// Sums lab/medium-match.mjs rows from files: A's score with a 95% interval, by deal pair (the pair's two games are one sample).
// usage: node lab/medium-match-sum.mjs <files…>
import fs from "node:fs";
const rows = process.argv.slice(2).flatMap(f => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)));
const n = rows.length, m = rows.reduce((a, r) => a + r.a, 0) / n, sd = Math.sqrt(rows.reduce((a, r) => a + (r.a - m) ** 2, 0) / (n - 1));
console.log(`${n} deals (${2 * n} games): ${(100 * m).toFixed(1)}% ± ${(196 * sd / Math.sqrt(n)).toFixed(1)}`);
