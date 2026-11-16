// Scry 1.2 (16 Nov 2026, Korbi 15:47: "the best improvement and the most adaptable for the general solution"): the belief net
// rebuilt on the raw record. Scry 1 read the other player's play through 25 numbers someone chose (13 counters, 12 facts a
// card); Scry 1.2 reads the record itself, one event a move, and learns what to make of it. And it deals whole hands: each
// unknown card's odds are conditioned on the cards already dealt before it (autoregressive, as Learned Belief Search, Hu et
// al. 2021), so "at least one counter" or "no land at all" holds for the hand, not card by card.
//
// An event (EV_N numbers, raw facts only): who moved (them or me), the kind of move, the step, whether it was their turn, the
// stack, both players' untapped lands, hand sizes, library, turn, life, the card named if the move shows one (a spell cast, a
// land played, a card cycled), whether it targets a spell, cards drawn. Each event is embedded by a small layer learned with
// the rest, e = ReLU(We·ev + be), and the record is read through three windows of those embeddings, summed: the whole game,
// the last two turns, and since this card came into their hand. With the board (the extended view) and five raw facts of the
// card's arrival (opening hand, mulligans before, drawn in the draw step, turns held, came this turn), and the names already
// dealt to the cards before it, a hidden layer gives the card's odds by name: softmax(log of the copies still unseen + net).
// Untrained (W2 = 0) it is the unseen pool's odds, as Scry 1. Trained by lab/zero/scry12_np.py on lab/zero/scry12-pack.mjs's rows.
//
// In Zero it plugs in where Scry 2 does (makeZero's filterOf): update() after every move, belief() the counts and the chance
// of at least one of each name for the policy's input (each card's odds with nothing dealt before it), deal() whole hands.
import { DECK, NAMES } from "../../dandan-cards.js";
import { isLandId } from "../../dandan-core.js";
import { EXT_N, NN, ext, seenBy, unknownSlots } from "./zero-view.mjs";

const other = x => 1 - x, NAME_AT = new Map(NAMES.map((n, k) => [n, k]));
const STEPS = ["mull", "upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end", "over"];
const TYPES = ["pass", "cast", "land", "cycle", "ability", "attack", "block", "mull", "keep", "hide", "other"];   // hide: put back, bottom, discard
const TYPE_AT = { pass: 0, cast: 1, land: 2, cycle: 3, ability: 4, attack: 5, block: 6, mull: 7, keep: 8, putback: 9, bottom: 9, discard: 9 };
const CTX = 11, T0 = 1, S0 = T0 + TYPES.length, C0 = S0 + STEPS.length, N0 = C0 + CTX;
export const EV_N = N0 + NN + 2;    // 1 + 11 + 10 + 11 + 25 + 2 = 60
export const BX12 = EXT_N + 1, SB_N = 5;
const untapped = (s, x) => s.bf.reduce((a, p) => a + (p.ctl === x && !p.tapped && p.id < DECK.length && isLandId(p.id) ? 1 : 0), 0);
const nameOf = id => (id != null && id >= 0 && id < DECK.length ? NAME_AT.get(DECK[id]) ?? -1 : -1);

/** One move as seen by `me`: `s` the position it was made in, `after` the one it led to. */
export function eventOf(s, who, m, after, me, out = new Float32Array(EV_N)) {
  out.fill(0);
  const them = other(me);
  out[0] = who === them ? 1 : 0;
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
  out[N0 + NN + 1] = Math.min(4, Math.max(0, ((after.draws || [0, 0])[who] || 0) - ((s.draws || [0, 0])[who] || 0))) / 4;
  return out;
}

/**
 * The record as `me` has seen it: every event, the index where each turn began, and for each card in the other hand the event
 * index it arrived at with its arrival facts. Indices are counts of events, so a window is [from, length).
 */
