// What a finished game is kept as (records.js): the moves go with it, so the game can be played again from its seed and
// come out the same, move for move; the summary and the index line are what the back end reads, and survive being JSON.
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, botMove } from "../seats.js";
import { entryOf, indexLine, replay, INDEX_ROOM } from "../records.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const J = x => JSON.stringify(x);

// a game played by the computer (the careless level, so it is quick), the record kept after each move
let G = newRecord(rules, { seats: 2, seed: 4242, now: 1000 });
const stood = [G];
for (let i = 0; i < 90 && !rules.over(G.state); i++) {
  const who = rules.toMove(G.state), r = applyMove(rules, G, who, botMove(rules, G, who, "easy"), 1000 + i);
  if (r.error) break;
  G = r.G;
  stood.push(G);
}
check(G.n >= 40 && G.moves.length === G.n && G.moves.every(m => Array.isArray(m) && m.length === 2 && Number.isInteger(m[0])), `a record keeps every move made, seat and move (${G.n} moves)`);
{
  const again = replay(rules, G);
  check(!again.error && J(again.state) === J(G.state) && again.n === G.n, "played again from the seed and the moves it ends in the same state, log and all");
  check([10, 25].every(k => J(replay(rules, G, k).state) === J(stood[k].state)), "and stopping part way gives the table as it stood");
  const wrong = { ...G, moves: [[1, G.moves[0][1]], ...G.moves.slice(1)] };
  check(replay(rules, wrong).error !== undefined, "a record that isn't the game's own (a move by the wrong seat) is refused, saying where");
}

// the entry that is sent
const v = { state: G.state, seat: 0, seats: [{ name: "Tom" }, { name: "Computer" }], G };
const entry = entryOf(v, { level: "easy", think: 1 }, 5000);
{
  check(typeof entry.game.moves === "string" && J(JSON.parse(entry.game.moves)) === J(G.moves) && entry.result.moves === G.n, "the moves go as one string (the database drops empty lists), and the summary counts them");
  const back = JSON.parse(JSON.stringify(entry));
  check(J(back) === J(entry), "an entry keeps through JSON (nothing undefined in it)");
  const again = replay(rules, back.game);
  check(!again.error && J(again.state) === J(G.state), "and the game as it is kept, moves as a string, plays again to the same state");
  const r = entry.result;
  check(r.name === "Tom" && r.level === "easy" && r.started === 1000 && r.ended === 5000 && r.ms === 4000 && r.turns === G.state.turn && entry.key === "1000" && r.won === (G.state.winner === 0), "the summary has who, how it was set, when and how long, the key is when it began");
  check(Array.isArray(entry.game.state.log) && entry.game.state.log.length > 0 && entry.game.seed === 4242, "the state it ends in, with its log, and the seed are kept");
}

// the index
{
  const line = indexLine(entry, "ABCD");
  check(line.room === "ABCD" && line.name === "Tom" && line.result.moves === G.n && !("game" in line), "a game's line in the index says where it is and carries its summary, not the game");
  check(/^[A-Z]{4}$/.test(INDEX_ROOM) && /[IO]/.test(INDEX_ROOM), "the index room's code fits the database's rule for a room, and has a letter no table's code ever has");
}

if (bad) { console.log(`${bad} problems`); process.exit(1); }
console.log("records: a game is kept with its moves and plays again exactly; its summary and index line are plain data");
