// Zero's extended view and its belief about the other hand (14 Nov 2026, Korbi 09:50 and 10:02, "do it all" 10:04).
// The policy sees only what its seat knows (an information set), with the other hand as the belief net's estimate; the value
// net judges a dealt world face up (both hands as dealt). Nothing here reads Medium (dandan-policy.js, dandan-reads.js).
//
// ext(s, me, theirHand) — EXT_N numbers:
//   per seat, me first then the other: on the battlefield untapped and tapped by card name (lands each by name, not grouped),
//   the hand by name (mine as it is; theirs as `theirHand` says: the belief's expected counts, or the dealt hand face up), the
//   hand's size, the floating mana by colour (W U B R G C), life;
//   then: the graveyard and exile by name, the library's top 5 where this seat knows them, the stack's top 4 (name, whose,
//   ability or spell, what it targets and whose that is), the step, whose turn and priority, the turn, the library's size,
//   and the cards this seat hasn't seen, by name (the deck less every card it has seen).
// The belief (Korbi 10:02, 10:19): each unknown card in the other hand its own distribution over names, softmax(log unseen + a
// net reading the public view, the other player's play so far (the Tracker) and that card's own history: from the opening hand
// after how many mulligans, drawn when, land drops skipped since…), so "no land last turn, one card drawn" makes two lands
// unlikely though neither card's chance of a land is 0. Expected counts = known + the slots' sum; the policy also sees the
// chance of at least one of each name. One belief a seat, kept up to date after every move, frozen at the root.
import fs from "node:fs";
import { DECK, NAMES, TOKEN_AT } from "../../dandan-cards.js";
import { isLandId, knOf, knownIn } from "../../dandan-core.js";
import { score } from "../../dandan-eval.js";

export const NN = NAMES.length;                                  // 25 names
const AT = new Map(NAMES.map((n, i) => [n, i]));
const nameAt = id => (id != null && id < TOKEN_AT ? AT.get(DECK[id]) ?? -1 : -1);
const STEPS = ["mull", "upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end", "over"];
const COLOURS = "WUBRGC";
const PER_SEAT = 3 * NN + 1 + 6 + 1, ANY = NN, SHARED = 2 * NN + 5 * NN + 4 * (NN + 7) + STEPS.length + 4 + NN;
export const EXT_N = 2 * PER_SEAT + ANY + SHARED;                // 533
export const DECK_COUNT = Float32Array.from(NAMES, n => DECK.filter(d => d === n).length);
const other = x => 1 - x;

/** The cards `me` hasn't seen, by name, and what it knows of the other hand: { unseen, known (by name), unknown (slots) }. */
export function seenBy(s, me) {
  const unseen = Float32Array.from(DECK_COUNT), known = new Float32Array(NN), bit = 1 << me, opp = other(me);
  const take = id => { const k = nameAt(id); if (k >= 0) unseen[k]--; };
  for (const id of s.hand[me]) take(id);
  for (const p of s.bf) if (p.id < TOKEN_AT) take(p.id);
  for (const id of s.yard) take(id);
  for (const id of s.exile) take(id);
  for (const it of s.stack) if (it.kind === "spell" && it.card != null) take(it.card);
  const kh = knownIn(s, opp, me);
  for (const id of kh) { take(id); const k = nameAt(id); if (k >= 0) known[k]++; }
  for (const id of s.lib) if (knOf(s, id) & bit) take(id);
  for (let k = 0; k < NN; k++) if (unseen[k] < 0) unseen[k] = 0;
  return { unseen, known, unknown: s.hand[opp].length - kh.length };
}
/** The other hand by name as it really is (a dealt world, face up). */
export function handCounts(s, seat) { const h = new Float32Array(NN); for (const id of s.hand[seat]) { const k = nameAt(id); if (k >= 0) h[k]++; } return h; }

