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
// queues the next batch of self-play (spb<n>, 120 games of Hard at 256 deals against itself, seeds after the batch before) and,
// for each finished batch, a training of the judge on all batches up to it (jt<n>); a worker filling never stops for want of work.
//
// usage: node lab/worker.mjs            (on Google: LAB_BUCKET=<bucket>)      a worker stops when nothing has come for LAB_IDLE_MIN
//        LAB_DIR=<folder> node lab/worker.mjs   (the same queue in a folder, for trying it out)
// settings (environment): LAB_FILL (above), LAB_SLOTS cores to use (all), LAB_IDLE_MIN minutes without work before it stops (15), LAB_POLL_SEC (15),
//        LAB_MAX_HOURS the most it ever runs (8), LAB_WORK where it works (/tmp/lab-work), LAB_REPO the repo to run (the public one).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

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
  };
}
function bucketStore(bucket) {
  let tok = null, exp = 0;
  const token = async () => {
    if (tok && Date.now() < exp) return tok;
    const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    if (!r.ok) throw new Error("no access token from the metadata server: " + r.status);
    const j = await r.json(); tok = j.access_token; exp = Date.now() + (j.expires_in - 120) * 1000; return tok;
  };
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
  };
}
const store = env.LAB_DIR ? folderStore(path.resolve(env.LAB_DIR)) : bucketStore(env.LAB_BUCKET || (() => { throw new Error("set LAB_BUCKET (or LAB_DIR to try it in a folder)"); })());

// ---------- finding a shard to run ----------
const claimBody = () => JSON.stringify({ by: NAME, t: Date.now() });
const finished = new Set(), FILL = env.LAB_FILL === "1";
const doneCount = async id => (await store.list(`results/${id}/`)).filter(r => /\/done-\d+$/.test(r.name)).length;
const batch = n => `spb${String(n).padStart(2, "0")}`;
/** The queue run dry, with LAB_FILL: a training of the judge for each finished self-play batch not yet trained on, and the next batch. */
async function refill() {
  const ids = new Set((await store.list("jobs/")).map(o => path.basename(o.name, ".json")));
  const nums = [...ids].filter(i => /^spb\d+$/.test(i)).map(i => Number(i.slice(3))).sort((a, b) => a - b);
  const last = nums.at(-1) ?? 0, made = { by: NAME, at: new Date().toISOString() };
  const put = spec => store.put(`jobs/${spec.id}.json`, JSON.stringify({ ref: "main", repo: REPO, ...spec, made }), { ifAbsent: true });
  for (const n of nums) {
    const id = `jt${String(n).padStart(2, "0")}`;
    if (ids.has(id) || (await doneCount(batch(n))) < 24) continue;
    const upTo = nums.filter(k => k <= n).map(batch);
    await put({ id, script: "judge-train.mjs", args: `{shard} {shards} {out} ${upTo.join(",")}`, shards: 1, timeoutMin: 240,
      purpose: `the judge trained on Hard self-play ${upTo[0]}..${upTo.at(-1)} (${upTo.length * 120} games); held-out scores by library size show what the batch adds` });
  }
  if (nums.length && (await doneCount(batch(last))) < 24 && !(await allClaimed(batch(last)))) return;
  await put({ id: batch(last + 1), script: "selfplay.mjs", args: `{shard} {shards} {out} 256 120 ${7000 + 120 * last}`, shards: 24, timeoutMin: 120,
    purpose: "Hard (256 deals) against itself, every decision with the search's value of each move: data to teach the judge and Medium" });
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
      try { await runShard(slot, work.spec, work.shard); } catch (e) { log(`slot ${slot}: ${work.spec.id}/${work.shard} failed to run:`, e.message); await store.put(`results/${work.spec.id}/done-${work.shard}`, JSON.stringify({ code: "worker error", error: String(e.message), by: NAME })).catch(() => {}); }
      idleSince = Date.now();
      continue;
    }
    if (FILL) { try { await refill(); } catch (e) { log("refill:", e.message); } }
    else if (Date.now() - idleSince > IDLE_MS) return;
    await sleep(POLL_MS + Math.random() * 3000);
  }
}
log(`worker ${NAME}: ${SLOTS} slots, ${env.LAB_DIR ? "folder " + env.LAB_DIR : "bucket " + env.LAB_BUCKET}`);
await Promise.all(Array.from({ length: SLOTS }, (_, i) => slotLoop(i)));
log("no more work: stopping");
