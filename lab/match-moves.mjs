// What each side of a lab/hard-match.mjs job does, move by move (14 Nov 2026, Fable No. 16 point 5: "say what the ranker's side does
// less of"): from the games the shards printed (stdout-<n>.txt: { pair, seed, aSeat, winner, moves }), each side's moves a game by
// type (pass, land, cast, cycle, ability, attack, …), the share of its casts from the graveyard, and the game's length in moves.
// usage: node lab/match-moves.mjs <job>
import { labStore } from "./lib.mjs";

const job = process.argv[2], store = await labStore();
const names = (await store.list(`results/${job}/stdout-`)).filter(n => /stdout-\d+\.txt$/.test(n));
const side = [{}, {}], yard = [0, 0], casts = [0, 0];
let games = 0, len = 0;
for (let i = 0; i < names.length; i += 20) for (const text of await Promise.all(names.slice(i, i + 20).map(n => store.get(n)))) {
  for (const line of (text || "").split("\n")) {
    if (!line.startsWith("{")) continue;
    let g; try { g = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(g.moves)) continue;
    games++; len += g.moves.length;
    for (const [seat, m] of g.moves) {
      const k = seat === g.aSeat ? 0 : 1, t = m?.t || "?";
      side[k][t] = (side[k][t] || 0) + 1;
      if (t === "cast") { casts[k]++; if (m.from === "yard") yard[k]++; }
    }
  }
}
const types = [...new Set([...Object.keys(side[0]), ...Object.keys(side[1])])].sort((a, b) => (side[1][b] || 0) - (side[1][a] || 0));
console.log(`${job}: ${games} games from ${names.length} shards, ${(len / Math.max(1, games)).toFixed(1)} moves a game; a side's moves a game, A | B (A − B):`);
for (const t of types) { const a = (side[0][t] || 0) / games, b = (side[1][t] || 0) / games; console.log(`  ${t.padEnd(10)} ${a.toFixed(2).padStart(6)} | ${b.toFixed(2).padStart(6)}  (${(a - b >= 0 ? "+" : "") + (a - b).toFixed(2)})`); }
console.log(`  casts from the graveyard: A ${(100 * yard[0] / Math.max(1, casts[0])).toFixed(1)}%, B ${(100 * yard[1] / Math.max(1, casts[1])).toFixed(1)}%`);
