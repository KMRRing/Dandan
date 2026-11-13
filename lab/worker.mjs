// The lab's worker, for machines that are not GitHub's (10 November 2026: Actions throttled the account). It takes the lab's
// shards (the scripts of lab/ that run as `<script> … {shard} {shards} {out}`) from a queue in a Cloud Storage bucket, runs one
// at a time on each core, and puts what they wrote back in the bucket. It needs nothing installed but Node 22 and git, and no
// secret: on a Google machine it works as the machine's own service account (the metadata server), and the code comes from
// the public repo. A session queues work and reads results with `gcloud storage` (see lab/README or the notes at the end).
//
//   bucket layout
//     jobs/<id>.json            { id, script, args, shards, ref, repo?, timeoutMin? }  args: {shard} {shards} {out} filled in
//     claims/<id>/<shard>       who is running it and when it last said so (made only if absent: the claim is atomic;
//                               a claim not renewed for LEASE is taken over, so a machine that is gone (Spot) loses its shards)
//     results/<id>/part-<shard>.jsonl, stdout-<shard>.txt, done-<shard>   what a shard wrote, what it printed, and how it ended
//   A job's spec may also say why it was run (`purpose`) and, once read, what came of it (`outcome`): lab/ledger.mjs lists them
//   all, kept for good whether a job led anywhere or not, so nothing is run twice by mistake. A job stopped before its end
//   is moved to retired/<id>.json, out of the workers' sight but still in the ledger.
//
// LAB_FILL=1 (10 November 2026, Korbi: keep the machines on something useful at all times): when no shard is left the worker
// queues the next batch of self-play; a worker filling never stops for want of work. The batches are spm<n> (11 November 2026):
// 120 games of Hard against itself at mixed depth with the live value net (lab/selfplay.mjs `mix`: a quarter of the decisions at
// Deep with every legal move weighed, the lessons for a learned policy; the rest at 128 deals, which keeps the games many), seeds
// from 2,000,000 on, each batch at the commit `main` was at when it was queued. Before them: spb01-390, Hard at 256 deals with the
// old value net, then at 128 with v14, all at whatever `main` was that minute. The value-net training that used to follow every
// batch (jt<n>, on all batches so far) is gone: from about 10,000 games on it no longer finished in its four hours or its memory.
//
// usage: node lab/worker.mjs            (on Google: LAB_BUCKET=<bucket>)      a worker stops when nothing has come for LAB_IDLE_MIN
//        LAB_DIR=<folder> node lab/worker.mjs   (the same queue in a folder, for trying it out)
// settings (environment): LAB_KEY a service-account key file, off Google; LAB_FILL (above), LAB_SLOTS cores to use (all), LAB_IDLE_MIN minutes without work before it stops (15), LAB_POLL_SEC (15),
//        LAB_MAX_HOURS the most it ever runs (8), LAB_WORK where it works (/tmp/lab-work), LAB_REPO the repo to run (the public one).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { googleToken } from "./lib.mjs";
import { readOpen, editOpen, OPEN_STALE_MS } from "./open-list.mjs";

