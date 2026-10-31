// Dandan's computer player by habit: what a good player of the format does without looking ahead, worked out at each
// decision from what its seat may know. It is Medium; Easy is the same player made careless (it taps out on its own
// turn, counters whatever it can, uses removal on sight, attacks with everything); and Hard (dandan-think.js) plays the
// moves this one would consider out a turn ahead in many deals of the cards it can't see, with this player moving both
// seats there. So it must be quick: everything is worked out once per decision, from the state as it stands.
//
// It weighs everything in cards: 1 is an average card in hand. The format's turns of the screw it plays by:
//  · The library is shared, so the next card drawn goes to whoever draws next: on your turn, after your draw, that is
//    the other player; on theirs, you. A spell countered by Memory Lapse goes on top: countered on their turn, it comes
//    to you. A card put on top is chosen by who will draw it (Brainstorm's two, Halimar Depths' three, a surveil).
//  · Lands untap only on their owner's turn: mana spent on your turn is gone on theirs, mana left at the end of their
//    turn is free. So it holds two open for a Memory Lapse on its own turn, and spends the rest at the end of theirs.
//  · A Dandân dies to anything that takes a point of toughness or its last Island, and can only attack a player who
//    controls an Island. Islands are double-edged: yours keep your Dandâns, and let theirs attack you.
//  · The graveyard is shared too, and a Mystic Retrieval in it is anyone's with red: a spell cast leaves its card there
//    for the other player to take back, and a Retrieval cast from the hand leaves itself (gift).
import { CARDS, DECK, NAMES, BASICS, HALVES, TOKEN_AT, total } from "./dandan-cards.js";
import { moves, halfOf, nextDrawer, costOf } from "./dandan-engine.js";
import {
  other, nm, isLandId, perm, isLand, isCreature, isToken, pt, lands, islands, creatures, typesOf, needType, manaAlts, topKnown, itemOf,
  knownIn, poolOf, isSpellCard,
} from "./dandan-core.js";
import { shuffle } from "./seats.js";
import { readsOf } from "./dandan-reads.js";

export const PASS = { t: "pass" };
const pickOne = (a, rng) => a[Math.floor(rng() * a.length)];
const sum = a => a.reduce((t, x) => t + x, 0);
/** A card's front half (the split card cast from a hand is Commit). */
const front = id => (HALVES[DECK[id]] ? HALVES[DECK[id]][0] : DECK[id]);

/** What a card in hand is worth before its use, in cards: an average card is 1. */
export const WORTH = {
  "Memory Lapse": 1.5, "Dandân": 1.4, "Piracy Charm": 1.25, "Mind Bend": 1.15, "Commit // Memory": 1.05, "Narset's Reversal": 1.0,
  "Repulse": 1.0, "Metamorphose": 0.95, "Lórien Revealed": 0.9, "Brainstorm": 0.9, "Predict": 0.85, "Mystic Retrieval": 0.8,
  "Deem Inferior": 0.8, "Take Inventory": 0.75, "Chart a Course": 0.75, "Gone Missing": 0.7, "Quicken": 0.55,
};
/** What a card held is worth over using it now: part of its worth (a card kept is a card for later). */
const KEEP = 0.75;

// ---------- what the seat knows ----------
/** Each card's name as a number (its place in NAMES), and how many copies of each the deck has: counted once. */
const NAME_AT = new Map(NAMES.map((n, i) => [n, i]));
const NAME_OF = Uint8Array.from(DECK, n => NAME_AT.get(n));
const COPIES = (() => { const c = new Int16Array(NAMES.length); for (const i of NAME_OF) c[i]++; return c; })();
/** How many copies of a name a seat hasn't seen (facts' left, by name). */
export const unseenOf = (F, name) => F.left[NAME_AT.get(name)];
/**
 * The facts a seat plays from: the table, and the odds on the cards it can't see. left: for each name (by its place in
 * NAMES; unseenOf reads it by name), the copies not in its hand, on the table, in the graveyard or exile, on the stack,
 * seen in the library or known to be in the other hand; those are in the other hand or the library, at random as far
 * as it knows. (Numbers in a typed array: this is worked out at every decision of every game Hard plays in its head.)
 */
export function facts(s, me) {
  const opp = other(me), left = COPIES.slice();
  const see = id => { if (id < TOKEN_AT) left[NAME_OF[id]]--; };
  for (const id of s.hand[me]) see(id);
  for (const id of s.yard) see(id);
  for (const id of s.exile) see(id);
  for (const p of s.bf) see(p.id);
  for (const it of s.stack) if (it.kind === "spell" && !it.copy) see(it.card);
  for (const [id, m] of s.kn) if (m & (1 << me)) see(id);
  const theirKnown = knownIn(s, opp, me);
  for (const id of theirKnown) see(id);
  let unknown = 0;
  for (let i = 0; i < left.length; i++) if (left[i] > 0) unknown += left[i];
  return {
    s, me, opp, left, unknown, theirKnown, hidden: Math.max(0, s.hand[opp].length - theirKnown.length), reads: readsOf(s, opp),
    known: topKnown(s, me), next: nextDrawer(s), myTurn: s.active === me,
    my: openMana(s, me), their: openMana(s, opp),
    mine: creatures(s, me), theirs: creatures(s, opp), myIsl: islands(s, me).length, theirIsl: islands(s, opp).length,
  };
}
const countOf = (str, c) => { let n = 0; for (const x of str) if (x === c) n++; return n; };
/** The mana a seat has open: its pool and its untapped lands at their most, how many of them make blue, and red. */
export function openMana(s, seat) {
  const pool = poolOf(s, seat);
  let n = pool.length, u = countOf(pool, "U"), r = countOf(pool, "R");
  for (const l of s.bf) {
    if (l.ctl !== seat || l.tapped || !isLand(l)) continue;
    const alts = manaAlts(l);
    if (!alts.length) continue;
    n += Math.max(...alts.map(a => a.length));
    if (alts.some(a => a.includes("U"))) u++;
    if (alts.some(a => a.includes("R"))) r++;
  }
  return { n, u, r };
}
/**
 * A read of the other player (dandan-reads.js) of a kind, when nothing has been drawn since: what their play has just
 * shown. "land": no land; "lapse": no Memory Lapse, at a spell of ours let through; "kill": no answer, at our attack.
 */
export const freshRead = (F, kind) => F.reads.find(r => r.since === 0 && (r.kind === kind
  || (kind === "lapse" && r.at === "stack" && r.names?.has("Memory Lapse"))
  || (kind === "kill" && r.at === "attack"))) || null;
/**
 * The chance the other hand holds at least one card of a name: one known to be there, certainly; else at random among
 * the cards not seen, unless their play ruled it out of the hand they held then (a read): then only the cards drawn
 * since may have brought one, or they held it back anyway (the read's slip).
 */
export function holds(F, name) {
  if (F.theirKnown.some(id => DECK[id] === name)) return 1;
  const p = holdsAtRandom(F, name);
  let q = p;
  for (const r of F.reads) if (r.names?.has(name)) q = Math.min(q, r.slip * p + (1 - r.slip) * holdsAtRandom(F, name, Math.min(r.since, F.hidden)));
  return q;
}
/** The chance n cards at random from those not seen (F.hidden of them by default, the other hand) include one of a name. */
function holdsAtRandom(F, name, n = F.hidden) {
  const k = Math.max(0, unseenOf(F, name)), U = F.unknown;
  if (k <= 0 || n <= 0 || U <= 0) return 0;
  let none = 1;
  for (let i = 0; i < n; i++) none *= Math.max(0, U - k - i) / (U - i);
  return 1 - none;
}
/** The chance a spell of ours cast now is answered: a Memory Lapse with two open (one blue), a Commit with four, a Reversal on an instant or sorcery. */
export function counterRisk(F, half) {
  const o = F.their;
  if (o.u < 1 || o.n < 2) return 0;
  let keep = 1 - holds(F, "Memory Lapse");
  if (o.n >= 4) keep *= 1 - 0.6 * holds(F, "Commit // Memory");
  const t = CARDS[half]?.type;
  if (o.u >= 2 && (t === "instant" || t === "sorcery")) keep *= 1 - 0.5 * holds(F, "Narset's Reversal");
  return Math.min(0.92, 0.9 * (1 - keep));
}