const r3 = v => Math.round(v * 1000) / 1000;
export function ext(s, me, theirHand, out = new Float32Array(EXT_N), unseen = null, theirAny = null) {
  out.fill(0);
  let k = 0;
  for (const x of [me, other(me)]) {
    for (const p of s.bf) if (p.ctl === x) { const n = nameAt(p.id); if (n >= 0) out[k + (p.tapped ? NN : 0) + n] += 0.25; }
    k += 2 * NN;
    if (x === me) for (const id of s.hand[x]) { const n = nameAt(id); if (n >= 0) out[k + n] += 0.25; }
    else for (let n = 0; n < NN; n++) out[k + n] = r3(theirHand[n] / 4);
    k += NN;
    out[k++] = s.hand[x].length / 7;
    const pool = (s.pool || ["", ""])[x] || "";
    for (const ch of pool) { const c = COLOURS.indexOf(ch); if (c >= 0) out[k + c] += 1 / 3; }
    k += 6;
    out[k++] = Math.max(0, s.life[x]) / 20;
  }
  // their hand: the chance it holds at least one of each name (the belief's slots; face up, 1 where they hold one)
  for (let n = 0; n < NN; n++) out[k + n] = theirAny ? r3(theirAny[n]) : theirHand[n] > 0.5 ? 1 : 0;
  k += ANY;
  for (const id of s.yard) { const n = nameAt(id); if (n >= 0) out[k + n] += 0.25; }
  k += NN;
  for (const id of s.exile) { const n = nameAt(id); if (n >= 0) out[k + n] += 0.25; }
  k += NN;
  const bit = 1 << me;
  for (let i = 0; i < 5; i++) { const id = s.lib[i]; if (id != null && (knOf(s, id) & bit)) { const n = nameAt(id); if (n >= 0) out[k + i * NN + n] = 1; } }
  k += 5 * NN;
  for (let j = 0; j < 4; j++) {
    const it = s.stack[s.stack.length - 1 - j];
    if (it) {
      const n = nameAt(it.card);
      if (n >= 0) out[k + n] = 1;
      out[k + NN] = it.ctl === me ? 1 : 0;
      out[k + NN + 1] = it.kind === "spell" ? 0 : 1;
      const t = it.targets?.[0];
      if (t) {
        const at = { c: 0, s: 1, p: 2, g: 3 }[t.k];
        if (at != null) out[k + NN + 2 + at] = 1;
        const whose = t.k === "p" ? t.seat : t.k === "c" ? s.bf.find(p => p.id === t.id)?.ctl : t.k === "s" ? s.stack.find(x => x.sid === t.sid)?.ctl : null;
        out[k + NN + 6] = whose === me ? 1 : 0;
      }
    }
    k += NN + 7;
  }
  const st = s.over ? STEPS.length - 1 : s.mull && !s.mull.done.every(Boolean) ? 0 : STEPS.indexOf(s.step);
  if (st >= 0) out[k + st] = 1;
  k += STEPS.length;
  out[k++] = s.active === me ? 1 : 0;
  out[k++] = s.prio === me ? 1 : 0;
  out[k++] = Math.min(60, s.turn) / 40;
  out[k++] = s.lib.length / 80;
  const u = unseen || seenBy(s, me).unseen;
  for (let n = 0; n < NN; n++) out[k + n] = u[n] / 4;
  k += NN;
  return out;
}

