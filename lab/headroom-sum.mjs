// Sums a headroom job (lab/headroom.mjs): Hard's score against Medium over the deal pairs, and by how the game ran (its length,
// how it ended). usage: node lab/headroom-sum.mjs <job id>
import { readParts } from "./lib.mjs";
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
const line = (name, rs) => {
  if (!rs.length) return;
  const pairs = new Map();
  for (const r of rs) pairs.set(r.pair, [...(pairs.get(r.pair) ?? []), r.hardWon]);
  const ps = [...pairs.values()].map(v => v.reduce((a, b) => a + b, 0) / v.length), m = ps.reduce((a, b) => a + b, 0) / ps.length;
  const se = Math.sqrt(ps.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, ps.length - 1) / ps.length);
  console.log(`${name.padEnd(26)} games ${String(rs.length).padStart(4)}  Hard ${(100 * rs.reduce((a, r) => a + r.hardWon, 0) / rs.length).toFixed(1)}%  (by pairs ${(100 * m).toFixed(1)} ± ${(100 * se).toFixed(1)})`);
};
line("all", rows);
for (const [name, lo, hi] of [["up to 20 turns", 0, 20], ["21 to 30 turns", 21, 30], ["over 30 turns", 31, 999]]) line(name, rows.filter(r => r.turns >= lo && r.turns <= hi));
for (const why of new Set(rows.map(r => r.why))) line(`ended by ${why}`, rows.filter(r => r.why === why));
console.log(`median ms a game ${rows.map(r => r.ms).sort((a, b) => a - b)[rows.length >> 1]}`);
