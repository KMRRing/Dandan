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
//   mix:<share>[:<deep deals 1024>] (11 November 2026): the search at mixed depth. That share of the decisions, drawn by the game's seed,
//   is searched at the deep deals (1,024 and more weigh every legal move) and marked `deep: 1`: the lessons for a learned policy; the
//   rest at <deals>, which keeps the games cheap and many: the lessons for a value net. Each decision says which it was.
//   any mode + "-explore3~<n>" (14 Nov 2026): 1 decision in n (at most one a game) played by a random other option of the search's
//   any mode + "-free~<model>" (14 Nov 2026): the look-aheads played by that Medium-free move-picker (lab/policy/<model>.json)
//   any mode + "-cut" (13 Nov 2026): the harder cutting of lab/halving.mjs (first look at 8 deals, 2 standard errors); self-play only
//   any mode + "-explore" (13 Nov 2026, Fable: data for a keep net trained on results): each seat's decision on its first seven is,
//   1 time in 4 (1 in 10 until 13 Nov 21:30Z), a fair coin (keep or throw back) instead of Medium's rule, marked in the line as explore: [{ seat, move }]
//   ("hardall-cut-explore": both)
//   hardall (12 November 2026, the planning chat: ab-g2-s4d-2all): Hard weighing every legal move, as the live game does at Deep,
//   at <deals>; each decision marks with `off: 1` a move played that Medium's shortlist would not have weighed.
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
import { knetMove } from "../dandan-keep.js";
import { makePlus } from "../dandan-netpolicy.js";

