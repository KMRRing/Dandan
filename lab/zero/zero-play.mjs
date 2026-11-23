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
import { branchPoints, drawPoint, redeal } from "./branch-lib.mjs";

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
  // prior=<k> (19 Nov 2026, Korbi: "do both"): the policy as the search's prior, the general nets only (lab/zero/general.mjs withPrior)
  ...(flag("prior") ? { prior: Number(flag("prior")) } : {}),
  // multi=1 (22 Nov 2026, Fable): the group lift off one card's several ways (lab/zero/general.mjs withPrior)
  ...(flag("multi") ? { multi: true } : {}),
  // bestreply=1 (22 Nov 2026, Fable 19:08Z): a root move scored by the other seat's best first reply (dandan-think.js)
  ...(flag("bestreply") ? { bestReply: true } : {}),
  // commit=1 (22 Nov 2026, Fable 19:40Z): explore, then commit, at the other seat's first reply (dandan-think.js)
  ...(flag("commit") ? { commit: true } : {}),
  // cheat=hand|all (LAB ONLY, 23 Nov 2026, Fable 09:45Z, Korbi's yes 11:38 local: the ceiling probe): the nets' search sees the
  // other hand (hand) or the other hand and the library's order (all). Breaks "Monte never uses what a player can't know": a
  // measuring stick only, never a candidate; the game's engines (dandan-engines.js) have no way to pass it
  ...(flag("cheat") ? { open: flag("cheat") === "all" ? "all" : true } : {}),
};
const CAP = flag("cap") ? (([share, d]) => ({ share, deals: d || 64 }))(flag("cap").split(":").map(Number)) : null;
// priorsplit (19 Nov 2026, Fable): the prior on even shards only, so a batch reads with and without it side by side; the game
// line says which (prior: c, or 0)
if (DEEPER.prior && flag("priorsplit") && shard % 2 === 1) delete DEEPER.prior;
const PRIOR = DEEPER.prior || 0;
const FAST = { ...(DEEPER.decided ? { decided: DEEPER.decided } : {}), ...(PRIOR ? { prior: PRIOR } : {}), ...(DEEPER.open ? { open: DEEPER.open } : {}) };
// vsresign=<share> (19 Nov 2026, Fable): that share of the rival games resigns for real (the goal's engine, resigning included);
// the rest play out as before, with `would` keeping count
const VS_RESIGN = Number(flag("vsresign") || 0);
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
// "noprior:<every>" (19 Nov 2026, Korbi: "a sample … prior vs no prior, both deep"): the same nets as ours, playing without the
// policy prior while our side plays with it, whatever the shard; the head-to-head reading of the prior, its games training as any
const RIVALS = await Promise.all((flag("vs") || "").split(",").filter(Boolean).map(async (spec, k) => {
  const cut = spec.lastIndexOf(":"), nets = spec.slice(0, cut), every = Number(spec.slice(cut + 1)) || 0;
  const at = k ? (Math.floor(every / 2) + k) % every : 0;
  if (nets === "noprior") return { nets, every, at, noprior: true, brain: await brainBy(process.argv[8], process.argv[9]) };
  // "withprior:<every>" (23 Nov 2026, Fable 09:55Z: from generation 28 our side plays without the prior): the same nets as ours,
  // playing with the policy prior (×1) while our side plays without it; the same head-to-head, the other way round
  // "policyonly:<every>" (23 Nov 2026, Fable 11:35Z, zpol001): the same nets as ours, playing the policy's top move with no search
  if (nets === "policyonly") return { nets, every, at, policyonly: true, brain: await brainBy(process.argv[8], process.argv[9]) };
  if (nets === "withprior") return { nets, every, at, withprior: true, brain: await brainBy(process.argv[8], process.argv[9]) };
  return { nets, every, at, brain: await brainBy(nets.startsWith("gen:") ? nets : `${nets}-policy`, `${nets}-value`) };
}));
const rivalOf = g => RIVALS.find(r => r.every && g % r.every === r.at) || null;
const random = !brain.judge;   // generation 0: no value net, no search
const J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m);
const base = Math.floor(games / shards), extra = games % shards, first = shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
const realRandom = Math.random;
// branch=<share> bsrc=<batches> [bw=<weights, URI-encoded JSON>] [bparts=6] (19 Nov 2026, Korbi; lab/zero/branch-lib.mjs): that
// share of the self-play games start from a branch point of a stored game of those batches (a rare ending, an even position, or
// the other side of a close call), the hidden cards re-dealt from the view of the player to move; this shard draws its branch
// points from bparts parts chosen at random
const BRANCH = Number(flag("branch") || 0);
let POINTS = [];
if (BRANCH && flag("bsrc")) {
  const local = flag("bsrc").startsWith("file:"), weights = flag("bw") ? JSON.parse(decodeURIComponent(flag("bw"))) : {};
  const st = local ? { get: async n => fs.readFileSync(n, "utf8") } : await (await import("../lib.mjs")).labStore();
  const names = local ? [flag("bsrc").slice(5)] : (await Promise.all(flag("bsrc").split(",").map(id => st.list(`results/${id}/`)))).flat().filter(x => /\/part-\d+\.jsonl$/.test(x));
  const pick = seeded(mix(seed0 + shard, 4949)), chosen = [];
  for (let k = 0; k < Math.min(Number(flag("bparts") || 6), names.length); k++) chosen.push(names.splice(Math.floor(pick() * names.length), 1)[0]);
  const games = [], decisions = new Map();
  for (const name of chosen) for (const l of ((await st.get(name)) || "").split("\n")) {
    if (l.startsWith('{"game"')) games.push(JSON.parse(l));
    else if (l.startsWith('{"g"')) { const d = JSON.parse(l); delete d.x; (decisions.get(d.g) || decisions.set(d.g, []).get(d.g)).push(d); }
  }
  POINTS = branchPoints(games, decisions, weights);
  console.error(`branch points: ${POINTS.length} from ${games.length} games in ${chosen.length} parts`);
}
// arb=<file> (22 Nov 2026, Fable's acceptance test b; points from lab/arbiter-points.mjs): the play-out arbiter. Shard 2k plays
// point k with the search's top move forced, shard 2k+1 with the policy's; game j of either shard re-deals with the same seed, so
// the two sides are paired game by game. The nets play both seats from there, deep as asked, and never resign.
const ARB = flag("arb") ? JSON.parse(fs.readFileSync(flag("arb"), "utf8")) : null, ARBP = ARB ? ARB[Math.floor(shard / 2)] : null;
// a point names its source game's part in the store: its moves are read from there, up to the decision
if (ARBP && !ARBP.moves) {
  const st = await (await import("../lib.mjs")).labStore();
  const src = ((await st.get(ARBP.part)) || "").split("\n").filter(l => l.startsWith('{"game"')).map(l => JSON.parse(l)).find(x => x.seed === ARBP.src);
  ARBP.moves = src ? src.moves.slice(0, ARBP.at + 1) : [];
}
const ARBSIDE = shard % 2 ? "policy" : "search";
fs.writeFileSync(out, "");
for (let g = first; g < first + n && (!ARB || ARBP); g++) {
  const seed = ARB ? seed0 + 1000 * Math.floor(shard / 2) + (g - first) : seed0 + g, lines = [], rows = [];
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), explored3 = null, lastTurn = -1;
  // a game against the previous nets: the seat they play, taking turns game by game
  const R = rivalOf(g), rival = R?.brain || null, VS_NETS = R?.nets || "";
  const vsSeat = R ? Math.floor(g / R.every) % 2 : -1, brainOf = seat => (seat === vsSeat ? rival : brain);
  brain.reset(); if (rival) rival.reset();
  // games against a rival always play out (18 Nov: zl16 resigned 49 of its 69 losses to the full g12r-C; the score has to be
  // the true one, and `would` shows what resigning there would have cost)
  const realVs = vsSeat >= 0 && VS_RESIGN > 0 && seeded(mix(seed, 777003))() < VS_RESIGN;
  const noResign = !RESIGN || (vsSeat >= 0 ? !realVs : seeded(mix(seed, 777001))() < RESIGN.keep), streak = [0, 0];
  let resigned = null, would = null;
  const rescued = [];
  // a branch game: the source's moves replayed up to the branch point with its randomness, then the hidden cards re-dealt from
  // the view of the player to move; this game's own randomness from there (branch-lib.mjs rngSeedOf)
  let i0 = 0, branch = null, force = null;
  const arbPoint = ARBP ? { kind: "A", g: { seed: ARBP.src, moves: ARBP.moves }, at: ARBP.at, force: ARBP[ARBSIDE] } : null;
  if (arbPoint || POINTS.length && vsSeat < 0 && seeded(mix(seed, 4747))() < BRANCH) {
    const p = arbPoint || drawPoint(POINTS, seeded(mix(seed, 4848))), src = p.g;
    let H = newRecord(rules, { seats: 2, seed: src.seed, now: 0 }), at = -1;
    for (let k = 0; k < src.moves.length && !rules.over(H.state); k++) {
      const st0 = H.state;
      if (p.kind === "E" ? st0.turn >= p.turnAt && !st0.pending : k === p.at) { at = k; break; }
      const [w, m] = src.moves[k], s0 = rules.restore(J(st0));
      Math.random = seeded(mix(src.seed, k + 1));
      const r = applyMove(rules, H, w, m, 0);
      Math.random = realRandom;
      if (r.error) break;
      brain.seen(s0, w, m, r.G.state); H = r.G;
    }
    if (at >= 0 && !rules.over(H.state)) {
      const seat = rules.toMove(H.state);
      G = { ...H, state: redeal(rules, H.state, seat, seed) }; i0 = at;
      branch = { src: src.seed, at, seat, kind: p.kind, ...(p.force ? { force: p.force } : {}), ...(arbPoint ? { side: ARBSIDE, point: Math.floor(shard / 2), band: ARBP.band, v: ARBP.v, gap: ARBP.gap } : {}) };
      if (p.force) force = p.force;
    } else brain.reset();
  }
  const holdSeed = branch ? branch.src : seed;
  // a branch game plays out (Fable, 19 Nov): the rare endings it is for would be conceded before they happen; `would` still counts
  const noResignHere = noResign || !!branch;
  for (let i = i0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    const rng = seeded(mix(seed, i + 1));
    Math.random = rng;
    if (s.turn !== lastTurn && !s.pending) { lastTurn = s.turn; for (const me of [0, 1]) rows.push({ i, seat: me, turn: s.turn, f: valueRow(s, me) }); }
    const ms = zeroOptions(s, who);
    let move;
    // the other side of a close call: the branch's first move, if still legal after the re-deal (not written as a lesson)
    const forced = force && i === i0 && ms.some(m => key(m) === key(force)) ? force : null;
    if (forced) { move = forced; branch.forced = 1; }   // forced: the branch's move was still legal after the re-deal
    else if (ms.length <= 1) move = ms[0] ?? PASS;
    else if (random) move = ms[Math.floor(rng() * ms.length)];
    else {
      // the yardstick rival (an old-line engine, not gen:) plays straight up (Korbi 18 Nov 05:37: "the clean engine with resign and
      // lazy searching on winning or losing positions to beat the leaky hard-working old engine straight up"): the same deals and
      // close-call look, none of the shortcuts (early, decided stops) and it never resigns
      const yard = who === vsSeat && R && !R.nets.startsWith("gen:");
      // cap=<share>:<deals> (18 Nov 2026, KataGo's playout cap randomisation; Korbi 04:48 "KataGo in for sure"): a share of
      // decisions gets the full search and only those become policy targets; the rest play from a fast search (that many deals,
      // no close-call look) and leave no decision line (their positions still give value rows from the game's result)
      // in a game against a rival both sides search fully on every move (18 Nov: zl16 scored 32.7% against the full g12r-C
      // while 3 of its own moves in 4 came from the 128-deal fast search; a reading has to be like for like)
      const full = vsSeat >= 0 || !CAP || seeded(mix(seed, 3300017 + i))() < CAP.share;
      // the prior head-to-head: our side with the prior (the flag's weight, or 1), the rival without
      const opts0 = yard ? FULL : full ? DEEPER : FAST, opts = vsSeat >= 0 && who === vsSeat && opts0.open ? (({ open, ...o }) => o)(opts0) : opts0, ab = R?.policyonly ? (who === vsSeat ? { policyOnly: true } : opts) : R?.withprior ? (who === vsSeat ? { ...opts, prior: 1 } : opts) : R?.noprior ? (who === vsSeat ? (({ prior, ...o }) => o)(opts) : { ...opts, prior: Number(flag("prior")) || 1 }) : opts;   // the rival never sees through (cheat)
      // oracle=1 (19 Nov 2026, Korbi: a diagnostic, never self-play): our side's search sees the other hand as it is (determinize
      // open: only the library's order dealt), the upper bound of what a perfect dealer could give it
      const ab2 = flag("oracle") && who !== vsSeat ? { ...ab, open: true } : ab;
      // rdeals=<n> (19 Nov 2026, Fable: which engine gains from depth): the rival searches at n deals with the close-call look one
      // turn deeper only (quick), our side as the flags say (deep): the same nets on both sides make a depth-against-quick match
      const R_DEALS = Number(flag("rdeals") || 0), rq = R_DEALS && who === vsSeat;
      let res = brainOf(who).think(s, who, rq ? R_DEALS : full ? deals : CAP.deals, rq ? (DEEPER.deeper ? { deeper: { gap: DEEPER.deeper.gap } } : {}) : ab2);
      move = res.best;
      if (RESIGN && !res.only && !yard) {
        const v = res.list.find(c => key(c.move) === key(res.best))?.mean;
        streak[who] = v != null && v < RESIGN.t ? streak[who] + 1 : 0;
        // a game that never resigns stops asking once its would-resign point is noted (20 Nov 2026, Korbi 10:28: "keep documenting
        // when resignation would happen but don't actually do it"; every game now plays out, so a lost one would otherwise run the
        // 2,048-deal confirmation on every later move)
        if (streak[who] >= RESIGN.run && !(noResignHere && would)) {
          // one deep search confirms it first (Korbi 04:08: "do one deep search, if it's obvious still, resign"): 2,048 deals,
          // the close-call look up to 4 turns; an out found there plays on (the streak starts again)
          const deep = brainOf(who).think(s, who, RESIGN.confirm, { deeper: { gap: 0.03, max: 4 } }), dv = deep.only ? null : Math.max(...deep.list.map(c => c.mean));
          if (dv != null && dv >= RESIGN.t) { streak[who] = 0; rescued.push({ seat: who, i, v: +dv.toFixed(4) }); res = deep; move = deep.best; }   // the deep search's line is the one kept
          else if (!noResignHere) { resigned = { seat: who, i }; Math.random = realRandom; break; }
          else if (!would) would = { seat: who, i };
        }
      }
      if (X3 && !explored3 && res.list.length >= 2 && seeded(mix(seed, 9700003 + i))() < 1 / X3) {
        const others = res.list.filter(c => key(c.move) !== key(res.best));
        if (others.length) { move = others[Math.floor(seeded(mix(seed, 9800003 + i))() * others.length)].move; explored3 = { i, seat: who, move }; }
      }
      // every searched decision: with priority for the policy head, a question (qd) for the question head
      if (full && !res.only && res.list.length >= 2) lines.push(decisionLine(s, who, seed, i, res, res.list.findIndex(c => key(c.move) === key(res.best)), deals, holdSeed % 5 === 0, null));
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
    ...rows.map(r => JSON.stringify({ v: 1, g: seed, seat: r.seat, turn: r.turn, f: r.f, won: won(r.seat), ...(holdSeed % 5 === 0 ? { hold: 1 } : {}), ...(explored3 ? { x3: Math.sign(r.i - explored3.i) } : {}) })),
    JSON.stringify({ game: g, seed, winner: st.winner, why: st.why, turns: st.turn, moves: G.moves ?? [], ...(branch ? { branch } : {}), ...(explored3 ? { explore3: explored3 } : {}), ...(vsSeat >= 0 ? { vs: { nets: VS_NETS, seat: vsSeat, ...(realVs ? { resign: true } : {}) } } : {}), ...(PRIOR ? { prior: PRIOR } : flag("priorsplit") ? { prior: 0 } : {}), ...(resigned ? { resign: resigned } : {}), ...(would ? { would } : {}), ...(rescued.length ? { rescued } : {}) })];
  fs.appendFileSync(out, text.join("\n") + "\n");
  if (WALL && brain.walls?.()) for (const w of brain.walls()) console.error(`wall ${w.me} game ${g}: ${JSON.stringify(w.stats)} worlds ${w.parts.filter(p => p.alive).length} ess ${w.ess().toFixed(1)}`);
}
