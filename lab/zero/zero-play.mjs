// Zero's self-play, one shard (14 Nov 2026, Fable No. 12, No. 13 points 3-4, No. 17 point 6; Korbi: pure, more compute, Deep).
// Generation 0 (policy and value "-"): uniform random legal play, no search. From generation 1: at every decision with two or
// more options the search weighs all of them (zero-lib.mjs zeroOptions: no Medium), the look-aheads played by Zero's policy (at
// random before one is trained), the tree's options at a decision with priority the policy's focus, the position at the end
// of a look-ahead judged by Zero's value net, hidden cards dealt without tells. 1 decision in `x3` (at most one a game) is played
// by a random other option of the search's list (explore3), and the value net then learns only from positions after it.
// Out, one JSON line each: a searched decision with priority (lab/export.mjs's format, so fetch-ex.mjs / policy_np.py read it),
// then the game's value rows { v: 1, g, seat, turn, f: [mine, theirs], won, x3 } at every turn's start for both seats, then
// { game, seed, winner, turns, moves, explore3 }.
// "vs=<nets>:<every>" (17 Nov 2026, Korbi: how the general Monte is known to be ready, with every game still training): every
// <every>th game one seat (taking turns) plays the nets <nets> (lab/zero/nets/<nets>-policy, -value), the previous generation's;
// the game line says so ({ vs: { nets, seat } }), and Zero's loop reads the new nets' score against them off those games.
// The general line (17 Nov 2026, Korbi: "loop on general line … asap"): a policy argument gen:<name> plays the general Monte
// (lab/zero/general.mjs; nets lab/zero/nets/<name>-gpolicy, -gvalue, -scry12; the value argument is then ignored), and
// vs=gen:<name>:<every> plays it as the rival. The records are the same (moves and the search's weights): the general packer
// replays them.
// usage: node lab/zero/zero-play.mjs <shard> <shards> <out> <deals> <games> <first seed> <policy net|gen:<name>|-> <value net|-> [x3 400] [deeper=<gap>] [vs=<nets>:<every>]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { zeroOptions, zeroBrain, generalBrain, valueRow, decisionLine, PASS } from "./zero-lib.mjs";

