// A null move (17 Nov 2026, Korbi: a measure of the nets, never a rule the search uses): played with both players passing until
// the stack is empty, it leaves the position as it was but for the card gone from the mover's hand and its mana spent.
// Used by lab/null-count.mjs (self-play) and lab/suite.mjs (the suite's picks).
import { act, toMove } from "../dandan-engine.js";

const J = x => JSON.parse(JSON.stringify(x)), key = x => JSON.stringify(x), PASS = { t: "pass" };
/** The position as the rules use it, without what a resolved spell's payment leaves behind (tapped lands, mana pool), the
 *  bookkeeping (object numbers, log, reads) and the one card `card` off the table (in hand, graveyard or exile). */
function core(s, card) {
  const bf = s.bf.map(({ tapped, oid, ent, ...p }) => p);   // the card on the table is no null move: it stays in the key
  const drop = a => a.filter(x => x !== card);
  return key([s.turn, s.step, s.active, s.life, s.lib, s.hand.map(drop), bf, s.stack.map(x => [x.name, x.card, x.ctl, x.targets]), drop(s.yard), drop(s.exile),
    s.played, s.attacked, s.pending, s.combat, s.over, s.winner]);
}
/** The move played with both players passing until the stack is empty: is the position the same, but for the card and the mana? */
export function isNull(s, who, m, rng) {
  const card = m.card ?? null, c = J(s);
  if (typeof act(c, who, m, { rng, quiet: true }) === "string") return false;
  for (let k = 0; k < 60 && c.stack.length && !c.over; k++) {
    if (c.pending) return false;   // somebody is asked something: not a plain resolution
    if (typeof act(c, toMove(c), PASS, { rng, quiet: true }) === "string") return false;
  }
  return !c.pending && !c.stack.length && core(c, card) === core(s, card);
}
