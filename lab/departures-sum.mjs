// lab/departures.mjs's cases tabled by source (Korbi's kept games, self-play), then by kind of move (card, mode, whose target): cases, the search's estimated gain over the best
// shortlist move and the gain the play-outs realised, with its standard error, worst realised first (the blunders).
// 13 Nov (Fable): also by estimated gain (under 2 points, 2-5, 5-10, over 10) and by library size (over 20, 20 or fewer),
// and how far the kept games got (a shard stops after its quota of cases, so many kept games end part-way).
// usage: node lab/departures-sum.mjs <file or lab job id…>   (as a lab job: one shard, the table is what it prints)
import fs from "node:fs";
import { readParts } from "./lib.mjs";

const texts = [];
for (const a of process.argv.slice(2)) texts.push(...(fs.existsSync(a) ? [fs.readFileSync(a, "utf8")] : await readParts(a)));
const all = texts.flatMap(t => (t || "").split("\n")).filter(l => l.startsWith("{")).map(l => JSON.parse(l)).filter(r => r.src);
const rows = all.filter(r => r.real != null);
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
/** A group's line: cases, mean estimated and realised gain in points, the realised gain's standard error. */
function line(rs) {
  const real = rs.map(r => r.real), m = mean(real), sd = rs.length > 1 ? Math.sqrt(real.reduce((a, x) => a + (x - m) ** 2, 0) / (rs.length - 1)) : null;
  return { cases: rs.length, est: +(100 * mean(rs.map(r => r.est))).toFixed(1), real: +(100 * m).toFixed(1), se: sd == null ? null : +(100 * sd / Math.sqrt(rs.length)).toFixed(1) };
}
const group = (rs, key) => {
  const by = new Map();
  for (const r of rs) { const k = key(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  return by;
};
const GAIN = [["under 2", 0, 0.02], ["2-5", 0.02, 0.05], ["5-10", 0.05, 0.1], ["over 10", 0.1, Infinity]];
console.log(JSON.stringify({ lines: all.length, withPlayOuts: rows.length, noPlayOuts: all.length - rows.length }));
for (const [src, rs0] of [["kept games", rows.filter(r => r.src.startsWith("kept:"))], ["self-play", rows.filter(r => !r.src.startsWith("kept:"))]]) {
  if (!rs0.length) continue;
  console.log(JSON.stringify({ source: src, ...line(rs0), games: new Set(rs0.map(r => r.src)).size }));
  for (const [name, lo, hi] of GAIN) { const rs = rs0.filter(r => r.est >= lo && r.est < hi); if (rs.length) console.log(JSON.stringify({ source: src, gain: name, ...line(rs) })); }
  for (const [name, f] of [["library over 20", r => r.lib > 20], ["library 20 or fewer", r => r.lib <= 20]]) {
    const rs = rs0.filter(f); if (rs.length) console.log(JSON.stringify({ source: src, library: name, ...line(rs) }));
  }
  if (src === "kept games") {
    // how far each kept game got: its last case's library size (a game whose last case is early likely stopped at the quota)
    const last = [...group(rs0, r => r.src)].map(([, rs]) => Math.min(...rs.map(r => r.lib)));
    console.log(JSON.stringify({ source: src, keptGamesReachingLibrary20: last.filter(l => l <= 20).length, of: last.length }));
  }
  const table = [...group(rs0, r => [r.kind.t, r.kind.card, r.kind.mode, r.kind.target].filter(x => x != null).join(" · "))]
    .map(([kind, rs]) => ({ kind, ...line(rs) })).sort((a, b) => a.real - b.real);
  for (const t of table) console.log(JSON.stringify({ source: src, ...t }));
}
