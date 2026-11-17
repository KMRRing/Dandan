// Scry 1.2 (16 Nov 2026, Korbi 15:47: "the best improvement and the most adaptable for the general solution"): the belief net
// rebuilt on the raw record. Scry 1 read the other player's play through 25 numbers someone chose (13 counters, 12 facts a
// card); Scry 1.2 reads the record itself, one event a move, and learns what to make of it. And it deals whole hands: each
// unknown card's odds are conditioned on the cards already dealt before it (autoregressive, as Learned Belief Search, Hu et
// al. 2021), so "at least one counter" or "no land at all" holds for the hand, not card by card.
//
// An event (EV_N numbers, raw facts only): whose it was (them or me), the kind (a move, a pass at a priority point, cards drawn),
// the step, whether it was their turn, the stack, both players' untapped lands, hand sizes, library, turn, life, the card named
// if the move shows one (a spell cast, a land played, a card cycled), whether it targets a spell, how many cards were drawn.
// Each event is embedded by a small layer learned with the rest, e = ReLU(We·ev + be), and the record is read through three
// windows of those embeddings, summed: the whole game, the last two turns, and this turn. With the board (the extended view),
// five facts of the hand (cards they drew this turn and last, hand size, cards played this turn, mulligans) and the names
// already dealt to the cards before it, a hidden layer gives a card's odds by name: softmax(log of the copies unseen + net).
// The record is honest (Record12): nothing in it depends on where the engine stopped to ask.
// Untrained (W2 = 0) it is the unseen pool's odds, as Scry 1. Trained by lab/zero/scry12_np.py on lab/zero/scry12-pack.mjs's rows.
//
// In Zero it plugs in where Scry 2 does (makeZero's filterOf): update() after every move, belief() the counts and the chance
// of at least one of each name for the policy's input (each card's odds with nothing dealt before it), deal() whole hands.
import { DECK, NAMES } from "../../dandan-cards.js";
import { isLandId } from "../../dandan-core.js";
import { EXT_N, NN, ext, seenBy, unknownSlots } from "./zero-view.mjs";
import { observe } from "../../dandan-view.js";

const other = x => 1 - x, NAME_AT = new Map(NAMES.map((n, k) => [n, k]));
const STEPS = ["mull", "upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end", "over"];
const TYPES = ["pass", "cast", "land", "cycle", "ability", "attack", "block", "mull", "keep", "hide", "other", "draw"];   // hide: put back, bottom, discard
const TYPE_AT = { pass: 0, cast: 1, land: 2, cycle: 3, ability: 4, attack: 5, block: 6, mull: 7, keep: 8, putback: 9, bottom: 9, discard: 9, draw: 11 };
const CTX = 11, T0 = 1, S0 = T0 + TYPES.length, C0 = S0 + STEPS.length, N0 = C0 + CTX;
export const EV_N = N0 + NN + 2;    // 1 + 12 + 10 + 11 + 25 + 2 = 61
export const BX12 = EXT_N + 1, SB_N = 5, HANDS = 1024;   // dealt hands a belief (Fable 21:15: 48 left a 50% chance ±7 points; 1,024 ±1.6)
const lcg = x => () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
const untapped = (s, x) => s.bf.reduce((a, p) => a + (p.ctl === x && !p.tapped && p.id < DECK.length && isLandId(p.id) ? 1 : 0), 0);
const nameOf = id => (id != null && id >= 0 && id < DECK.length ? NAME_AT.get(DECK[id]) ?? -1 : -1);
const LAND = NAMES.map(n => isLandId(DECK.indexOf(n)));
const played = m => m.t === "land" || (m.t === "cast" && m.from === "hand") || m.t === "cycle";

/** One event as seen by `me`: `s` the position it happened in, `who` whose it was, `m` the move (or { t: "pass" } at a priority
 *  point, { t: "draw", n } for cards drawn). Every number is the position's or the event's own. */
