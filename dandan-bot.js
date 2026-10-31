// Dandan's computer players, by level: Easy and Medium are dandan-policy.js's player (Easy made careless), Hard
// dandan-think.js's look-ahead with Medium moving both seats in the games it plays out in its head. Each plays from
// what its seat may know: its hand, the table, the graveyard, the library cards and the cards in the other hand it has
// seen go there; the rest it takes as odds (Medium) or deals at random many times over (Hard).
import { BASICS, NAMES } from "./dandan-cards.js";
import { moves, upkeepStop, MOST_MULLS } from "./dandan-engine.js";
import { policyMove, PASS } from "./dandan-policy.js";
import { thinkMove } from "./dandan-think.js";
import { shuffle } from "./seats.js";

export const LEVEL_NAMES = [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]];
const pickOne = (a, rng) => a[Math.floor(rng() * a.length)];

// ---------- the baseline the tests measure it against ----------
/** A random legal answer to the question put to a seat. */
export function randomAnswer(s, rng) {
  const p = s.pending, seat = p.seat;
  switch (p.t) {
    case "mull": return (p.free || p.taken < MOST_MULLS) && rng() < (p.free ? 0.6 : 0.12) ? { t: "mull" } : { t: "keep" };
    case "bottom": return { t: "bottom", cards: shuffle(s.hand[seat], rng).slice(0, p.n) };
    case "attack": return { t: "attack", ids: p.ids.filter(() => rng() < 0.7) };
    case "block": return { t: "block", pairs: p.blockers.filter(() => rng() < 0.6).map(b => [b, pickOne(p.attackers, rng)]) };
    case "discard": return { t: "discard", cards: shuffle(s.hand[seat], rng).slice(0, p.n) };
    case "putback": return { t: "putback", cards: shuffle(s.hand[seat], rng).slice(0, p.n) };
    case "order": return { t: "order", cards: shuffle(p.cards, rng) };
    case "surveil": return { t: "surveil", yard: rng() < 0.5 };
    case "search": return { t: "search", card: pickOne(p.ids, rng) };
    case "pick": return { t: "pick", card: p.optional && rng() < 0.3 ? null : pickOne(p.ids, rng) };
    case "owner": return { t: "owner", bottom: rng() < 0.5 };
    case "bend": { const from = pickOne(p.froms, rng); return { t: "bend", from, to: pickOne(BASICS.filter(b => b !== from), rng) }; }
    case "name": return { t: "name", name: pickOne(NAMES, rng) };
    case "retarget": return rng() < 0.5 ? { t: "retarget" } : { t: "retarget", targets: pickOne(p.options, rng) };
  }
  return PASS;
}
/** Any legal move or pass at random, the answers at random. */
export function randomMove(s, seat, rng) {
  if (s.pending) return randomAnswer(s, rng);
  const all = moves(s, seat);
  return rng() < 0.35 || !all.length ? PASS : pickOne(all, rng);
}

/** The computer player's move at a level (Hard by default): an answer to the question put to it, or what it does with priority. */
export function botMove(s, seat, { rng = Math.random, level = "hard" } = {}) {
  // an upkeep stop only for a Flood Plain's window (engine fetchWindow) is for a person: the computer never fetched there
  if (s.step === "upkeep" && !s.stack.length && !s.pending && !upkeepStop(s, seat)) return PASS;
  if (level === "hard" || !level) return thinkMove(s, seat);
  return policyMove(s, seat, { rng, level: level === "easy" ? "easy" : "medium" });
}