const env = process.env;
const SLOTS = Number(env.LAB_SLOTS) || os.cpus().length, WORK = env.LAB_WORK || "/tmp/lab-work";
const IDLE_MS = (Number(env.LAB_IDLE_MIN) || 15) * 60000, POLL_MS = (Number(env.LAB_POLL_SEC) || 15) * 1000, MAX_MS = (Number(env.LAB_MAX_HOURS) || 8) * 3600000;
const REPO = env.LAB_REPO || "https://github.com/KMRRing/Dandan.git";
const LEASE_MS = 15 * 60000, BEAT_MS = 2 * 60000, NAME = `${os.hostname()}-${process.pid}`, T0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- the bucket (or a folder that works like one) ----------
/** A store: list(prefix) → [{ name, generation, t (ms, when last written) }], get(name) → text or null, put(name, text, { ifAbsent, ifGeneration }) → whether it was written. */
function folderStore(root) {
  const file = n => path.join(root, n), gen = f => String(fs.statSync(f).mtimeMs);
  return {
    async list(prefix) {
      const out = [];
      const walk = d => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push({ name: path.relative(root, f), generation: gen(f), t: fs.statSync(f).mtimeMs }); } };
      walk(root);
      return out.filter(o => o.name.startsWith(prefix));
    },
    async get(name) { return fs.existsSync(file(name)) ? fs.readFileSync(file(name), "utf8") : null; },
    async getG(name) { return fs.existsSync(file(name)) ? { text: fs.readFileSync(file(name), "utf8"), generation: gen(file(name)) } : null; },
    async put(name, body, { ifAbsent, ifGeneration } = {}) {
      const f = file(name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      if (ifAbsent) { try { fs.writeFileSync(f, body, { flag: "wx" }); return true; } catch (e) { if (e.code === "EEXIST") return false; throw e; } }
      if (ifGeneration && (!fs.existsSync(f) || gen(f) !== ifGeneration)) return false;
      fs.writeFileSync(f, body); return true;
    },
    async del(name) { fs.rmSync(file(name), { force: true }); },
  };
}
function bucketStore(bucket) {
  const token = googleToken;   // the machine's own account on Google, a service-account key (LAB_KEY) elsewhere
  const call = async (url, init = {}) => {
    for (let tries = 0; ; tries++) {
      try {
        const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await token()}` } });
        if ((r.status === 429 || r.status >= 500) && tries < 5) { await sleep(1000 * 2 ** tries); continue; }
        return r;
      } catch (e) { if (tries >= 5) throw e; await sleep(1000 * 2 ** tries); }
    }
  };
  const api = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`, up = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o`;
  return {
    async list(prefix) {
      const out = []; let page;
      do {
        REQ.list++;
        const q = new URLSearchParams({ prefix, maxResults: "1000", fields: "items(name,generation,updated),nextPageToken" }); if (page) q.set("pageToken", page);
        const r = await call(`${api}?${q}`); if (!r.ok) throw new Error("list " + r.status + " " + await r.text());
        const j = await r.json(); out.push(...(j.items || []).map(o => ({ ...o, t: Date.parse(o.updated) }))); page = j.nextPageToken;
      } while (page);
      return out;
    },
    async get(name) {
      REQ.read++;
      const r = await call(`${api}/${encodeURIComponent(name)}?alt=media`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("get " + r.status); return r.text();
    },
    async getG(name) {
      REQ.read++;
      const r = await call(`${api}/${encodeURIComponent(name)}?alt=media`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("get " + r.status); return { text: await r.text(), generation: r.headers.get("x-goog-generation") };
    },
    async put(name, body, { ifAbsent, ifGeneration } = {}) {
      REQ.write++;
      const q = new URLSearchParams({ uploadType: "media", name }); if (ifAbsent) q.set("ifGenerationMatch", "0"); else if (ifGeneration) q.set("ifGenerationMatch", ifGeneration);
      const r = await call(`${up}?${q}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
      if (r.status === 412) return false;
      if (!r.ok) throw new Error("put " + r.status + " " + await r.text()); return true;
    },
    async del(name) { REQ.write++; await call(`${api}/${encodeURIComponent(name)}`, { method: "DELETE" }); },
  };
}
// the bucket requests this worker made (13 Nov, the fleet director): lists and writes are Google's class A (about $0.005 a
// thousand), reads class B (about $0.0004); each report carries the counts since the one before
const REQ = { list: 0, write: 0, read: 0 };
const store = env.LAB_DIR ? folderStore(path.resolve(env.LAB_DIR)) : bucketStore(env.LAB_BUCKET || (() => { throw new Error("set LAB_BUCKET (or LAB_DIR to try it in a folder)"); })());

