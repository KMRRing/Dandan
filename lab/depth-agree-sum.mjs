// Sums lab/depth-agree.mjs: for each depth, how often it chooses as the deepest does, and what its choices are worth by the
// deepest's figures (points a decision, and how many over 2 points); then, pair by pair, how often adjacent depths agree.
// usage: node lab/depth-agree-sum.mjs <job id or files…>
import fs from "node:fs";
import { readParts } from "./lib.mjs";
const rows = [];
for (const a of process.argv.slice(2)) for (const t of fs.existsSync(a) ? [fs.readFileSync(a, "utf8")] : await readParts(a)) for (const l of t.split("\n")) if (l) rows.push(JSON.parse(l));
if (!rows.length) { console.log("no rows yet"); process.exit(0); }
const depths = Object.keys(rows[0].by), last = depths.at(-1);
console.log(`${rows.length} decisions; against ${last}:`);
for (const d of depths) {
  const same = rows.filter(r => r.by[d].same).length, lost = rows.reduce((a, r) => a + (r.by[d].lost || 0), 0) / rows.length, big = rows.filter(r => r.by[d].lost > 0.02).length;
  console.log(`  ${d.padEnd(8)} same move ${(100 * same / rows.length).toFixed(1)}%   loses ${(100 * lost).toFixed(2)} points a decision   ${big} choices 2+ points worse`);
}
console.log("adjacent depths, same move:");
for (let j = 1; j < depths.length; j++) {
  const a = depths[j - 1], b = depths[j], same = rows.filter(r => r.by[a].move === r.by[b].move).length;
  console.log(`  ${a} vs ${b}: ${(100 * same / rows.length).toFixed(1)}%`);
}
