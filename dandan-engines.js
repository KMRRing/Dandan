// The engines of the game lab (lab.html): every computer player Dandan has, in one list, so the lab can seat any of them as
// the opponent (Monte) and any number of them as coaches. Pure data and two small functions, no page: the lab's page
// (dandan-lab.js), the look-ahead's worker (dandan-worker.js) and the Node tests all read it.
//
// An engine is { id, name, short, kind, description, expect, available, ... }:
//   kind "medium": dandan-policy.js's hand-written player, `style` choosing its plan (STYLES there), `tune` switches set in its TUNE
//                  for its moves only; about a millisecond a move.
//   kind "hard":   dandan-think.js's look-ahead, `judge` choosing the network that scores where a line ends (null: the game's own
//                  judge, dandan-eval.js `winChance`; else a key of JUDGES below).
//   available false: listed so it can be read about, but not seated (planned, not built).
// To add a variant, push one more entry onto ENGINES (a Medium style needs its entry in STYLES, a judge its file in JUDGES): the lab
// lists it, seats it and runs it with no other change.
import { policyMove, PASS, TUNE } from "./dandan-policy.js";
import { think, thinkMove } from "./dandan-think.js";
import { keepMove, knetMove } from "./dandan-keep.js";
import { moves } from "./dandan-engine.js";
import { makeJudge } from "./dandan-eval.js";
import { makePlus } from "./dandan-netpolicy.js";

/** The retrained judges, by name: the file each is read from (next to this module), `{ layers }` for makeJudge. */
export const JUDGES = {
  "ac-jh2": "./judges/ac-jh2.json",
  "ag-v14": "./judges/ag-v14.json",
  "jt130": "./judges/jt130.json",
  "s3c": "./judges/s3c.json",
  "s3d": "./judges/s3d.json",
  "s4d": "./judges/s4d.json",
  "s5": "./judges/s5.json",
  // a list: the mean of those judges' chances (12 November 2026: two nets averaged screened better than either alone)
  "avg-jt130-s3c": ["./judges/jt130.json", "./judges/s3c.json"],
  "avg-jt130-s4d": ["./judges/jt130.json", "./judges/s4d.json"],
};
/** The engine Monte plays in the live game (dandan-worker.js, a request with no engine), and the judge of the live game's coach
 *  and its end-of-game review. Generation 12's nets (g12r-C) since 17 November 2026, 10:30Z (Korbi: "put the new one live";
 *  no gates: the latest nets play; Monte's test suite, lab/suite.json, 4 of 5 against g9x-C's 0). Monte Scry Zero since 15 November 2026, 16:48Z (Korbi: "replace Monte in the standard app",
 *  after playing it in the lab; its Deep match against the benchmark 62.2%, 99% range 55.6 to 68.7, over 181 of 200 pairs, no
 *  crown test yet). Before it, Hard with S5 + the keep net from 13 November (its Deep gate against S4 d with Medium's keep,
 *  54.3% ± 2.5 over 1,195 of 1,200 pairs), S4 d from 12 November, v14 before that. The coach and the review stay Hard with S5. */
export const LIVE_ENGINE = "zero-g12r";
export const LIVE_JUDGE = "s5";

