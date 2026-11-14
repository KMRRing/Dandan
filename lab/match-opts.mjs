// The focus arm's tally of options a tree decision opened (14 Nov 2026, Fable No. 17 point 4), from a lab/hard-match.mjs job's
// rows: each shard's last row holds its running tally (opts), so the shards' last rows are summed.
// usage: node lab/match-opts.mjs <job>
import { labStore } from "./lib.mjs";

const job = process.argv[2], store = await labStore(), sum = {};
const names = (await store.list(`results/${job}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n));
for (let i = 0; i < names.length; i += 25) for (const t of await Promise.all(names.slice(i, i + 25).map(n => store.get(n)))) {
  const rows = (t || "").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(r => r.opts);
  const last = rows[rows.length - 1];
  if (last) for (const [k, v] of Object.entries(last.opts)) sum[k] = (sum[k] || 0) + v;
}
const n = Object.values(sum).reduce((a, b) => a + b, 0), pct = k => (100 * (sum[k] || 0) / Math.max(1, n)).toFixed(1);
const four = Object.entries(sum).filter(([k]) => Number(k) >= 4).reduce((a, [, v]) => a + v, 0);
console.log(`${job}: ${n} tree decisions with priority from ${names.length} shards; options opened: one ${pct(1)}%, two ${pct(2)}%, three ${pct(3)}%, four or more ${(100 * four / Math.max(1, n)).toFixed(1)}% (${["4", "5", "6"].map(k => `${k}: ${pct(k)}%`).join(", ")})`);
