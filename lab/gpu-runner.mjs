// The GPU runner (Fable, 26 Nov 2026 12:55Z, option (a); Korbi: "we're going GPU"): runs the GPU jobs, the Python scripts in
// lab/schafkopf/gpu/, one shard at a time on a GPU machine. worker.mjs is untouched and never sees these jobs.
//
// Its part of the store, and nothing else:
//   gpujobs/<id>.json        a GPU job's spec { id, script (lab/schafkopf/gpu/<name>.py), args, shards, ref, repo, timeoutMin },
//                            put there by lab/queue-push.mjs from lab/queue-gpu/ (create-only); read here, never written
//   claims/<id>/<shard>      its claims: made only if absent, renewed every BEAT_MS, a claim silent for LEASE_MS taken over (as
//                            worker.mjs's, so a gone pod's shards come back); deleted only if its own, when the machine stops
//   results/<id>/part-<shard>.jsonl, stdout-<shard>.txt, done-<shard>   what its shard wrote, printed, and how it ended
//   workers/gpu-<host>.json  its heartbeat, for the fleet page
//   retired/<id>.json        a job stopped (26 Nov 2026, the director's review): never claimed, and a shard of it running here
//                            is stopped and its claim given up
// It never retires, deletes or rewrites a job, and never claims a job outside gpujobs/.
// A setup failure (git, a missing Python package, no GPU) is the machine's, not the job's (the director, 26 Nov): the claim
// is handed back with no result written, and after SETUP_LIMIT in a row this runner stops claiming, its heartbeat saying why.
// Store credentials as the workers get them (the pod's start-up, set by the director): lab/store.mjs's environment. None here.
// usage (on the GPU pod): node lab/gpu-runner.mjs   [env: LAB_GPU_SLOTS (1), the store's environment as for worker.mjs]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { labStore } from "./lib.mjs";

const env = process.env, store = await labStore();
const LEASE_MS = 15 * 60000, BEAT_MS = 5 * 60000, IDLE_MS = 60000, NAME = `gpu-${os.hostname()}-${process.pid}`, T0 = Date.now();
const SLOTS = Number(env.LAB_GPU_SLOTS) || 1, WORK = env.LAB_WORK || path.join(os.homedir(), "gpu-work");
const PINNED_REPO = "https://github.com/KMRRing/Dandan";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const claimBody = () => JSON.stringify({ by: NAME, t: Date.now(), gpu: 1 });
const MINE = new Set(), SETUP_LIMIT = 3;
let STOPPING = false, setupFails = 0, halted = null;
const retiredIds = async () => new Set((await store.list("retired/")).map(n => path.basename(typeof n === "string" ? n : n.name, ".json")));
/** A failure of this machine's setup rather than of the job: the shard is handed back for another runner. */
class SetupError extends Error {}

/** A free or lapsed shard of a GPU job, claimed for this runner, or null. */
async function claimOne() {
  const specs = [], gone = await retiredIds();
  for (const o of (await store.listAll("gpujobs/")).sort((a, b) => a.name.localeCompare(b.name))) {
    try { specs.push(JSON.parse(await store.get(o.name))); } catch (e) { log(`${o.name}: unreadable, skipped`); }
  }
  for (const spec of specs) {
    const id = spec.id;
    if (gone.has(id)) continue;
    const [claims, done] = await Promise.all([store.listAll(`claims/${id}/`), store.list(`results/${id}/done-`)]);
    const finished = new Set(done.map(n => Number(n.split("done-")[1])));
    const held = new Map(claims.map(c => [Number(path.basename(c.name)), c]));
    for (let k = 0; k < spec.shards; k++) {
      if (finished.has(k) || MINE.has(`${id}/${k}`)) continue;
      const c = held.get(k);
      if (!c) {
        if (await store.put(`claims/${id}/${k}`, claimBody(), { ifAbsent: true })) return { spec, shard: k };
        continue;
      }
      // the claim's age from the listing: its holder rewrites it every BEAT_MS (as worker.mjs reads it)
      if (Date.now() - c.t > LEASE_MS && (await store.put(c.name, claimBody(), { ifGeneration: c.generation }))) { log(`took over ${c.name}`); return { spec, shard: k }; }
    }
  }
  return null;
}