export const ENGINES = [
  {
    id: "medium-tempo", name: "Medium (tempo)", short: "Tempo", kind: "medium", style: "tempo", available: true,
    description: "Today's Medium: a hand-written player. It scores every legal move with rules written by hand (what a card is worth, how much mana to keep, whether a Dandân will survive) and plays the best. Its plan is tempo: it casts threats early and answers what it sees.",
    expect: "About 1 ms a move. Hard beats it about 87% of the time, and Hard uses it to play out its look-aheads (it moves both seats in the lines Hard imagines).",
  },
  {
    id: "medium-squeeze", name: "Medium (squeeze)", short: "Squeeze", kind: "medium", style: "squeeze", available: true,
    description: "Medium with the squeeze plan, built 10 November 2026 to play the mid-game value squeeze: it keeps two mana up when it holds answers, holds back a Dandân into likely answers, and weighs how urgent a threat is before spending an answer on it.",
    expect: "Honest status: in tests it scored 49% against tempo Medium in the mid game, so no better yet. It differs from tempo in about 9% of decisions, mostly holding back a Dandân.",
  },
  {
    id: "medium-tempo2", name: "Medium (tempo 2)", short: "Tempo2", kind: "medium", style: "tempo", tune: { tiWeak: 1, redraw: 1, reversal: 1 }, available: true,
    description: "Tempo Medium with Korbi's card values of 11 November 2026: a Take Inventory with none in the graveyard is only a draw-one (worth 0.35, and 0.65 more for each in the graveyard); a card countered onto their library costs them a fresh draw, so countering a bad card onto it is worth more; Narset's Reversal is worth more on a spell of theirs aimed at ours, and on an expensive one. (Both tempo Mediums also have the stack fix of that day: no counter at a spell already countered.)",
    expect: "Being matched against tempo Medium (lab jobs aa-ag-ti, -rd, -rv, -all): until those finish, not shown better.",
  },
  {
    id: "medium-squeeze2", name: "Medium (squeeze 2)", short: "Squeeze2", kind: "medium", style: "squeeze", tune: { tiWeak: 1, redraw: 1, reversal: 1 }, available: true,
    description: "Squeeze Medium with the same three card values as tempo 2 (Take Inventory, a bad card countered onto their library, Narset's Reversal), and the stack fix.",
    expect: "Matched against tempo 2 from mid-game setups where one side is ahead on mana and Memory Lapses: see the lab ledger.",
  },
  {
    id: "medium-deckout", name: "Medium (deckout)", short: "Deckout", kind: "medium", style: null, available: false,
    description: "Planned: plays to win the race to the end of the library (holds draw and put-back effects, counts cards). Not built yet.",
    expect: "Nothing to expect yet: it is listed so the lab shows the whole family.",
  },
  {
    id: "hard-today", name: "Hard (old judge)", short: "Hard old", kind: "hard", judge: null, available: true,
    description: "Hard as the live game played it until 11 November 2026: a look-ahead that plays each candidate move out over many dealt guesses of the hidden cards, Medium moving both sides about two turns ahead. Then today's judge scores the position: a small neural network trained on 1.3 million positions of 45,000 Medium-vs-Medium games. It drops clearly worse moves early and stops when the leader is clear.",
    expect: "Beaten 53.7% by Hard with judge v14, which took its place in the live game. It uses the thinking depth setting (as a coach it uses the lab's coach depth), so it takes from a fraction of a second to a few seconds a decision, and it shows its win chance for the move it picks.",
  },
  {
    id: "hard-v14", name: "Hard (judge v14)", short: "Hard v14", kind: "hard", judge: "ag-v14", available: true,
    description: "Hard with judge v14 (judges/ag-v14.json), the live game's Hard from 11 to 12 November 2026: the same look-ahead, with a judge retrained on about 2,850 Hard-vs-Hard self-play games starting from today's judge's weights, and given eight more inputs a side for the mid-game squeeze (card and land lead, and the like). Picked from a screen of 24 judge variants (lab job ag-jv1) for predicting results best, slow positions above all.",
    expect: "It beat Hard with the old judge 53.7% over 600 deals played both ways (1,200 games, at Quick), the first retrained judge to win its match. About a fifth slower per position judged.",
  },
  {
    id: "hard-jh2", name: "Hard (retrained judge jh2)", short: "Hard jh2", kind: "hard", judge: "ac-jh2", available: true,
    description: "Hard with the retrained judge (judges/ac-jh2.json): the same look-ahead, but the judge was retrained on about 2,900 Hard-vs-Hard self-play games (11 November 2026), with a rule that a card in hand may never lower its holder's chance.",
    expect: "It predicts game results better (Brier score 0.170 to 0.161 on held-out games) and almost never calls a card worth less than nothing (3.0% to 0.5% of positions). In a 1,066-game match against today's Hard it scored 50.8% ± 1.5: not yet shown stronger. It agrees with human moves slightly more often.",
  },
  // ---- the night of 11–12 November 2026 (lab ledger): candidates for Monte 1.1, to play against before one goes live ----
  {
    id: "hard-jt130", name: "Hard (judge jt130)", short: "Hard jt130", kind: "hard", judge: "jt130", available: true,
    description: "Hard with judge jt130 (judges/jt130.json): v14's own recipe (the same size and inputs) retrained on 15,462 of the lab's quick self-play games (Hard at 128–256 deals). The first judge since v14 to pass the planning chat's Deep gate.",
    expect: "Against Hard with v14, both at Deep (1,024 deals), 600 deals played both ways: 54.0% ± 3.5 (99% range 50.5–57.5): CROWNED. At Quick it screened 53.0%. Same speed as v14. Part of its edge is the luck of being the best of 18 screened, so the true edge is likelier near 2 points than 4.",
  },
  {
    id: "hard-s4d", name: "Hard (judge S4 d)", short: "Hard S4d", kind: "hard", judge: "s4d", available: true,
    description: "Hard with judge S4 d (judges/s4d.json): a larger network (128·64·32, about six times v14's weights) trained on all ~56,000 of the lab's quick self-play games, with the squeeze inputs and the rule that a card in hand may not lower its holder's chance.",
    expect: "Against Hard with v14, both at Deep (1,024 deals): 57.6% ± 3.6 after 575 of 600 deals played both ways, and above 50% even if it lost every deal still to come: CROWNED (12 November). At Quick: 54.6% ± 2.6 over 1,000. Predicts results best of all (Brier 0.143 against v14's 0.155 on held-out games). About 1.3× v14's thinking time a decision. The live game's Hard from 12 to 13 November 2026.",
  },
  {
    id: "hard-s5-knet", name: "Hard (S5 + keep net)", short: "Hard S5", kind: "hard", tag: "The live game's Monte from 13 to 15 November 2026, and still its coach: Hard with value net S5 and the keep net on the first seven.", judge: "s5", knet: true, available: true,
    description: "The lab's benchmark since 13 November 2026 (keep net from 18:30Z, Korbi): Hard with value net S5 (judges/s5.json: S4 d's recipe with the race inputs) and the keep net on the first seven (judges/keep-net.json: a small network trained on real results that rates a seven by its cards and the seat; a seven Medium throws back still goes back, one Medium keeps goes back when the net rates it under the redraw value, 49.9% on the play, 49.0% on the draw). Every later keep and the bottom cards are Medium's. The live game's Hard since 13 November 2026, 21:30Z (Korbi).",
    expect: "With S5 on both sides at Quick: the keep net against Medium's keep 52.0% ± 1.2 over 3,660 pairs; against the value keep +1.1 ± 1.2 on the same deals; the value table after the first seven (the hybrid) costs 1.4 ± 0.8. S5 against S4 d at Quick: 51.8% ± 1.8; S5 + value keep against live 52.1% ± 1.2 over 5,000. Its Deep gate against S4 d with Medium's keep, both at Deep (1,024 deals, every legal move): 54.3% ± 2.5 over 1,195 of 1,200 pairs (99%: 51.8 to 56.8), the same thinking time: it went live on that.",
  },
  {
    id: "hard-s5-knet-mpN6416", name: "Hard (S5 + keep net + mpN6416): the benchmark", short: "Bench mp", kind: "hard", tag: "The lab's yardstick: the live Hard with a Medium-free move-picker in its look-aheads, within a point of the live Hard.", judge: "s5", knet: true, look: "mpN6416", available: true,
    description: "The lab's benchmark since 14 November 2026, 00:55Z (Fable No. 11, Korbi 00:10): the live game's Hard (S5 and the keep net on the first seven) whose look-aheads are played past the tree by the Medium-free move-picker mpN6416 (judges/mp-mpN6416.json, a copy of lab/policy/mpN6416.json: 121 inputs, 64·16, every legal move and passing scored from the position and the move's marks alone, no Medium inside) instead of Medium. Medium still answers the engine's questions (attacks, blocks, targets, later keeps). Not the live game.",
    expect: "Against the live Hard (Medium in the look-aheads), Quick, 2,000 pairs: 49.1% (99%: 47.3 to 51.0), its side thinking 1.08 times as long: the swap bar (49% and at most 1.2 times) is met. Alone against Medium, no search: 49.2% over 20,000 pairs.",
  },
  {
    id: "zero-g12r", name: "Monte Scry Zero: live", short: "Zero", kind: "zero", tag: "What the live game plays since 17 November 2026: Monte Scry Zero with generation 12's nets (g12r-C), trained from scratch on that generation's games; the latest nets play, no gate (Korbi). Monte's test suite: 4 of 5 (g9x-C 0 of 5).", nets: "g12r-C", deeper: 0.03, available: true,
    description: "The from-scratch line (lab, 14–15 November 2026): nothing of Medium inside. Its options are every legal move and passing; its look-aheads are played by its own policy net (g12r-C, 654 inputs: the position as its seat sees it and Scry's estimate of the other hand) and its questions by its own question head; the hidden cards are dealt by Scry, a net that follows the other player's play and gives each unseen card in their hand its own chance of every name; positions are judged by its own value net (both hands face up). Close calls (the best two within 3 points) are weighed again three turns ahead instead of two (Korbi's variable look-ahead). Its nets (about 2 MB) ship with the app and are kept offline.",
    expect: "Monte's test suite (lab/suite.json, the no-Island Dandân positions from Korbi's games) at 256 deals: 4 of 5 passed, against 0 of 5 for g9x-C. Each warm generation has measured 2 to 3 points ahead of the one before at Quick.",
  },
  {
    id: "zero-zl20", name: "Monte Zero zl20 (lab)", short: "zl20", kind: "zero", general: true, belief: "scryg", nets: "zl20", deeper: 0.03, deepmax: 4, prior: 1, available: true,
    tag: "The clean line's generation 20 (19 Nov 2026), in the lab for Korbi to play: honest end to end (its value net sees both hands, as every value net does; its dealer and policy only what a seat may), with the policy as the search's prior on near-ties. Not the live game's Monte.",
    description: "The general Monte: one view of the game for any card set (3,009 inputs), a dealer (belief net) for the other hand, a policy that scores every legal move, a value net judging positions; the search deals the hidden cards from the dealer, plays look-aheads with the policy and weighs close calls up to four turns ahead; where the search can't tell two moves apart, the policy's view decides (prior). zl19, its parent, scored 58.5% against live Monte (g12r-C) at quick over 585 games.",
    expect: "Monte's test suite (the no-Island Dandân positions): zl19 passed 5 of 6 at 2,048 deals and 5 of 6 at quick with the prior. zl20's deep reading against live Monte runs on 19 Nov evening.",
  },
  {
    id: "zero-zl23x2", name: "Monte Zero zl23, prior ×2 + group lift (lab)", short: "zl23 ×2", kind: "zero", general: true, belief: "scryg", nets: "zl23", deeper: 0.03, deepmax: 4, prior: 2, multi: true, available: false,   // rejected (Fable 23 Nov 06:45Z: zad004, −3.4 ± 3.4 against ×1, no fewer mistakes)
    tag: "zl23's nets with the search fix of 22 Nov 2026 (Korbi 19:35 local: the latest strongest model in the lab): the policy's prior at twice the weight, and the group lift (one card's several ways, such as Mind Bend's targets, no longer look better by chance). Lab only, not the live game.",
    description: "As zl23, with prior ×2 and the group lift. On the suite's ten blunder positions over five seeds it avoids the bad move in 34 of 50 deep searches (zl23 with prior ×1: fewer) and 39 of 50 quick ones.",
    expect: "Not yet measured against live Monte: zl23 with prior ×1 scored 53.5% over 951 deep games (22 Nov). The fleet test of this setting (zdm003) is waiting.",
  },
  {
    id: "zero-zl25", name: "Monte Zero zl25 (lab)", short: "zl25", kind: "zero", general: true, belief: "scryg", nets: "zl25", deeper: 0.03, deepmax: 4, available: true,   // prior off, no lift (23 Nov 2026, Fable 06:45Z and 09:55Z)
    tag: "The clean line's newest generation (zl25, crowned 22 Nov 2026 12:00Z), with prior ×2 and the group lift. Lab only, not the live game.",
    description: "Generation 25's nets (policy fresh, value and dealer warm from zl24), searched as zl23 ×2.",
    expect: "Not measured against live Monte. The loop crowns every generation: zl24 scored 47.4% against zl23 over 477 games, and zl25 has not been played against either yet.",
  },
  {
    id: "zero-wide", name: "Monte Zero wide (lab)", short: "Wide", kind: "zero", general: true, belief: "scryg", nets: "zp27wide", deeper: 0.03, deepmax: 4, available: true,   // prior off (24 Nov 2026, Korbi 16:45 local: the potentially best engine in the lab as an optional opponent)
    tag: "The potentially strongest engine tested so far (24 Nov 2026): generation 27's value net and dealer (zl27) with the wide policy (zp27wide: 256/128/128, 24 epochs), the prior off. Lab only, not the live game.",
    description: "The general Monte as zl23, with zl27's value net and dealer and a policy twice as wide, trained 24 epochs: it agrees with the search's own pick on 68.5% of held-out decisions (the 8-epoch control: 67%). The search deals the hidden cards from the dealer, plays look-aheads with the policy and weighs close calls up to four turns ahead. It thinks no longer than the narrower nets (search time per decision within 2%).",
    expect: "Against the same engine with the 24-epoch policy, deep: about 54% over 385 games (24 Nov, still running); policy alone against the 24-epoch policy alone: 58.5% over 2,000. Against live Monte (g12r-C) at deep: running (24 Nov), level with zl23 so far.",
  },
  {
    id: "zero-zl23", name: "Monte Zero zl23 (lab)", short: "zl23", kind: "zero", general: true, belief: "scryg", nets: "zl23", deeper: 0.03, deepmax: 4, available: true,   // prior off (23 Nov 2026, Fable 09:55Z: with it, 47.9 ± 0.8 over 3,468 deep games against itself without)
    tag: "The clean line's generation 23 (21 Nov 2026), in the lab for Korbi to play: honest end to end (its value net sees both hands, as every value net does; its dealer and policy only what a seat may), with the policy as the search's prior on near-ties. Not the live game's Monte.",
    description: "The general Monte: one view of the game for any card set (3,009 inputs), a dealer (belief net) for the other hand, a policy that scores every legal move, a value net judging positions; the search deals the hidden cards from the dealer, plays look-aheads with the policy and weighs close calls up to four turns ahead; where the search can't tell two moves apart, the policy's view decides (prior).",
    expect: "Against live Monte (g12r-C), both with 1,024 deals and close calls up to four turns: 53.5% over 951 games (22 Nov); at quick (256 deals) 50.0% over 576.",
  },
  {
    id: "zero-g9x", name: "Monte Scry Zero (g9x-C)", short: "Zero g9x", kind: "zero", tag: "The live game's Monte from 15 to 17 November 2026: the from-scratch line's generation 9 nets; 62.2% against the benchmark at Deep.", nets: "g9x-C", deeper: 0.03, available: true,
    description: "The from-scratch line (lab, 14–15 November 2026): nothing of Medium inside. Its options are every legal move and passing; its look-aheads are played by its own policy net (g9x-C, 654 inputs: the position as its seat sees it and Scry's estimate of the other hand) and its questions by its own question head; the hidden cards are dealt by Scry, a net that follows the other player's play and gives each unseen card in their hand its own chance of every name; positions are judged by its own value net (both hands face up). Close calls (the best two within 3 points) are weighed again three turns ahead instead of two (Korbi's variable look-ahead). Its nets (about 2 MB) ship with the app and are kept offline.",
    expect: "Against the lab's benchmark (the live Hard with a Medium-free look-ahead, within a point of the live Hard), both at Deep: 61.7% (99%: 55.0 to 68.5) over 175 of 200 pairs (lab job az-yd9-c); at Quick 59.0% over 200. Not crown-tested yet (1,200 pairs at Deep) and never at Deepest. It thinks about 1.5 to 2 times as long as Hard a deal: its nets are larger than Hard's.",
  },
  {
    id: "hard-s5-keep", name: "Hard (S5 + value keep)", short: "S5 vkeep", kind: "hard", judge: "s5", keep: true, available: false,
    description: "The benchmark until 13 November 2026, 18:30Z: Hard with value net S5 and the keep by the value net (each opening hand rated over 256 deals, thrown back when S5's redraw table says a redraw is worth more). Replaced by the keep net on the first seven, which matched it and needs no table re-solved for each net.",
    expect: "With S5 on both sides at Quick: 51.0% ± 1.0 against Medium's keep over 6,235 pairs; 52.1% ± 1.2 against live over 5,000.",
  },
  {
    id: "hard-s3d", name: "Hard (judge S3 d)", short: "Hard S3d", kind: "hard", judge: "s3d", available: true,
    description: "Hard with judge S3 d (judges/s3d.json): the same larger network as S4 d, trained on a third of the games (17,297).",
    expect: "At Quick against v14: 53.9% ± 2.7. At Deep: 53.2% ± 3.4 over 595 of 600 deals (the gate would extend; not extended, since S4 d is the same recipe on more games).",
  },
  {
    id: "hard-avg-jt130-s3c", name: "Hard (mean of jt130 and S3 c)", short: "Hard mean", kind: "hard", judge: "avg-jt130-s3c", available: true,
    description: "Hard whose judge is the mean of two: jt130 and S3 c (v14's size, the squeeze inputs, turn starts only, 17,297 games). Averaging two judges smooths out where either is wrong.",
    expect: "At Quick against v14: 54.6% ± 2.5, better than either alone (53.0% and 52.2%). Not yet gated at Deep. Twice the judging work of v14 per position.",
  },
  {
    id: "hard-avg-jt130-s4d", name: "Hard (mean of jt130 and S4 d)", short: "Hard mean2", kind: "hard", judge: "avg-jt130-s4d", available: true,
    description: "Hard whose judge is the mean of jt130 and S4 d, the two strongest single judges.",
    expect: "Being screened at Quick against v14 (lab 12 November): no result yet. The slowest of these: S4 d's larger network plus jt130.",
  },
];