// ---------- what things are worth ----------
/** A Dandân on the battlefield, to its controller: a clock while the other player has its land type, less while it can't attack, less again on its last land. */
export function dandanWorth(s, p) {
  const foe = other(p.ctl), need = needType(p);
  const canHit = s.bf.some(l => l.ctl === foe && isLand(l) && typesOf(l).includes(need));
  const homes = s.bf.filter(l => l.ctl === p.ctl && isLand(l) && typesOf(l).includes(need)).length;
  if (!homes) return 0.2;                                         // it goes with the next check
  let v = canHit ? 2.5 : 1.4;
  if (homes <= 1) v *= 0.85;
  if (pt(p)[1] <= 0) return 0;
  return v;
}
/** A Dandân about to come in under seat: what it will be worth (a card thrown away when there's no Island to keep it). */
function newDandanWorth(s, seat) {
  const homes = islands(s, seat).length;
  if (!homes) return -1.4;
  return (islands(s, other(seat)).length ? 2.5 : 1.4) * (homes <= 1 ? 0.85 : 1);
}
/** How many lands a seat has, counting those it holds when the seat is the one asking (the other's hand: one, as a guess). */
function landCount(F, seat, except = null) {
  const s = F.s, onBf = lands(s, seat).length;
  // theirs: one in hand, as a guess, none when they've just missed a land drop
  if (seat !== F.me) return onBf + (freshRead(F, "land") ? 0 : 1);
  return onBf + s.hand[seat].filter(id => id !== except && isLandId(id)).length;
}
/** What a card is worth to a seat holding or drawing it: lands by how many it has, the rest by WORTH and the table. */
export function cardWorth(F, id, seat = F.me) {
  if (id == null || id >= TOKEN_AT) return 0;
  const s = F.s, name = DECK[id];
  if (isLandId(id)) {
    const n = landCount(F, seat, id);
    let v = n < 3 ? 1.35 : n < 5 ? 1.0 : n < 7 ? 0.55 : 0.25;
    if (CARDS[name].cycling) v = Math.max(v, 0.5);
    if ((CARDS[name].subs || []).includes("Island")) v += creatures(s, seat).length || (seat === F.me && s.hand[seat].some(i => DECK[i] === "Dandân")) ? 0.2 : 0.05;
    return v;
  }
  if (name === "Take Inventory") return 0.7 + 0.3 * s.yard.filter(i => DECK[i] === name).length;
  if (name === "Dandân") return islands(s, seat).length || landCount(F, seat) >= 2 ? 1.4 : 1.0;
  if (name === "Mystic Retrieval") return 0.6 + (s.yard.some(i => DECK[i] === "Memory Lapse") ? 0.3 : 0);
  return WORTH[name] ?? 0.7;
}

/** What taking a permanent away does for `by`, in cards (negative for their own): the effect at full strength. */
function hitWorth(F, p, by) {
  const s = F.s, sign = p.ctl === by ? -1 : 1;
  if (isCreature(p)) return sign * dandanWorth(s, p);
  if (nm(p.id) === "Clue") return sign * 0.35;
  if (!isLand(p)) return 0;
  return sign * landHit(s, p);
}
/** A land taken away for good (or made something else, keepsMana: Mind Bend), to its controller: the mana, and the Dandâns that go with it. */
function landHit(s, p, keepsMana = false) {
  if (keepsMana) return 0.05 + landDandans(s, p);
  const [n, d] = manaDrop(s, p, false);
  return manaWorth(n, d) + landDandans(s, p);
}

// ---------- mana ----------
// What mana is worth, measured with the judge (dandan-eval.js) over Medium's games: a land taken from the battlefield,
// or from the hand, against a spell taken from the hand (on the same scale: the judge puts an attacking Dandân at 2.6
// spells, this player at 2.5). Slowing the other player's mana is worth a great deal until their lands are all down.
/** The n-th mana of a seat's lands, lost: a card and three quarters while it's short of what the spells cost, a card at six, nothing much past ten. */
const MANA_LOSS = [1.75, 1.75, 1.75, 1.7, 1.55, 1.35, 1.05, 0.9, 0.7, 0.6, 0.45, 0.25, 0.15];
/** A land card in hand lost (put down in place of one taken away), by the seat's mana: its only land, or one of several. */
const LAST_LAND = [1.3, 1.3, 1.3, 1.3, 1.2, 0.9, 0.7, 0.5, 0.4, 0.25, 0.2];
const SPARE_LAND = [0.9, 0.9, 0.9, 0.75, 0.6, 0.5, 0.45, 0.32, 0.23, 0.2, 0.17];
const at = (table, n) => table[Math.max(0, Math.min(n, table.length - 1))];
/** What a card at random is worth to whoever draws it: what a card put on top is weighed against. */
const FRESH = 0.85;
/** Their land drawn again in place of a new card, by the judge: about a card whatever the turn (the draw lost), and a little of the mana (played again in place of a new land). */
const REDRAWN = 0.95, REDRAWN_MANA = 0.15;
/** A hand's land cards. */
const landsIn = hand => { let n = 0; for (const id of hand) if (isLandId(id)) n++; return n; };
/** d mana lost by a seat with n. */
function manaWorth(n, d) {
  let v = 0;
  for (let j = 0; j < d; j++) v += at(MANA_LOSS, n - j);
  return v;
}
/** The mana a land makes at its most (Izzet Boilerworks two; Flood Plain one, the Island it fetches). */
function manaOf(l) {
  let big = 0;
  for (const a of manaAlts(l)) if (a.length > big) big = a.length;
  return big || (CARDS[nm(l.id)]?.fetch ? 1 : 0);
}
/**
 * The mana a seat's lands will make, and how much less once its land p is gone (dropped: and a land from its hand put
 * down in its place, as Metamorphose lets it), counting a Boilerworks of its waiting on the stack to return a land: it
 * returns the one making least, itself only when it's the last. So the Boilerworks taken in answer to its trigger costs
 * them its two while they still return a land for it, and an Island taken then can leave the Boilerworks to go back itself.
 */
function manaDrop(s, p, dropped) {
  const owner = p.ctl, boil = s.stack.find(x => x.name === "@boil" && x.ctl === owner);
  const left = ls => {
    let n = 0;
    for (const l of ls) n += l.m;
    if (!boil || !ls.length) return n;
    let back = null;
    for (const l of ls) if (l.id !== boil.src && (!back || l.m < back.m)) back = l;
    return n - (back || ls[0]).m;
  };
  const ls = [];
  for (const l of s.bf) if (l.ctl === owner && isLand(l)) ls.push({ id: l.id, m: manaOf(l) });
  const before = left(ls), rest = ls.filter(l => l.id !== p.id);
  if (dropped) rest.push({ id: -1, m: 1 });
  return [before, Math.max(0, before - left(rest))];
}
const LAND_NAMES = NAMES.filter(n => CARDS[n]?.type === "land");
const LN_FACT = (() => { const a = [0]; for (let i = 1; i <= 100; i++) a[i] = a[i - 1] + Math.log(i); return a; })();
const lnC = (n, k) => (k < 0 || k > n ? -Infinity : LN_FACT[n] - LN_FACT[k] - LN_FACT[n - k]);
/** The chance that h cards at random from `all`, `good` of them of a kind, include at least k of it. */
function atLeast(k, h, good, all) {
  if (k <= 0) return 1;
  h = Math.min(h, all);
  let below = 0;
  for (let x = 0; x < k; x++) below += Math.exp(lnC(good, x) + lnC(all - good, h - x) - lnC(all, h));
  return Math.max(0, 1 - below);
}
/**
 * The chance the other hand holds at least k lands: those known to be there, then the hidden cards at random, unless a
 * turn of theirs ended with no land played (a read): then only the cards drawn since, or a land they kept back anyway.
 */
