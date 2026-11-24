// The per-deal payoff's spread at a table of four of Codex's players (usage: node lab/schafkopf/sk-sd.mjs <deals> <level> <seed>):
// the framework's value unit for Schafkopf is one standard deviation of it (Fable, 24 Nov 2026 18:50Z: the close-call gap in
// standard deviations of the per-deal payoff, measured from the baseline games). Prints the payoffs and their spread.
import { schafkopf as G, codexMove } from "./sk-rules.js";
import { seeded, mix } from "../../seats.js";
const [n = 100, level = "hard", seed0 = 1] = process.argv.slice(2);
const all = [], t0 = Date.now();
for (let k = 0; k < +n; k++) {
  const rng = seeded(mix(+seed0, k)), s = G.deal({ rng });
  while (!G.over(s)) { const w = G.toMove(s); G.act(s, w, codexMove(s, w, level, rng), rng); }
  all.push(...G.payoff(s));
}
const m = all.reduce((a, b) => a + b, 0) / all.length, sd = Math.sqrt(all.reduce((a, x) => a + (x - m) ** 2, 0) / (all.length - 1));
console.log(JSON.stringify({ deals: +n, level, sd: +sd.toFixed(3), maxAbs: Math.max(...all.map(Math.abs)), msPerDeal: Math.round((Date.now() - t0) / n) }));