/** An engine by id (or undefined). */
export const engineOf = id => ENGINES.find(e => e.id === id);
/** The engines that can be seated (planned ones are listed but not here). */
export const seatable = () => ENGINES.filter(e => e.available);
/** The engine Monte is at the start: what the live game plays. */
export const DEFAULT_ENGINE = LIVE_ENGINE;
/** The lab's benchmark (13 Nov 2026, Korbi: the benchmark and the live game are two things): what new candidates must beat.
 *  Since 14 Nov 2026, 00:55Z the live Hard with the Medium-free move-picker mpN6416 in its look-aheads (Fable No. 11 point 3). */
export const BENCHMARK_ENGINE = "hard-s5-knet-mpN6416";

// ---------- the judges ----------
const judges = new Map();
/** The default way to read a judge's file: from the network (the page's and the worker's). Node's tests pass their own. */
const fetchJson = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
/**
 * An engine's judge as think() takes one, or undefined for the game's own (so a Hard with today's judge runs exactly the
 * code the live game runs). A retrained judge is read once and kept.
 */
export async function judgeOf(engine, load = fetchJson) {
  if (!engine?.judge) return undefined;
  if (!judges.has(engine.judge)) {
    // a net's redraw table (`mull`, lab/keep-table.mjs) rides on its judge, for the keep by the value net
    const one = file => load(new URL(file, import.meta.url).href).then(j => Object.assign(makeJudge(j.layers), j.mull ? { mull: j.mull } : {})), f = JUDGES[engine.judge];
    judges.set(engine.judge, Array.isArray(f) ? Promise.all(f.map(one)).then(js => (s, me) => js.reduce((a, j) => a + j(s, me), 0) / js.length) : one(f));
  }
  return judges.get(engine.judge);
}