export function landOdds(F, k = 1) {
  let known = 0;
  for (const id of F.theirKnown) if (isLandId(id)) known++;
  if (known >= k) return 1;
  let good = 0;
  for (const n of LAND_NAMES) good += Math.max(0, unseenOf(F, n));
  const p = h => atLeast(k - known, h, good, F.unknown);
  const r = F.reads.find(x => x.kind === "land");
  return r ? r.slip * p(F.hidden) + (1 - r.slip) * p(Math.min(r.since, F.hidden)) : p(F.hidden);
}
/**
 * A land put on top of the library (Metamorphose, Gone Missing), to `by`, in cards. Drawn next by `by`, it's gone from
 * its owner for good, and `by`'s in place of a card at random (worth less to a hand that holds a land already); drawn
 * by its owner, they play it again in place of a new land, and the card they'd have drawn is lost: a turn's land and a
 * card. Metamorphose lets them put a land from their hand straight down (a Dandân rather, when an Island stands for it,
 * priced by the caller): then they lose only the mana the land put down doesn't make up, and the land from their hand,
 * which costs less when they hold others. So Metamorphose on an Island while they hold the land their Boilerworks just
 * returned does nothing to their mana; on the Boilerworks, it takes a mana away for good.
 */
function landAway(F, p, half, by) {
  const s = F.s, owner = p.ctl, ours = owner === F.me;
  let drop = 0, more = 0;
  if (half === "Metamorphose") {
    if (ours) {
      const n = landsIn(s.hand[owner]);
      drop = n ? 1 : 0;
      more = n > 1 ? 1 : 0;
    } else {
      drop = landOdds(F, 1);
      more = drop > 0 ? landOdds(F, 2) / drop : 0;
    }
    // a Dandân goes down rather, where an Island will stand under it
    if (islands(s, owner).some(l => l.id !== p.id)) drop *= 1 - (ours ? +s.hand[owner].some(id => DECK[id] === "Dandân") : holds(F, "Dandân"));
  }
  const [n, d0] = manaDrop(s, p, false), d1 = drop ? manaDrop(s, p, true)[1] : 0;
  let loss;
  if (F.next === owner) loss = REDRAWN + REDRAWN_MANA * ((1 - drop) * manaWorth(n, d0) + drop * manaWorth(n, d1));
  else loss = (1 - drop) * manaWorth(n, d0) + drop * (manaWorth(n, d1) + (1 - more) * at(LAST_LAND, n) + more * at(SPARE_LAND, n));
  loss += (1 - drop) * landDandans(s, p);
  let gain = 0;
  if (F.next === by && by !== owner) {
    const held = by === F.me ? landsIn(s.hand[by]) > 0 : landOdds(F, 1) > 0.5;
    gain = at(held ? SPARE_LAND : LAST_LAND, landMana(s, by)) - FRESH;
  }
  return (owner === by ? -loss : loss) + gain;
}
/** The Dandâns that go with a land, to its controller: theirs on their last land of that type, and the attacks it ends for the other player's. */
function landDandans(s, p) {
  const types = typesOf(p);
  let v = 0;
  for (const d of creatures(s, p.ctl)) {
    const need = needType(d);
    if (!types.includes(need)) continue;
    const rest = s.bf.filter(l => l.ctl === p.ctl && l.id !== p.id && isLand(l) && typesOf(l).includes(need)).length;
    if (!rest) v += dandanWorth(s, d) + 0.2;
  }
  // their last Island also ends our attacks on them: a Dandân may attack only a player who controls one
  const foe = other(p.ctl);
  for (const d of creatures(s, foe)) {
    const need = needType(d);
    if (!types.includes(need)) continue;
    const rest = s.bf.filter(l => l.ctl === p.ctl && l.id !== p.id && isLand(l) && typesOf(l).includes(need)).length;
    if (!rest) v -= 0.9;
  }
  return v;
}

// ---------- the shared graveyard ----------
/** How much of a removal spell's hit on a Dandân stays: a kill is for good; a bounce or a trip to the library is a delay. */
const STAYS = { "Piracy Charm": 1, "Mind Bend": 1, "Deem Inferior": 0.95, "Repulse": 0.5, "Commit": 0.7, "Gone Missing": 0.75, "Metamorphose": 0.7 };
/** Whether a land can make red. */
const makesRed = l => manaAlts(l).some(a => a.includes("R"));
/** Whether a seat controls a land that makes red: what a Mystic Retrieval's flashback ({2}{R}) needs. */
export const hasRed = (s, seat) => s.bf.some(l => l.ctl === seat && isLand(l) && makesRed(l));
/** The mana a seat's lands make with all of them untapped, as on its own turn (Izzet Boilerworks makes two). */
export function landMana(s, seat) {
  let n = 0;
  for (const l of s.bf) {
    if (l.ctl !== seat || !isLand(l)) continue;
    let big = 0;
    for (const a of manaAlts(l)) if (a.length > big) big = a.length;
    n += big;
  }
  return n;
}
/**
 * What a removal card would do for `seat` cast this turn with `mana` to spare, against the other's best Dandân, in
 * cards: the Dandân's worth for as long as the answer lasts, and the attack it won't make. 0 without the mana or a
 * Dandân worth it.
 */
export function answerWorth(F, id, seat, mana) {
  const s = F.s, half = front(id), stays = STAYS[half];
  if (stays == null || mana < total(costOf(s, seat, half, "hand"))) return 0;
  let best = 0;
  for (const d of creatures(s, other(seat))) {
    const v = dandanWorth(s, d) * stays + (islandsOfType(s, seat, needType(d)) ? 0.5 * hitValue(s.life[seat]) : 0);
    if (v > best) best = v;
  }
  return best;
}
/**
 * What the graveyard is worth to `seat` on its next turn through a Mystic Retrieval, in cards: the best instant or
 * sorcery there (a removal spell it could cast the same turn counts what it would do to a Dandân), when it could cast
 * the Retrieval: flashed back from the graveyard (a red source and three mana) or from its hand (four mana; `inHand`
 * the chance it holds one). `mana`: what it will have.
 */
export const yardWorth = (F, yard, seat, mana, inHand = 0) => yardPick(F, yard, seat, mana, inHand).v;
/** yardWorth's working: { v, id (the card it would find), kill (it would answer a Dandân the same turn), flash (by flashback) }. */
export function yardPick(F, yard, seat, mana, inHand = 0) {
  const pull = (ids, left) => {
    let best = { v: 0, id: null, kill: false };
    for (const id of ids) {
      if (!isSpellCard(id)) continue;
      const card = cardWorth(F, id, seat), kill = answerWorth(F, id, seat, left);
      const v = Math.max(card, kill);
      if (v > best.v) best = { v, id, kill: kill > card };
    }
    return best;
  };
  let out = { v: 0, id: null, kill: false, flash: false };
  const flash = yard.findIndex(id => DECK[id] === "Mystic Retrieval");
  // flashed back it's exiled: worth what it finds, less the turn's mana (a little)
  if (flash >= 0 && mana >= 3 && hasRed(F.s, seat)) {
    const p = pull(yard.filter((_, i) => i !== flash), mana - 3);
    out = { ...p, v: p.v - 0.2, flash: true };
  }
  // from the hand it's a card spent on the one it finds
  if (inHand > 0 && mana >= 4) {
    const p = pull(yard, mana - 4), v = inHand * (p.v - 0.6);
    if (v > out.v) out = { ...p, v, flash: false };
  }
  if (out.v < 0) out = { v: 0, id: null, kill: false, flash: false };
  return out;
}

