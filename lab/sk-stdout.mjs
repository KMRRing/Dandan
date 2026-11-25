// The belief arm's effective worlds across a job's shards (Fable, 25 Nov 2026 07:50Z): each shard prints a "belief:" line with
// the median and 10th percentile of the effective number of worlds (of 256) at the bid and after tricks 1 and 4; this gives, over
// the shards, the median of those medians and the lowest 10th percentile. Read-only.
// usage: node lab/sk-stdout.mjs <job id>
import { labStore } from "./lib.mjs";

const [id] = process.argv.slice(2), store = await labStore(), at = { bid: [[], []], 1: [[], []], 4: [[], []] };
let shards = 0;
for (const n of (await store.list(`results/${id}/`)).filter(n => /stdout-\d+\.txt$/.test(n))) {
  let t = ""; try { t = (await store.get(n)) || ""; } catch { continue; }
  const m = t.match(/belief: .*?bid (\d+) \/ (\d+), trick 1 (\d+) \/ (\d+), trick 4 (\d+) \/ (\d+)/);
  if (!m) continue;
  shards++;
  [["bid", 1], [1, 3], [4, 5]].forEach(([k, i]) => { at[k][0].push(+m[i]); at[k][1].push(+m[i + 1]); });
}
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : "-"; };
console.log(`${id}: effective worlds of 256 over ${shards} shards (median of the shards' medians; lowest shard 10th percentile): ` +
  ["bid", 1, 4].map(k => `${k === "bid" ? "bid" : `trick ${k}`} ${med(at[k][0])} (${at[k][1].length ? Math.min(...at[k][1]) : "-"})`).join(", "));