// ---------- the Tracker: the other player's play so far, as each seat has seen it (public moves only) ----------
// Each card in a hand is a slot with its own history (Korbi 10:19): when it came in, from the opening hand (after how many
// mulligans, a free one shown or not) or a draw, and what its holder has done since (land drops skipped, passes with mana up
// against a spell, main phases passed with mana up, spells cast). The engine's card ids only follow a slot from hand to hand
// position; nothing here reads a hidden card's name.
export const TRACK_N = 13, SLOT_N = 12;
const isLandBf = p => p.id < TOKEN_AT && isLandId(p.id);
const openLands = (s, x) => s.bf.reduce((a, p) => a + (p.ctl === x && !p.tapped && isLandBf(p) ? 1 : 0), 0);
const COUNTS = ["decl", "noLand", "passMain", "cast", "turns"];
export class Tracker {
  constructor() {
    this.t = [0, 1].map(() => ({ decl: 0, declR: 0, counters: 0, noLand: 0, noLandR: 0, drawR: 0, castR: 0, cast: 0, passMain: 0, passMainR: 0, sinceCast: 0, turns: 0, free: 0, mulls: 0 }));
    this.turn = -1; this.active = -1; this.land = false; this.draws = [0, 0]; this.slots = [new Map(), new Map()];
  }
  /** After every move: `s` the position the move was made in, `who` who made it, `m` the move, `after` the position it led to. */
  update(s, who, m, after) {
    const T = this.t[who];
    if (m.t === "mull" && s.pending?.t === "mull") { T.mulls++; if (s.pending.free) T.free++; }
    if (m.t === "pass" && !s.pending) {
      const top = s.stack[s.stack.length - 1];
      if (top && top.ctl !== who && top.kind === "spell" && openLands(s, who) >= 2) { T.decl++; T.declR++; }
      if (!s.stack.length && s.active === who && (s.step === "main1" || s.step === "main2") && openLands(s, who) >= 3) { T.passMain++; T.passMainR++; }
    }
    if (m.t === "land" && s.active === who) this.land = true;
    if (m.t === "cast") { T.castR++; T.cast++; T.sinceCast = 0; if (m.targets?.some(t => t.k === "s")) T.counters++; }
    for (const x of [0, 1]) { const d = (after.draws || [0, 0])[x] - this.draws[x]; if (d > 0) this.t[x].drawR += d; this.draws[x] = (after.draws || [0, 0])[x]; }
    if (after.turn !== this.turn) {
      if (this.active >= 0 && !this.land && this.turn > 0) { this.t[this.active].noLand++; this.t[this.active].noLandR++; }
      for (const X of this.t) { X.declR *= 0.6; X.noLandR *= 0.6; X.drawR *= 0.6; X.castR *= 0.6; X.passMainR *= 0.6; X.sinceCast++; X.turns++; }
      this.turn = after.turn; this.active = after.active; this.land = false;
    }
    // the slots: a card that left a hand is gone, a new one came in now (opening while the mulligans aren't done)
    const opening = !(after.mull?.done?.[0] && after.mull?.done?.[1]);
    for (const x of [0, 1]) {
      const S = this.slots[x], now = new Set(after.hand[x]);
      for (const id of [...S.keys()]) if (!now.has(id)) S.delete(id);
      const T2 = this.t[x];
      for (const id of after.hand[x]) if (!S.has(id)) S.set(id, { open: opening, mulls: T2.mulls, free: T2.free, drawStep: after.step === "draw", turn: after.turn, at: Object.fromEntries(COUNTS.map(c => [c, T2[c]])) });
      if (opening) for (const v of S.values()) { v.open = true; v.mulls = T2.mulls; v.free = T2.free; v.at = Object.fromEntries(COUNTS.map(c => [c, T2[c]])); }
    }
  }
  /** What `me` has seen of the other player's play. */
  of(me, s) {
    const T = this.t[other(me)], c = v => Math.min(5, v) / 5;
    return [c(T.decl), c(T.declR), c(T.counters), c(T.noLand), c(T.noLandR), c(T.drawR), c(T.castR), c(T.passMain), c(T.passMainR), c(T.sinceCast), (s.mull?.n?.[other(me)] || 0) / 3, Math.min(2, T.free) / 2, Math.min(3, T.mulls) / 3];
  }
  /** One slot's history, as `me` sees the other hand's card `id` (into out at k). */
  slotOf(me, s, id, out, k = 0) {
    const x = other(me), v = this.slots[x].get(id), T = this.t[x], c = (a, d = 3) => Math.min(d, a) / d;
    if (!v) { out.fill(0, k, k + SLOT_N); out[k + 11] = 1; return out; }
    out[k] = v.open ? 1 : 0; out[k + 1] = c(v.mulls); out[k + 2] = c(v.free, 2); out[k + 3] = v.drawStep ? 1 : 0;
    out[k + 4] = c(T.turns - v.at.turns, 6); out[k + 5] = c(T.noLand - v.at.noLand); out[k + 6] = c(T.decl - v.at.decl);
    out[k + 7] = c(T.passMain - v.at.passMain); out[k + 8] = c(T.cast - v.at.cast, 5); out[k + 9] = v.turn === s.turn ? 1 : 0;
    out[k + 10] = c(s.hand[x].length, 10); out[k + 11] = 0;
    return out;
  }
}