/** What a spell or ability on the stack does for its controller if it resolves, in cards. */
export function spellWorth(F, it) {
  const s = F.s, t0 = it.targets[0], ctl = it.ctl;
  const target = t0?.k === "c" ? perm(s, t0.id) : null;
  switch (it.name) {
    case "Dandân": return Math.max(0.4, newDandanWorth(s, ctl));
    case "Brainstorm": return 0.75;
    case "Predict": return 1.05;
    case "Quicken": return 0.5;
    case "Chart a Course": return s.active === ctl && s.attacked ? 1.8 : 1.1;
    case "Take Inventory": return 1 + s.yard.filter(i => DECK[i] === "Take Inventory").length;
    case "Lórien Revealed": return 2.5;
    case "Mystic Retrieval": return t0 ? cardWorth(F, t0.id, ctl) : 0.4;
    case "Memory": return Math.max(0.3, 0.8 * (s.hand[other(ctl)].length - s.hand[ctl].length) + 0.6);
    case "Memory Lapse": case "Commit": case "Narset's Reversal": {
      if (target) return 0.8 * hitWorth(F, target, ctl);
      const y = t0?.k === "s" ? itemOf(s, t0.sid) : null;
      if (!y) return 0;
      if (it.name === "Narset's Reversal") return (y.ctl === ctl ? 0.6 : 1) * Math.abs(spellWorth(F, y)) * 0.8;
      return y.ctl === ctl ? -spellWorth(F, y) : spellWorth(F, y) + 0.4;
    }
    case "Piracy Charm":
      if (it.mode === 2) return t0?.seat !== ctl ? 0.7 : -0.7;
      if (!target) return 0;
      if (it.mode === 0) return target.ctl === ctl && s.combat?.att.includes(target.id) ? 0.9 : 0.1;
      return hitWorth(F, target, ctl);
    case "Mind Bend":
      if (!target) return 0;
      return isCreature(target) ? hitWorth(F, target, ctl) : (target.ctl === ctl ? -1 : 1) * landHit(s, target, true);
    case "Repulse": return (target ? 0.55 * hitWorth(F, target, ctl) : 0) + 0.9;
    case "Metamorphose": case "Gone Missing": case "Deem Inferior": {
      const hit = !target ? 0 : isLand(target) && it.name !== "Deem Inferior" ? landAway(F, target, it.name, ctl) : 0.8 * hitWorth(F, target, ctl);
      return hit + (it.name === "Gone Missing" ? 0.5 : 0);
    }
    case "@cycle": case "@clue": return 0.9;
    case "@isle": return 0.9;
    case "@fetch": return 0.4;
    case "@dandan": return 0;
    default: return 0.3;
  }
}

// ---------- the player ----------
const REMOVAL = new Set(["Piracy Charm", "Mind Bend", "Repulse", "Commit", "Metamorphose", "Gone Missing", "Deem Inferior"]);

export class Player {
  /** level: "medium" or "easy" (careless). */
  constructor(s, me, { level = "medium", rng = Math.random } = {}) {
    this.s = s; this.me = me; this.opp = other(me); this.rng = rng;
    this.easy = level === "easy";
    this.F = facts(s, me);
  }

  // ===== the questions =====
  answer() {
    const s = this.s, p = s.pending, F = this.F, me = this.me;
    switch (p.t) {
      case "mull": return this.mulligan(p);
      case "bottom": return { t: "bottom", cards: this.worst(s.hand[me], p.n) };
      case "attack": return this.attacks(p);
      case "block": return this.blocks(p);
      case "discard": return { t: "discard", cards: this.worst(s.hand[me], p.n) };
      case "putback": return this.putback(p);
      case "order": return this.order(p);
      case "surveil": return { t: "surveil", yard: this.toYard(p.card) };
      case "search": return { t: "search", card: this.searchPick(p) };
      case "pick": return { t: "pick", card: this.pickFor(p) };
      case "owner": return { t: "owner", bottom: this.bottomOwn(p) };
      case "bend": return this.bend(p);
      case "name": return { t: "name", name: this.nameCard() };
      case "retarget": return this.retarget(p);
    }
    return PASS;
  }

  mulligan(p) {
    if (p.free) return { t: "mull" };
    const h = this.s.hand[this.me], n = h.filter(isLandId).length;
    if (this.easy) return n >= 1 && n <= 6 || p.taken >= 1 ? { t: "keep" } : { t: "mull" };
    const good = h.filter(id => !isLandId(id) && ["Memory Lapse", "Dandân", "Piracy Charm", "Mind Bend", "Brainstorm", "Predict"].includes(DECK[id])).length;
    // the first mulligan costs nothing (p.taken counts it), so each keep is one step pickier than when every mulligan
    // cost a card: after two, anything; after one, a seven that will be a six, two to five lands
    if (p.taken >= 3) return { t: "keep" };
    if (p.taken === 2) return n >= 2 && n <= 5 ? { t: "keep" } : { t: "mull" };
    // after the free one: two to five lands, and something to do with them
    if (p.taken === 1) return n >= 2 && n <= 5 && (good >= 1 || n >= 3) ? { t: "keep" } : { t: "mull" };
    // the first seven, a free mulligan to be had: three or four lands and something to do with them, or two or five
    // and two such spells
    return ((n === 3 || n === 4) && good >= 1) || ((n === 2 || n === 5) && good >= 2) ? { t: "keep" } : { t: "mull" };
  }
  /** The n cards of a hand we'd miss least: by worth, the lands weighed by how many we have. */
  worst(ids, n) {
    const F = this.F;
    return [...ids].sort((a, b) => cardWorth(F, a) - cardWorth(F, b) || a - b).slice(0, n);
  }
  /** What a card on top is worth to whoever draws it, from our side: ours to draw is good for us, theirs to draw is bad. */
  given(id, seat) { return seat === this.me ? cardWorth(this.F, id, this.me) : -cardWorth(this.F, id, this.opp); }
  /** Brainstorm's two back on top: the pair and order that keep most and give least, the top going to whoever draws next. */
  putback(p) {
    const s = this.s, F = this.F, hand = s.hand[this.me];
    if (this.easy) return { t: "putback", cards: this.worst(hand, p.n) };
    if (p.n === 1) return { t: "putback", cards: this.worst(hand, 1) };
    const d1 = F.next, d2 = other(d1);
    let best = null;
    for (let i = 0; i < hand.length; i++) for (let j = 0; j < hand.length; j++) {
      if (i === j) continue;
      const a = hand[i], b = hand[j];                             // a on top, b under it
      const v = -cardWorth(F, a) - cardWorth(F, b) + 0.9 * this.given(a, d1) + 0.75 * this.given(b, d2);
      if (!best || v > best.v) best = { v, cards: [a, b] };
    }
    return { t: "putback", cards: best.cards };
  }
  /** The top three in an order: each card to whoever will draw it (the next drawer, then the other, then the next again). */
  order(p) {
    const F = this.F, ids = p.cards;
    if (this.easy) return { t: "order", cards: shuffle(ids, this.rng) };
    const drawers = [F.next, other(F.next), F.next], w = [1, 0.85, 0.7];
    let best = null;
    for (const perm3 of permutations(ids)) {
      const v = sum(perm3.map((id, i) => w[i] * this.given(id, drawers[i])));
      if (!best || v > best.v) best = { v, cards: perm3 };
    }
    return { t: "order", cards: best.cards };
  }
  /** Surveil: kept on top if it's ours to draw and worth drawing, binned if it's theirs and worth something to them. */
  toYard(id) {
    const F = this.F;
    if (this.easy) return this.rng() < 0.4;
    return F.next === this.me ? cardWorth(F, id, this.me) < 0.8 : cardWorth(F, id, this.opp) >= 0.7;
  }
  /** A land from the library: an Island while there are Dandâns to keep; Mystic Sanctuary when it would come in untapped with a spell worth putting on top for us; Thundering Falls for red. */
  searchPick(p) {
    const s = this.s, F = this.F, me = this.me;
    const sanctFor = islands(s, me).length >= 3 && s.yard.some(id => DECK[id] === "Memory Lapse") && F.next === me;
    const wantsRed = [...s.hand[me], ...s.yard].some(id => DECK[id] === "Mystic Retrieval") && F.my.r === 0;
    // fetched onto the battlefield, an Island comes in untapped and Thundering Falls tapped: the Falls only for red
    const rank = id => {
      const n = DECK[id];
      if (n === "Mystic Sanctuary") return sanctFor ? 3 : p.to === "bf" && islands(s, me).length < 3 ? 0.5 : 1.5;
      if (n === "Thundering Falls") return p.to === "bf" ? (wantsRed ? 1.6 : 0.8) : wantsRed ? 2.5 : 1.4;
      return 2;
    };
    return [...p.ids].sort((a, b) => rank(b) - rank(a) || a - b)[0] ?? null;
  }
  pickFor(p) {
    const s = this.s, F = this.F, me = this.me;
    if (p.for === "boil") {
      // return a tapped land (its mana is spent) we can play again; never the last Island under a Dandân
      const needIsl = creatures(s, me).some(d => needType(d) === "Island");
      const isl = islands(s, me);
      const rank = id => {
        const l = perm(s, id);
        // the Boilerworks itself only when it's the one land (returning it is a land drop thrown away)
        let v = (l.tapped ? 0 : 3) + (nm(id) === "Izzet Boilerworks" ? 20 : 0);
        if (needIsl && isl.length <= 1 && isl.some(i => i.id === id)) v += 10;
        if (nm(id) === "Island") v -= 0.5;
        return v;
      };
      return [...p.ids].sort((a, b) => rank(a) - rank(b) || a - b)[0];
    }
    if (p.for === "drop") {
      // a Dandân when an Island will stand under it, else the Island it needs, else any land
      const hand = p.ids, isl = hand.find(id => (CARDS[DECK[id]].subs || []).includes("Island"));
      const d = hand.find(id => DECK[id] === "Dandân");
      if (d != null && islands(s, me).length > 0) return d;
      return isl ?? hand.find(isLandId) ?? null;
    }
    // Mystic Sanctuary: a spell on top for us if we draw next; for them, the one they'd least like (in place of a card at random)
    const ids = p.ids;
    if (F.next === me) {
      const best = [...ids].sort((a, b) => cardWorth(F, b) - cardWorth(F, a))[0];
      return cardWorth(F, best) >= 0.85 ? best : null;
    }
    const meh = [...ids].sort((a, b) => cardWorth(F, a, this.opp) - cardWorth(F, b, this.opp))[0];
    return meh != null && cardWorth(F, meh, this.opp) < 0.6 ? meh : null;
  }
  /** Our permanent into the library: second from the top when we'll draw the second card, else the bottom. */
  bottomOwn(p) {
    const F = this.F, t = perm(this.s, p.target);
    if (!t || hitWorth(F, t, other(t.ctl)) < 0.5) return true;
    return other(F.next) !== this.me;
  }
  /** Mind Bend: a Dandân told to look for a land type its controller has none of; an Island told to be one that makes nothing they need. */
  bend(p) {
    const s = this.s, t = perm(s, p.target);
    if (t && isCreature(t)) {
      const have = new Set(lands(s, t.ctl).flatMap(typesOf));
      const mine = t.ctl === this.me;
      const from = p.froms[0];
      // theirs: to a type they don't have (it dies); ours (to save it): to one we have
      const to = mine ? (BASICS.find(b => b !== from && have.has(b)) ?? BASICS.find(b => b !== from)) : (["Plains", "Forest", "Swamp", "Mountain", "Island"].find(b => b !== from && !have.has(b)) ?? BASICS.find(b => b !== from));
      return { t: "bend", from, to };
    }
    const from = p.froms.includes("Island") ? "Island" : p.froms[0];
    return { t: "bend", from, to: ["Swamp", "Plains", "Forest", "Mountain", "Island"].find(b => b !== from) };
  }
  nameCard() {
    const F = this.F;
    if (F.known != null) return DECK[F.known];
    return NAMES.reduce((best, n) => (unseenOf(F, n) > unseenOf(F, best) ? n : best), NAMES[0]);
  }
  retarget(p) {
    const s = this.s, F = this.F, me = this.me, copy = itemOf(s, p.copy);
    const value = t => {
      if (!copy) return 0;
      const probe = { ...copy, ctl: me, targets: [t] };
      if (t.k === "s") {
        const y = itemOf(s, t.sid);
        if (!y) return -5;
        if (y.name === "Narset's Reversal" && y.ctl === me) return 0.05;   // the resolving Reversal: the copy fizzles harmlessly
        return copy.name === "Narset's Reversal" ? 0 : (y.ctl === me ? -spellWorth(F, y) : spellWorth(F, y));
      }
      return spellWorth(F, probe);
    };
    let best = null;
    for (const o of p.options) { const v = value(o[0]); if (!best || v > best.v) best = { v, o }; }
    const keep = copy ? spellWorth(F, { ...copy, ctl: me }) : 0;
    return best && best.v > keep ? { t: "retarget", targets: best.o } : { t: "retarget" };
  }

