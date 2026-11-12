// lab/chart-card.mjs's lines summed: each chart's Brier against the result (all turn starts; library over 20; 20 or fewer),
// how far it moves between turns (the mean swing, in points: a chart that jumps about without cause reads badly), and the
// look-aheads' seconds a game. usage: node lab/chart-card-sum.mjs <file of lines…>
import fs from "node:fs";

const rows = process.argv.slice(2).flatMap(f => fs.readFileSync(f, "utf8").split("\n")).filter(l => l.startsWith("{")).map(l => JSON.parse(l));
const cols = Object.keys(rows[0] || {}).filter(k => k === "today" || k === "net" || /^la\d+$/.test(k));
const brier = rs => +(rs.reduce((a, r) => a + (r.p - r.won) ** 2, 0) / Math.max(1, rs.length)).toFixed(4);
const games = new Map();
for (const r of rows) { if (!games.has(r.file)) games.set(r.file, []); games.get(r.file).push(r); }
const out = { games: games.size, positions: rows.length };
for (const c of cols) {
  const rs = rows.map(r => ({ p: r[c], won: r.won, lib: r.lib }));
  let swing = 0, n = 0;
  for (const g of games.values()) for (let i = 1; i < g.length; i++) { swing += Math.abs(g[i][c] - g[i - 1][c]); n++; }
  const ms = c.startsWith("la") ? c.replace("la", "ms") : null;
  out[c] = { brier: brier(rs), brierOver20: brier(rs.filter(r => r.lib > 20)), brier20orFewer: brier(rs.filter(r => r.lib <= 20)), meanSwing: +(100 * swing / Math.max(1, n)).toFixed(1),
    ...(ms ? { secondsPerGame: +([...games.values()].reduce((a, g) => a + g.reduce((b, r) => b + r[ms], 0), 0) / 1000 / games.size).toFixed(1), secondsPerTurnMax: +(Math.max(...rows.map(r => r[ms])) / 1000).toFixed(1) } : {}) };
}
console.log(JSON.stringify(out, null, 1));