const git = (cwd, ...a) => { try { execFileSync("git", a, { cwd, stdio: ["ignore", "ignore", "inherit"] }); } catch (e) { throw new SetupError(`git ${a[0]}: ${e.message}`); } };
// the GPU and PyTorch, checked before each shard (LAB_GPU_ALLOW_CPU=1 for a trial without one)
function checkGpu() {
  const probe = env.LAB_GPU_ALLOW_CPU === "1" ? "import torch" : "import torch, sys; sys.exit(0 if torch.cuda.is_available() else 3)";
  try { execFileSync("python3", ["-c", probe], { stdio: ["ignore", "ignore", "pipe"], timeout: 120000 }); }
  catch (e) { throw new SetupError(e.status === 3 ? "PyTorch sees no GPU" : `PyTorch is missing or broken (${e.status ?? e.signal}: ${String(e.stderr || e.message).trim().split("\n").pop().slice(0, 160)})`); }
}
async function runShard(slot, spec, shard) {
  const id = spec.id, t0 = Date.now(), dir = path.join(WORK, `slot${slot}`), repo = path.join(dir, "repo"), run = path.join(dir, "run");
  if (!/^lab\/schafkopf\/gpu\/[a-z0-9_]+\.py$/.test(spec.script)) throw new Error("refused: script " + spec.script + " is not a GPU script");
  // the repository pinned and the commit on its main, as worker.mjs requires (13 Nov 2026)
  if ((spec.repo || PINNED_REPO).replace(/\.git$/, "") !== PINNED_REPO) throw new Error(`refused: repository ${spec.repo}`);
  if (!/^[0-9a-f]{40}$/.test(spec.ref)) throw new Error(`refused: ref ${spec.ref} is not a full commit`);
  fs.mkdirSync(dir, { recursive: true });
  checkGpu();
  if (!fs.existsSync(path.join(repo, ".git"))) git(dir, "clone", "-q", "--depth=1", PINNED_REPO, repo);
  try { git(repo, "fetch", "-q", "--shallow-since=60.days.ago", "origin", "main"); } catch { git(repo, "fetch", "-q", "origin", "main"); }
  const main = execFileSync("git", ["rev-parse", "FETCH_HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  git(repo, "fetch", "-q", "--depth=1", "origin", spec.ref);
  try { execFileSync("git", ["merge-base", "--is-ancestor", spec.ref, main], { cwd: repo, stdio: "ignore" }); } catch { throw new Error(`refused: commit ${spec.ref} is not on main`); }
  git(repo, "checkout", "-q", "--detach", "-f", "FETCH_HEAD");
  fs.rmSync(run, { recursive: true, force: true }); fs.mkdirSync(run, { recursive: true });
  const out = path.join(run, `part-${shard}.jsonl`), printed = path.join(run, `stdout-${shard}.txt`);
  const argv = spec.args.replaceAll("{shard}", shard).replaceAll("{shards}", spec.shards).replaceAll("{out}", out).split(/\s+/).filter(Boolean);
  log(`slot ${slot}: ${id}/${shard} ${spec.script} ${argv.join(" ")}`);
  const fd = fs.openSync(printed, "w");
  const child = spawn("python3", [spec.script, ...argv], { cwd: repo, stdio: ["ignore", fd, fd] });
  let retired = false;
  const beat = setInterval(async () => {
    try { if ((await retiredIds()).has(id)) { retired = true; child.kill("SIGTERM"); return; } } catch {}
    store.put(`claims/${id}/${shard}`, claimBody()).catch(() => {});
  }, BEAT_MS);
  const limit = setTimeout(() => child.kill("SIGKILL"), (spec.timeoutMin || 120) * 60000);
  const code = await new Promise(res => child.on("exit", (c, sig) => res(c ?? sig)));
  clearInterval(beat); clearTimeout(limit); fs.closeSync(fd);
  if (STOPPING) { log(`slot ${slot}: ${id}/${shard} cut short by the machine stopping: left for another runner`); return; }
  if (retired) { log(`slot ${slot}: ${id} was retired: shard ${shard} stopped`); await store.del(`claims/${id}/${shard}`).catch(() => {}); return; }
  // a package the script needs is missing here: the machine's fault, the shard goes back
  if (code !== 0 && /ModuleNotFoundError|No module named|CUDA driver|no CUDA GPUs/.test(fs.readFileSync(printed, "utf8"))) throw new SetupError(`the script couldn't start here (exit ${code}); see its output`);
  if (fs.existsSync(out)) await store.put(`results/${id}/part-${shard}.jsonl`, fs.readFileSync(out));
  await store.put(`results/${id}/stdout-${shard}.txt`, fs.readFileSync(printed));
  await store.put(`results/${id}/done-${shard}`, JSON.stringify({ code, seconds: Math.round((Date.now() - t0) / 1000), by: NAME, gpu: 1 }));
  log(`slot ${slot}: ${id}/${shard} ended with ${code} after ${Math.round((Date.now() - t0) / 1000)} s`);
}

async function loop(slot) {
  while (!STOPPING) {
    if (halted) { await new Promise(r => setTimeout(r, IDLE_MS)); continue; }
    let work = null;
    try { work = await claimOne(); } catch (e) { log(`slot ${slot}: looking for work failed:`, e.message); }
    if (!work) { await new Promise(r => setTimeout(r, IDLE_MS)); continue; }
    const k = `${work.spec.id}/${work.shard}`;
    MINE.add(k);
    try { await runShard(slot, work.spec, work.shard); setupFails = 0; }
    catch (e) {
      if (e instanceof SetupError) {
        MINE.delete(k); setupFails++; log(`slot ${slot}: ${k} handed back, setup failed (${setupFails} in a row):`, e.message);
        await store.del(`claims/${k}`).catch(() => {});
        if (setupFails >= SETUP_LIMIT) { halted = `stopped claiming after ${setupFails} setup failures in a row; last: ${e.message}`; log(halted); beatSelf(); }
      } else { log(`slot ${slot}: ${k} failed to run:`, e.message); await store.put(`results/${work.spec.id}/done-${work.shard}`, JSON.stringify({ code: "runner error", error: String(e.message), by: NAME, gpu: 1 })).catch(() => {}); }
    }
    MINE.delete(k);
  }
}

const gpuOf = () => { try { return execFileSync("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader"], { encoding: "utf8" }).trim(); } catch { return null; } };
const beatSelf = () => store.put(`workers/${NAME}.json`, JSON.stringify({ by: NAME, gpu: gpuOf(), slots: SLOTS, busy: [...MINE], halted, started: T0, t: Date.now() })).catch(() => {});
setInterval(beatSelf, BEAT_MS); beatSelf();
// a stop hands this runner's shards back at once: its own claims are deleted, so another runner takes them
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, async () => {
  STOPPING = true; log(`${sig}: handing back ${[...MINE].join(", ") || "nothing"}`);
  await Promise.all([...MINE].map(k => store.del(`claims/${k}`).catch(() => {})));
  process.exit(0);
});
log(`${NAME}: ${SLOTS} slot(s); GPU: ${gpuOf() ?? "none found"}`);
await Promise.all(Array.from({ length: SLOTS }, (_, i) => loop(i)));