  // ===== combat =====
  attacks(p) {
    const s = this.s, F = this.F, me = this.me;
    const mine = p.ids.map(id => perm(s, id)).filter(Boolean);
    if (this.easy) return { t: "attack", ids: mine.map(d => d.id) };
    const life = s.life[me], theirLife = s.life[this.opp];
    // what can hit us back on their turn: their Dandâns that will be able to attack us (we hold their land type)
    const back = F.theirs.filter(d => islandsOfType(s, me, needType(d)) > 0);
    const backDamage = sum(back.map(d => Math.max(0, pt(d)[0])));
    const blockers = F.theirs.filter(d => !d.tapped).length;
    // keep home enough to block a lethal swing back (each blocker stops one)
    let home = 0;
    while (home < mine.length && backDamage - 4 * home >= life) home++;
    const go = mine.slice(0, mine.length - home);
    if (!go.length) return { t: "attack", ids: [] };
    const power = sum(go.map(d => pt(d)[0]));
    // lethal through every block, or more attackers than blockers: go
    if (power - 4 * blockers >= theirLife || go.length > blockers) return { t: "attack", ids: go.map(d => d.id) };
    // as many blockers as attackers: every block is a trade; go when we aren't behind in the race (cards and life)
    const ahead = life - theirLife + 3 * (F.mine.length - F.theirs.length) + 1.5 * (s.hand[me].length - s.hand[this.opp].length);
    return { t: "attack", ids: ahead >= 0 ? go.map(d => d.id) : [] };
  }
  blocks(p) {
    const s = this.s, F = this.F, me = this.me;
    const att = p.attackers.map(id => perm(s, id)).filter(Boolean).sort((a, b) => pt(b)[0] - pt(a)[0]);
    const free = p.blockers.map(id => perm(s, id)).filter(Boolean);
    const life = s.life[me];
    let incoming = sum(att.map(a => Math.max(0, pt(a)[0])));
    // the race: their attackers stay tapped through our turn, so if we live through this and our Dandâns can then
    // finish them past the blockers they kept back, we take it and swing back
    if (!this.easy && incoming < life) {
      const ours = F.mine.filter(d => islandsOfType(s, this.opp, needType(d)) > 0);
      const theirBlockers = F.theirs.filter(d => !s.combat?.att.includes(d.id)).length;
      const through = sum(ours.map(d => Math.max(0, pt(d)[0])).sort((a, b) => b - a).slice(theirBlockers));
      if (through >= s.life[this.opp]) return { t: "block", pairs: [] };
    }
    const pairs = [];
    for (const a of att) {
      if (!free.length) break;
      const lethal = incoming >= life;
      // a Dandân for a Dandân is even: take the trade when the damage hurts, or we're behind on the table
      const want = this.easy ? lethal : lethal || life - incoming <= 8 || F.theirs.length >= F.mine.length || life <= s.life[this.opp];
      if (!want) continue;
      pairs.push([free.shift().id, a.id]);
      incoming -= Math.max(0, pt(a)[0]);
    }
    return { t: "block", pairs };
  }

  // ===== priority =====
  /** Every move it would consider now, scored (in cards against passing): what Hard plays out, the best first. */
  scored() {
    const list = moves(this.s, this.me), out = [];
    for (const m of list) out.push({ m, v: this.score(m) });
    out.sort((a, b) => b.v - a.v);
    return out;
  }
  priority() {
    const list = moves(this.s, this.me);
    if (!list.length) return PASS;
    if (this.easy && this.rng() < 0.12) return this.rng() < 0.4 ? PASS : pickOne(list, this.rng);
    let best = PASS, top = 0.05;
    for (const m of list) {
      let v = this.score(m);
      if (this.easy) v += (this.rng() - 0.5) * 0.8;
      if (v > top) { best = m; top = v; }
    }
    return best;
  }
  score(m) {
    switch (m.t) {
      case "land": return this.scoreLand(m);
      case "cast": return this.scoreCast(m);
      case "cycle": return this.scoreCycle(m);
      case "ability": return this.scoreAbility(m);
    }
    return 0;
  }

