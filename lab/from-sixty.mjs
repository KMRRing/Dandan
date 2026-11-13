// Your games played on from the middle (13 Nov 2026, Fable): in each kept game, the first turn start with 60 cards or fewer
// in the library; from there both seats are Hard weighing every legal move (hardall*128, S4 d), the library re-dealt each
// game (hands, board and graveyards as they were). Monte's share there, by whether Monte won or lost the real game, says how
// much of the real result was decided by the play before that point. Shard n plays position floor(n / per) once (game n % per).
// usage: node lab/from-sixty.mjs <shard> <shards> <out> [games a position 20] [library at most 60] [judge s4d.json]
//        node lab/from-sixty.mjs sum <job>      (the table, from a finished job's parts)
import fs from "node:fs";
import { J, readParts } from "./lib.mjs";
import { applyMove, seeded, mix } from "../seats.js";
import { thinkMove } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { keptGames, recordAt } from "./mine-lib.mjs";

if (process.argv[2] === "sum") {
  const rows = (await readParts(process.argv[3])).flatMap(x => x.split("\n").filter(Boolean)).map(l => JSON.parse(l));
  const by = new Map();
  for (const r of rows) { const k = r.realMonte === 1 ? "Monte won the real game" : r.realMonte === 0 ? "Monte lost the real game" : "drawn"; const c = by.get(k) || { games: 0, monte: 0, positions: new Set() }; c.games++; c.monte += r.monte; c.positions.add(r.key); by.set(k, c); }
  for (const [k, c] of by) { const p = c.monte / c.games; console.log(`${k}: ${c.positions.size} positions, ${c.games} games, Monte ${(100 * p).toFixed(1)}% ± ${(100 * Math.sqrt(p * (1 - p) / c.games)).toFixed(1)}`); }
  process.exit(0);
}
const [shard, , out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const per = Number(process.argv[5] || 20), most = Number(process.argv[6] || 60);
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${process.argv[7] || "s4d.json"}`, import.meta.url), "utf8")).layers);
/** The kept games with a Monte seat and a result, each with its first turn start at `most` cards or fewer: [{ game, i }]. */
function positions() {
  const out = [];
  for (const game of keptGames()) {
    if (game.human == null || !(game.winner >= 0)) continue;
    let G = recordAt(game, 0);
    for (let i = 0; i < game.moves.length; i++) {
      const s = G.state;
      if (s.step === "upkeep" && !s.stack.length && !s.pending && s.lib.length <= most) { out.push({ game, i }); break; }
      const r = applyMove(game.R, G, game.moves[i][0], game.moves[i][1], game.now);
      if (r.error) break;
      G = r.G;
    }
  }
  return out;
}
const list = positions(), p = list[Math.floor(shard / per)];
fs.writeFileSync(out, "");
console.error(`positions: ${list.length}`);
if (!p) { console.log(JSON.stringify({ shard, positions: list.length, note: "no position for this shard" })); process.exit(0); }
const { game, i } = p, monte = 1 - game.human, R = game.R, realRandom = Math.random, g = shard % per;
const seed = mix(game.opts.seed, 78000001 + g), rng = seeded(seed), G0 = J(recordAt(game, i)), lib = G0.state.lib;
for (let k = lib.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [lib[k], lib[j]] = [lib[j], lib[k]]; }
let G = G0;
for (let m = 0; m < 4000 && !R.over(G.state); m++) {
  const who = R.toMove(G.state), x = R.restore(J(G.state));
  Math.random = seeded(mix(seed, m + 1));
  const mv = thinkMove(x, who, { deals: 128, ms: 1e9, judge, all: true, salt: seed });
  Math.random = realRandom;
  const r = applyMove(R, G, who, mv, game.now);
  if (r.error) break;
  G = r.G;
}
const w = G.state.winner, row = { key: game.file.replace(/\.json$/, ""), i, g, seed, monteSeat: monte, library: J(recordAt(game, i)).state.lib.length,
  realMonte: game.winner === monte ? 1 : 0, monte: w === monte ? 1 : w == null || w < 0 ? 0.5 : 0, winner: w, turns: G.state.turn };
fs.appendFileSync(out, JSON.stringify(row) + "\n");
console.log(JSON.stringify(row));
