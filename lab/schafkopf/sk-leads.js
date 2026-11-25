// The father's two leads (Korbi, 25 Nov 2026: his father, an expert, on Codex's Schafkopf), as positions and the cards in question.
// Never rules for an engine: meters (sk-dad.mjs) and labels for the readings (sk-pack.mjs K and QM).
//   A: a defender leads trump into a Solo or Wenz whose declarer plays last to the trick;
//   B: a Sauspiel's declarer, on lead in tricks 2 to 4 with the called ace still out, leads the called suit himself.
import { schafkopf as G } from "./sk-rules.js";
import { cid, suitOf, rankOf } from "./codex/trumps-cards.js";

const trump = (c, id) => (c.type === "wenz" ? rankOf(id) === "J" : rankOf(id) === "Q" || rankOf(id) === "J" || suitOf(id) === c.trump);
export const aceFell = (s, ace) => s.tricks.some(t => t.cards.some(x => x.card === ace)) || s.trick.some(x => x.card === ace);
/** The questioned cards of `kind` ("A" or "B") for seat `w` on lead in `s`, or null when the position isn't of that kind (or every
 *  legal card, or none, is in question). */
export function questioned(s, w, kind) {
  const c = s.contract;
  if (s.step !== "play" || !c || s.trick.length) return null;
  const legal = G.options(s, w).map(m => m.card);
  let q = null;
  if (kind === "A" && (c.type === "solo" || c.type === "wenz") && w !== c.declarer && (w + 3) % 4 === c.declarer) q = legal.filter(x => trump(c, x));
  if (kind === "B" && c.type === "sau" && w === c.declarer && s.tricks.length >= 1 && s.tricks.length <= 3 && !aceFell(s, cid(c.ace, "A")) && legal.some(x => trump(c, x)))
    q = legal.filter(x => suitOf(x) === c.ace && !trump(c, x));
  return q && q.length && q.length < legal.length ? q : null;
}