export function eventOf(s, who, m, me, out = new Float32Array(EV_N)) {
  s = observe(s, me);   // only what `me` sees (dandan-view.js); the move's own fields read are public (its kind, a card it shows)
  out.fill(0);
  out[0] = who === other(me) ? 1 : 0;
  out[T0 + (TYPE_AT[m.t] ?? 10)] = 1;
  const st = STEPS.indexOf(s.mull && !(s.mull.done?.[0] && s.mull.done?.[1]) ? "mull" : s.step);
  if (st >= 0) out[S0 + st] = 1;
  const top = s.stack[s.stack.length - 1];
  out[C0] = s.active === who ? 1 : 0;
  out[C0 + 1] = s.stack.length ? 1 : 0;
  out[C0 + 2] = top && top.ctl !== who && top.kind === "spell" ? 1 : 0;
  out[C0 + 3] = Math.min(6, untapped(s, who)) / 6; out[C0 + 4] = Math.min(6, untapped(s, other(who))) / 6;
  out[C0 + 5] = Math.min(10, s.hand[who].length) / 10; out[C0 + 6] = Math.min(10, s.hand[other(who)].length) / 10;
  out[C0 + 7] = Math.min(80, s.lib.length) / 80; out[C0 + 8] = Math.min(40, s.turn || 0) / 40;
  out[C0 + 9] = Math.max(0, Math.min(20, s.life?.[who] ?? 20)) / 20; out[C0 + 10] = Math.max(0, Math.min(20, s.life?.[other(who)] ?? 20)) / 20;
  const k = m.t === "cast" || m.t === "land" || m.t === "cycle" ? nameOf(m.card) : m.t === "ability" ? nameOf(m.id) : -1;
  if (k >= 0) out[N0 + k] = 1;
  out[N0 + NN] = m.targets?.some(t => t.k === "s") ? 1 : 0;
  out[N0 + NN + 1] = m.t === "draw" ? Math.min(4, m.n) / 4 : 0;
  return out;
}

/**
 * The record as `me` has seen it, honest by construction (16 Nov 2026, Fable's review items 6-7 and his note on the honest
 * record): nothing in it depends on where the engine stopped to ask, which depends on the hidden hand. Its events are every
 * move but a pass of priority, then what the move led to in the order it happened (the state's passPoints, dandan-rules.js):
 * a pass event at every priority point the engine notes, asked or not, and a draw event at every draw. Each event keeps its
 * own turn, and the windows are found from those turns; the hand's facts are the position's own. The hand is a set: every
 * unknown card gets the same facts and the same window ("this turn"), none is followed by its id.
 */
export class Record12 {
  constructor(me) { this.me = me; this.events = []; this.turns = []; this.drew = []; this.plays = []; }
  push(s, who, m) {
    const them = other(this.me);
    this.events.push(eventOf(s, who, m, this.me)); this.turns.push(s.turn || 0);
    this.drew.push(who === them && m.t === "draw" ? m.n : 0); this.plays.push(who === them && played(m) ? 1 : 0);
  }
  /** After every move: `s` the position it was made in, `who` who made it, `m` the move, `after` the position it led to. */
  update(s, who, m, after) {
    if (m.t !== "pass" || s.pending) this.push(s, who, m);   // a pass of priority is read where the engine notes it, asked or not
    for (const p of after.passPoints || []) this.push(p.s, p.seat, p.draw ? { t: "draw", n: p.draw } : { t: "pass" });
  }
  /** Where the events of turn `t` and after begin. */
  from(t) { let i = this.turns.length; while (i > 0 && this.turns[i - 1] >= t) i--; return i; }
  /** Where the last two turns began, and where this turn did (every unknown card's own window). */
  recent(s) { return this.from((s.turn || 0) - 1); }
  thisTurn(s) { return this.from(s.turn || 0); }
  /** The hand's facts (SB_N), the same for every unknown card: cards they drew this turn and last, hand size, cards they played
   *  this turn, mulligans. */
  slotFacts(s, out = new Float32Array(SB_N)) {
    const them = other(this.me), t = s.turn || 0, a = this.from(t - 1), b = this.from(t);
    let last = 0, now = 0;
    for (let i = a; i < b; i++) last += this.drew[i];
    for (let i = b; i < this.events.length; i++) now += this.plays[i];
    out[0] = Math.min(4, s.drawn?.[them] || 0) / 4; out[1] = Math.min(4, last) / 4; out[2] = Math.min(10, s.hand[them].length) / 10;
    out[3] = Math.min(4, now) / 4; out[4] = Math.min(3, s.mull?.n?.[them] || 0) / 3;
    return out;
  }
}

/** The position's own input (BX12): the extended view with only what `me` knows of the other hand, and the unknown count. */
export function input12(s, me, seen = seenBy(s, me), out = new Float32Array(BX12)) {
  out.set(ext(s, me, seen.known, new Float32Array(EXT_N), seen.unseen), 0);
  out[EXT_N] = seen.unknown / 7;
  return out;
}

/**
 * A trained Scry 1.2 (lab/zero/scry12_np.py: { D, H, EV_N, BX, SB_N, NN, We, be, Wx, Wa, Wt, Wb, Ws, Wc, b1, W2, b2 }) as a
 * filter for seat `me` in makeZero's filterOf: update after each move, belief(s) (counts, any), deal() a whole-hand dealer.
 */