/** The keep net (judges/keep-net.json, lab/keep_net.py), read once. */
// the Medium-free move-picker an engine's look-aheads play (`look`: judges/mp-<name>.json, a copy of lab/policy/<name>.json, as
// judges/ ships with the app and lab/ does not), read once and kept
const lookP = new Map();
export const lookOf = (name, load = fetchJson) => {
  if (!lookP.has(name)) lookP.set(name, load(new URL(`./judges/mp-${name}.json`, import.meta.url).href).then(m => makePlus(m, { free: true }).move));
  return lookP.get(name);
};
let keepNetP = null;
export const keepNet = (load = fetchJson) => (keepNetP ||= load(new URL("./judges/keep-net.json", import.meta.url).href));

// ---------- Monte Scry Zero (kind "zero"; 15 Nov 2026, Korbi 16:21: Zero in the game lab) ----------
// Its nets ship with the app (judges/zero-<nets>-policy, -qpolicy, -scry, -value.json: copies of lab/zero/nets/), kept offline
// like the judges, read the first time it plays. Scry follows the whole game, so a request carries the game record (`game`: seed, seq,
// options, started, first, moves) and the brain is caught up on the moves since it last saw this game, replayed as the page
// plays them (shownRules).
const zeroP = new Map();
async function zeroOf(engine, load = fetchJson) {
  if (!zeroP.has(engine.id)) zeroP.set(engine.id, (async () => {
    // the general Monte (engine.general, 17 Nov 2026: stage 3 step 3): its nets judges/general-<nets>-gpolicy, -gvalue, -scry12.
    // Its code is still the lab's (lab/zero/general.mjs, not kept offline): no engine in the list is general yet; at the live swap
    // its files move beside this one and are kept (the path is built here so the offline list doesn't ask for them before then)
    if (engine.general) {
      const lab = ["lab", "zero", "general.mjs"].join("/");
      // the belief: the general dealer (engine.belief "scryg", 19 Nov 2026: zl20 on) or Scry 1.2 (scry12)
      const belief = engine.belief || "scry12";
      const [{ makeGeneral }, [policy, value, b]] = await Promise.all([import(`./${lab}`),
        Promise.all(["gpolicy", "gvalue", belief].map(k => load(new URL(`./judges/general-${engine.nets}-${k}.json`, import.meta.url).href)))]);
      return { brain: makeGeneral({ policy, value, [belief]: b }), game: null, G: null, at: 0 };
    }
    const [{ makeZero }, nets] = await Promise.all([import("./dandan-zero.js"),
      Promise.all(["policy", "qpolicy", "scry", "value"].map(k => load(new URL(`./judges/zero-${engine.nets}-${k}.json`, import.meta.url).href)))]);
    const [policy, qpolicy, scry, value] = nets;
    return { brain: makeZero({ policy, qpolicy, scry, value }), game: null, G: null, at: 0 };
  })());
  return zeroP.get(engine.id);
}
/** The brain caught up on the game up to its last move (a new game, or one gone back on, from its start). */
async function zeroAt(engine, game, load) {
  const z = await zeroOf(engine, load);
  const [{ shownRules }, { newRecord, applyMove }] = await Promise.all([import("./dandan-rules.js"), import("./seats.js")]);
  const moves = game?.moves ? (typeof game.moves === "string" ? JSON.parse(game.moves) : game.moves) : [];
  const id = game ? `${game.seed}:${game.started}` : null;
  if (!game || z.game !== id || moves.length < z.at) {
    z.brain.reset(); z.game = id; z.at = 0;
    const prev = game && (game.first === 0 || game.first === 1) ? { state: { over: true, winner: 1 - game.first } } : null;
    z.G = game ? newRecord(shownRules, { seats: 2, options: game.options || {}, seed: game.seed, seq: game.seq || 1, now: game.started, prev }) : null;
  }
  for (; z.G && z.at < moves.length; z.at++) {
    const [who, move] = moves[z.at], before = shownRules.restore(JSON.parse(JSON.stringify(z.G.state)));
    const r = applyMove(shownRules, z.G, who, move, game.started);
    if (r.error) { z.G = null; break; }                            // the record and the rules part ways: Scry stops following
    z.brain.seen(before, who, move, r.G.state);
    z.G = r.G;
  }
  return z.brain;
}
/**
 * Decided positions against people (18 Nov 2026, Korbi 04:08, "yep ok" 04:22): Monte never resigns against a person, but once a
 * full search finds the game all but lost (its best move worth LOST or less) it plays the rest of that turn in a light mode
 * (LIGHT deals, no second look), and looks again in full at the first decision of every turn, so an out a person's mistake
 * opens is seen. All but won (WON or more): the rest of the turn at a careful medium search (a quarter of the deals, at least
 * 256, the second look kept), as a slip there throws a won game away. Anything else: the full search, as before.
 */
