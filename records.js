// What a finished game is kept as (no page: results.js sends it, tools/pull-games.mjs reads it back, tests/records.mjs runs
// both in Node). A game is kept whole: the seed, the seats and the moves (so it can be played again move by move,
// `replay` below), the state it ended in (the log of everything done, both hands, the judge's chances after each action) and a
// summary. Each game is a room of its own under crates/rooms (results.js), and a short line about it goes in the one
// room whose code is always the same, which is how a reader finds the rest.
import { newRecord, applyMove } from "./seats.js";

/** The room that lists the games. Its code has an I in it, which the codes a table is given never do, so no table is ever it. */
export const INDEX_ROOM = "DDIX";

/** What the back end gets of a finished game: the table as the Almanac keeps one, and a summary. */
export function entryOf(v, how = {}, now = Date.now()) {
  const s = v.state, me = v.seat, name = v.seats?.[me]?.name || "You";
  // the moves go as one string: the database drops an empty list (a move with no targets) and may give a list back with holes
  const { moves = [], ...rest } = v.G;
  const result = {
    name, won: s.winner === me, drawn: s.winner < 0, winner: s.winner, why: s.why || "", conceded: s.why === "conceded",
    turns: s.turn, life: s.life, library: s.lib.length, moves: moves.length, started: v.G.started, ended: now, ms: now - v.G.started,
    ...how, page: typeof location === "object" ? location.host + location.pathname : "",
  };
  return { key: String(v.G.started), name, result, game: { ...rest, moves: JSON.stringify(moves) }, at: now };
}

/**
 * A game still being played, as the viewer needs it to play it again (games.js): the seed, the seats and the moves so far, not
 * the state (the log and the judge's chances are rebuilt by playing the moves, so a write after each move stays small).
 * It goes under the index room's `live`, by when the game began, and is written over after each move.
 */
export function liveEntry(v, how = {}, now = Date.now()) {
  const s = v.state, name = v.seats?.[v.seat]?.name || "You", { moves = [], seats, options, seed, seq, started } = v.G;
  const result = {
    name, live: true, turns: s.turn, life: s.life, library: s.lib.length, moves: moves.length, started, ended: now, ms: now - started,
    ...how, page: typeof location === "object" ? location.host + location.pathname : "",
  };
  return { key: String(started), name, result, game: { seats, options: options || {}, seed, seq: seq || 1, started, moves: JSON.stringify(moves), state: { first: s.first } }, at: now };
}

/**
 * A kept game played through once, noting how long the log was after each move, so a line of it can be found and the table
 * shown as it stood when it was written: { lens: [log length after move 0, 1, …], G: where it ends } or { error, at }.
 */
export function walk(rules, game) {
  const moves = typeof game.moves === "string" ? JSON.parse(game.moves) : game.moves || [];
  const first = game.state?.first;
  const prev = first === 0 || first === 1 ? { state: { over: true, winner: 1 - first } } : null;
  let G = newRecord(rules, { seats: game.seats, options: game.options || {}, seed: game.seed, seq: game.seq || 1, now: game.started, prev });
  const lens = [];
  for (let i = 0; i < moves.length; i++) {
    const [seat, move] = moves[i], r = applyMove(rules, G, seat, move, game.started);
    if (r.error) return { error: r.error, at: i, lens, G };
    G = r.G;
    lens.push(G.state.log.length);
  }
  return { lens, G };
}

/** The line about a game that goes in the index room: where the game is, and its summary. */
export const indexLine = (entry, room) => ({ room, at: entry.at, name: entry.name, result: entry.result });

/**
 * A kept game played again from its seed and its moves: the record it ends in, or { error, at } where a move is refused (the
 * rules changed since, or the record is wrong). `game` is as kept (moves a string) or as the runner has it (moves a list);
 * `until` stops after that many moves, for looking at the table as it stood.
 */
export function replay(rules, game, until = Infinity) {
  const moves = typeof game.moves === "string" ? JSON.parse(game.moves) : game.moves || [];
  // who went first isn't in the seed when the game was dealt after another (the last game's loser goes first): it is in the state it
  // ended in, and the deal is the same whichever way it was chosen. A game from the page plays again under shownRules (dandan-rules.js).
  const first = game.state?.first;
  const prev = first === 0 || first === 1 ? { state: { over: true, winner: 1 - first } } : null;
  let G = newRecord(rules, { seats: game.seats, options: game.options || {}, seed: game.seed, seq: game.seq || 1, now: game.started, prev });
  for (let i = 0; i < moves.length && i < until; i++) {
    const [seat, move] = moves[i], r = applyMove(rules, G, seat, move, game.started);
    if (r.error) return { error: r.error, at: i };
    G = r.G;
  }
  return G;
}