const [shard, shards, out, deals, games, seed0] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5] || 256), Number(process.argv[6] || 800), Number(process.argv[7] || 7000)];
const mode0 = process.argv[8] || "hard", judgeFile = process.argv[9];
// "-cut" (13 Nov 2026, Fable: self-play only, never gates or live play): the harder cutting lab/halving.mjs
// measured, a first look at 8 deals and moves dropped 2 standard errors behind (passing never dropped)
// the mode's flags, any order after the search (13 Nov 2026): -cut, -explore, -knet (the first seven by the keep net,
// judges/keep-net.json, as the benchmark keeps since 18:30Z; Medium's throw-backs still go back, later keeps Medium's)
const [mode, ...flags] = mode0.split("-"), explore = flags.includes("explore"), cut = flags.includes("cut");
const knet = flags.includes("knet") ? JSON.parse(fs.readFileSync(new URL("../judges/keep-net.json", import.meta.url), "utf8")) : null;
// "-free~<model>" (14 Nov 2026, Fable No. 7 point 10 / No. 11 point 3: the swap): the look-aheads are played past the tree by a
// Medium-free move-picker (lab/policy/<model>.json, unguarded) instead of Medium, as hard-match's "+free~" arm plays them
const lookFlag = flags.find(f => f.startsWith("free~"));
// "-explore3~<n>" (14 Nov 2026, Fable No. 13 point 4 and No. 15, Korbi 01:06Z): a decision where the search weighed two or more
// options is, 1 time in n by the game's seed and the move's number, played by a uniformly random other option from the search's
// list; at most one such move a game. The search runs there as usual; the decision keeps the search's pick as `pick` and adds the
// option played (`played`); the game's line gets explore3: { i, seat, move }
const x3Flag = flags.find(f => f.startsWith("explore3~")), X3 = x3Flag ? Number(x3Flag.slice(9)) : 0;
if (x3Flag && !(X3 >= 1)) throw new Error(`explore3~<n>: n must be 1 or more, not ${x3Flag.slice(9)}`);
const rollout = lookFlag ? makePlus(JSON.parse(fs.readFileSync(new URL(`./policy/${lookFlag.slice(5)}.json`, import.meta.url), "utf8").split("\n")[0]), { free: true }).move : null;
const EXPLORE_SHARE = 0.25; // 1 in 4 (Fable No. 7 point 3, Korbi 23:30 local); was 1 in 10
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
const every = mode === "hardall";
const mixed = mode.startsWith("mix:") ? mode.split(":").slice(1).map(Number) : null;   // [share of deep decisions, deep deals]
const base = Math.floor(games / shards), extra = games % shards, first = shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
const nm = id => DECK[id] ?? "token";
const realRandom = Math.random;
for (let g = first; g < first + n; g++) {
  let G = newRecord(rules, { seats: 2, seed: seed0 + g, now: 0 }), dec = [];
  const explored = [], explored2 = [];
  let explored3 = null;
  const log = [];
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state)), p = s.pending;
    Math.random = seeded(mix(seed0 + g, i + 1));
    let move;
    if (plans) move = policyMove(s, who, { style: plans[who] });
    else if (explore && p?.t === "mull" && p.taken === 0 && !explored.some(x => x.seat === who) && seeded(mix(seed0 + g, 9100003 + who))() < EXPLORE_SHARE) {
      // the first seven's decision by a coin, from the game's seed (the same wherever it is played)
      move = { t: seeded(mix(seed0 + g, 9200003 + who))() < 0.5 ? "keep" : "mull" };
      explored.push({ seat: who, move: move.t });
    }
    // (18:30Z, Fable) explore past the first seven too: each later keep by a coin 1 time in 4 (1 in 10 until 13 Nov 21:30Z), and the bottom cards at random
    // 1 time in 4 (1 in 10 until 13 Nov 21:30Z), from the game's seed and the move's number; marked in explore2 (explore keeps the first sevens only)
    else if (explore && p?.t === "mull" && p.taken > 0 && seeded(mix(seed0 + g, 9300003 + i))() < EXPLORE_SHARE) {
      move = { t: seeded(mix(seed0 + g, 9400003 + i))() < 0.5 ? "keep" : "mull" };
      explored2.push({ seat: who, i, kind: "keep", taken: p.taken, move: move.t });
    }
    else if (explore && p?.t === "bottom" && seeded(mix(seed0 + g, 9500003 + i))() < EXPLORE_SHARE) {
      const r = seeded(mix(seed0 + g, 9600003 + i)), hand = s.hand[who].slice();
      for (let k = hand.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [hand[k], hand[j]] = [hand[j], hand[k]]; }
      move = { t: "bottom", cards: hand.slice(0, p.n) };
      explored2.push({ seat: who, i, kind: "bottom", cards: move.cards.map(nm) });
    }
    else if (knet && p?.t === "mull" && p.taken === 0 && !p.free) move = knetMove(s, who, knet, policyMove(s, who)).move;
    else if (p && ["mull", "bottom", "name"].includes(p.t)) move = policyMove(s, who);
    else if (!p && !legal(s, who, true).length) move = PASS;
    else {
      // mix: this decision's depth, by the game's seed and the move's number (the same wherever the game is played)
      const deep = mixed ? seeded(mix(seed0 + g, 1000003 + i))() < mixed[0] : false;
      const res = (mode === "paths" ? thinkPaths : think)(s, who, { deals: deep ? mixed[1] || 1024 : deals, ms: 1e9, ...(every ? { all: true, offCheck: true } : {}), ...(cut ? { first: 8, z: 2, hold: true } : {}), ...(judge ? { judge } : {}), ...(rollout ? { rollout } : {}) });
      move = res.best;
      const key = m => JSON.stringify(m);
      if (X3 && !explored3 && !res.only && res.list.length >= 2 && seeded(mix(seed0 + g, 9700003 + i))() < 1 / X3) {
        const others = res.list.filter(c => key(c.move) !== key(res.best));
        if (others.length) { move = others[Math.floor(seeded(mix(seed0 + g, 9800003 + i))() * others.length)].move; explored3 = { i, seat: who, move }; }
      }
      if (!res.only) {
        const list = res.list.map(c => [moveName(c.move, s, who), c.move, +c.mean.toFixed(4), +c.se.toFixed(4), c.n, c.out ? 1 : 0]);
        dec.push({
          i, seat: who, turn: s.turn, step: s.step, lib: s.lib.length, life: s.life.slice(), hands: s.hand.map(h => h.length), hand: s.hand[who].map(nm).sort(),
          bf: s.bf.map(q => [nm(q.id), q.ctl, q.tapped ? 1 : 0]), yard: s.yard.map(nm).sort(), stack: s.stack.map(x => x.name),
          list, med: res.list.findIndex(c => c.i === 0), pick: res.list.findIndex(c => key(c.move) === key(res.best)),
          ...(explored3 && explored3.i === i ? { played: res.list.findIndex(c => key(c.move) === key(move)) } : {}),
          ...(mixed ? { deep: deep ? 1 : 0 } : {}), ...(every ? { off: res.off ? 1 : 0 } : {}),
        });
      }
    }
    log.push([who, move]);
    G = applyMove(rules, G, who, move, 0).G;
  }
  Math.random = realRandom;
  const st = G.state;
  // a line each game as it ends, so a machine taken away mid-share loses only the game it was playing
  fs.appendFileSync(out, JSON.stringify({ game: g, seed: seed0 + g, winner: st.winner, why: st.why, turns: st.turn, moves: log, dec, ...(explored.length ? { explore: explored } : {}), ...(explored2.length ? { explore2: explored2 } : {}), ...(explored3 ? { explore3: explored3 } : {}) }) + "\n");
}
