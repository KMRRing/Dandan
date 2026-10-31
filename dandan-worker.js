// Dandan's look-ahead off the page's thread (dandan-think.js): the computer's moves at Hard, so the table never stops
// while it thinks, and the coach's weighing of your decisions, both as deep as the menu's Thinking (depth). A request
// is { id, kind, state, seat, move, depth }: "move", the computer's move; "think", the coach's weighing of a decision
// (its Hint, and Always); "check", the same with a move of yours kept in to the end, so it's set against the coach's
// deal by deal. Each stops at so many deals, not at a time, so a position gets the same answer on any phone (the time
// is only a backstop for a slow one).
import { think, thinkMove, coachBudget, BUDGET, DEPTH } from "./dandan-think.js";

onmessage = e => {
  const { id, kind, state, seat, move, depth } = e.data;
  try {
    if (kind === "move") postMessage({ id, move: thinkMove(state, seat, DEPTH[depth] || BUDGET.move) });
    else postMessage({ id, result: think(state, seat, { ...coachBudget(kind, depth), must: kind === "check" ? move : null }) });
  } catch (err) {
    postMessage({ id, error: String(err?.stack || err) });
  }
};