export class Scry12 {
  /** hands: whole hands dealt a belief (HANDS; the packer may deal fewer, Fable 20:45Z: 256 packs four times as fast) */
  constructor(me, net, { hands = HANDS } = {}) {
    const F = a => Float32Array.from(a);
    this.me = me; this.n = net; this.rec = new Record12(me); this.hands = hands;
    if (!net.honest || net.EV_N !== EV_N || net.BX !== BX12 || net.SB_N !== SB_N || net.NN !== NN) throw new Error("Scry 1.2: the net's sizes differ from the code's");
    for (const k of ["We", "be", "Wx", "Wa", "Wt", "Wb", "Ws", "Wc", "b1", "W2", "b2"]) this[k] = F(net[k]);
    this.D = net.D; this.H = net.H;
    this.cum = [new Float32Array(this.D)];   // cum[j]: the sum of the first j events' embeddings
  }
  update(s, who, m, after) {
    this.rec.update(s, who, m, after);
    const D = this.D;
    for (let j = this.cum.length - 1; j < this.rec.events.length; j++) {   // a move adds none, one or several events
      const ev = this.rec.events[j], e = Float32Array.from(this.be), c = Float32Array.from(this.cum[j]);
      for (let i = 0; i < EV_N; i++) { const v = ev[i]; if (!v) continue; const r = i * D; for (let o = 0; o < D; o++) e[o] += v * this.We[r + o]; }
      for (let o = 0; o < D; o++) if (e[o] > 0) c[o] += e[o];
      this.cum.push(c);
    }
  }
  /** The part of the hidden layer every unknown card of this position shares (the hand is a set): the board, the whole game,
   *  the last two turns, this turn and the hand's facts. */
  base(s, seen) {
    const H = this.H, D = this.D, x = input12(s, this.me, seen), g = Float32Array.from(this.b1), n = this.cum.length - 1;
    const add = (v, W, r) => { for (let o = 0; o < H; o++) g[o] += v * W[r + o]; };
    for (let i = 0; i < BX12; i++) if (x[i]) add(x[i], this.Wx, i * H);
    const all = this.cum[n], last2 = this.cum[this.rec.recent(s)], now = this.cum[Math.min(this.rec.thisTurn(s), n)], sb = this.rec.slotFacts(s);
    for (let d = 0; d < D; d++) {
      const a = all[d] / 8, t = (all[d] - last2[d]) / 4, w = (all[d] - now[d]) / 4;
      if (a) add(a, this.Wa, d * H);
      if (t) add(t, this.Wt, d * H);
      if (w) add(w, this.Wb, d * H);
    }
    for (let i = 0; i < SB_N; i++) if (sb[i]) add(sb[i], this.Ws, i * H);
    return g;
  }
  /** A card's odds by name, given the position's share g, the names already dealt before it (counts) and the unseen pool. */
  card(g, dealt, unseen) {
    const H = this.H, h = Float32Array.from(g);
    if (dealt) for (let k = 0; k < NN; k++) { const v = dealt[k]; if (v) { const r = k * H; for (let o = 0; o < H; o++) h[o] += v * this.Wc[r + o]; } }
    const z = Float32Array.from(this.b2);
    for (let o = 0; o < H; o++) { const v = h[o]; if (v <= 0) continue; const r = o * NN; for (let k = 0; k < NN; k++) z[k] += v * this.W2[r + k]; }
    let top = -Infinity;
    for (let k = 0; k < NN; k++) { const u = unseen[k] - (dealt ? dealt[k] : 0); z[k] = u > 0 ? z[k] + Math.log(u) : -Infinity; if (z[k] > top) top = z[k]; }
    let sum = 0;
    for (let k = 0; k < NN; k++) { z[k] = z[k] === -Infinity ? 0 : Math.exp(z[k] - top); sum += z[k]; }
    for (let k = 0; k < NN; k++) z[k] = sum ? z[k] / sum : 1 / NN;
    return z;
  }
  /**
   * The belief the policy reads (Fable's review, item 10): the expected counts by name and the chance of at least one of each,
   * from HANDS whole hands dealt card after card (each card's odds given those dealt before it), so "at least one counter" holds
   * for the hand and not card by card. slots: each card's odds with nothing dealt before it (the scorecard's marginals); hit: the
   * chance of at least one of each name among the unknown cards alone, and land: of at least one land among them (belief-eval).
   * The deals use a stream fixed by the record's length, so a position gives the same belief however often it is asked.
   */
  belief(s) {
    s = observe(s, this.me);   // only what this seat sees (dandan-view.js)
    const seen = seenBy(s, this.me), ids = unknownSlots(s, this.me), g = this.base(s, seen);
    const p0 = this.card(g, null, seen.unseen), slots = ids.map(() => p0);
    this.last = { s, seen, ids, g, memo: new Map() };
    const counts = Float32Array.from(seen.known), hit = new Float32Array(NN), rng = lcg(1 + this.rec.events.length);
    let land = 0;
    if (ids.length) for (let h = 0; h < this.hands; h++) {
      const d = this.hand(rng);
      let l = false;
      for (let k = 0; k < NN; k++) if (d[k]) { counts[k] += d[k] / this.hands; hit[k] += 1 / this.hands; l ||= LAND[k]; }
      if (l) land += 1 / this.hands;
    }
    const any = Float32Array.from(hit, (v, k) => (seen.known[k] > 0 ? 1 : v));
    return { slots, counts, any, hit, land, ...seen };
  }
  /** The odds of the next card given the names dealt before it (d), at the last belief's position, kept for the position (Fable
   *  20:45Z: most of the 1,024 hands share their first cards, so the net is asked once per distinct prefix; the same numbers). */
  next(d, k) {
    const L = this.last;
    let p = L.memo.get(k);
    if (!p) { p = this.card(L.g, d, L.seen.unseen); L.memo.set(k, p); }
    return p;
  }
  /** One whole hand of the unknown cards at the last belief's position, dealt card after card: counts by name. */
  hand(rng) {
    const L = this.last, d = new Float32Array(NN);
    let k = "";   // the names dealt so far, in order: the memo's key (the odds depend only on the counts, so an order-free key
    for (let j = 0; j < L.ids.length; j++) {   // would share more, but this one costs nothing to build)
      const p = this.next(d, k);
      let r = rng(), c = 0; while (c < NN - 1 && (r -= p[c]) > 0) c++;
      d[c]++; k += c + ".";
    }
    return d;
  }
  /** A dealer for determinize: the other hand's unknown cards one after another, each by its odds given those dealt before it. */
  deal() {
    const L = this.last;
    return (pool, n, rng) => {
      const left = pool.slice(), hand = [], dealt = new Float32Array(NN);
      let dk = "";
      for (let j = 0; j < n && left.length; j++) {
        const p = L && j < L.ids.length ? this.next(dealt, dk) : null;
        // a name by its odds among the names still in the pool, then one card of it
        const byName = new Map();
        left.forEach((id, i) => { const k = NAME_AT.get(DECK[id]) ?? -1; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); });
        let tot = 0; const ks = [...byName.keys()], w = ks.map(k => { const v = (p && k >= 0 ? p[k] : byName.get(k).length) + 1e-6; tot += v; return v; });
        let r = rng() * tot, c = 0;
        while (c < ks.length - 1 && (r -= w[c]) > 0) c++;
        const at = byName.get(ks[c]), i = at[Math.floor(rng() * at.length)];
        hand.push(left[i]); if (ks[c] >= 0) { dealt[ks[c]]++; dk += ks[c] + "."; } left.splice(i, 1);
      }
      for (let i = left.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [left[i], left[j]] = [left[j], left[i]]; }
      return [...hand, ...left];
    };
  }
  /** The scorecard's reads (lab/zero-scorecard.mjs scoreFilter): the names' expected counts among the unknown cards, and the
   *  chance that at least k of them are lands, from whole hands dealt card after card. */
  marginals(s) { const b = this.belief(s), p = new Float32Array(NN); for (const q of b.slots) for (let k = 0; k < NN; k++) p[k] += q[k]; return { p, u: b.slots.length }; }
  landsAtLeast(k, LANDS, s, n = 200) {
    const b = this.belief(s), rng = lcg(12345);
    if (!b.slots.length) return 0;
    let hit = 0;
    for (let t = 0; t < n; t++) { const d = this.hand(rng); let lands = 0; for (let c = 0; c < NN; c++) if (LANDS[c]) lands += d[c]; if (lands >= k) hit++; }
    return hit / n;
  }
  /** The chance of the true hidden cards, as a chain (whole hand) and card by card (the scorecard's two numbers, in nats). */
  score(s, truthIds) {
    const seen = seenBy(s, this.me), g = this.base(s, seen), dealt = new Float32Array(NN);
    let chain = 0, each = 0;
    for (const id of truthIds) {
      const y = NAME_AT.get(DECK[id]);
      const p1 = this.card(g, null, seen.unseen), pc = this.card(g, dealt, seen.unseen);
      each -= Math.log((p1[y] || 0) + 1e-9); chain -= Math.log((pc[y] || 0) + 1e-9); dealt[y]++;
    }
    return { chain, each, n: truthIds.length };
  }
}