  // ----- when -----
  get stack() { return this.s.stack.length > 0; }
  /** The end of their turn, nothing on the stack: our lands untap next, so whatever is open is free to spend. */
  get theirEnd() { return !this.stack && !this.F.myTurn && this.s.step === "end"; }
  get myMain() { return !this.stack && this.F.myTurn && (this.s.step === "main1" || this.s.step === "main2"); }
  /**
   * The mana to keep open now: two for a Memory Lapse (or a Reversal) we hold, unless it's the end of their turn; and
   * one for a removal spell while one of their Dandâns could attack us.
   */
  reserve(exclude = null) {
    if (this.easy || this.theirEnd) return 0;
    const s = this.s, F = this.F, hand = s.hand[this.me].filter(id => id !== exclude).map(id => DECK[id]);
    let r = hand.includes("Memory Lapse") || hand.includes("Narset's Reversal") ? 2 : 0;
    if ((hand.includes("Piracy Charm") || hand.includes("Mind Bend")) && F.theirs.some(d => islandsOfType(s, this.me, needType(d)))) r += 1;
    return r;
  }
  /** What spending `mana` now costs us in answers we can't make later: nothing within the spare, more the more of the reserve it eats. */
  manaCost(mana, exclude = null) {
    const left = this.F.my.n - mana, res = this.reserve(exclude);
    if (left >= res) return 0;
    return 0.45 * Math.min(res, res - left) * (this.F.myTurn ? 1 : 0.8);
  }

  scoreLand(m) {
    const s = this.s, F = this.F, me = this.me, n = DECK[m.card], d = CARDS[n];
    const have = lands(s, me).length;
    let v = 2;
    if (n === "Izzet Boilerworks" && have < 1) return 0.2;          // it would return itself
    if (d.cycling && landCount(F, me) >= 6) v -= 1.6;                // flooded: cycle it instead
    const tapped = d.tapped && !(n === "Mystic Sanctuary" && F.myIsl >= 3);
    // the mana this turn, and through their turn (lands untap only on ours): what we'd cast now (a spell one more would
    // pay for) or keep open (reserve). A land that comes in untapped adds one, a tapped one none (best played when we
    // don't need it), and Izzet Boilerworks returning an untapped land (none of ours tapped) takes one away
    const needNow = s.hand[me].some(id => {
      if (isLandId(id)) return false;
      const c = total(costOf(s, me, front(id), "hand"));
      return c === F.my.n + 1;
    });
    const want = Math.max(this.reserve(), needNow ? F.my.n + 1 : 0);
    const after = F.my.n + (tapped ? 0 : 1) - (n === "Izzet Boilerworks" && !lands(s, me).some(l => l.tapped) ? 1 : 0);
    v += 0.35 * (Math.min(want, after) - Math.min(want, F.my.n));
    if (tapped && want <= F.my.n) v += 0.15;
    const isl = (d.subs || []).includes("Island");
    const ownDandans = F.mine.length + s.hand[me].filter(id => DECK[id] === "Dandân").length;
    if (isl) {
      // an Island keeps our Dandâns; it also lets theirs attack us: without Dandâns of our own, a land that isn't an Island is safer
      if (ownDandans && F.myIsl < 3) v += 0.35;
      if (!ownDandans && F.theirs.length && F.myIsl === 0) v -= 0.6;
    }
    if (n === "Halimar Depths" && !needNow) v += 0.1;
    if (n === "Izzet Boilerworks") v += have >= 2 ? 0.15 : -0.3;
    if (n === "Mystic Sanctuary" && !tapped) {
      const lapse = s.yard.some(id => DECK[id] === "Memory Lapse");
      v += lapse && this.canDrawFirst() ? 0.4 : -0.05;
    }
    if (this.easy) v += (this.rng() - 0.5) * 0.6;
    return v;
  }
  /** Whether we could draw the top card before the other player on our own turn: an instant that draws, and the mana for it after a land. */
  canDrawFirst() {
    const s = this.s, me = this.me;
    return s.hand[me].some(id => ["Brainstorm", "Quicken", "Predict"].includes(DECK[id]) || CARDS[front(id)].cycling);
  }
  scoreCycle(m) {
    const s = this.s, F = this.F, me = this.me, n = DECK[m.card], d = CARDS[front(m.card)];
    const mana = d.cycling === "{2}" ? 2 : 1;
    if (n === "Lórien Revealed") {
      // islandcycling: a land when we're short of one (and the search shuffles the library)
      const short = landCount(F, me) < 4 && !s.hand[me].some(id => id !== m.card && isLandId(id));
      const mix = this.reshuffle();
      if (!short && mix < 0.3) return -0.5;
      return (short ? 0.9 : 0) + mix - this.manaCost(mana) + (this.theirEnd ? 0.1 : 0) - (F.myTurn && !this.myMain ? 0.2 : 0);
    }
    // a cycling land: worth more drawn than played when we have lands enough; best spent at the end of their turn, or
    // in their upkeep to draw a top card we know before they can
    const asLand = cardWorth(F, m.card);
    let v = 0.95 - asLand - this.manaCost(mana) + this.steal();
    if (!this.theirEnd && !this.steal()) v -= 0.25;
    return v;
  }
  /**
   * What drawing the top card first is worth at the other player's upkeep, when we know it: ours to keep and theirs no
   * longer, against the card at random each would otherwise get. (Nothing at any other moment.)
   */
  steal() {
    const s = this.s, F = this.F;
    if (s.step !== "upkeep" || F.myTurn || F.known == null || this.stack) return 0;
    return cardWorth(F, F.known, this.me) + cardWorth(F, F.known, this.opp) - 1.7;
  }
  /** What shuffling the library away is worth now: a known top card that is good for the one who draws it next, from our side. */
  reshuffle() {
    const F = this.F;
    if (F.known == null) return 0;
    return F.next === this.me ? 0.85 - cardWorth(F, F.known, this.me) : cardWorth(F, F.known, this.opp) - 0.85;
  }
  scoreAbility(m) {
    const s = this.s, F = this.F, p = perm(s, m.id);
    if (!p) return 0;
    if (nm(p.id) === "Flood Plain") {
      // a free Island (untapped for our turn); it shuffles, which loses a top card we know is ours to draw, or takes
      // a good one away from them
      const mix = this.reshuffle();
      if (mix < -0.2) return mix - 0.2;
      if (mix > 0.2) return 0.4 + mix;
      return this.theirEnd || (this.myMain && islands(s, this.me).length === 0 && F.mine.length) ? 0.5 : this.myMain ? 0.2 : -0.1;
    }
    if (nm(p.id) === "Clue") return (this.theirEnd ? 0.75 : 0.1) + this.steal() - this.manaCost(2) - (this.F.myTurn ? 0.3 : 0);
    return 0;
  }

