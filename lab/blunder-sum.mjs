// The blunder rate's summary (23 Nov 2026, Fable 10:57Z): for each batch of lab/blunder-pick.mjs, the positions scored, the mean
// points given up against the reference's best (± its standard error), and the share of picks 2, 5 and 10 points or more below
// it (a blunder is 5 or more: blunder-ref.mjs); the batches side by side on the positions all of them have, when more than one.
// usage: node lab/blunder-sum.mjs <batch> [<batch> ...]
const ids = process.argv.slice(2), store = await (await import("./lib.mjs")).labStore();
const byId = new Map();
for (const id of ids) {
  const m = new Map();
  for (const n of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)))
    for (const l of ((await store.get(n)) || "").split("\n")) if (l.startsWith('{"pos"')) { const o = JSON.parse(l); if (o.loss != null) m.set(o.pos, o.loss); }
  byId.set(id, m);
}
const pct = (k, n) => (n ? (100 * k / n).toFixed(1) : "-");
function row(name, xs) {
  const n = xs.length, mean = n ? xs.reduce((a, b) => a + b, 0) / n : 0, sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const at = t => xs.filter(x => x >= t - 1e-9).length, b = at(0.05);
  return `${name}: ${n} positions, mean ${(100 * mean).toFixed(2)} ± ${(100 * sd / Math.sqrt(Math.max(1, n))).toFixed(2)} points; >= 2 points ${pct(at(0.02), n)}%, >= 5 ${pct(b, n)}% (± ${n ? (100 * Math.sqrt((b / n) * (1 - b / n) / n)).toFixed(1) : "-"}), >= 10 ${pct(at(0.1), n)}%`;
}
for (const [id, m] of byId) console.log(row(id, [...m.values()]));
if (ids.length > 1) {
  const common = [...byId.get(ids[0]).keys()].filter(p => ids.every(id => byId.get(id).has(p)));
  console.log(`on the ${common.length} positions all have:`);
  for (const id of ids) console.log("  " + row(id, common.map(p => byId.get(id).get(p))));
}
