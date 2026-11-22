// Where the fleet's slots are (22 Nov 2026, Fable 21:14Z): for each job named, the shards claimed and still beating (a claim
// heard from in the last 10 minutes, not done), the shards done, and the seconds a finished shard took (done-<shard>'s seconds),
// so the cost of a game is read rather than guessed. Read-only.
// usage: node lab/job-slots.mjs <id> [id…]
import { labStore } from "./lib.mjs";

const store = await labStore(), ids = process.argv.slice(2), now = Date.now();
for (const id of ids) {
  const [claims, done] = await Promise.all([store.list(`claims/${id}/`), store.list(`results/${id}/done-`)]);
  const doneSet = new Set(done.map(n => Number(n.split("done-")[1])));
  let live = 0, stale = 0;
  for (const c of claims) {
    const shard = Number(c.split("/").pop());
    if (doneSet.has(shard)) continue;
    let t = 0;
    try { t = JSON.parse((await store.get(c)) || "{}").t || 0; } catch {}
    if (now - t < 10 * 60000) live++; else stale++;
  }
  const secs = [];
  for (const n of done.slice(0, 40)) { try { const d = JSON.parse((await store.get(n)) || "{}"); if (d.seconds != null) secs.push(d.seconds); } catch {} }
  secs.sort((a, b) => a - b);
  const med = secs.length ? secs[Math.floor(secs.length / 2)] : null;
  console.log(`${id}: running ${live} (stale claims ${stale}), done ${done.length}; a finished shard took ${med ?? "-"} s (median of ${secs.length}${secs.length ? `, ${secs[0]}-${secs[secs.length - 1]}` : ""})`);
}
