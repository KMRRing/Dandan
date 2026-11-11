// Sums lab/medium-match.mjs (or judge-match / gem-match) rows: A's score with a 95% interval, by deal pair (a pair's two games
// are one sample). Arguments are files, or lab job ids (their results read from the bucket).
// usage: node lab/medium-match-sum.mjs <file or job id…>
import fs from "node:fs";
import { readParts } from "./lib.mjs";
for (const a of process.argv.slice(2)) {
  const text = fs.existsSync(a) ? [fs.readFileSync(a, "utf8")] : await readParts(a);
  const rows = text.flatMap(t => t.split("\n").filter(Boolean)).map(l => JSON.parse(l));
  if (!rows.length) { console.log(`${a}: no rows yet`); continue; }
  const n = rows.length, m = rows.reduce((s, r) => s + r.a, 0) / n, sd = n > 1 ? Math.sqrt(rows.reduce((s, r) => s + (r.a - m) ** 2, 0) / (n - 1)) : 0;
  console.log(`${a}: ${n} deals (${2 * n} games): ${(100 * m).toFixed(1)}% ± ${(196 * sd / Math.sqrt(n)).toFixed(1)}`);
}
