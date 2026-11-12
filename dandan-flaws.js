// Moves that are wrong on their face, whoever makes them: a short list of rules Korbi has called out, checked at the move.
// Display and counting only: no engine reads this to choose a move (12 November 2026, Korbi: "flag this as a flaw"; the planning
// chat: the lab counts them per 1,000 decisions for every net, and nothing is hard-coded into the play). Pure, no page:
// tests/dandan-flaws.mjs.
//
// Mind Bend on your own Island (Korbi, 12 November 2026: "the purest recurring error there is"; one of the best cards in the
// game, a Dandân killer). Fine only:
//   1. to make it a Mountain for red mana you need (the deck's one red cost: Mystic Retrieval's flashback, {2}{R}, so a
//      Retrieval in the graveyard, or in your hand to cast and flash back later: planning ahead);
//   2. at a Dandân (not a land at all, so never flagged here);
//   3. maybe: it is your only Island, their Dandâns would kill you on their next attack, and with it gone they can't attack
//      (flagged as doubtful: nearly always the Bend belongs on one of their Dandâns).
// Mind Bend on their Island while they have three or more lands that are Islands (a Mystic Sanctuary or any other land typed
// Island counts) is a flaw too (Korbi, 12 November 2026): it takes nothing they need, Dandâns or mana.
import { perm, isLand, islands, isIsland, defOf } from "./dandan-core.js";
import { DECK } from "./dandan-cards.js";

/** A flaw in `move` by `seat` in state `s` (before the move): { kind: "flaw" | "doubt", card, text }, or null. */
export function flawAt(s, seat, move) {
  const p = s.pending;
  if (move?.t !== "bend" || p?.t !== "bend" || p.seat !== seat) return null;
  const t = perm(s, p.target);
  if (!t || !isLand(t) || move.from !== "Island" || !isIsland(t)) return null;
  if (t.ctl !== seat) {
    const theirs = islands(s, t.ctl).length;
    return theirs >= 3 ? { kind: "flaw", card: "Mind Bend", text: `Mind Bend on their Island while they had ${theirs} Islands: it takes nothing they need, and spends one of the best cards in the game` } : null;
  }
  const red = id => /\{R\}/.test(defOf(id).flashback || "");
  if (move.to === "Mountain" && (s.yard.some(red) || s.hand[seat].some(red))) return null;
  const foe = 1 - seat, dandans = s.bf.filter(q => q.ctl === foe && DECK[q.id] === "Dandân").length;
  const last = islands(s, seat).length === 1, dying = dandans && s.life[seat] <= 4 * dandans;
  const made = move.to === "Mountain" ? "a Mountain, with no Retrieval in hand or graveyard to flash back" : `a ${move.to}`;
  if (last && dying) return { kind: "doubt", card: "Mind Bend", text: `Mind Bend on its own last Island (made it ${made}) to stop the Dandâns attacking: nearly always better aimed at a Dandân` };
  return { kind: "flaw", card: "Mind Bend", text: `Mind Bend on its own Island (made it ${made}): one of the best cards in the game spent for nothing` };
}

/**
 * Every flaw in a finished game, by replaying its moves: [{ i, turn, seat, kind, card, text }]. `replay(each)` walks the game,
 * calling each(state before, seat, move, i) (the caller has the rules and the record).
 */
export function flawsOf(replay) {
  const out = [];
  replay((s, seat, move, i) => { const f = flawAt(s, seat, move); if (f) out.push({ i, turn: s.turn, seat, ...f }); });
  return out;
}
