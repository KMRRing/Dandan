// The positions of the game lab's error review (12 November 2026, Korbi: "simulate each of them and I can approve that this is
// marked as objective error"): Monte's casts that the report card (lab/report-card.mjs, aa-a0-rc1) flagged, each played again
// from the kept games to the decision, with what Monte did and what each engine played there at 256 deals. Written to
// error-review.json at the root, which the lab page reads; the verdicts are kept in the database (dandan-lab.js) and collected
// onto the game-records branch (tools/pull-games.mjs, errors.json).
// usage: node lab/error-review-data.mjs <games dir> <report card lines (part-0.jsonl of aa-a0-rc1)>
import fs from "node:fs";
import path from "node:path";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { DECK } from "../dandan-cards.js";

const [dir, card] = process.argv.slice(2);
const J = x => JSON.parse(JSON.stringify(x));
const casts = fs.readFileSync(card, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(l => l.part === "cast");
const out = [];
for (const c of casts) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, c.game), "utf8")).game, list = JSON.parse(g.moves);
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  for (let i = 0; i < c.move; i++) G = applyMove(shownRules, G, list[i][0], list[i][1], g.started).G;
  const [seat, move] = list[c.move], s = J(G.state);
  s.log = s.log.slice(-12);
  out.push({ id: `${c.game.replace(".json", "")}-${c.move}`, game: c.game.replace(".json", ""), move: c.move, turn: c.turn, seat, card: DECK[move.card] ?? c.card,
    played: move, why: `v14 rated keeping ${c.card} ${Math.round(100 * c.baseWithout)} points better than casting it`, engines: c.hardPlays, state: s });
}
fs.writeFileSync(new URL("../error-review.json", import.meta.url), JSON.stringify({ made: "2026-11-12", source: "aa-a0-rc1 (report card, 256 deals)", items: out }) + "\n");
console.log(out.length, "positions");
