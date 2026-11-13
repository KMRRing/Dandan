// A real game played on from one of its positions many times (13 Nov, Korbi: "this may be a position to start from that the
// engine *should* win, even with the draws the way they are"): from <game key>:<move index> of the kept games, each game
// re-deals the library's order (hidden from both players, so each is a different future; hands, board and graveyards as they
// were) and both seats play to the end. Shard n plays games n, n + shards, …; a line a game: { game, seed, winner, turns, moves }
// (the moves from the position on), the mover at the position counted as "us".
// usage: node lab/from-position.mjs <shard> <shards> <out> <game:move> <games> [our engine hardall*128] [their engine hardall*128] [judge s4d.json] [deal shuffle]
//   deal: shuffle (the library re-dealt each game) or real (the library as it was: the draws the way they were, only the engines' seeds differ)
//   engine: hard (the shortlist) or hardall (every legal move), *deals
import fs from "node:fs";
import { J } from "./lib.mjs";
import { applyMove, seeded, mix } from "../seats.js";
import { thinkMove } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { keptGames, recordAt } from "./mine-lib.mjs";

const [shard, shards, out, at, games] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], Number(process.argv[6] || 100)];
const engines = [process.argv[7] || "hardall*128", process.argv[8] || "hardall*128"].map(e => { const [mode, d] = e.split("*"); return { all: mode === "hardall", deals: Number(d || 128) }; });
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${process.argv[9] || "s4d.json"}`, import.meta.url), "utf8")).layers);
const shuffle = (process.argv[10] || "shuffle") !== "real";
const [key, i0] = [at.split(":")[0], Number(at.split(":")[1])];
const game = keptGames().find(g => g.src === `kept:${key}.json`);
if (!game) throw new Error(`no kept game ${key}`);
const start = recordAt(game, i0), us = game.moves[i0][0], R = game.R, realRandom = Math.random;
fs.writeFileSync(out, "");
let won = 0, played = 0;
for (let g = shard; g < games; g += shards) {
  const seed = mix(game.opts.seed, 77000001 + g), rng = seeded(seed), G0 = J(start), lib = G0.state.lib;
  if (shuffle) for (let k = lib.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [lib[k], lib[j]] = [lib[j], lib[k]]; }
  let G = G0;
  const moves = [];
  for (let i = 0; i < 4000 && !R.over(G.state); i++) {
    const who = R.toMove(G.state), e = engines[who === us ? 0 : 1], x = R.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const mv = thinkMove(x, who, { deals: e.deals, ms: 1e9, judge, all: e.all, salt: seed });
    Math.random = realRandom;
    const r = applyMove(R, G, who, mv, game.now);
    if (r.error) break;
    G = r.G; moves.push([who, mv]);
  }
  const w = G.state.winner, result = w === us ? 1 : w == null || w < 0 ? 0.5 : 0;
  won += result; played++;
  fs.appendFileSync(out, JSON.stringify({ at, game: g, seed, us, result, winner: w, why: G.state.why, turns: G.state.turn, library: G.state.lib.length, moves }) + "\n");
}
console.log(JSON.stringify({ shard, at, played, won }));
