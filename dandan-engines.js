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
import { moves } from "./dandan-engine.js";
import { makeJudge } from "./dandan-eval.js";

/** The retrained judges, by name: the file each is read from (next to this module), `{ layers }` for makeJudge. */
export const JUDGES = {
  "ac-jh2": "./judges/ac-jh2.json",
  "ag-v14": "./judges/ag-v14.json",
  "jt130": "./judges/jt130.json",
  "s3c": "./judges/s3c.json",
  "s3d": "./judges/s3d.json",
  "s4d": "./judges/s4d.json",
  // a list: the mean of those judges' chances (12 November 2026: two nets averaged screened better than either alone)
  "avg-jt130-s3c": ["./judges/jt130.json", "./judges/s3c.json"],
  "avg-jt130-s4d": ["./judges/jt130.json", "./judges/s4d.json"],
};
/** The judge the live game's Hard plays with (dandan-worker.js, a request with no engine): the one that won its match.
 *  S4 d since 12 November 2026 (Korbi, after playing it, and the planning chat: 57.7% ± 3.5 against v14 at Deep, 600 pairs). */
export const LIVE_JUDGE = "s4d";

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
    expect: "Against Hard with v14, both at Deep (1,024 deals): 57.6% ± 3.6 after 575 of 600 deals played both ways, and above 50% even if it lost every deal still to come: CROWNED (12 November). At Quick: 54.6% ± 2.6 over 1,000. Predicts results best of all (Brier 0.143 against v14's 0.155 on held-out games). About 1.3× v14's thinking time a decision. The live game's Hard since 12 November 2026.",
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
export const DEFAULT_ENGINE = "hard-s4d";

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
    const one = file => load(new URL(file, import.meta.url).href).then(j => makeJudge(j.layers)), f = JUDGES[engine.judge];
    judges.set(engine.judge, Array.isArray(f) ? Promise.all(f.map(one)).then(js => (s, me) => js.reduce((a, j) => a + j(s, me), 0) / js.length) : one(f));
  }
  return judges.get(engine.judge);
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
export async function decide(engine, s, seat, { budget = {}, must = null, load } = {}) {
  if (engine.kind === "medium") return { move: mediumMove(engine, s, seat), chance: null, list: [] };
  const p = s.pending;
  if (p && MEDIUM_ONLY.includes(p.t)) return { move: policyMove(s, seat), chance: null, list: [] };
  if (!p && !moves(s, seat, true).length) return { move: PASS, chance: null, list: [] };
  const judge = await judgeOf(engine, load);
  const r = think(s, seat, { ...budget, ...(judge ? { judge } : {}), must });
  const top = r.list[0], chance = top && Number.isFinite(top.mean) && top.mean >= 0 ? top.mean : null;
  return { move: r.best, chance, list: r.list.slice(0, 4).map(c => ({ move: c.move, mean: c.mean })) };
}

/** Hard's move for an engine, as the live game plays it (thinkMove) but with the engine's judge: what the opponent's worker runs. */
export async function engineMove(engine, s, seat, budget, load) {
  if (engine.kind === "medium") return mediumMove(engine, s, seat);
  const judge = await judgeOf(engine, load);
  return thinkMove(s, seat, judge ? { ...budget, judge } : budget);
}
