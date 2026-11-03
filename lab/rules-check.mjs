// The rules check: games played by the engine against itself, every state audited against the rules as written, so that a
// bug in the rules (an illegal move offered, a card lost, a game that cannot end, a result that disagrees with the
// life totals or the library) shows up before it costs a person a game. The players are the weakest to the strongest the
// page has (random legal moves, Easy, Medium, Hard at a few deals): random play reaches the corners (a Reversal on a
// counter, a Mind Bend on a land, a Boilerworks returning itself) that good play seldom does.
// usage: node lab/rules-check.mjs <first seed> <games> [players: random,easy,medium,hard8 (comma list, one per game in turn)]
//        [out.jsonl for the failures]
import fs from "node:fs";
import { audit, auditMoves, auditEnd } from "./audit.mjs";
import { rules as base } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { randomMove } from "../dandan-bot.js";
import { policyMove } from "../dandan-policy.js";
import { thinkMove } from "../dandan-think.js";
import { toMove } from "../dandan-engine.js";

const [from, games, kinds = "random,easy,medium,hard8", out = null] = [Number(process.argv[2] || 0), Number(process.argv[3] || 100), process.argv[4], process.argv[5]];
// as the page deals and moves them: the computer's spells in seat 1 are shown (the engine stops with them on the stack)
const rules = { ...base, act: (s, seat, move, ctx) => base.act(s, seat, move, { ...ctx, show: seat !== 0 }) };
const PLAYERS = {
  random: (s, seat, rng) => randomMove(s, seat, rng),
  easy: (s, seat, rng) => policyMove(s, seat, { rng, level: "easy" }),
  medium: (s, seat, rng) => policyMove(s, seat, { rng, level: "medium" }),
  hard8: (s, seat) => thinkMove(s, seat, { deals: 8, ms: 1e9 }),
};
const list = kinds.split(",");
const tally = { games: 0, moves: 0, turns: 0, byWhy: {}, byKinds: {}, failures: 0, longest: 0 };
const bad = [];
const fail = (g, what, extra = {}) => {
  tally.failures++;
  const row = { game: g.seed, what, ...extra };
  if (bad.length < 40) bad.push(row);
  if (out) fs.appendFileSync(out, JSON.stringify(row) + "\n");
};

for (let n = 0; n < games; n++) {
  const seed = from + n, a = list[(n * 7) % list.length], b = list[(n * 7 + 1 + Math.floor(n / list.length)) % list.length];
  const kindOf = [a, b];
  // alternate who sits first the way a series of games does (the loser of the last goes first), via prev
  const prev = n % 3 === 0 ? null : { state: { over: true, winner: n % 2 } };
  let G = newRecord(rules, { seats: 2, seed, now: 0, prev });
  const g = { seed };
  let moves = 0, broken = false;
  const first = audit(G.state);
  if (first.length) { fail(g, "deal: " + first.join("; ")); continue; }
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const s = rules.restore(JSON.parse(JSON.stringify(G.state))), who = rules.toMove(s);
    if (who == null) { fail(g, "nobody to move in a game not over", { turn: s.turn, step: s.step }); broken = true; break; }
    const bad1 = auditMoves(s, who);
    if (bad1.length) { fail(g, "moves: " + bad1.join("; "), { turn: s.turn, step: s.step }); broken = true; break; }
    const rng = seeded(mix(seed, i + 7));
    const realRandom = Math.random;
    Math.random = seeded(mix(seed ^ 0xabc, i + 1));        // the quick policy's own dice
    let move;
    try { move = PLAYERS[kindOf[who]](s, who, rng); } catch (e) { Math.random = realRandom; fail(g, "player threw: " + (e.stack || e).toString().split("\n").slice(0, 3).join(" | "), { turn: s.turn, step: s.step, kind: kindOf[who] }); broken = true; break; }
    Math.random = realRandom;
    let r;
    try { r = applyMove(rules, G, who, move, 0); } catch (e) { fail(g, "engine threw: " + (e.stack || e).toString().split("\n").slice(0, 3).join(" | "), { turn: s.turn, step: s.step, move }); broken = true; break; }
    if (r.error) { fail(g, "a move the player chose was refused: " + r.error, { turn: s.turn, step: s.step, kind: kindOf[who], move }); broken = true; break; }
    G = r.G; moves++;
    const bad2 = audit(G.state, s);
    if (bad2.length) { fail(g, bad2.join("; "), { turn: G.state.turn, step: G.state.step, move }); broken = true; break; }
  }
  if (broken) continue;
  if (!rules.over(G.state)) { fail(g, "the game did not end in 4000 moves", { turn: G.state.turn, step: G.state.step }); continue; }
  const endBad = auditEnd(G.state);
  if (endBad.length) { fail(g, "end: " + endBad.join("; ")); continue; }
  tally.games++; tally.moves += moves; tally.turns += G.state.turn; tally.longest = Math.max(tally.longest, G.state.turn);
  tally.byWhy[G.state.why] = (tally.byWhy[G.state.why] || 0) + 1;
  const k = kindOf.join(" v "); tally.byKinds[k] = (tally.byKinds[k] || 0) + 1;
}
console.log(JSON.stringify(tally));
for (const b of bad) console.log("FAIL", JSON.stringify(b));
process.exit(tally.failures ? 1 : 0);
