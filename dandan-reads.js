// Dandan's reads: what the other player's play has shown about the cards in their hand. In a game of today every pass
// that could show something is read (dandan-observe.js, kept as obs): the cards a player holding them would clearly have
// played there are ruled out of the hand held then; a game from before them has the engine's four tells (dandan-core.js's
// tellsOf: the hand kept, a turn ended with no land played, a spell let through that a Memory Lapse would surely have
// countered, an unblocked Dandân let hit them with blue open). Each read rules a kind of card out of the hand they held
// then; the cards drawn since may be anything; the kept hand bounds its lands.
//
// Read as chances (Bayes' rule): a hand of hidden cards is as likely as before, times the chance that a player holding
// it would have shown what the table saw. That chance is 1 when the hand has none of what a read rules out; else it is
// the chance that every such card came with the draws since (and the chance the player held one back anyway, its
// slip). dandan-think.js deals the other hand by it (a deal kept with that chance, dealt again if not); dandan-policy.js's
// odds on a card in their hand read the same.
import { CARDS, DECK, TOKEN_AT } from "./dandan-cards.js";
import { isLandId } from "./dandan-core.js";

/**
 * How often a player holding the card plays as though they didn't: a land kept back, a Memory Lapse saved for
 * something bigger, a Piracy Charm saved at a high life total. Medium never does (in 2,000 games of it against itself,
 * 42 of 17,644 turns ended with no land played had one in hand, none of 7,284 passes on a Dandân a Lapse, none of 5,370
 * unanswered attacks an answer); a person sometimes does, and these are set for people.
 */
export const SLIP = { keep: 0.1, land: 0.05, lapse: 0.15, kill: 0.25, out: 0.15 };
const LANDS = new Set(Object.keys(CARDS).filter(n => CARDS[n].type === "land"));
/** The instant answers to an attacking Dandân, with the mana each needs. */
const ANSWERS = [["Piracy Charm", 1], ["Mind Bend", 1], ["Metamorphose", 2], ["Repulse", 3], ["Commit // Memory", 4]];
/** The answers a kill tell rules out: those castable with the mana they had open. */
export const answersWith = mana => ANSWERS.filter(([, c]) => c <= mana).map(([n]) => n);
/** The lands a hand held at the keep must have had: two to five of seven, before the free first mulligan and after it;
 *  at least one of six after the next (one to the bottom); after three, anything. */
const KEPT = [[2, 5], [2, 5], [1, 5]];

/**
 * The reads of `seat` that still say something about its hand: [{ kind, names (a Set) or lands, since (cards drawn
 * since), slip, at and on (where a pass was, and the spell it let by) }], and the keep's bounds while it's early (keep:
 * { lo, hi, since }). A read says nothing once the whole hand could have been drawn since, or (the keep) after a few
 * draws, when what's been played says more.
 */
export function readsOf(s, seat) {
  const t = s.tells?.[seat], drawn = s.draws?.[seat] ?? 0, hand = s.hand[seat].length;
  const out = [];
  if (!t) return out;
  const since = d => drawn - d;
  if (s.obs) {
    // the passes read at every decision (dandan-observe.js): what each ruled out of the hand held then
    for (const o of s.obs) {
      if (o.s !== seat || since(o.d) >= hand) continue;
      const names = new Set(o.out), lands = o.out.some(n => LANDS.has(n));
      out.push({ kind: lands ? "land" : "out", names, lands, at: o.at, on: o.on, since: since(o.d), slip: lands ? SLIP.land : SLIP.out });
    }
  } else {
    // a game from before them: the tells the engine keeps
    if (t.land >= 0 && since(t.land) < hand) out.push({ kind: "land", lands: true, since: since(t.land), slip: SLIP.land });
    if (t.lapse >= 0 && since(t.lapse) < hand) out.push({ kind: "lapse", names: new Set(["Memory Lapse"]), since: since(t.lapse), slip: SLIP.lapse });
    if (t.kill >= 0 && since(t.kill) < hand && t.mana > 0) out.push({ kind: "kill", names: new Set(answersWith(t.mana)), since: since(t.kill), slip: SLIP.kill });
  }
  const m = s.mull?.n?.[seat] ?? 0;
  if (t.keep >= 0 && m < KEPT.length && since(t.keep) <= 4) out.push({ kind: "keep", lo: KEPT[m][0], hi: KEPT[m][1], since: since(t.keep), lands: t.lands, slip: SLIP.keep });
  return out;
}

/** The chance that k cards of a kind among n are all among m of them picked at random (the cards drawn since): C(m, k) / C(n, k). */
export function allAmong(k, n, m) {
  if (k <= 0) return 1;
  m = Math.min(m, n);
  if (k > m) return 0;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (m - i) / (n - i);
  return p;
}

/**
 * The chance a hand would have shown what the table saw: hidden, the cards of it the seat can't see (as dealt);
 * known, the ones it knows are there. The product over the reads of slip + (1 − slip) × the chance that what the read
 * rules out came with the draws since; for the keep, whether the lands it has had (in hand and played) fit a kept hand.
 */
export function likelihood(reads, hidden, known = []) {
  let L = 1;
  for (const r of reads) {
    let ok;
    if (r.kind === "keep") {
      let had = r.lands;
      for (const id of hidden) if (id < TOKEN_AT && isLandId(id)) had++;
      for (const id of known) if (id < TOKEN_AT && isLandId(id)) had++;
      // the lands it kept are still in hand or were played; the draws since may have brought more
      ok = had >= r.lo && had <= r.hi + r.since ? 1 : 0;
    } else {
      let k = 0;
      for (const id of hidden) if (id < TOKEN_AT && (r.names ? r.names.has(DECK[id]) : isLandId(id))) k++;
      ok = allAmong(k, hidden.length, r.since);
    }
    L *= r.slip + (1 - r.slip) * ok;
  }
  return L;
}