  /** A cast: what the spell does for us, less what it leaves the other player in the graveyard. */
  scoreCast(m) {
    const s = this.s, me = this.me;
    const half = m.from === "yard" ? halfOf(m.card, "yard") : front(m.card);
    const mana = total(costOf(s, me, half, m.from));
    const v = this.castWorth(m, half, mana);
    return v > -0.9 ? v - this.gift(this.yardAfter(m, half), mana, m.from === "hand" ? m.card : null) : v;
  }
  castWorth(m, half, mana) {
    const s = this.s, F = this.F, me = this.me;
    const t0 = m.targets[0];
    const keep = m.from === "yard" ? 0 : KEEP * cardWorth(F, m.card);
    const pay = this.manaCost(mana, m.from === "hand" ? m.card : null);
    switch (half) {
      case "Dandân": return this.castDandan(keep, pay);
      case "Memory Lapse": case "Narset's Reversal": case "Commit": {
        if (t0?.k === "s") return this.counter(half, itemOf(s, t0.sid), keep, pay);
        return half === "Commit" ? this.removal(half, m, keep, pay) : -1;
      }
      case "Piracy Charm": case "Mind Bend": case "Repulse": case "Metamorphose": case "Gone Missing": case "Deem Inferior":
        return this.removal(half, m, keep, pay);
      case "Brainstorm": {
        // best at the end of their turn (two cards back for our draw), or in their upkeep (two of our choosing for theirs)
        let v = 0.8 - keep - pay + this.steal();
        if (this.theirEnd) v += 0.25;
        else if (s.step === "upkeep" && !F.myTurn) v += 0.3;
        else if (this.stack) v -= 0.2;
        else v -= this.easy ? 0 : 0.5;
        return v;
      }
      case "Predict": {
        // a top card we know: name it and draw two; one that's theirs to draw and good for them: mill it
        let v = (F.known != null ? 1.7 : 0.95) - keep - pay;
        if (F.known != null && F.next === this.opp) v += 0.6 * cardWorth(F, F.known, this.opp);
        if (F.known != null && F.next === me) v -= cardWorth(F, F.known);   // it mills the card we'd draw
        if (!this.theirEnd && !(s.step === "upkeep" && !F.myTurn)) v -= this.easy ? 0 : 0.45;
        return v;
      }
      case "Quicken": {
        // a cantrip, or a sorcery at instant speed: at the end of their turn, with a sorcery to follow it
        const sorc = s.hand[me].filter(id => id !== m.card && CARDS[front(id)].type === "sorcery").map(id => total(costOf(s, me, front(id), "hand")));
        const follow = sorc.length && F.my.n - mana >= Math.min(...sorc);
        let v = 0.55 - keep - pay + (follow && this.theirEnd ? 0.8 : 0) + this.steal();
        if (!this.theirEnd && !this.steal()) v -= this.easy ? 0 : 0.4;
        return v;
      }
      case "Chart a Course": case "Take Inventory": case "Lórien Revealed": {
        const w = half === "Lórien Revealed" ? 2.5 : half === "Take Inventory" ? 1 + s.yard.filter(i => DECK[i] === half).length : (s.attacked && F.myTurn ? 1.8 : 1.05);
        let v = w - keep - pay;
        // after the attack it draws two with no discard: wait for it when there's an attack to make
        if (half === "Chart a Course" && this.myMain && s.step === "main1" && F.mine.some(d => !d.tapped && d.ent < s.turn) && F.theirIsl > 0) v -= 0.6;
        // a sorcery cast on our own turn, if countered, goes on top for them
        if (F.myTurn) v -= counterRisk(F, half) * (w * 0.4 + cardWorth(F, m.card, this.opp) * 0.5);
        return v;
      }
      case "Mystic Retrieval": {
        if (!t0) return -1;
        // what it finds: the card, or what it does cast at once with the mana left (a Piracy Charm on their Dandân): an
        // instant any time, a sorcery in our own main phase
        const w = cardWorth(F, t0.id), flash = m.from === "yard" ? 0.15 : 0;
        const at = CARDS[front(t0.id)]?.type === "instant" || this.myMain;
        const now = at ? answerWorth(F, t0.id, me, F.my.n - mana) * (1 - 0.6 * counterRisk(F, front(t0.id))) : 0;
        if (now > w) return now - 0.35 - keep - this.manaCost(mana + total(costOf(s, me, front(t0.id), "hand")), m.from === "hand" ? m.card : null) + flash;
        return w - 0.35 - keep - pay + flash;
      }
      case "Memory": {
        const a = s.hand[me].length, b = s.hand[this.opp].length;
        return 0.85 * (b - a) - 0.6 - pay;
      }
    }
    return -1;
  }

  // ----- the graveyard both players share -----
  /** The graveyard once a spell of ours has resolved: an instant or sorcery from the hand in it, a flashback exiled, a Retrieval's card gone, Memory's all of it. */
  yardAfter(m, half) {
    const s = this.s, t0 = m.targets[0], type = CARDS[half]?.type;
    if (half === "Memory") return [];
    let y = s.yard;
    if (m.from === "yard") y = y.filter(id => id !== m.card);
    if (half === "Mystic Retrieval" && t0?.k === "g") y = y.filter(id => id !== t0.id);
    if (m.from === "hand" && (type === "instant" || type === "sorcery")) y = [...y, m.card];
    return y;
  }
  /**
   * What a move leaving the graveyard as `after` gives the other player there, against what it has for them now, in
   * cards: the best card their Mystic Retrieval would find (a Piracy Charm with the mana to cast it on our Dandân, a
   * Dandân's worth), flashed back with their red or cast from their hand. Negative when we take away what they'd find.
   * Our Memory Lapse with two left open on their turn may counter the Retrieval; spent on their turn, ours comes first.
   */
  gift(after, spend = 0, exclude = null) {
    return this.easy ? 0 : this.giftOf(after, spend, exclude).v;
  }
  /** gift's working: { v, after, before } (after and before: yardPick's for them). */
  giftOf(after, spend = 0, exclude = null) {
    const s = this.s, F = this.F, opp = this.opp;
    // what they could find now, worked out once for the decision; after a move, only when they could find anything
    this.yardNow ??= (() => {
      const mana = landMana(s, opp) + (s.hand[opp].length >= 2 ? 1 : 0), inHand = holds(F, "Mystic Retrieval");
      return { mana, inHand, red: hasRed(s, opp), pick: yardPick(F, s.yard, opp, mana, inHand) };
    })();
    const { mana, inHand, red, pick: b } = this.yardNow;
    const could = (red && mana >= 3 && after.some(id => DECK[id] === "Mystic Retrieval")) || (inHand > 0.01 && mana >= 4);
    const a = could ? yardPick(F, after, opp, mana, inHand) : { v: 0, id: null, kill: false, flash: false }, g = a.v - b.v;
    if (Math.abs(g) < 0.05) return { v: 0, after: a, before: b };
    const lapse = s.hand[this.me].some(id => id !== exclude && DECK[id] === "Memory Lapse");
    const guard = lapse && (F.myTurn ? F.my.n - spend : 2) >= 2 ? 0.5 : 1;
    return { v: g * guard * (F.myTurn ? 1 : 0.6), after: a, before: b };
  }

  /** A Dandân cast now: what it's worth in against the chance it's countered and goes on top for them to draw. */
  castDandan(keep, pay) {
    const s = this.s, F = this.F, me = this.me;
    const w = newDandanWorth(s, me);
    if (w <= 0) return -3;
    let p = counterRisk(F, "Dandân");
    // two more open for our own Lapse: their counter can be countered
    if (!this.easy && s.hand[me].some(id => DECK[id] === "Memory Lapse") && F.my.n >= 4) p *= 0.35;
    if (this.easy) p *= 0.3;
    // countered on our turn, it goes on top and they draw it: our card gone and theirs gained, their Lapse spent
    const lost = 1.4 + 1.4 - 1.1;
    let v = (1 - p) * w - p * lost - keep * 0.6 - pay;
    if (s.step === "main1" && F.mine.some(d => !d.tapped && d.ent < s.turn) && F.theirIsl) v -= 0.1;   // after the attack
    return v;
  }

  /** A counter (Memory Lapse, Commit, Narset's Reversal) on a spell on the stack. */
  counter(half, x, keep, pay) {
    const s = this.s, F = this.F, me = this.me;
    if (!x) return -1;
    if (half === "Narset's Reversal") return this.reversal(x, keep, pay);
    if (x.ctl === me) return -3;
    let gain = spellWorth(F, x);
    if (!x.copy) {
      // where the countered card goes: on top (Lapse) to whoever draws next; second from the top (Commit) to the one after
      const to = half === "Memory Lapse" ? F.next : other(F.next);
      gain += to === me ? cardWorth(F, x.card, me) * 0.9 : 0.35;
    }
    if (this.easy) return gain - 0.5;
    return gain - keep - pay * 0.5 - (half === "Commit" ? 0.2 : 0);
  }
  /** Narset's Reversal on a spell: theirs goes back to their hand and we get a copy; ours, a copy and the card back. */
  reversal(x, keep, pay) {
    const F = this.F, me = this.me;
    if (x.ctl === me) {
      const again = ["Lórien Revealed", "Take Inventory", "Chart a Course", "Memory Lapse"].includes(x.name) ? cardWorth(F, x.card) : 0;
      return again - keep - pay;
    }
    if (x.name === "Memory") return -1;
    // theirs doesn't resolve; the copy is ours: a draw spell draws for us, a removal or counter finds another target or none
    let copy = 0;
    if (["Brainstorm", "Predict", "Quicken", "Chart a Course", "Take Inventory", "Lórien Revealed", "Mystic Retrieval"].includes(x.name)) copy = 0.8 * Math.abs(spellWorth(F, x));
    else if (["Piracy Charm", "Mind Bend", "Repulse"].includes(x.name) && F.theirs.length) copy = 0.7 * Math.max(...F.theirs.map(d => dandanWorth(this.s, d)));
    return spellWorth(F, x) + copy - keep - pay * 0.5;
  }

