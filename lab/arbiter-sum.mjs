// The play-out arbiter's verdict (22 Nov 2026, Fable's acceptance test b): for each point of an arb= batch (lab/zero/zero-play.mjs),
// the deciding seat's score with the search's top move forced and with the policy's, paired game by game (the same re-deal seed),
// over the games where the forced move was still legal. Reported by win-chance band and overall: the mean difference (search less
// policy) in points with its standard error over points, and how many points each side won. Read-only.
// usage: node lab/arbiter-sum.mjs <batch | file:a.jsonl,b.jsonl>
import fs from "node:fs";

const [batch] = process.argv.slice(2), local = batch.startsWith("file:");
const store = local ? { get: async n => fs.readFileSync(n, "utf8") } : await (await import("./lib.mjs")).labStore();
const names = local ? batch.slice(5).split(",") : (await store.list(`results/${batch}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n));
const pts = new Map();   // point -> { band, search: Map(seed -> score), policy: Map(seed -> score) }
for (const n of names) {
  let text = "";
  try { text = (await store.get(n)) || ""; } catch { continue; }
  for (const l of text.split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l), b = g.branch;
    if (!b || b.kind !== "A" || !b.forced) continue;
    const p = pts.get(b.point) || pts.set(b.point, { band: b.band, search: new Map(), policy: new Map() }).get(b.point);
    p[b.side].set(g.seed, g.winner === b.seat ? 1 : g.winner == null || g.winner < 0 ? 0.5 : 0);
  }
}
const rows = [];
for (const [k, p] of pts) {
  const both = [...p.search.keys()].filter(s => p.policy.has(s));
  if (!both.length) continue;
  const d = both.map(s => p.search.get(s) - p.policy.get(s));
  rows.push({ k, band: p.band, n: both.length, diff: d.reduce((a, b) => a + b, 0) / d.length });
}
const say = (tag, rs) => {
  if (!rs.length) return;
  const m = rs.reduce((a, r) => a + r.diff, 0) / rs.length, v = rs.reduce((a, r) => a + (r.diff - m) ** 2, 0) / Math.max(1, rs.length - 1);
  const se = Math.sqrt(v / rs.length), games = rs.reduce((a, r) => a + r.n, 0);
  console.log(`  ${tag.padEnd(8)} ${String(rs.length).padStart(4)} points, ${String(games).padStart(5)} paired games: search less policy ${(100 * m).toFixed(1)} ± ${(100 * se).toFixed(1)} points; search better at ${rs.filter(r => r.diff > 0).length}, policy at ${rs.filter(r => r.diff < 0).length}, level ${rs.filter(r => r.diff === 0).length}`);
};
console.log(`${batch}: the play-out arbiter, the deciding seat's score with the search's top move less with the policy's`);
for (const b of ["0-20", "20-40", "40-60", "60-80", "80-100"]) say(`${b}%`, rows.filter(r => r.band === b));
say("all", rows);
