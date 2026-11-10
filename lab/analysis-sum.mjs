// Sums an analysis job (lab/analysis.mjs): for the game's judge and for the deep look-ahead with all the information, how far
// the verdict for the human moves from one turn to the next and how much of each move the next one undoes (a verdict that
// only moves on news: about 0), how much it leans to the player whose turn it is, and how well it predicts the result
// (Brier score, lower is better; by how sure it was). usage: node lab/analysis-sum.mjs <job id> [min turns left 3]
import { readParts } from "./lib.mjs";
const minLeft = Number(process.argv[3] ?? 3);
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
const games = new Map();
for (const r of rows) (games.get(r.file) ?? games.set(r.file, []).get(r.file)).push(r);
for (const g of games.values()) g.sort((a, b) => a.turn - b.turn);
const f1 = x => (100 * x).toFixed(1);
console.log(`positions ${rows.length} from ${games.size} games (human won ${[...games.values()].filter(g => g[0].won).length})`);
for (const key of ["judge", "deep"]) {
  const steps = [], pairs = [], lean = [];
  for (const g of games.values()) {
    const d = g.slice(1).map((r, i) => r[key] - g[i][key]);
    steps.push(...d.map(Math.abs));
    for (let i = 1; i < d.length; i++) pairs.push([d[i - 1], d[i]]);
    for (let i = 1; i + 1 < g.length; i++) { const m = x => (g[i].active === 0 ? x[key] : 1 - x[key]); lean.push(m(g[i]) - (m(g[i - 1]) + m(g[i + 1])) / 2); }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const mx = mean(pairs.map(p => p[0])), my = mean(pairs.map(p => p[1]));
  const corr = pairs.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / Math.sqrt(pairs.reduce((a, [x]) => a + (x - mx) ** 2, 0) * pairs.reduce((a, [, y]) => a + (y - my) ** 2, 0));
  const ml = mean(lean), sl = Math.sqrt(lean.reduce((a, x) => a + (x - ml) ** 2, 0) / (lean.length - 1) / lean.length);
  const scored = rows.filter(r => r.left >= minLeft), brier = mean(scored.map(r => (r[key] - r.won) ** 2));
  console.log(`\n${key}: moves ${f1(mean(steps))} points a turn; next move undoes it, correlation ${corr.toFixed(2)}; lean to the player whose turn it is ${f1(ml)} ± ${f1(sl)}; Brier ${brier.toFixed(4)} (${scored.length} positions, ${minLeft}+ turns left)`);
  for (const [lo, hi] of [[0, 0.15], [0.15, 0.35], [0.35, 0.5], [0.5, 0.65], [0.65, 0.85], [0.85, 1.01]]) {
    const b = scored.filter(r => r[key] >= lo && r[key] < hi);
    if (b.length) console.log(`  says ${String(Math.round(100 * lo)).padStart(2)}-${String(Math.min(100, Math.round(100 * hi))).padEnd(3)}%: ${String(b.length).padStart(4)} positions (${new Set(b.map(r => r.file)).size} games), human won ${(100 * mean(b.map(r => r.won))).toFixed(0)}%`);
  }
}
console.log("\nwins from far behind (deep under 25% with 5+ turns left, the human won): file, turn, judge/deep");
for (const r of rows.filter(r => r.won && r.left >= 5 && r.deep < 0.25)) console.log(`  ${r.file} turn ${r.turn}: ${f1(r.judge)} / ${f1(r.deep)}`);
