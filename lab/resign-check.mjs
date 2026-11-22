// Is resigning safe (22 Nov 2026, Korbi: "whether it's safe to do forfeit and lazy play on the live Monte now")? Since 20 Nov every
// self-play game plays out and notes where a seat would have resigned (zero-play.mjs: would = { seat, i }, the resign rule's
// confirmed point). Counted here: of the games with such a point, how often that seat won all the same, so how often resigning
// there would have thrown a game away. Branch games never resign and note none.
// usage: node lab/resign-check.mjs <batches, comma-separated | file:<zero-play output>>
import fs from "node:fs";

const [ids] = process.argv.slice(2);
const local = ids.startsWith("file:"), store = local ? null : await (await import("./lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort();
const T = { games: 0, would: 0, savedBy: 0, rival: 0, early: [] };
for (const name of parts) for (const line of ((local ? fs.readFileSync(name, "utf8") : await store.get(name)) || "").split("\n")) {
  if (!line.startsWith('{"game"')) continue;
  const g = JSON.parse(line);
  if (g.branch || g.winner == null || g.winner < 0) continue;
  T.games++;
  if (!g.would) continue;
  T.would++;
  if (g.winner === g.would.seat) { T.savedBy++; if (T.early.length < 8) T.early.push(`${g.seed} move ${g.would.i} of ${g.moves.length}`); }
}
const pc = (a, b) => `${a} of ${b} (${(100 * a / Math.max(1, b)).toFixed(2)}%)`;
console.log(`${T.games} played-out games from ${ids}; a seat would have resigned in ${pc(T.would, T.games)}; it went on to win ${pc(T.savedBy, T.would)}`);
if (T.early.length) console.log(`  games it would have thrown away: ${T.early.join("; ")}`);
