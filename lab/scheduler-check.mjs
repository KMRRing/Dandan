// The fleet scheduler, checked from outside (17 Nov 2026): which worker the beats choose (lab/scheduler.mjs), how old its beat
// is, and with LAB_GH_TOKEN set, whether the token can see the loop's runs and start one (the scheduler's own two calls).
// usage: node lab/scheduler-check.mjs [--dispatch]
import { labStore } from "./lib.mjs";
import { chosenScheduler } from "./scheduler.mjs";
const store = await labStore(), now = Date.now();
const names = (await store.list("workers/")).map(o => (typeof o === "string" ? o : o.name)).filter(n => n.endsWith(".json"));
const beats = (await Promise.all(names.map(n => store.get(n).then(t => { try { return JSON.parse(t); } catch { return null; } })))).filter(Boolean);
const fresh = beats.filter(b => now - b.t < 11 * 60000), sched = fresh.filter(b => b.sched);
console.log(`${beats.length} beats, ${fresh.length} fresh, ${sched.length} hold the token`);
for (const b of sched.sort((a, c) => (c.hw?.cpus || 0) - (a.hw?.cpus || 0) || (a.boot ?? a.started) - (c.boot ?? c.started))) console.log(`  ${b.by}  ${b.hw?.cpus} cores  up since ${new Date(b.boot ?? b.started).toISOString()}  beat ${Math.round((now - b.t) / 1000)} s ago`);
console.log(`chosen: ${chosenScheduler(beats, now)}`);
const T = process.env.LAB_GH_TOKEN, repo = process.env.GITHUB_REPOSITORY || "KMRRing/Dandan";
if (T) {
  const h = { authorization: `Bearer ${T}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/zero-loop.yml/runs?per_page=3`, { headers: h });
  console.log(`runs read: ${r.status}`);
  if (process.argv.includes("--dispatch")) {
    const d = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/zero-loop.yml/dispatches`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ ref: "main" }) });
    console.log(`dispatch: ${d.status} ${d.status === 204 ? "(started)" : await d.text()}`);
  }
}
