// Dandan's look-ahead off the page's thread (dandan-think.js): the computer's moves at Hard, so the table never stops
// while it thinks, and the coach's weighing of your decisions, both as deep as the menu's Thinking (depth). A request
// is { id, kind, state, seat, move, depth }: "move", the computer's move; "think", the coach's weighing of a decision
// (its Hint, and Always); "check", the same with a move of yours kept in to the end, so it's set against the coach's
// deal by deal. Each stops at so many deals, not at a time, so a position gets the same answer on any phone (the time
// is only a backstop for a slow one).
// The game lab (lab.html) adds one field, `engine` (an id of dandan-engines.js): "move" then plays that engine's move (a Hard with
// the retrained judge, say) and "think" is that engine's weighing, answered as { id, result: { move, chance, list } }. A request
// with no engine (the live game) is answered by Hard with the live judge (LIVE_JUDGE: S4 d since 12 November 2026, v14 before it: each beat
// the one before it in its match).
import { think, thinkMove, coachBudget, BUDGET, DEPTH } from "./dandan-think.js";
import { engineOf, engineMove, decide, judgeOf, LIVE_JUDGE } from "./dandan-engines.js";
import { shownRules } from "./dandan-rules.js";
import { newRecord, applyMove } from "./seats.js";
import { flawAt } from "./dandan-flaws.js";
import { winChance } from "./dandan-eval.js";

// ---------- a finished game rated again (12 November 2026, the planning chat; Korbi: show that it is still being evaluated) ----------
// kind "review", { game: { seed, seq, options, started, first, moves } }: the game replayed, and at each turn's start Hard's
// look-ahead with both hands open (the library's order still unknown), the live judge where its lines end, 256 deals, gives seat
// 0's chance. On the kept games it read the result better than the instant chart, by a third in the last 20 cards (lab job
// aa-a0-cc1). Answered with { id, progress: [done, of] } as it goes, then { id, review: { turns: [[turn, percent]], flaws, judge } };
// the flaws (dandan-flaws.js) come from the same replay.
const REVIEW_DEALS = 256;
async function review(id, game) {
  const R = shownRules, J = x => JSON.parse(JSON.stringify(x));
  const moves = typeof game.moves === "string" ? JSON.parse(game.moves) : game.moves || [];
  let G = newRecord(R, { seats: 2, seed: game.seed, seq: game.seq, options: game.options || {}, now: game.started, prev: { state: { over: true, winner: 1 - game.first } } });
  const spots = [], flaws = [];
  let doneTurn = -1;
  for (let i = 0; i < moves.length; i++) {
    const st = G.state, [who, move] = moves[i];
    if (st.turn !== doneTurn && who === st.active && !st.stack.length && !st.pending && st.step !== "mull") { doneTurn = st.turn; spots.push({ turn: st.turn, who, state: J(st) }); }
    const f = flawAt(st, who, move);
    if (f) flaws.push({ i, turn: st.turn, seat: who, ...f });
    const r = applyMove(R, G, who, move, game.started);
    if (r.error) break;
    G = r.G;
  }
  const judge = await judgeOf({ judge: LIVE_JUDGE }).catch(() => undefined), turns = [];
  for (let k = 0; k < spots.length; k++) {
    postMessage({ id, progress: [k, spots.length] });
    const { turn, who, state } = spots[k], s = R.restore(state);
    const r = think(s, who, { deals: REVIEW_DEALS, ms: 1e9, open: true, ...(judge ? { judge } : {}) });
    // one legal move (nothing to weigh): the judge's own reading
    const p = r.only || !Number.isFinite(r.list[0].mean) ? (judge || winChance)(s, who) : r.list[0].mean;
    turns.push([turn, Math.round(100 * (who === 0 ? p : 1 - p))]);
  }
  postMessage({ id, review: { turns, flaws, judge: judge ? LIVE_JUDGE : "built-in", deals: REVIEW_DEALS } });
}

onmessage = async e => {
  const { id, kind, state, seat, move, depth, engine } = e.data;
  try {
    if (kind === "review") return await review(id, e.data.game);
    if (engine) {
      const eng = engineOf(engine);
      if (!eng?.available) throw new Error(`no engine ${engine}`);
      if (kind === "move") postMessage({ id, move: await engineMove(eng, state, seat, DEPTH[depth] || BUDGET.move) });
      else postMessage({ id, result: await decide(eng, state, seat, { budget: coachBudget(kind, depth), must: kind === "check" ? move : null }) });
      return;
    }
    const judge = await judgeOf({ judge: LIVE_JUDGE }).catch(() => undefined);   // no file (offline, a fetch failed): the game's own
    const j = judge ? { judge } : {};
    if (kind === "move") postMessage({ id, move: thinkMove(state, seat, { ...(DEPTH[depth] || BUDGET.move), ...j }) });
    else postMessage({ id, result: think(state, seat, { ...coachBudget(kind, depth), must: kind === "check" ? move : null, ...j }) });
  } catch (err) {
    postMessage({ id, error: String(err?.stack || err) });
  }
};
