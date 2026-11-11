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
};

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
    id: "hard-today", name: "Hard (today's judge)", short: "Hard", kind: "hard", judge: null, available: true,
    description: "Hard as the live game plays it (Monte): a look-ahead that plays each candidate move out over many dealt guesses of the hidden cards, Medium moving both sides about two turns ahead. Then today's judge scores the position: a small neural network trained on 1.3 million positions of 45,000 Medium-vs-Medium games. It drops clearly worse moves early and stops when the leader is clear.",
    expect: "The strongest player in the game. It uses the thinking depth setting (as a coach it uses the lab's coach depth), so it takes from a fraction of a second to a few seconds a decision, and it shows its win chance for the move it picks.",
  },
  {
    id: "hard-jh2", name: "Hard (retrained judge jh2)", short: "Hard jh2", kind: "hard", judge: "ac-jh2", available: true,
    description: "Hard with the retrained judge (judges/ac-jh2.json): the same look-ahead, but the judge was retrained on about 2,900 Hard-vs-Hard self-play games (11 November 2026), with a rule that a card in hand may never lower its holder's chance.",
    expect: "It predicts game results better (Brier score 0.170 to 0.161 on held-out games) and almost never calls a card worth less than nothing (3.0% to 0.5% of positions). In a 1,066-game match against today's Hard it scored 50.8% ± 1.5: not yet shown stronger. It agrees with human moves slightly more often.",
  },
];

/** An engine by id (or undefined). */
export const engineOf = id => ENGINES.find(e => e.id === id);
/** The engines that can be seated (planned ones are listed but not here). */
export const seatable = () => ENGINES.filter(e => e.available);
/** The engine Monte is at the start: what the live game plays. */
export const DEFAULT_ENGINE = "hard-today";

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
  if (!judges.has(engine.judge)) judges.set(engine.judge, load(new URL(JUDGES[engine.judge], import.meta.url).href).then(j => makeJudge(j.layers)));
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