// ---------- the belief net: one distribution a card in the other hand (Korbi 10:19) ----------
export const BX = EXT_N + TRACK_N + 1;
const BX_BUF = new Float32Array(BX), EXT_BUF = new Float32Array(EXT_N);
/** The belief net's shared input for `me`: the view with only the known part of the other hand, the Tracker, the unknown slots. */
export function beliefInput(s, me, tracker, seen = seenBy(s, me), out = BX_BUF) {
  ext(s, me, seen.known, EXT_BUF, seen.unseen);
  out.set(EXT_BUF, 0); out.set(tracker ? tracker.of(me, s) : new Array(TRACK_N).fill(0), EXT_N); out[EXT_N + TRACK_N] = seen.unknown / 7;
  return out;
}
/** The other hand's unknown cards (its slots), in hand order: the ones `me` doesn't know (determinize deals them in this order). */
export function unknownSlots(s, me) { const kh = new Set(knownIn(s, other(me), me)); return s.hand[other(me)].filter(id => !kh.has(id)); }
/** A belief net (lab/zero/belief_np.py: { H, Wg (BX×H), Ws (SLOT_N×H), b1, W2 (H×NN), b2 }) as (s, me, tracker) → { slots (each
 *  unknown card's chance by name: softmax(log unseen + net)), counts (expected, by name: known + the slots' sum), any (the
 *  chance of at least one of a name), known, unknown, unseen }; with no net, every slot the unseen pool's own odds. */
export function beliefOf(net) {
  const H = net ? net.H : 0, F = a => (net ? Float32Array.from(a) : null);
  const Wg = net ? F(net.Wg) : null, Ws = net ? F(net.Ws) : null, b1 = net ? F(net.b1) : null, W2 = net ? F(net.W2) : null, b2 = net ? F(net.b2) : null;
  const g = new Float32Array(H), h = new Float32Array(H), sf = new Float32Array(SLOT_N);
  return (s, me, tracker) => {
    const seen = seenBy(s, me), ids = unknownSlots(s, me), lp = new Float32Array(NN);
    for (let n = 0; n < NN; n++) lp[n] = seen.unseen[n] > 0 ? Math.log(seen.unseen[n]) : -Infinity;
    if (net) {
      const x = beliefInput(s, me, tracker, seen);
      g.set(b1);
      for (let i = 0; i < BX; i++) { const v = x[i]; if (!v) continue; const r = i * H; for (let o = 0; o < H; o++) g[o] += v * Wg[r + o]; }
    }
    const slots = ids.map(id => {
      const z = new Float32Array(NN);
      if (net) {
        h.set(g);
        tracker ? tracker.slotOf(me, s, id, sf) : sf.fill(0);
        for (let i = 0; i < SLOT_N; i++) { const v = sf[i]; if (!v) continue; const r = i * H; for (let o = 0; o < H; o++) h[o] += v * Ws[r + o]; }
        for (let o = 0; o < H; o++) if (h[o] < 0) h[o] = 0;
        z.set(b2);
        for (let o = 0; o < H; o++) { const v = h[o]; if (!v) continue; const r = o * NN; for (let n = 0; n < NN; n++) z[n] += v * W2[r + n]; }
      }
      let top = -Infinity;
      for (let n = 0; n < NN; n++) { z[n] = lp[n] === -Infinity ? -Infinity : z[n] + lp[n]; if (z[n] > top) top = z[n]; }
      let sum = 0;
      for (let n = 0; n < NN; n++) { z[n] = z[n] === -Infinity ? 0 : Math.exp(z[n] - top); sum += z[n]; }
      for (let n = 0; n < NN; n++) z[n] = sum ? z[n] / sum : 0;
      return z;
    });
    const counts = Float32Array.from(seen.known), none = new Float32Array(NN).fill(1);
    for (const p of slots) for (let n = 0; n < NN; n++) { counts[n] += p[n]; none[n] *= 1 - p[n]; }
    const any = Float32Array.from(none, (v, n) => (seen.known[n] > 0 ? 1 : 1 - v));
    return { slots, counts, any, ...seen };
  };
}
/** Hidden cards dealt by a belief (dandan-think.js determinize's `deal`): each unknown slot of the other hand, in hand order,
 *  drawn from the pool by its own distribution (a card's weight its name's chance for that slot), without putting back; the
 *  rest of the pool shuffled. */