export class Record12 {
  // honest (16 Nov 2026, Fable's review items 6-7): no move-by-move passes (a pass is only recorded when the seat was asked to
  // act); instead one pass event at every priority point the rules note, asked or not (the state's passPoints, dandan-rules.js).
  // And the hand as a set: no card followed by its id; every unknown card gets the same hand-level facts (cards they drew this
  // turn and last, hand size, cards they played this turn, mulligans) and the window "since it arrived" becomes "this turn".
  constructor(me, { honest = false } = {}) {
    this.me = me; this.honest = honest; this.events = []; this.turnAt = []; this.turn = -1; this.arrived = new Map(); this.mulls = 0;
    this.drawn = [0, 0]; this.lastDraws = 0; this.played = 0; this.draws0 = 0;
  }
  update(s, who, m, after) {
    const them = other(this.me);
    if (m.t === "mull" && who === them) this.mulls++;
    if (!this.honest || m.t !== "pass") this.events.push(eventOf(s, who, m, after, this.me));
    if (this.honest) for (const p of after.passPoints || []) this.events.push(eventOf(p.s, p.seat, { t: "pass" }, p.s, this.me));
    if (who === them && (m.t === "land" || (m.t === "cast" && m.from === "hand") || m.t === "cycle")) this.played++;
    const d = (after.draws || [0, 0])[them] || 0;
    if (after.turn !== this.turn) {
      this.turn = after.turn; this.turnAt.push(this.events.length);
      this.drawn = [d - this.draws0, this.drawn[0]]; this.draws0 = d; this.played = 0;
    }
    this.lastDraws = d - this.draws0;
    if (this.honest) return;
    const opening = !(after.mull?.done?.[0] && after.mull?.done?.[1]), now = new Set(after.hand[them]);
    for (const id of [...this.arrived.keys()]) if (!now.has(id)) this.arrived.delete(id);
    for (const id of after.hand[them]) if (!this.arrived.has(id) || opening) this.arrived.set(id, { at: opening ? 0 : this.events.length, open: opening, mulls: this.mulls, draw: after.step === "draw", turn: after.turn });
  }
  /** Where the last two turns began. */
  recent() { const n = this.turnAt.length; return n >= 2 ? this.turnAt[n - 2] : 0; }
  /** A card's arrival facts (SB_N): opening hand, mulligans before, drawn in the draw step, turns held, came this turn; honest:
   *  the hand's facts, the same for every unknown card. */
  slotFacts(id, s, out = new Float32Array(SB_N)) {
    out.fill(0);
    if (this.honest) {
      const them = other(this.me);
      out[0] = Math.min(4, this.lastDraws) / 4; out[1] = Math.min(4, Math.max(0, this.drawn[1])) / 4; out[2] = Math.min(10, s.hand[them].length) / 10;
      out[3] = Math.min(4, this.played) / 4; out[4] = Math.min(3, this.mulls) / 3;
      return out;
    }
    const a = this.arrived.get(id);
    if (!a) return out;
    out[0] = a.open ? 1 : 0; out[1] = Math.min(3, a.mulls) / 3; out[2] = a.draw ? 1 : 0;
    out[3] = Math.min(6, Math.max(0, (s.turn || 0) - (a.turn || 0))) / 6; out[4] = a.turn === s.turn ? 1 : 0;
    return out;
  }
  /** The start of a card's own window: when it arrived; honest: this turn's start, the same for every card. */
  arrivalOf(id) { return this.honest ? (this.turnAt[this.turnAt.length - 1] ?? 0) : this.arrived.get(id)?.at ?? 0; }
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
  constructor(me, net) {
    const F = a => Float32Array.from(a);
    this.me = me; this.n = net; this.rec = new Record12(me, { honest: !!net.honest });
    if (net.EV_N !== EV_N || net.BX !== BX12 || net.SB_N !== SB_N || net.NN !== NN) throw new Error("Scry 1.2: the net's sizes differ from the code's");
    for (const k of ["We", "be", "Wx", "Wa", "Wt", "Wb", "Ws", "Wc", "b1", "W2", "b2"]) this[k] = F(net[k]);
    this.D = net.D; this.H = net.H;
    this.cum = [new Float32Array(this.D)];   // cum[j]: the sum of the first j events' embeddings
  }
  update(s, who, m, after) {
    this.rec.update(s, who, m, after);
    const ev = this.rec.events[this.rec.events.length - 1], D = this.D, e = Float32Array.from(this.be);
    for (let i = 0; i < EV_N; i++) { const v = ev[i]; if (!v) continue; const r = i * D; for (let o = 0; o < D; o++) e[o] += v * this.We[r + o]; }
    const c = Float32Array.from(this.cum[this.cum.length - 1]);
    for (let o = 0; o < D; o++) if (e[o] > 0) c[o] += e[o];
    this.cum.push(c);
  }
  /** The part of the hidden layer every card of this position shares: board, whole game, last two turns. */
  base(s, seen) {
    const H = this.H, D = this.D, x = input12(s, this.me, seen), g = Float32Array.from(this.b1), n = this.cum.length - 1;
    for (let i = 0; i < BX12; i++) { const v = x[i]; if (!v) continue; const r = i * H; for (let o = 0; o < H; o++) g[o] += v * this.Wx[r + o]; }
    const all = this.cum[n], rs = this.rec.recent(), rec = this.cum[rs];
    for (let d = 0; d < D; d++) {
      const a = all[d] / 8, t = (all[d] - rec[d]) / 4, ra = d * H;
      if (a) for (let o = 0; o < H; o++) g[o] += a * this.Wa[ra + o];
      if (t) for (let o = 0; o < H; o++) g[o] += t * this.Wt[ra + o];
    }
    return g;
  }
  /** One card's odds by name, given the board's share g, the names already dealt (counts), and the unseen pool. */
  card(g, s, id, dealt, unseen) {
    const H = this.H, D = this.D, h = Float32Array.from(g), n = this.cum.length - 1, a = this.rec.arrivalOf(id);
    const since = this.cum[n], from = this.cum[Math.min(a, n)], sb = this.rec.slotFacts(id, s);
    for (let d = 0; d < D; d++) { const v = (since[d] - from[d]) / 4; if (v) { const r = d * H; for (let o = 0; o < H; o++) h[o] += v * this.Wb[r + o]; } }
    for (let i = 0; i < SB_N; i++) { const v = sb[i]; if (v) { const r = i * H; for (let o = 0; o < H; o++) h[o] += v * this.Ws[r + o]; } }
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
  /** Each unknown card's odds with nothing dealt before it, and from them the expected counts and the chance of at least one. */
  belief(s) {
    const seen = seenBy(s, this.me), ids = unknownSlots(s, this.me), g = this.base(s, seen);
    const slots = ids.map(id => this.card(g, s, id, null, seen.unseen));
    const counts = Float32Array.from(seen.known), none = new Float32Array(NN).fill(1);
    for (const p of slots) for (let k = 0; k < NN; k++) { counts[k] += p[k]; none[k] *= 1 - p[k]; }
    const any = Float32Array.from(none, (v, k) => (seen.known[k] > 0 ? 1 : 1 - v));
    this.last = { s, seen, ids, g };
    return { slots, counts, any, ...seen };
  }
  /** A dealer for determinize: the other hand's unknown cards one after another, each by its odds given those dealt before it. */
  deal() {
    const L = this.last;
    return (pool, n, rng) => {
      const left = pool.slice(), hand = [], dealt = new Float32Array(NN);
      for (let j = 0; j < n && left.length; j++) {
        const p = L && L.ids[j] != null ? this.card(L.g, L.s, L.ids[j], dealt, L.seen.unseen) : null;
        // a name by its odds among the names still in the pool, then one card of it
        const byName = new Map();
        left.forEach((id, i) => { const k = NAME_AT.get(DECK[id]) ?? -1; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); });
        let tot = 0; const ks = [...byName.keys()], w = ks.map(k => { const v = (p && k >= 0 ? p[k] : byName.get(k).length) + 1e-6; tot += v; return v; });
        let r = rng() * tot, c = 0;
        while (c < ks.length - 1 && (r -= w[c]) > 0) c++;
        const at = byName.get(ks[c]), i = at[Math.floor(rng() * at.length)];
        hand.push(left[i]); if (ks[c] >= 0) dealt[ks[c]]++; left.splice(i, 1);
      }
      for (let i = left.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [left[i], left[j]] = [left[j], left[i]]; }
      return [...hand, ...left];
    };
  }
  /** The scorecard's reads (lab/zero-scorecard.mjs scoreFilter): the names' expected counts among the unknown cards, and the
   *  chance that at least k of them are lands, from whole hands dealt card after card. */
  marginals(s) { const b = this.belief(s), p = new Float32Array(NN); for (const q of b.slots) for (let k = 0; k < NN; k++) p[k] += q[k]; return { p, u: b.slots.length }; }
  landsAtLeast(k, LANDS, s, n = 200) {
    const b = this.belief(s), L = this.last, rng = (x => () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296))(12345);
    let hit = 0;
    for (let t = 0; t < n; t++) {
      const dealt = new Float32Array(NN); let lands = 0;
      for (const id of L.ids) {
        const p = this.card(L.g, L.s, id, dealt, L.seen.unseen);
        let r = rng(), c = 0; while (c < NN - 1 && (r -= p[c]) > 0) c++;
        dealt[c]++; if (LANDS[c]) lands++;
      }
      if (lands >= k) hit++;
    }
    return b.slots.length ? hit / n : 0;
  }
  /** The chance of the true hidden cards, as a chain (whole hand) and card by card (the scorecard's two numbers, in nats). */
  score(s, truthIds) {
    const seen = seenBy(s, this.me), g = this.base(s, seen), dealt = new Float32Array(NN);
    let chain = 0, each = 0;
    for (const id of truthIds) {
      const y = NAME_AT.get(DECK[id]);
      const p1 = this.card(g, s, id, null, seen.unseen), pc = this.card(g, s, id, dealt, seen.unseen);
      each -= Math.log((p1[y] || 0) + 1e-9); chain -= Math.log((pc[y] || 0) + 1e-9); dealt[y]++;
    }
    return { chain, each, n: truthIds.length };
  }
}
