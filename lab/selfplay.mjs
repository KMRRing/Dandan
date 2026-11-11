// Hard against Hard, every decision kept with all that the search weighed (9 November 2026). The data to teach Medium from the
// search: at each decision with more than one move worth weighing, the position as the mover sees it, each candidate's mean
// win chance over the deals with its standard error and the deals it had, which candidate is Medium's own move (`med`, the
// first the look-ahead is given) and which the search played (`pick`). Written as lines, one per game as it ends:
//   { game, seed, winner, why, turns, moves: [[seat, move]…], dec: [{ i (index in moves), seat, turn, step, lib, life, hand
//     (the mover's, by name), bf ([name, seat, tapped]…), yard, stack, hands (sizes), list: [[name, move, mean, se, n, out]…],
//     med (index in list or -1), pick }] }
// The games replay from the seed and `moves` under the plain rules (dandan-rules.js `rules`), as lab/match.mjs plays them.
// Run by the Lab workflow, a share of the games in each job:
// usage: node lab/selfplay.mjs <shard> <shards> <out> <deals 256> <games 800> [first seed 7000] [mode hard] [judge]
//   mode: hard (the search above); paths (Hard over four paths, dandan-think.js thinkPaths); medium:<plan>:<plan> (Medium of those
//   plans, seat 0's first, no search kept: data for a judge of those plans). judge: a file in judges/, or @<job>[#variant] (a judge-variants run), else the game's own.
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { think, thinkPaths } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { readParts } from "./lib.mjs";
import { policyMove, PASS } from "../dandan-policy.js";
import { moves as legal } from "../dandan-engine.js";
import { moveName } from "../dandan-words.js";
import { DECK } from "../dandan-cards.js";
import { J } from "./lib.mjs";

const [shard, shards, out, deals, games, seed0] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5] || 256), Number(process.argv[6] || 800), Number(process.argv[7] || 7000)];
const mode = process.argv[8] || "hard", judgeFile = process.argv[9];
// a judge file in judges/, or @<job>[#variant]: a lab/judge-variants.mjs run's (its first line, or the line of that variant)
async function judgeFrom(t) {
  if (!t || t === "-") return undefined;
  if (t.startsWith("@")) {
    const [job, v] = t.slice(1).split("#"), ls = (await readParts(job)).flatMap(x => x.split("\n").filter(Boolean)).map(l => JSON.parse(l));
    return makeJudge((v == null ? ls[0] : ls.find(l => l.variant === Number(v))).layers);
  }
  return makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${t}`, import.meta.url), "utf8")).layers);
}
const judge = await judgeFrom(judgeFile);
const plans = mode.startsWith("medium:") ? mode.split(":").slice(1) : null;
const base = Math.floor(games / shards), extra = games % shards, first = shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
const nm = id => DECK[id] ?? "token";
const realRandom = Math.random;
for (let g = first; g < first + n; g++) {
  let G = newRecord(rules, { seats: 2, seed: seed0 + g, now: 0 }), dec = [];
  const log = [];
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state)), p = s.pending;
    Math.random = seeded(mix(seed0 + g, i + 1));
    let move;
    if (plans) move = policyMove(s, who, { style: plans[who] });
    else if (p && ["mull", "bottom", "name"].includes(p.t)) move = policyMove(s, who);
    else if (!p && !legal(s, who, true).length) move = PASS;
    else {
      const res = (mode === "paths" ? thinkPaths : think)(s, who, { deals, ms: 1e9, ...(judge ? { judge } : {}) });
      move = res.best;
      if (!res.only) {
        const key = m => JSON.stringify(m);
        const list = res.list.map(c => [moveName(c.move, s, who), c.move, +c.mean.toFixed(4), +c.se.toFixed(4), c.n, c.out ? 1 : 0]);
        dec.push({
          i, seat: who, turn: s.turn, step: s.step, lib: s.lib.length, life: s.life.slice(), hands: s.hand.map(h => h.length), hand: s.hand[who].map(nm).sort(),
          bf: s.bf.map(q => [nm(q.id), q.ctl, q.tapped ? 1 : 0]), yard: s.yard.map(nm).sort(), stack: s.stack.map(x => x.name),
          list, med: res.list.findIndex(c => c.i === 0), pick: res.list.findIndex(c => key(c.move) === key(move)),
        });
      }
    }
    log.push([who, move]);
    G = applyMove(rules, G, who, move, 0).G;
  }
  Math.random = realRandom;
  const st = G.state;
  // a line each game as it ends, so a machine taken away mid-share loses only the game it was playing
  fs.appendFileSync(out, JSON.stringify({ game: g, seed: seed0 + g, winner: st.winner, why: st.why, turns: st.turn, moves: log, dec }) + "\n");
}