  /**
   * A spell that takes something away (or Piracy Charm's other modes): what it does now, by target and moment. A kill
   * (+2/−1, Mind Bend) is for good; Deem Inferior is one too, cast on our turn (its owner bottoms it rather than give us
   * the second card); the rest are a delay, a Dandân recast and sick for a turn, the card going to whoever draws it next
   * (on our turn they draw their own card back instead of a new one). The worse their next attack would hurt, the more
   * an answer is worth now; and while they're tapped out on our turn, nothing can counter it, which their turn won't be.
   */
  removal(half, m, keep, pay) {
    const s = this.s, F = this.F, me = this.me, t0 = m.targets[0];
    if (half === "Piracy Charm" && m.mode === 2) {
      // a discard: worth it on a small hand, at the end of their turn
      const n = s.hand[this.opp].length;
      return n && n <= 3 && (this.theirEnd || this.easy) ? 0.95 - 0.1 * n - keep - pay : -1;
    }
    const p = t0?.k === "c" ? perm(s, t0.id) : null;
    if (!p) return -1;
    if (half === "Piracy Charm" && m.mode === 0) {
      // islandwalk for our attacker when they have a blocker that could stop it
      const ours = p.ctl === me && s.combat?.att.includes(p.id) && s.step === "attackers";
      return ours && F.theirs.some(d => !d.tapped) && F.theirIsl ? 1.0 - keep - pay : -1;
    }
    if (half === "Repulse" && p.ctl === me) return this.saveOwn(p, keep, pay);
    if (p.ctl === me) return -3;
    if (isLand(p) && (half === "Metamorphose" || half === "Gone Missing") && !this.easy) return this.landRemoval(half, p, keep, pay);
    let hit;
    if (half === "Mind Bend") hit = isCreature(p) ? hitWorth(F, p, me) : landHit(s, p, true);
    else hit = isLand(p) ? 0.45 + landDandans(s, p) : hitWorth(F, p, me);    // Easy: a land is a land, whatever their mana
    let v = hit * (STAYS[half] ?? 0.7);
    if (this.easy) return isCreature(p) || hit > 0 ? v - 0.3 : -1;
    if (hit <= 0.2 && !["Gone Missing", "Metamorphose"].includes(half)) return -1;
    // where the card goes: on top (Metamorphose, Gone Missing) to whoever draws next, who if it's them draws their own
    // card back in place of a new one; second from the top (Commit) to the one after
    const owner = p.ctl;
    if (["Metamorphose", "Gone Missing"].includes(half) && !isToken(p.id)) v += F.next === me ? 0.8 * cardWorth(F, p.id) : F.next === owner ? 0.45 : 0;
    if (half === "Commit" && !isToken(p.id)) v += other(F.next) === me ? 0.7 * cardWorth(F, p.id) : 0.2;
    if (half === "Metamorphose") v -= 0.6 * holds(F, "Dandân") * (islands(s, this.opp).length ? 1 : 0.3);
    if (half === "Repulse") v += 0.9;
    if (half === "Gone Missing") v += 0.5;
    if (hit <= 0.2 && v < 0.6) return -1;
    if (isCreature(p)) {
      // the attack it would make on us next: answered now (killed, or recast and sick for a turn), it never lands
      const canHit = islandsOfType(s, me, needType(p)) > 0;
      if (canHit) v += hitValue(s.life[me]) * (STAYS[half] >= 0.95 ? 0.5 : 1);
      const attacking = s.combat?.att.includes(p.id) && !F.myTurn;
      const riskNow = this.stack ? 0 : counterRisk(F, half);
      const riskLater = F.myTurn ? Math.min(0.9, 0.9 * holds(F, "Memory Lapse")) : riskNow;
      if (attacking) v += 0.5 + 0.15 * (20 - s.life[me]) / 4;
      else if (this.theirEnd) v += 0.1;
      else if (F.myTurn && s.step === "attackers" && s.combat?.att.length) v += 0.2;
      else if (F.myTurn && riskLater - riskNow > 0.2) v += 0.3 * (riskLater - riskNow) * v;   // they're tapped out now; on their turn they won't be
      // an instant waits for its moment (their attack, the end of their turn); a sorcery's next is our next turn, after their attack
      else if (CARDS[half].type !== "sorcery") v -= 0.35;
    } else if (!this.theirEnd && !(F.myTurn && this.myMain)) v -= 0.2;
    // casting into open mana invites a counter (on our turn the card then goes to them)
    if (!this.stack) v -= counterRisk(F, half) * (0.6 * v + (F.myTurn ? 0.4 : 0));
    return v - keep - pay;
  }
  /**
   * Metamorphose or Gone Missing on a land of theirs: what it does to their mana and who gets the card (landAway), less
   * a Dandân Metamorphose would let them put down free. Its moment: the end of their turn (we draw it), our main phase,
   * or now, before a Boilerworks of theirs on the stack brings the land it returns to their hand, from where Metamorphose
   * would let them put it straight back down.
   */
  landRemoval(half, p, keep, pay) {
    const s = this.s, F = this.F;
    let v = landAway(F, p, half, this.me);
    if (half === "Metamorphose") v -= 0.6 * holds(F, "Dandân") * (islands(s, p.ctl).some(l => l.id !== p.id) ? 1 : 0.3);
    else v += 0.5;                                                     // Gone Missing's Clue
    const boil = s.stack.some(x => x.name === "@boil" && x.ctl === p.ctl);
    if (!boil && !this.theirEnd && !(F.myTurn && this.myMain)) v -= 0.2;
    // casting into open mana invites a counter (a land's trigger on the stack leaves their mana as it was)
    if (s.stack.every(x => x.kind === "trigger")) v -= counterRisk(F, half) * (0.6 * Math.max(0, v) + (F.myTurn ? 0.4 : 0));
    return v - keep - pay;
  }
  /** Repulse on our own Dandân in answer to something aimed at it: it's saved to our hand, and we draw. */
  saveOwn(p, keep, pay) {
    const aimed = this.s.stack.some(x => x.ctl !== this.me && x.targets.some(t => t.k === "c" && t.id === p.id) && !["Narset's Reversal"].includes(x.name));
    return aimed && isCreature(p) ? 0.55 * dandanWorth(this.s, p) + 0.9 - keep - pay : -1;
  }
}

/** What one more Dandân hit (4 life) costs at a life total, in cards: little at 20, everything at 4. */
export function hitValue(life) {
  const h = Math.max(1, Math.ceil(life / 4));
  return h <= 1 ? 4 : 3 / h;
}
/** How many lands of a type a seat controls. */
function islandsOfType(s, seat, type) { return s.bf.filter(l => l.ctl === seat && isLand(l) && typesOf(l).includes(type)).length; }
/** Every order of a few cards. */
function permutations(a) {
  if (a.length <= 1) return [a.slice()];
  const out = [];
  a.forEach((x, i) => { for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...rest]); });
  return out;
}

/** The player's move: an answer to the question put to it, or the best thing to do with priority (passing if nothing is worth it). */
export function policyMove(s, seat, { rng = Math.random, level = "medium" } = {}) {
  const p = new Player(s, seat, { level, rng });
  return s.pending ? p.answer() : p.priority();
}