// ---------- finding a shard to run ----------
const claimBody = () => JSON.stringify({ by: NAME, t: Date.now() });
const finished = new Set(), FILL = env.LAB_FILL === "1";
let STOPPING = false;
// a stop (a spot reclaim, a pod restart) hands its shards back at once: their claims are deleted, so another worker takes them
// now rather than after LEASE_MS (16:38Z: a rolling restart left ~500 shards held by gone pods for 15 minutes)
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
  STOPPING = true; log(`${sig}: stopping, shards in hand handed back`);
  const back = [...BUSY.values()];
  for (const w of back) store.del(`claims/${w}`).catch(() => {});
  if (back.length) editOpen(store, jobs => { for (const w of back) jobs[w.split("/")[0]] = 1; return true; }, { by: NAME }).catch(() => {});
  setTimeout(() => process.exit(0), 5000);
});
const doneCount = async id => (await store.list(`results/${id}/done-`)).length;
// sps<n> (12 November 2026, Fable: S4 d crowned, so the games it learns from next are its own): flat 128 deals with value net
// S4 d in both seats; spf<n> before it played v14 the same way, spm<n> before that mixed depths
/**
 * The filler's spec (13 Nov 2026, Fable): read from fleet/filler.json in the bucket at every refill, so a new benchmark reaches
 * running workers without a restart: { prefix, shards, games (a shard's games), seedBase, args (with {seed} for the batch's
 * first seed), purpose }. Without the file, or with one that doesn't parse, the built-in below.
 */
const FILLER = {
  prefix: "sps", shards: 24, games: 120, seedBase: 5000000, timeoutMin: 240,
  args: "{shard} {shards} {out} 128 120 {seed} hardall-cut @aa-g8-s5-r#24",
  purpose: "Hard at 128 deals with value net S5 (the benchmark, 13 Nov) against itself, every legal move weighed, harder cutting (hardall-cut): filler games for the next value net",
};
/** The commit `main` is at now: a batch queued at it says which engine played it (one queued at "main" can't, as main moves on). */
function mainSha() {
  try { return execFileSync("git", ["ls-remote", REPO, "refs/heads/main"], { encoding: "utf8", timeout: 20000 }).split(/\s+/)[0] || "main"; } catch { return "main"; }
}
async function fillerSpec() {
  try { const t = await store.get("fleet/filler.json"); if (t) return { ...FILLER, ...JSON.parse(t) }; } catch (e) { log("fleet/filler.json:", e.message); }
  return FILLER;
}
/** The queue run dry, with LAB_FILL: the next batch of self-play, once the last one is finished or all taken. True when it queued one. */
async function refill() {
  const F = await fillerSpec(), batch = n => `${F.prefix}${String(n).padStart(3, "0")}`, re = new RegExp(`^${F.prefix}\\d+$`);
  const ids = (await store.list("jobs/")).map(o => path.basename(o.name, ".json"));
  const last = Math.max(0, ...ids.filter(i => re.test(i)).map(i => Number(i.slice(F.prefix.length))));
  // the last batch's own size, not the spec's now (16:40Z, the fleet director: after shards went 24 → 240, 24-shard batches
  // never looked fully taken, so the chain stalled)
  const lastShards = last ? (await specOf({ name: `jobs/${batch(last)}.json`, generation: "open" }).catch(() => null))?.shards || F.shards : F.shards;
  if (last && (await doneCount(batch(last))) < lastShards && (await store.list(`claims/${batch(last)}/`)).length < lastShards) {
    // the last batch still has free shards, yet the open list (which sent us here) didn't name it: an update was lost
    await editOpen(store, jobs => (jobs[batch(last)] ? false : ((jobs[batch(last)] = 1), true)), { by: NAME }).catch(e => log("open list:", e.message));
    return false;
  }
  const spec = {
    ref: mainSha(), repo: REPO, id: batch(last + 1), script: F.script || "selfplay.mjs", args: F.args.replace("{seed}", String(F.seedBase + F.games * last)), shards: F.shards, timeoutMin: F.timeoutMin,
    purpose: F.purpose, made: { by: NAME, at: new Date().toISOString() },
  };
  if (!(await store.put(`jobs/${spec.id}.json`, JSON.stringify(spec), { ifAbsent: true }))) return false;
  await editOpen(store, jobs => ((jobs[spec.id] = 1), true), { by: NAME }).catch(e => log("open list:", e.message));
  return true;
}
// A job's spec, read once a version (the listing's generation changes when a spec is rewritten)
const specs = new Map();
async function specOf(o) {
  const k = o.generation === "open" ? `${o.name}#open${Math.floor(Date.now() / 600000)}` : `${o.name}#${o.generation}`;
  if (!specs.has(k)) specs.set(k, JSON.parse(await store.get(o.name)));
  return specs.get(k);
}
// 13 Nov (Korbi: "not all cores busy?"): with shards of a minute, a slot spent a large share of its time looking for the next
// one: every result file of every job listed (parts and logs too), each spec read again, and every slot racing for the same
// lowest free shard. Now only the done marks are listed, specs are kept, and each slot starts its search at a random shard.
// 13 Nov (fleet director: idle slots' listings cost more in bucket requests than the machines): a job whose every shard is
// claimed is skipped for FULL_MS, as a claim can only lapse after LEASE_MS; a lapsed one is taken up at most FULL_MS late
const fullUntil = new Map(), FULL_MS = 3 * 60000;
/**
 * Look at the queue for a shard: claimed for this worker and returned, or null. With ids, only those jobs (the open list's);
 * without, every job in jobs/ (a full look). What it learns goes back to fleet/open.json: a job finished, fully claimed or gone
 * is taken out, one with a free or lapsed shard put in. A full look rewrites the whole list, and writes it even unchanged, so
 * its time says when the queue was last seen whole.
 */