const [shard, shards, out, deals, games, seed0] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5]), Number(process.argv[6]), Number(process.argv[7])];
// the nets by name; from generation 6 (Korbi 10:04) a policy on the extended view with its Scry, and a value net face up
// "wall=<worlds>" (17 Nov 2026, Korbi: the particle wall, lab/zero/wall.mjs): the general Monte deals its worlds from a wall of
// that many
const WALL = Number((process.argv.slice(11).find(f => f.startsWith("wall=")) || "").slice(5)) || 0;
const brainBy = (policy, value) => (policy.startsWith("gen:") ? generalBrain(policy.slice(4), WALL ? { wall: { n: WALL } } : {}) : zeroBrain(policy, value, null));
const brain = await brainBy(process.argv[8], process.argv[9]), X3 = Number(process.argv[10] || 400);
// "deeper=<gap>" (15 Nov 2026, Korbi): three turns ahead on close calls, the search's values for those moves the deeper look's
const FLAGS = process.argv.slice(11), flag = k => FLAGS.find(f => f.startsWith(`${k}=`))?.slice(k.length + 1);
// deepmax=<turns> (17 Nov 2026, Korbi 19:51: the search rule, "more ambitious"): the close-call look may go on, a turn at a
// time while still close, up to that many turns ahead; early=<at>:<gap>[:<most>],… the search stops at `at` deals when the
// leader is `gap` ahead (with fewer than `most` options); first=, steady= as think's
const DEEPER = {
  ...(flag("deeper") ? { deeper: { gap: Number(flag("deeper")), ...(flag("deepmax") ? { max: Number(flag("deepmax")) } : {}) } } : {}),
  ...(flag("early") ? { early: flag("early").split(",").map(e => { const [at, gap, most] = e.split(":").map(Number); return { at, gap, ...(most ? { most } : {}) }; }) } : {}),
  ...(flag("first") ? { first: Number(flag("first")) } : {}),
  ...(flag("steady") ? { steady: Number(flag("steady")) } : {}),
  // decided=<at>:<hi>:<lo> (18 Nov 2026, Korbi 03:56): the search stops at `at` deals when the best move's mean is hi+ or lo-
  ...(flag("decided") ? { decided: (([at, hi, lo]) => ({ at, hi, lo }))(flag("decided").split(":").map(Number)) } : {}),
};
// the old engine's search as the yardstick plays it: the close-call look only
const FULL = DEEPER.deeper ? { deeper: DEEPER.deeper } : {};
// resign=<threshold>:<run>:<keep> (18 Nov 2026, Korbi 03:56; AlphaZero's resignation): a seat whose searched best move is worth
// less than `threshold` at `run` of its own decisions in a row resigns, and the game is the other seat's. A share `keep` of games
// never resigns, so the false resignations can be counted (their game line notes where a resignation would have come: would).
// Measured on zps007 (lab/decided-zero.mjs, 1,349 games): below 0.03 for 2 decisions resigns 81% of games, 0.8% of them wrongly,
// saving 29% of the search's deals.
// The confirming search's deals: resign=<t>:<run>:<keep>:<confirm> (2,048 when left out).
const RESIGN = flag("resign") ? (([t, run, keep, confirm]) => ({ t, run, keep, confirm: confirm || 2048 }))(flag("resign").split(":").map(Number)) : null;
// vs=<nets>:<every>[,<nets>:<every>…] (18 Nov 2026, Korbi 03:52: is the honest line gaining? the previous nets every generation,
// and the leaky old engine g12r-C as a fixed yardstick): the first rival plays games g % every = 0, each later one games
// g % every = every / 2 + its place (1, 2…), off the first rival's multiples (with 10 and 20: games 0, 10, 20… and 11, 31…)
const RIVALS = await Promise.all((flag("vs") || "").split(",").filter(Boolean).map(async (spec, k) => {
  const cut = spec.lastIndexOf(":"), nets = spec.slice(0, cut), every = Number(spec.slice(cut + 1)) || 0;
  return { nets, every, at: k ? Math.floor(every / 2) + k : 0, brain: await brainBy(nets.startsWith("gen:") ? nets : `${nets}-policy`, `${nets}-value`) };
}));
const rivalOf = g => RIVALS.find(r => r.every && g % r.every === r.at) || null;
const random = !brain.judge;   // generation 0: no value net, no search
const J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m);
const base = Math.floor(games / shards), extra = games % shards, first = shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
const realRandom = Math.random;
fs.writeFileSync(out, "");
for (let g = first; g < first + n; g++) {
  const seed = seed0 + g, lines = [], rows = [];
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), explored3 = null, lastTurn = -1;
  // a game against the previous nets: the seat they play, taking turns game by game
  const R = rivalOf(g), rival = R?.brain || null, VS_NETS = R?.nets || "";
  const vsSeat = R ? Math.floor(g / R.every) % 2 : -1, brainOf = seat => (seat === vsSeat ? rival : brain);
  brain.reset(); if (rival) rival.reset();
  const noResign = !RESIGN || seeded(mix(seed, 777001))() < RESIGN.keep, streak = [0, 0];
  let resigned = null, would = null;
  const rescued = [];
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    const rng = seeded(mix(seed, i + 1));
    Math.random = rng;
    if (s.turn !== lastTurn && !s.pending) { lastTurn = s.turn; for (const me of [0, 1]) rows.push({ i, seat: me, turn: s.turn, f: valueRow(s, me) }); }
    const ms = zeroOptions(s, who);
    let move;
    if (ms.length <= 1) move = ms[0] ?? PASS;
    else if (random) move = ms[Math.floor(rng() * ms.length)];
    else {
      // the yardstick rival (an old-line engine, not gen:) plays straight up (Korbi 18 Nov 05:37: "the clean engine with resign and
      // lazy searching on winning or losing positions to beat the leaky hard-working old engine straight up"): the same deals and
      // close-call look, none of the shortcuts (early, decided stops) and it never resigns
      const yard = who === vsSeat && R && !R.nets.startsWith("gen:");
      let res = brainOf(who).think(s, who, deals, yard ? FULL : DEEPER);
      move = res.best;
      if (RESIGN && !res.only && !yard) {
        const v = res.list.find(c => key(c.move) === key(res.best))?.mean;
        streak[who] = v != null && v < RESIGN.t ? streak[who] + 1 : 0;
        if (streak[who] >= RESIGN.run) {
          // one deep search confirms it first (Korbi 04:08: "do one deep search, if it's obvious still, resign"): 2,048 deals,
          // the close-call look up to 4 turns; an out found there plays on (the streak starts again)
          const deep = brainOf(who).think(s, who, RESIGN.confirm, { deeper: { gap: 0.03, max: 4 } }), dv = deep.only ? null : Math.max(...deep.list.map(c => c.mean));
          if (dv != null && dv >= RESIGN.t) { streak[who] = 0; rescued.push({ seat: who, i, v: +dv.toFixed(4) }); res = deep; move = deep.best; }   // the deep search's line is the one kept
          else if (!noResign) { resigned = { seat: who, i }; Math.random = realRandom; break; }
          else if (!would) would = { seat: who, i };
        }
      }
      if (X3 && !explored3 && res.list.length >= 2 && seeded(mix(seed, 9700003 + i))() < 1 / X3) {
        const others = res.list.filter(c => key(c.move) !== key(res.best));
        if (others.length) { move = others[Math.floor(seeded(mix(seed, 9800003 + i))() * others.length)].move; explored3 = { i, seat: who, move }; }
      }
      // every searched decision: with priority for the policy head, a question (qd) for the question head
      if (!res.only && res.list.length >= 2) lines.push(decisionLine(s, who, seed, i, res, res.list.findIndex(c => key(c.move) === key(res.best)), deals, seed % 5 === 0, null));
    }
    const r = applyMove(rules, G, who, move, 0);
    if (r.error) throw new Error(`zero game ${seed} move ${i}: ${r.error}`);
    brain.seen(s, who, move, r.G.state);
    if (vsSeat >= 0) rival.seen(s, who, move, r.G.state);
    G = r.G;
  }
  Math.random = realRandom;
  const st = resigned ? { ...G.state, winner: 1 - resigned.seat, why: "resign" } : G.state, won = seat => (st.winner === seat ? 1 : st.winner == null || st.winner < 0 ? 0.5 : 0);
  // with a random move in the game, every decision and value row says where it stands against it (x3 −1, 0, 1)
  if (explored3) for (const d of lines) d.x3 = Math.sign(d.i - explored3.i);
  const text = [...lines.map(d => JSON.stringify(d)),
    ...rows.map(r => JSON.stringify({ v: 1, g: seed, seat: r.seat, turn: r.turn, f: r.f, won: won(r.seat), ...(seed % 5 === 0 ? { hold: 1 } : {}), ...(explored3 ? { x3: Math.sign(r.i - explored3.i) } : {}) })),
    JSON.stringify({ game: g, seed, winner: st.winner, why: st.why, turns: st.turn, moves: G.moves ?? [], ...(explored3 ? { explore3: explored3 } : {}), ...(vsSeat >= 0 ? { vs: { nets: VS_NETS, seat: vsSeat } } : {}), ...(resigned ? { resign: resigned } : {}), ...(would ? { would } : {}), ...(rescued.length ? { rescued } : {}) })];
  fs.appendFileSync(out, text.join("\n") + "\n");
  if (WALL && brain.walls?.()) for (const w of brain.walls()) console.error(`wall ${w.me} game ${g}: ${JSON.stringify(w.stats)} worlds ${w.parts.filter(p => p.alive).length} ess ${w.ess().toFixed(1)}`);
}
