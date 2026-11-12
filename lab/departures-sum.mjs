// lab/departures.mjs's cases tabled by kind of move (card, mode, whose target): cases, the search's estimated gain over the best
// shortlist move and the gain the play-outs realised, with its standard error, worst realised first (the blunders).
// usage: node lab/departures-sum.mjs <file of lines…>
import fs from "node:fs";

const rows = process.argv.slice(2).flatMap(f => fs.readFileSync(f, "utf8").split("\n")).filter(l => l.startsWith("{")).map(l => JSON.parse(l)).filter(r => r.real != null);
const by = new Map();
for (const r of rows) {
  const k = [r.kind.t, r.kind.card, r.kind.mode, r.kind.target].filter(x => x != null).join(" · ");
  if (!by.has(k)) by.set(k, []);
  by.get(k).push(r);
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const table = [...by].map(([kind, rs]) => {
  const real = rs.map(r => r.real), m = mean(real), sd = rs.length > 1 ? Math.sqrt(real.reduce((a, x) => a + (x - m) ** 2, 0) / (rs.length - 1)) : null;
  return { kind, cases: rs.length, est: +(100 * mean(rs.map(r => r.est))).toFixed(1), real: +(100 * m).toFixed(1), se: sd == null ? null : +(100 * sd / Math.sqrt(rs.length)).toFixed(1) };
}).sort((a, b) => a.real - b.real);
console.log(JSON.stringify({ cases: rows.length, est: +(100 * mean(rows.map(r => r.est))).toFixed(1), real: +(100 * mean(rows.map(r => r.real))).toFixed(1) }));
for (const t of table) console.log(JSON.stringify(t));