async function scan(ids, open) {
  const objs = ids ? ids.map(id => ({ name: `jobs/${id}.json`, generation: "open" })) : await store.list("jobs/");
  const now = Date.now(), seen = new Map();   // id → true (may have work) / false (nothing to take)
  let found = null;
  for (const o of objs) {
    const id = path.basename(o.name, ".json");
    if (finished.has(id)) { seen.set(id, false); continue; }
    if (fullUntil.get(id) > now) { seen.set(id, false); continue; }
    if (found) continue;   // not looked at after the claim: left as the list has it
    const spec = await specOf(o).catch(() => null);
    if (!spec?.shards) { seen.set(id, false); continue; }
    const [claims, results] = await Promise.all([store.list(`claims/${id}/`), store.list(`results/${id}/done-`)]);
    const done = new Set(results.map(r => path.basename(r.name)).filter(n => /^done-\d+$/.test(n)).map(n => Number(n.slice(5))));
    if (done.size >= spec.shards) { finished.add(id); seen.set(id, false); continue; }
    const claimed = new Map(claims.map(c => [Number(path.basename(c.name)), c]));
    const free = [], lapsed = [];
    for (let k = 0; k < spec.shards; k++) {
      if (done.has(k)) continue;
      const c = claimed.get(k);
      if (!c) free.push(k); else if (now - c.t > LEASE_MS) lapsed.push(c);
    }
    if (!free.length && !lapsed.length) { fullUntil.set(id, now + FULL_MS); seen.set(id, false); continue; }
    // each slot starts at a random free shard, so slots don't all race for the same one
    const start = Math.floor(Math.random() * free.length);
    for (let k = 0; k < free.length && !found; k++) {
      const shard = free[(start + k) % free.length];
      if (await store.put(`claims/${id}/${shard}`, claimBody(), { ifAbsent: true })) found = { spec, shard, left: free.length - 1 + lapsed.length };
    }
    // the claim's age from the listing (13 Nov, Fable): its holder rewrites it every BEAT_MS, so its last write is its last beat
    for (const c of lapsed) {
      if (found) break;
      if (await store.put(c.name, claimBody(), { ifGeneration: c.generation })) { log(`took over ${c.name} (silent ${Math.round((now - c.t) / 60000)} min)`); found = { spec, shard: Number(path.basename(c.name)), left: lapsed.length - 1 }; }
    }
    seen.set(id, found ? found.left > 0 : false);
    if (!found) fullUntil.set(id, now + FULL_MS);   // every free shard was taken by others while this worker tried
  }
  const listed = new Set(objs.map(o => path.basename(o.name, ".json")));
  const differs = jobs => [...seen].some(([id, may]) => may !== Boolean(jobs[id]));
  if (!ids || differs(open?.jobs || {})) {
    await editOpen(store, jobs => {
      if (!ids) for (const id of Object.keys(jobs)) if (!listed.has(id)) delete jobs[id];   // no longer in jobs/
      let changed = false;
      for (const [id, may] of seen) { if (may && !jobs[id]) { jobs[id] = 1; changed = true; } else if (!may && jobs[id]) { delete jobs[id]; changed = true; } }
      return changed;
    }, { by: NAME, touch: !ids }).catch(e => log("open list:", e.message));
  }
  return found;
}
/**
 * The machine's poller looks for work (13 Nov 2026, the fleet director's rules): it reads fleet/open.json, and looks only at the
 * jobs it names. A full look instead when the file is missing, unreadable or older than OPEN_STALE_MS, or has said "nothing"
 * for OPEN_STALE_MS on end, so a lost or stale update can't leave slots asleep. Returns { work, empty }.
 */
