// The fleet's ten-minute check (13 Nov 2026, Korbi: up to 1,000 vCPUs, with a check every 10 minutes for bottlenecks).
// Read-only: workers reporting in the last 5 minutes (slots, busy, by machine size and cloud), the queue (jobs with shards left,
// unclaimed and running), shards finished in the last 10 minutes with their exit codes (a failing job shows here), and how long
// a shard takes against the time a slot spends between shards. One block of text.
// usage: node lab/fleet-check.mjs
import { labStore } from "./lib.mjs";

const store = await labStore(), now = Date.now(), M = 60000;
const names = await store.list("workers/");
const ws = [];
for (let i = 0; i < names.length; i += 25) ws.push(...(await Promise.all(names.slice(i, i + 25).map(async n => { try { return JSON.parse(await store.get(n)); } catch { return null; } }))).filter(Boolean));
const live = ws.filter(w => now - w.t < 5 * M);
const slots = live.reduce((a, w) => a + w.slots, 0), busy = live.reduce((a, w) => a + (w.busy || []).length, 0);
const by = {};
for (const w of live) { const k = `${w.pool || "VM"} · ${w.hw?.present || w.slots} cores`; const b = (by[k] ||= { machines: 0, slots: 0, busy: 0 }); b.machines++; b.slots += w.slots; b.busy += (w.busy || []).length; }
console.log(`${new Date(now).toISOString().slice(11, 16)}Z  ${live.length} machines, ${slots} slots, ${busy} busy (${slots ? Math.round(100 * busy / slots) : 0}%)`);
for (const [k, b] of Object.entries(by).sort()) console.log(`  ${k.padEnd(28)} ${String(b.machines).padStart(4)} machines ${String(b.busy).padStart(5)}/${b.slots} busy`);
// shards finished in the last 10 minutes, by job, from the workers' own records; and the gap a slot spends between shards
const fin = {};
for (const w of live) for (const [job, sec, at] of w.fin || []) if (now - at < 10 * M) { const f = (fin[job] ||= { n: 0, sec: 0 }); f.n++; f.sec += sec; }
console.log("finished in the last 10 min:", Object.entries(fin).map(([j, f]) => `${j} ${f.n} (mean ${Math.round(f.sec / f.n)} s)`).join(", ") || "none");
const work = Object.values(fin).reduce((a, f) => a + f.sec, 0) / 60, capacity = slots * 10;
console.log(`slot-minutes spent on finished shards in the last 10 min: ${Math.round(work)} of ${capacity} (the rest: shards still running, or a slot between shards)`);
// the queue
const jobs = (await store.list("jobs/")).map(n => n.replace(/^jobs\//, "").replace(/\.json$/, ""));
const open = [];
for (const id of jobs) {
  const spec = JSON.parse((await store.get(`jobs/${id}.json`)) || "{}");
  if (!spec.shards) continue;
  const done = (await store.list(`results/${id}/done-`)).length;
  if (done >= spec.shards) continue;
  const claims = (await store.list(`claims/${id}/`)).length;
  open.push(`${id}: ${done}/${spec.shards} done, ${Math.max(0, claims - done)} running, ${Math.max(0, spec.shards - claims)} unclaimed`);
}
console.log(`queue (${open.length} jobs with shards left):`); for (const o of open) console.log("  " + o);