export function dealBy(slots) {
  return (pool, n, rng) => {
    const left = pool.slice(), hand = [];
    for (let j = 0; j < n && left.length; j++) {
      const p = slots[j];
      let tot = 0;
      const w = left.map(id => { const k = nameAt(id), v = (p && k >= 0 ? p[k] : 1 / NN) + 1e-4; tot += v; return v; });
      let r = rng() * tot, i = 0;
      while (i < left.length - 1 && (r -= w[i]) > 0) i++;
      hand.push(left[i]); left.splice(i, 1);
    }
    for (let i = left.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [left[i], left[j]] = [left[j], left[i]]; }
    return [...hand, ...left];
  };
}

// ---------- the value net on the extended view (face up) ----------
/** A value net of value_np.py's layer format over [dandan-eval.js features(s, x), ext(s, x, the other hand as dealt, face up)], as a
 *  judge: the chance `me` wins, sigmoid(g(mine) − g(theirs)). */
export function extJudge(layers, features, N) {
  const net = layers.map(L => {
    const [nIn, nOut] = L.n, raw = atob(L.q), W = new Float32Array(nIn * nOut), b = new Float32Array(nOut);
    for (let i = 0; i < raw.length; i++) { let v = raw.charCodeAt(i); if (v > 127) v -= 256; W[i] = v * L.s[i % nOut]; }
    if (L.b.length) b.set(L.b);
    return { nIn, nOut, W, b, y: new Float32Array(nOut) };
  });
  if (net[0].nIn !== N + EXT_N) throw new Error(`extJudge: the net reads ${net[0].nIn} inputs, not ${N + EXT_N}`);
  const xs = [new Float32Array(N + EXT_N), new Float32Array(N + EXT_N)], e = new Float32Array(EXT_N);
  const fill = (s, x, out) => { features(s, x, out.subarray(0, N)); ext(s, x, handCounts(s, other(x)), e); out.set(e, N); return out; };
  return (s, me) => {
    if (s.over) return s.winner < 0 ? 0.5 : s.winner === me ? 1 : 0;
    const a = score(net, fill(s, me, xs[0])), b = score(net, fill(s, other(me), xs[1]));
    return 1 / (1 + Math.exp(b - a));
  };
}
/** A value row face up for `x`: features and ext, both seats, rounded. */
export function extValueRow(s, features, N) {
  const row = x => { const f = features(s, x, new Float32Array(N)), e = ext(s, x, handCounts(s, other(x))); return [...Array.from(f, r3), ...Array.from(e, r3)]; };
  return [row(0), row(1)];
}
export const readNet = path => (fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8").split("\n")[0]) : null);