let emptySince = 0;
async function findWork() {
  const open = await readOpen(store), now = Date.now(), ids = open ? Object.keys(open.jobs) : [];
  if (open && !ids.length) emptySince ||= now; else emptySince = 0;
  if (!open || now - open.t > OPEN_STALE_MS || (emptySince && now - emptySince > OPEN_STALE_MS)) {
    emptySince = 0;
    const work = await scan(null, open);
    return { work, empty: !work };
  }
  if (!ids.length) return { work: null, empty: true };
  const work = await scan(ids, open);
  return { work, empty: false };
}

// ---------- running one ----------
const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: ["ignore", "ignore", "inherit"] });
async function runShard(slot, spec, shard) {
  const id = spec.id, t0 = Date.now(), dir = path.join(WORK, `slot${slot}`), repo = path.join(dir, "repo"), run = path.join(dir, "run");
  if (!/^[a-z0-9-]+\.mjs$/.test(spec.script)) throw new Error("bad script name " + spec.script);
  fs.mkdirSync(dir, { recursive: true });
  const repoUrl = spec.repo || REPO;
  if (!fs.existsSync(path.join(repo, ".git"))) execFileSync("git", ["clone", "-q", "--depth=1", repoUrl, repo], { stdio: ["ignore", "ignore", "inherit"] });
  git(repo, "fetch", "-q", "--depth=1", "origin", spec.ref);
  git(repo, "checkout", "-q", "--detach", "-f", "FETCH_HEAD");
  // the scripts keep their own builds beside the repo (../tune-fit, ../quick-champion…): each slot's are its own, begun afresh
  for (const e of fs.readdirSync(dir)) if (e !== "repo") fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  git(repo, "worktree", "prune");
  fs.mkdirSync(run, { recursive: true });
  const out = path.join(run, `part-${shard}.jsonl`), printed = path.join(run, `stdout-${shard}.txt`);
  const argv = spec.args.replaceAll("{shard}", shard).replaceAll("{shards}", spec.shards).replaceAll("{out}", out).split(/\s+/).filter(Boolean);
  log(`slot ${slot}: ${id}/${shard} ${spec.script} ${argv.join(" ")}`);
  const fd = fs.openSync(printed, "w");
  // a larger young generation (13 Nov, Fable): fewer collections of the look-ahead's short-lived states; the same moves (lab/bench.mjs hashes)
  const child = spawn(process.execPath, ["--max-semi-space-size=32", `lab/${spec.script}`, ...argv], { cwd: repo, stdio: ["ignore", fd, fd] });
  const beat = setInterval(() => store.put(`claims/${id}/${shard}`, claimBody()).catch(() => {}), BEAT_MS);
  const limit = setTimeout(() => child.kill("SIGKILL"), (spec.timeoutMin || 120) * 60000);
  const code = await new Promise(res => child.on("exit", (c, sig) => res(c ?? sig)));
  clearInterval(beat); clearTimeout(limit); fs.closeSync(fd);
  // the machine itself is going (a spot reclaim, a stop): the shard didn't fail, so leave it unfinished; its claim lapses
  // and another worker takes it up (11 Nov 2026: four trainings were marked done when their machines were taken back)
  if (STOPPING) { log(`slot ${slot}: ${id}/${shard} cut short by the machine stopping: left for another worker`); return; }
  if (fs.existsSync(out)) await store.put(`results/${id}/part-${shard}.jsonl`, fs.readFileSync(out));
  await store.put(`results/${id}/stdout-${shard}.txt`, fs.readFileSync(printed));
  await store.put(`results/${id}/done-${shard}`, JSON.stringify({ code, seconds: Math.round((Date.now() - t0) / 1000), by: NAME }));
  if (code === 0) { FIN.push([id, Math.round((Date.now() - t0) / 1000), Date.now()]); while (FIN.length > 40) FIN.shift(); }
  log(`slot ${slot}: ${id}/${shard} ended with ${code} after ${Math.round((Date.now() - t0) / 1000)} s`);
}