const LOST = 0.03, WON = 0.97, LIGHT = 64;
function modeBudget(z, s, seat, deals) {
  const m = z.mode?.[seat];
  if (!m || m.turn !== s.turn || m.game !== z.game) return { deals, full: true };
  return m.kind === "lost" ? { deals: Math.min(deals, LIGHT), full: false, light: true } : { deals: Math.min(deals, Math.max(256, deals >> 2)), full: false };
}
/** Zero's weighing of a decision: { best, list, only, mode } as think's. */
async function zeroThink(engine, s, seat, { budget = {}, must = null, load, game } = {}) {
  const brain = await zeroAt(engine, game, load), z = await zeroOf(engine, load), { zeroOptions } = await import("./dandan-zero.js");
  const ms = zeroOptions(s, seat);
  if (ms.length <= 1) return { best: ms[0] ?? PASS, list: [], only: true };
  const D = budget.deals || 64, mb = modeBudget(z, s, seat, D);
  // the budget's time backstop as Hard's (Deep 40 s, Deepest 120 s): a slow phone stops there, each look of a close call its own
  const r = brain.think(s, seat, mb.deals, { ...(budget.ms ? { ms: budget.ms } : {}), ...(engine.deeper && !mb.light ? { deeper: { gap: engine.deeper, ...(engine.deepmax ? { max: engine.deepmax } : {}) } } : {}), ...(engine.prior ? { prior: engine.prior } : {}), ...(engine.multi ? { multi: true } : {}), ...(must ? { must } : {}) });
  if (mb.full && !r.only && D > LIGHT) {
    const best = Math.max(...r.list.map(c => c.mean).filter(Number.isFinite));
    z.mode ||= {};
    z.mode[seat] = best <= LOST ? { kind: "lost", turn: s.turn, game: z.game } : best >= WON ? { kind: "won", turn: s.turn, game: z.game } : null;
  }
  return { ...r, mode: mb.full ? "full" : mb.light ? "light" : "careful" };
}

