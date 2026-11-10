// Sums one tune-round job: what each candidate scored over the pairs it played, and against the base candidate (d 0) on the same pairs.
// usage: node lab/tune-sum.mjs <job id> [top 25]      reads results/<id>/part-*.jsonl from LAB_BUCKET (on a Google machine) or LAB_DIR (a folder queue)
import { readParts } from "./lib.mjs";
const [id, top = 25] = [process.argv[2], Number(process.argv[3] ?? 25)];
const parts = await readParts(id);
const by = new Map(); // candidate -> { k, d, rows: Map pair -> score }
for (const text of parts) for (const line of text.split("\n")) {
  if (!line) continue;
  const r = JSON.parse(line), c = by.get(r.cand) ?? by.set(r.cand, { cand: r.cand, k: r.k, d: r.d, rows: new Map() }).get(r.cand);
  c.rows.set(r.pair, r.score);
}
const base = [...by.values()].find(c => c.d === 0 && c.k === "pass");
const stat = (xs) => { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n, v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1); return { n, m, se: Math.sqrt(v / n) }; };
const rows = [...by.values()].map(c => {
  const s = stat([...c.rows.values()]);
  const diffs = base && c !== base ? [...c.rows].filter(([p]) => base.rows.has(p)).map(([p, v]) => v - base.rows.get(p)) : [];
  const d = diffs.length ? stat(diffs) : null;
  return { cand: c.cand, name: `${c.k} ${c.d >= 0 ? "+" : ""}${c.d}`, n: s.n, mean: s.m, se: s.se, vs: d ? d.m : null, vsz: d ? (d.se > 0 ? d.m / d.se : 0) : null }; // a candidate that played every pair like the base has no spread: z 0
});
console.log(`candidates ${rows.length}, pairs per candidate ${rows[0]?.n}; base ${base ? base.k + " " + base.d : "missing"}: ${base ? stat([...base.rows.values()]).m.toFixed(4) : ""}`);
console.log("cand  name                                   mean   se     vs base  z");
for (const r of rows.sort((a, b) => (b.vsz ?? -99) - (a.vsz ?? -99)).slice(0, top)) console.log(String(r.cand).padStart(3), r.name.padEnd(36), r.mean.toFixed(4), r.se.toFixed(4), r.vs === null ? "   base" : (r.vs >= 0 ? "+" : "") + r.vs.toFixed(4), r.vsz === null ? "" : r.vsz.toFixed(2));
const zs = rows.filter(r => r.vsz !== null).map(r => r.vsz), mz = zs.reduce((a, b) => a + b, 0) / zs.length;
console.log(`all candidates: mean z ${mz.toFixed(2)}, share with z>2: ${(zs.filter(z => z > 2).length)} of ${zs.length}; worst z ${Math.min(...zs).toFixed(2)}`);