// A newer worker on main (13 Nov 2026): every 10 minutes the worker compares its own file with main's; when they differ it
// takes no new shard, and once its slots have finished it exits, so the machine's loop (VM service, Kubernetes restart) starts
// the new one. Shards in hand are never cut short for it.
let DRAIN = false;
const OWN = fs.readFileSync(new URL(import.meta.url), "utf8");
async function checkNewer() {
  if (env.LAB_DIR || DRAIN) return;
  try {
    const r = await fetch(`${REPO.replace(/\.git$/, "").replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/lab/worker.mjs`);
    if (r.ok && (await r.text()) !== OWN) { DRAIN = true; log("a newer worker is on main: finishing the shards in hand, then restarting"); }
  } catch { /* offline: try again next time */ }
}
setInterval(checkNewer, 10 * 60000).unref();
/**
 * One poller a machine while the queue has nothing for it (13 Nov 2026, fleet director): every idle slot listing the queue
 * every 15 s cost about 30 bucket list requests a poll, dollars an hour at a few hundred idle slots. Now the first slot to find
 * nothing becomes the machine's poller and closes the gate; it polls with a backoff from POLL_MS doubling to BACKOFF_MAX, and the
 * other idle slots wait at the gate. When the poller finds a shard it opens the gate, and each waiting slot looks once itself.
 * With LAB_FILL (every lab machine) there is no backoff: the poller makes the next filler batch as soon as the last is taken.
 */
