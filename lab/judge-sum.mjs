// Sums a judge-check job (lab/judge-check.mjs) by how many cards the library has left: how many positions, the judge's bias
// (judge - playouts, + when it thinks the mover better off than it is), its error once the playouts' own noise is taken out,
// and how well each of the two predicts the game that was actually played. usage: node lab/judge-sum.mjs <job id>
import { readParts } from "./lib.mjs";
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
const buckets = [[61, 80], [46, 60], [31, 45], [21, 30], [13, 20], [9, 12], [0, 8]];
const f = x => x.toFixed(3);
console.log(`positions ${rows.length} from ${new Set(rows.map(r => r.seed)).size} games`);
console.log("library   n     bias    rmse   |err|>.15  brier judge  brier playouts");
for (const [lo, hi] of buckets) {
  const b = rows.filter(r => r.lib >= lo && r.lib <= hi);
  if (!b.length) continue;
  const n = b.length, mean = g => b.reduce((a, r) => a + g(r), 0) / n;
  const noise = mean(r => (r.mc * (1 - r.mc)) / (r.k - 1));               // the playouts' own variance, taken out of the error
  const rmse = Math.sqrt(Math.max(0, mean(r => (r.judge - r.mc) ** 2) - noise));
  console.log(`${String(lo).padStart(2)}-${String(hi).padEnd(3)} ${String(n).padStart(5)}  ${(mean(r => r.judge - r.mc) >= 0 ? "+" : "") + f(mean(r => r.judge - r.mc))}  ${f(rmse)}   ${f(mean(r => Math.abs(r.judge - r.mc) > 0.15))}      ${f(mean(r => (r.judge - r.won) ** 2))}        ${f(mean(r => (r.mc - r.won) ** 2))}`);
}
