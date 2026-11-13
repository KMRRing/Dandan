// The fleet in one small file for the director's dashboard (13 Nov 2026, Korbi: a fleet director chat with its own, more
// complete overview of regions and workers). Worked out from the snapshot fleet.yml has just taken, so it reads nothing new
// from the bucket; fleet.yml then writes it to fleet/summary.json in the bucket (the dashboard reads it through the viewer's
// Google connector) and to the fleet-status branch.
//
// node tools/fleet-summary.mjs <snapshot folder> [k8s.json] > summary.json
//   k8s.json: [{cluster, nodes, ready, pods, running}], one per Kubernetes cloudspace, from kubectl in fleet.yml
// Output:
//   workers: one row per region · kind · cores (machines, slots, busy, shards finished in the last 10 and 60 minutes)
//   unmapped: VM address prefixes no pool in fleet/sources.json claims (a pool whose `net` is still unknown)
//   jobs: every job with shards left (done, running, unclaimed, mean shard minutes, ETA at the current pace)
//   k8s: nodes ready of joined, lab pods running, per cluster
import fs from "node:fs";
import path from "node:path";

const snap = path.resolve(process.argv[2] || "snap"), M = 60000;
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(snap, p), "utf8")); } catch { return d; } };
const list = read("list.json", { objects: [] }), now = list.at || Date.now(), sources = read("o/fleet/sources.json", {});
const CLUSTERS = { "kmr-ring1-71": "Chicago", "kmr-ring1-25": "Hong Kong", "kmr-ring1-89": "US East", "kmr-ring1-86": "Dallas", "kmr-ring1-55": "London" };
// VM pools tell themselves apart only by address: each VM pool in sources.json gives its `net` prefix
const nets = (sources.rackspace?.pools || []).filter(p => p.net).map(p => [p.net, p.where.replace(/ \(VMs\)$/, "")]);
const region = w => {
  if (w.pool) return [CLUSTERS[w.pool] || w.pool, "Kubernetes"];
  const ip = (w.hw?.ips || []).find(a => !a.startsWith("127.")) || "";
  const hit = nets.find(([n]) => ip.startsWith(n));
  return hit ? [hit[1], "VMs"] : [ip ? `unmapped ${ip.split(".").slice(0, 3).join(".")}.` : `${w.cloud || "?"} (no address)`, "VMs"];
};

