// Score a match file: A's results with a paired (by deal) confidence interval, and what each side's thinking cost.
import fs from "node:fs";
const rows = process.argv.slice(2).flatMap(f => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
const byPair = new Map(); for (const r of rows) (byPair.get(r.pair) || byPair.set(r.pair, []).get(r.pair)).push(r);
const pairs = [...byPair.values()].filter(g => g.length === 2).map(g => (g[0].aWon + g[1].aWon) / 2);
const n = pairs.length, mean = pairs.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(pairs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1)), se = sd / Math.sqrt(n);
const games = rows.length, w = rows.filter(r => r.aWon === 1).length, d = rows.filter(r => r.aWon === 0.5).length;
const sum = k => rows.reduce((a, r) => a + r[k], 0);
console.log(`${games} games (${n} deals, both seats): A won ${w}, drew ${d}, lost ${games - w - d} → A scores ${(100 * mean).toFixed(1)}% ± ${(196 * se).toFixed(1)} (95%); lower 90% bound ${(100 * (mean - 1.28 * se)).toFixed(1)}%`);
console.log(`thinking: A ${(sum("msA") / 1000 / games).toFixed(0)} s a game, ${(sum("msA") / Math.max(1, sum("nA"))).toFixed(0)} ms per search over 1 ms; B ${(sum("msB") / 1000 / games).toFixed(0)} s a game, ${(sum("msB") / Math.max(1, sum("nB"))).toFixed(0)} ms per search`);
const seat0 = rows.filter(r => r.aSeat === 0).reduce((a, r) => a + r.aWon, 0) / rows.filter(r => r.aSeat === 0).length;
console.log(`A as first-listed seat scores ${(100 * seat0).toFixed(0)}%; mean game ${(sum("turns") / games).toFixed(1)} turns, ${(100 * rows.filter(r => /library|deck/i.test(r.why || "")).length / games).toFixed(0)}% ended by an empty library`);
