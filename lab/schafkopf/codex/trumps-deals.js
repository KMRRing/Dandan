// The cards a player can't see, dealt as they could lie: each other hand its size, holding nothing of a suit its
// player has shown to be out of (Belote's turned card with its taker); and, in Schafkopf, as the call and the play
// say they must (the caller holds no called Sau and still a card of its Farbe until one is played, and every card
// played so far was legal from the hands so dealt, which keeps the Sau with whoever ran away with it). The computer
// players (trumps-bot.js, trumps-think.js) and the solver's weighing (trumps-solve.js) deal from here.
import { GAMES, sFollow } from "./trumps-games.js";
import { cid, suitOf, rankOf, deckFrom } from "./trumps-cards.js";

const S = GAMES.schafkopf;

/** What a player's cards so far reveal: the suits it's out of. */
export function voidsOf(s, seat) {
  const out = new Set(), g = GAMES[s.game], c = s.contract;
  const tricks = [...s.tricks.map(t => t.cards), s.trick];
  for (const trick of tricks) {
    if (!trick.length) continue;
    const lead = trick[0].card;
    for (let i = 1; i < trick.length; i++) {
      if (trick[i].seat !== seat) continue;
      const card = trick[i].card;
      if (s.game === "schafkopf") { if (sFollow(c, card) !== sFollow(c, lead)) out.add(sFollow(c, lead)); continue; }
      const led = suitOf(lead), T = c.mode === "trump" || s.game !== "jass" ? c.suit : -1;
      if (suitOf(card) === led) continue;
      if (s.game === "jass" && suitOf(card) === T && led !== T) continue;              // trumping in reveals nothing in Jass
      out.add(led === T && s.game === "jass" ? "T-but-bauer" : led);
      if (s.game !== "jass" && suitOf(card) !== T && T >= 0) {
        // in Belote, not trumping when it had to (its partner not holding the trick) means no trumps
        const partnerHeld = trick.slice(0, i).length && trick[g.winner({ ...s, trick: trick.slice(0, i) }, trick.slice(0, i))].seat === (seat + 2) % 4;
        if (!partnerHeld) out.add(T);
      }
    }
  }
  return out;
}
/** Whether a card can lie in a hand that has shown these voids. */
export function fits(s, card, voids) {
  if (!voids.size) return true;
  if (s.game === "schafkopf") return !voids.has(sFollow(s.contract, card));
  if (voids.has(suitOf(card))) return false;
  if (voids.has("T-but-bauer") && suitOf(card) === s.contract.suit && rankOf(card) !== "J") return false;
  return true;
}
/** One way the cards a seat can't see could lie, by each hand's size and voids: hands, or null if none turns up. */
export function sample(s, seat, rng) {
  const g = GAMES[s.game], seen = new Set([...s.hands[seat], ...s.tricks.flatMap(t => t.cards.map(x => x.card)), ...s.trick.map(x => x.card)]);
  const pack = deckFrom(g.low);
  const fixed = [[], [], [], []];
  // Belote's turned card went to the taker
  if (s.game === "belote" && s.contract && s.turned != null && s.contract.taker !== seat && !seen.has(s.turned) && s.hands[s.contract.taker].length) {
    fixed[s.contract.taker].push(s.turned);
    seen.add(s.turned);
  }
  const unknown = pack.filter(c => !seen.has(c));
  const voids = [0, 1, 2, 3].map(p => (p === seat ? new Set() : voidsOf(s, p)));
  const need = [0, 1, 2, 3].map(p => (p === seat ? 0 : s.hands[p].length - fixed[p].length));
  for (let attempt = 0; attempt < 40; attempt++) {
    const hands = fixed.map(f => f.slice()), left = need.slice(), cards = [...unknown];
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    // the most constrained first: cards few hands may hold
    cards.sort((a, b) => [0, 1, 2, 3].filter(p => left[p] && fits(s, a, voids[p])).length - [0, 1, 2, 3].filter(p => left[p] && fits(s, b, voids[p])).length);
    let ok = true;
    for (const c of cards) {
      const can = [0, 1, 2, 3].filter(p => left[p] > 0 && (attempt > 30 || fits(s, c, voids[p])));
      if (!can.length) { ok = false; break; }
      let r = rng() * can.reduce((a, p) => a + left[p], 0), pick = can[0];
      for (const p of can) { r -= left[p]; if (r <= 0) { pick = p; break; } }
      hands[pick].push(c);
      left[pick]--;
    }
    if (ok) { hands[seat] = s.hands[seat].slice(); return hands; }
  }
  return null;
}

// ---------- Schafkopf: the call and the play ----------
/** The sides of a Schafkopf deal: the caller, and in a Sauspiel whoever holds (or played) the called Sau. */
export function sidesOf(s, hands) {
  const c = s.contract;
  let partner = -1;
  if (c.type === "sau") {
    const ace = cid(c.ace, "A");
    partner = hands.findIndex(h => h.includes(ace));
    if (partner < 0) for (const t of [...s.tricks.flatMap(x => x.cards), ...s.trick]) if (t.card === ace) partner = t.seat;
  }
  return seat => (seat === c.declarer || seat === partner ? 0 : 1);
}
/** Whether a deal could be the real one, by what the call says: the caller holds no called Sau, and still a card of its Farbe unless one is played. */
export function callerFits(s, hands) {
  const c = s.contract;
  if (c.type !== "sau") return true;
  const own = hands[c.declarer], ace = cid(c.ace, "A");
  if (own.includes(ace)) return false;
  const ofFarbe = id => suitOf(id) === c.ace && rankOf(id) !== "Q" && rankOf(id) !== "J";      // its Ober and Unter are trumps
  const played = s.tricks.flatMap(x => x.cards).concat(s.trick).some(t => t.seat === c.declarer && ofFarbe(t.card));
  return played || own.some(ofFarbe);
}
/**
 * Whether every card played so far was legal from the hands as a deal would have dealt them: what plain dealing misses
 * is the called Sau's rules (it must come when its Farbe is led, so whoever followed with another doesn't hold it).
 */
export function playedFits(s, hands) {
  const sim = { contract: s.contract, hands: hands.map(h => h.slice()), trick: [] }, all = [...s.tricks.map(t => t.cards), s.trick];
  for (const t of all) for (const x of t) sim.hands[x.seat].push(x.card);
  for (const t of all) {
    sim.trick = [];
    for (const x of t) {
      if (!S.legal(sim, x.seat).includes(x.card)) return false;
      sim.hands[x.seat] = sim.hands[x.seat].filter(id => id !== x.card);
      sim.trick.push(x);
    }
  }
  return true;
}
/** A Schafkopf deal of the cards a seat can't see that honours the call and the play so far, or null if none turns up. */
export function fittingDeal(s, seat, rng, tries = 60) {
  for (let k = 0; k < tries; k++) {
    const hands = sample(s, seat, rng);
    if (hands && callerFits(s, hands) && playedFits(s, hands)) return hands;
  }
  return null;
}
/** A Schafkopf deal of the cards a seat can't see, honouring the call and the play (tries a while, then lets them go). */
export function dealFor(s, seat, rng) {
  return fittingDeal(s, seat, rng) || sample(s, seat, rng);
}
