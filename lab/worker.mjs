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

const env = process.env;
const SLOTS = Number(env.LAB_SLOTS) || os.cpus().length, WORK = env.LAB_WORK || "/tmp/lab-work";
const IDLE_MS = (Number(env.LAB_IDLE_MIN) || 15) * 60000, POLL_MS = (Number(env.LAB_POLL_SEC) || 15) * 1000, MAX_MS = (Number(env.LAB_MAX_HOURS) || 8) * 3600000;
const REPO = env.LAB_REPO || "https://github.com/KMRRing/Dandan.git";
const LEASE_MS = 15 * 60000, BEAT_MS = 2 * 60000, NAME = `${os.hostname()}-${process.pid}`, T0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- the bucket (or a folder that works like one) ----------
/** A store: list(prefix) → [{ name, generation }], get(name) → text or null, put(name, text, { ifAbsent, ifGeneration }) → whether it was written. */
function folderStore(root) {
  const file = n => path.join(root, n), gen = f => String(fs.statSync(f).mtimeMs);
  return {
    async list(prefix) {
      const out = [];
      const walk = d => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push({ name: path.relative(root, f), generation: gen(f) }); } };
      walk(root);
      return out.filter(o => o.name.startsWith(prefix));
    },
    async get(name) { return fs.existsSync(file(name)) ? fs.readFileSync(file(name), "utf8") : null; },
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
        const q = new URLSearchParams({ prefix, maxResults: "1000", fields: "items(name,generation),nextPageToken" }); if (page) q.set("pageToken", page);
        const r = await call(`${api}?${q}`); if (!r.ok) throw new Error("list " + r.status + " " + await r.text());
        const j = await r.json(); out.push(...(j.items || [])); page = j.nextPageToken;
      } while (page);
      return out;
    },
    async get(name) {
      const r = await call(`${api}/${encodeURIComponent(name)}?alt=media`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("get " + r.status); return r.text();
    },
    async put(name, body, { ifAbsent, ifGeneration } = {}) {
      const q = new URLSearchParams({ uploadType: "media", name }); if (ifAbsent) q.set("ifGenerationMatch", "0"); else if (ifGeneration) q.set("ifGenerationMatch", ifGeneration);
      const r = await call(`${up}?${q}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
      if (r.status === 412) return false;
      if (!r.ok) throw new Error("put " + r.status + " " + await r.text()); return true;
    },
    async del(name) { await call(`${api}/${encodeURIComponent(name)}`, { method: "DELETE" }); },
  };
}
const store = env.LAB_DIR ? folderStore(path.resolve(env.LAB_DIR)) : bucketStore(env.LAB_BUCKET || (() => { throw new Error("set LAB_BUCKET (or LAB_DIR to try it in a folder)"); })());

// ---------- finding a shard to run ----------
const claimBody = () => JSON.stringify({ by: NAME, t: Date.now() });
const finished = new Set(), FILL = env.LAB_FILL === "1";
let STOPPING = false;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { STOPPING = true; log(`${sig}: stopping, shards in hand left unfinished`); setTimeout(() => process.exit(0), 5000); });
const doneCount = async id => (await store.list(`results/${id}/`)).filter(r => /\/done-\d+$/.test(r.name)).length;
// sps<n> (12 November 2026, Fable: S4 d crowned, so the games it learns from next are its own): flat 128 deals with value net
// S4 d in both seats; spf<n> before it played v14 the same way, spm<n> before that mixed depths
const batch = n => `sps${String(n).padStart(3, "0")}`;
/** The commit `main` is at now: a batch queued at it says which engine played it (one queued at "main" can't, as main moves on). */
function mainSha() {
  try { return execFileSync("git", ["ls-remote", REPO, "refs/heads/main"], { encoding: "utf8", timeout: 20000 }).split(/\s+/)[0] || "main"; } catch { return "main"; }
}
/** The queue run dry, with LAB_FILL: the next batch of self-play, once the last one is finished or all taken. */
async function refill() {
  const ids = (await store.list("jobs/")).map(o => path.basename(o.name, ".json"));
  const last = Math.max(0, ...ids.filter(i => /^sps\d+$/.test(i)).map(i => Number(i.slice(3))));
  if (last && (await doneCount(batch(last))) < 24 && !(await allClaimed(batch(last)))) return;
  const spec = {
    ref: mainSha(), repo: REPO, id: batch(last + 1), script: "selfplay.mjs", args: `{shard} {shards} {out} 128 120 ${5000000 + 120 * last} hard s4d.json`, shards: 24, timeoutMin: 240,
    purpose: "Hard at 128 deals with value net S4 d against itself: filler games for the next value net",
    made: { by: NAME, at: new Date().toISOString() },
  };
  await store.put(`jobs/${spec.id}.json`, JSON.stringify(spec), { ifAbsent: true });
}
const allClaimed = async id => (await store.list(`claims/${id}/`)).length >= 24;
/** The next shard nobody has (or whose claim lapsed): claimed for this worker, or null. */
async function nextShard() {
  for (const o of await store.list("jobs/")) {
    const id = path.basename(o.name, ".json");
    if (finished.has(id)) continue;
    const spec = JSON.parse(await store.get(o.name));
    const [claims, results] = await Promise.all([store.list(`claims/${id}/`), store.list(`results/${id}/`)]);
    const done = new Set(results.map(r => path.basename(r.name)).filter(n => /^done-\d+$/.test(n)).map(n => Number(n.slice(5))));
    if (done.size >= spec.shards) { finished.add(id); continue; }
    const claimed = new Map(claims.map(c => [Number(path.basename(c.name)), c]));
    for (let shard = 0; shard < spec.shards; shard++) {
      if (done.has(shard)) continue;
      const c = claimed.get(shard);
      if (!c) { if (await store.put(`claims/${id}/${shard}`, claimBody(), { ifAbsent: true })) return { spec, shard }; continue; }
      const held = JSON.parse((await store.get(c.name)) || "{}");
      if (Date.now() - (held.t || 0) > LEASE_MS && await store.put(c.name, claimBody(), { ifGeneration: c.generation })) { log(`took over ${id}/${shard} from ${held.by}`); return { spec, shard }; }
    }
  }
  return null;
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
  const child = spawn(process.execPath, [`lab/${spec.script}`, ...argv], { cwd: repo, stdio: ["ignore", fd, fd] });
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
  log(`slot ${slot}: ${id}/${shard} ended with ${code} after ${Math.round((Date.now() - t0) / 1000)} s`);
}

async function slotLoop(slot) {
  await sleep(slot * 700);
  let idleSince = Date.now();
  while (Date.now() - T0 < MAX_MS) {
    let work = null;
    try { work = await nextShard(); } catch (e) { log("queue:", e.message); }
    if (work) {
      BUSY.set(slot, `${work.spec.id}/${work.shard}`); beatWorker();
      try { await runShard(slot, work.spec, work.shard); } catch (e) { log(`slot ${slot}: ${work.spec.id}/${work.shard} failed to run:`, e.message); await store.put(`results/${work.spec.id}/done-${work.shard}`, JSON.stringify({ code: "worker error", error: String(e.message), by: NAME })).catch(() => {}); }
      BUSY.delete(slot);
      idleSince = Date.now();
      continue;
    }
    if (FILL) { try { await refill(); } catch (e) { log("refill:", e.message); } }
    else if (Date.now() - idleSince > IDLE_MS) return;
    await sleep(POLL_MS + Math.random() * 3000);
  }
}
// ---------- saying what this machine is doing ----------
// workers/<name>.json, every BEAT (11 November 2026, Korbi: the Fleet page shows whether every core on Google and AWS is
// working): which cloud, how many cores, and the shard each busy core has. Taken away when the worker stops; one a machine
// left behind (taken back mid-run) goes stale, and the page reads only fresh ones.
const CLOUD = env.LAB_CLOUD || (env.AWS_BATCH_JOB_ID ? "aws" : env.LAB_KEY ? "other" : "gcp"), BUSY = new Map();
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
const beatWorker = () => { grow(); return store.put(`workers/${NAME}.json`, JSON.stringify({ by: NAME, cloud: CLOUD, slots: loops.length, hw: hw(), busy: [...BUSY.values()], started: T0, t: Date.now() })).catch(() => {}); };
const workerBeat = setInterval(beatWorker, BEAT_MS);
beatWorker();
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { store.del(`workers/${NAME}.json`).catch(() => {}); });
log(`worker ${NAME}: ${SLOTS} slots, ${env.LAB_DIR ? "folder " + env.LAB_DIR : "bucket " + env.LAB_BUCKET}`);
grow();
for (let n = 0; n < loops.length; ) { n = loops.length; await Promise.all(loops); }   // a slot added while waiting is waited for too
clearInterval(workerBeat);
await store.del(`workers/${NAME}.json`).catch(() => {});
log("no more work: stopping");
