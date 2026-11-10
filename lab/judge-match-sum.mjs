// lab/judge-match.mjs summed: A's score over the deals so far, its standard error, and what the stop-early rule
// (lab/sequential.mjs: 55% aim) says. usage: node lab/judge-match-sum.mjs <job id>
import { readParts } from "./lib.mjs";
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
const n = rows.length, mean = rows.reduce((a, r) => a + r.a, 0) / n;
const sd = Math.sqrt(rows.reduce((a, r) => a + (r.a - mean) ** 2, 0) / Math.max(1, n - 1)), se = sd / Math.sqrt(n);
console.log(JSON.stringify({ deals: n, games: 2 * n, score: +mean.toFixed(4), se: +se.toFixed(4), z: +((mean - 0.5) / se).toFixed(2), interval95: [+(mean - 1.96 * se).toFixed(3), +(mean + 1.96 * se).toFixed(3)] }));