const BACKOFF_MAX = (Number(env.LAB_BACKOFF_SEC) || 120) * 1000;
let gate = null, backoff = POLL_MS;
const closeGate = () => { let open; gate = { p: new Promise(r => (open = r)), open: () => open() }; };
const openGate = () => { const g = gate; gate = null; backoff = POLL_MS; g?.open(); };
async function slotLoop(slot) {
  await sleep(slot * 700);
  let idleSince = Date.now(), polling = false;
  while (Date.now() - T0 < MAX_MS && !DRAIN) {
    if (gate && !polling) { await gate.p; continue; }
    let work = null, empty = true;
    try { ({ work, empty } = await findWork()); } catch (e) { log("queue:", e.message); }
    if (work) {
      if (polling) { polling = false; openGate(); } else backoff = POLL_MS;
      BUSY.set(slot, `${work.spec.id}/${work.shard}`); beatWorker();
      try { await runShard(slot, work.spec, work.shard); } catch (e) { log(`slot ${slot}: ${work.spec.id}/${work.shard} failed to run:`, e.message); await store.put(`results/${work.spec.id}/done-${work.shard}`, JSON.stringify({ code: "worker error", error: String(e.message), by: NAME })).catch(() => {}); }
      BUSY.delete(slot);
      idleSince = Date.now();
      continue;
    }
    // a filler batch only when the open list had nothing: with work listed, the refill's own listings would be wasted
    if (FILL && empty) { try { if (await refill()) { backoff = POLL_MS; continue; } } catch (e) { log("refill:", e.message); } }
    else if (Date.now() - idleSince > IDLE_MS) break;
    if (!gate) { closeGate(); polling = true; }
    // with LAB_FILL the queue is only ever empty until someone makes the next batch, so the poller keeps POLL_MS (16:28Z, the
    // fleet director: backed-off pollers left batch-making to old workers, which made small batches on the old spec)
    if (polling) { await sleep(backoff + Math.random() * 3000); if (!FILL) backoff = Math.min(backoff * 2, BACKOFF_MAX); }
  }
  if (polling) openGate();
}
// ---------- saying what this machine is doing ----------
// workers/<name>.json, every BEAT (11 November 2026, Korbi: the Fleet page shows whether every core on Google and AWS is
// working): which cloud, how many cores, and the shard each busy core has. Taken away when the worker stops; one a machine
// left behind (taken back mid-run) goes stale, and the page reads only fresh ones.
const CLOUD = env.LAB_CLOUD || (env.AWS_BATCH_JOB_ID ? "aws" : env.LAB_KEY ? "other" : "gcp"), BUSY = new Map();
// the shards this worker finished, [job, seconds, when] (the last 40): the Fleet page compares a machine's seconds a shard with
// the fleet's for the same job, which is its speed; LAB_POOL names the pool it belongs to (a Kubernetes cluster sets it), as
// a pod's name says nothing of where it runs (13 Nov 2026, Korbi: cost per working core and per unit of computing power)
const FIN = [], POOL = env.LAB_POOL || null;
// a machine can start with fewer cores than it has (12 Nov 2026: two Rackspace VMs of 16 came up seeing one): each beat looks
// again, and cores that have appeared get their own slot (unless LAB_SLOTS fixed the count)
const loops = [];
// Linux can be given cores it leaves switched off (hot-added, "offline"): the worker runs as root, so it switches them on first
const CPU = "/sys/devices/system/cpu";
const cpuList = f => { try { return fs.readFileSync(`${CPU}/${f}`, "utf8").trim().split(",").filter(Boolean).flatMap(r => { const [a, b = a] = r.split("-").map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); }); } catch { return []; } };
function wakeCores() {
  const on = new Set(cpuList("online"));
  for (const c of cpuList("present")) if (!on.has(c)) { try { fs.writeFileSync(`${CPU}/cpu${c}/online`, "1"); } catch {} }
}
const grow = () => { wakeCores(); const n = env.LAB_SLOTS ? SLOTS : Math.max(SLOTS, os.cpus().length); while (loops.length < n) loops.push(slotLoop(loops.length)); };
// the machine's own IPv4 addresses (not loopback): the fleet page tells two pools of the same machine size apart by address
// range (12 Nov: two Rackspace pools of 4-core machines, Hong Kong and Sydney)
const ipv4 = () => Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => a.address);
const hw = () => ({ cpus: os.cpus().length, avail: os.availableParallelism?.(), present: cpuList("present").length, possible: cpuList("possible").length, offline: cpuList("offline").length, memGB: Math.round(os.totalmem() / 2 ** 30), ips: ipv4() });
let lastBeat = T0;
const beatWorker = () => {
  grow();
  // the bucket requests since the last report, over `ms` (13 Nov, the fleet director); this report's own write counts in the next
  const now = Date.now(), req = { ...REQ, ms: now - lastBeat }; REQ.list = REQ.write = REQ.read = 0; lastBeat = now;
  return store.put(`workers/${NAME}.json`, JSON.stringify({ by: NAME, cloud: CLOUD, pool: POOL, fin: FIN, slots: loops.length, hw: hw(), busy: [...BUSY.values()], req, started: T0, t: now })).catch(() => {});
};
const workerBeat = setInterval(beatWorker, BEAT_MS);
beatWorker();
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { store.del(`workers/${NAME}.json`).catch(() => {}); });
log(`worker ${NAME}: ${SLOTS} slots, ${env.LAB_DIR ? "folder " + env.LAB_DIR : "bucket " + env.LAB_BUCKET}`);
grow();
for (let n = 0; n < loops.length; ) { n = loops.length; await Promise.all(loops); }   // a slot added while waiting is waited for too
clearInterval(workerBeat);
await store.del(`workers/${NAME}.json`).catch(() => {});
log(DRAIN ? "restarting for the newer worker" : "no more work: stopping");
process.exit(0);