const dir = path.join(snap, "o/workers"), ws = [];
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { try { ws.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch {} }
const groups = {}, unmapped = new Set(), shardMin = {};
let stale = 0;
for (const w of ws) {
  if (now - w.t > 5 * M) { stale++; continue; }
  const [where, kind] = region(w), cores = w.hw?.present || w.slots;
  if (where.startsWith("unmapped")) unmapped.add(where.slice(9));
  const g = (groups[`${where}|${kind}|${cores}`] ||= { where, kind, cores, machines: 0, slots: 0, busy: 0, fin10: 0, fin60: 0, oldest: now, listH: 0, writeH: 0, readH: 0 });
  g.machines++; g.slots += w.slots; g.busy += (w.busy || []).length; g.oldest = Math.min(g.oldest, w.started || now);
  // bucket requests per hour, from each report's counts since the one before (13 Nov, the fleet director). A report written
  // when a shard starts closes a window of seconds that holds that claim's requests, and scaling it to an hour made Dallas
  // look 30 times dearer than it was (19:05Z): only windows of a minute or more are used, and the group's rate is scaled up
  // from the machines that had one
  g.sampled ||= 0;
  if (w.req?.ms >= 60000) { g.sampled++; const k = 3600000 / w.req.ms; g.listH += w.req.list * k; g.writeH += w.req.write * k; g.readH += w.req.read * k; }
  for (const [job, sec, at] of w.fin || []) {
    if (now - at < 10 * M) g.fin10++;
    if (now - at < 60 * M) { g.fin60++; const s = (shardMin[job] ||= { n: 0, sec: 0 }); s.n++; s.sec += sec; }
  }
}
// Google's prices for the bucket's class: lists and writes are class A, reads class B (dollars a request)
const CLASS_A = 0.005 / 1000, CLASS_B = 0.0004 / 1000;
for (const g of Object.values(groups)) { const k = g.sampled ? g.machines / g.sampled : 0; g.listH *= k; g.writeH *= k; g.readH *= k; delete g.sampled; }
const workers = Object.values(groups).map(g => ({ ...g, listH: Math.round(g.listH), writeH: Math.round(g.writeH), readH: Math.round(g.readH), reqCostH: Math.round(((g.listH + g.writeH) * CLASS_A + g.readH * CLASS_B) * 1000) / 1000, upMin: Math.round((now - g.oldest) / M), oldest: undefined }))
  .sort((a, b) => a.where.localeCompare(b.where) || a.kind.localeCompare(b.kind) || a.cores - b.cores);

// the queue, from the listing: claims and done marks per job, shards from each spec
const claims = {}, done = {}, claimAt = {}, doneSet = {};
for (const [name, updated] of list.objects) {
  let m = name.match(/^claims\/([^/]+)\/(\d+)$/); if (m) { claims[m[1]] = (claims[m[1]] || 0) + 1; (claimAt[m[1]] ||= {})[m[2]] = updated * 1000; continue; }
  m = name.match(/^results\/([^/]+)\/done-(\d+)$/); if (m) { done[m[1]] = (done[m[1]] || 0) + 1; (doneSet[m[1]] ||= new Set()).add(m[2]); }
}
const LEASE_MS = 15 * M;
const jobs = [], finished = [], jdir = path.join(snap, "o/jobs");
for (const f of fs.existsSync(jdir) ? fs.readdirSync(jdir) : []) {
  const spec = (() => { try { return JSON.parse(fs.readFileSync(path.join(jdir, f), "utf8")); } catch { return null; } })();
  const id = f.replace(/\.json$/, "");
  // a spec of no shards (the jt no-op stand-ins) is finished: listed so that workers' full looks skip it (19:55Z: 300 of
  // them sat on the open list, each costing a read and an open-list write when a worker looked)
  if (!spec?.shards) { if (spec) finished.push(id); continue; }
  const d = done[id] || 0;
  if (d >= spec.shards) { finished.push(id); continue; }
  const c = claims[id] || 0, s = shardMin[id], perHour = s?.n || 0;
  const lapsed = Object.entries(claimAt[id] || {}).filter(([k, t]) => now - t > LEASE_MS && !doneSet[id]?.has(k)).length;
  jobs.push({ id, purpose: (spec.purpose || "").slice(0, 160), shards: spec.shards, done: d, running: Math.max(0, c - d), unclaimed: Math.max(0, spec.shards - c), lapsed,
    shardMin: s ? Math.round(s.sec / s.n / 6) / 10 : null, perHour, etaMin: perHour ? Math.round(60 * (spec.shards - d) / perHour) : null });
}
jobs.sort((a, b) => a.id.localeCompare(b.id));

const k8s = (() => { try { return JSON.parse(fs.readFileSync(process.argv[3], "utf8")).map(k => ({ ...k, where: CLUSTERS[k.cluster] || k.cluster })); } catch { return []; } })();
const tot = workers.reduce((a, g) => ({ machines: a.machines + g.machines, slots: a.slots + g.slots, busy: a.busy + g.busy, fin10: a.fin10 + g.fin10, listH: a.listH + g.listH, writeH: a.writeH + g.writeH, readH: a.readH + g.readH, reqCostH: a.reqCostH + g.reqCostH }), { machines: 0, slots: 0, busy: 0, fin10: 0, listH: 0, writeH: 0, readH: 0, reqCostH: 0 });
tot.reqCostH = Math.round(tot.reqCostH * 1000) / 1000;
// open: the jobs with a free or lapsed shard, which fleet.yml adds to fleet/open.json (a backstop that only adds)
const open = jobs.filter(j => j.unclaimed > 0 || j.lapsed > 0).map(j => j.id);
process.stdout.write(JSON.stringify({ at: new Date(now).toISOString(), total: { ...tot, stale }, workers, unmapped: [...unmapped], jobs, k8s, open, finished }));