// ---------- asking an engine ----------
/** A question the look-ahead leaves to Medium (as thinkMove does): the mulligan, what to put on the bottom, a name. */
const MEDIUM_ONLY = ["mull", "bottom", "name"];

/**
 * What an engine would do at a decision of `seat`: { move, chance, list } with `chance` the win chance it gives the move
 * (Hard only; null for Medium and for a move it did not need to weigh) and `list` the moves it weighed, best first, each
 * { move, mean }. `budget` is think()'s options for a Hard engine (deals, wide, ms…), `must` a move to keep in the weighing.
 * A Hard engine on the page's thread would freeze the table: the page asks the worker (dandan-worker.js, which calls this).
 */
/** A Medium's move with its switches set (and put back after: Medium runs on one thread, so nothing else moves meanwhile). */
export function mediumMove(engine, s, seat, opts = {}) {
  const was = { ...TUNE };
  Object.assign(TUNE, engine.tune || {});
  try { return policyMove(s, seat, { style: engine.style || "tempo", ...opts }); } finally { Object.assign(TUNE, was); }
}
export async function decide(engine, s, seat, { budget = {}, must = null, load, game = null } = {}) {
  if (engine.kind === "medium") return { move: mediumMove(engine, s, seat), chance: null, list: [] };
  if (engine.kind === "zero") {
    const r = await zeroThink(engine, s, seat, { budget, must, load, game }), top = r.list[0];
    return { move: r.best, chance: top && Number.isFinite(top.mean) && top.mean >= 0 ? top.mean : null, list: r.list.slice(0, 4).map(c => ({ move: c.move, mean: c.mean })) };
  }
  const p = s.pending, judge = await judgeOf(engine, load);
  // the keep net on the first seven (an engine with `knet`), the keep by the value net (`keep`, its net carrying a redraw
  // table); else Medium's, as before
  const knet = engine.knet && p?.t === "mull" ? knetMove(s, seat, await keepNet(load), policyMove(s, seat)) : null;
  if (knet) return { move: knet.move, chance: knet.why?.knet ?? null, list: [] };
  const kept = engine.keep && p && (p.t === "mull" || p.t === "bottom") ? keepMove(s, seat, judge) : null;
  if (kept) return { move: kept.move, chance: kept.why?.keep ?? null, list: [] };
  if (p && MEDIUM_ONLY.includes(p.t)) return { move: policyMove(s, seat), chance: null, list: [] };
  if (!p && !moves(s, seat, true).length) return { move: PASS, chance: null, list: [] };
  const r = think(s, seat, { ...budget, ...(judge ? { judge } : {}), ...(engine.look ? { rollout: await lookOf(engine.look, load) } : {}), must });
  const top = r.list[0], chance = top && Number.isFinite(top.mean) && top.mean >= 0 ? top.mean : null;
  return { move: r.best, chance, list: r.list.slice(0, 4).map(c => ({ move: c.move, mean: c.mean })) };
}

/** Hard's move for an engine, as the live game plays it (thinkMove) but with the engine's judge: what the opponent's worker runs. */
/**
 * How far an engine's search gets at a budget on this device (22 Nov 2026, Fable: the deals Deepest reaches in its 120 s on
 * Korbi's devices; lab/speed.html): { deals, ms, move }, the deals the search ran and the time it took.
 */
export async function engineSpeed(engine, s, seat, budget, load, game = null) {
  const t0 = performance.now(), r = await zeroThink(engine, s, seat, { budget, load, game });
  return { deals: r.deals ?? null, ms: Math.round(performance.now() - t0), move: r.best };
}
export async function engineMove(engine, s, seat, budget, load, game = null) {
  if (engine.kind === "medium") return mediumMove(engine, s, seat);
  if (engine.kind === "zero") return (await zeroThink(engine, s, seat, { budget, load, game })).best;
  const judge = await judgeOf(engine, load);
  return thinkMove(s, seat, { ...budget, ...(judge ? { judge } : {}), ...(engine.keep && judge?.mull ? { keep: true } : {}), ...(engine.knet ? { knet: await keepNet(load) } : {}), ...(engine.look ? { rollout: await lookOf(engine.look, load) } : {}) });
}
