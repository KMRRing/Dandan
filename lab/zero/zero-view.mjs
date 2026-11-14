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
// The belief (Korbi 10:02): the other hand by name, known cards exactly, the rest unseen-pool prior × a net reading the public
// view and the other player's play so far (the Tracker: passes with mana up against a spell, turns with no land, draws…),
// p = softmax(log unseen + net); expected count = known + p × unknown slots. One belief a seat, updated after every move,
// frozen at the root for the look-aheads.
import fs from "node:fs";
import { DECK, NAMES, TOKEN_AT } from "../../dandan-cards.js";
import { isLandId, knOf, knownIn } from "../../dandan-core.js";
import { score } from "../../dandan-eval.js";

export const NN = NAMES.length;                                  // 25 names
const AT = new Map(NAMES.map((n, i) => [n, i]));
const nameAt = id => (id != null && id < TOKEN_AT ? AT.get(DECK[id]) ?? -1 : -1);
const STEPS = ["mull", "upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end", "over"];
const COLOURS = "WUBRGC";
const PER_SEAT = 3 * NN + 1 + 6 + 1, SHARED = 2 * NN + 5 * NN + 4 * (NN + 7) + STEPS.length + 4 + NN;
export const EXT_N = 2 * PER_SEAT + SHARED;                      // 508
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
export function ext(s, me, theirHand, out = new Float32Array(EXT_N), unseen = null) {
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
export const TRACK_N = 11;
const isLandBf = p => p.id < TOKEN_AT && isLandId(p.id);
const openLands = (s, x) => s.bf.reduce((a, p) => a + (p.ctl === x && !p.tapped && isLandBf(p) ? 1 : 0), 0);
export class Tracker {
  constructor() { this.t = [0, 1].map(() => ({ decl: 0, declR: 0, counters: 0, noLand: 0, noLandR: 0, drawR: 0, castR: 0, passMain: 0, passMainR: 0, sinceCast: 0 })); this.turn = -1; this.active = -1; this.land = false; this.draws = [0, 0]; }
  /** After every move: `s` the position the move was made in, `who` who made it, `m` the move, `after` the position it led to. */
  update(s, who, m, after) {
    const T = this.t[who];
    if (m.t === "pass" && !s.pending) {
      const top = s.stack[s.stack.length - 1];
      if (top && top.ctl !== who && top.kind === "spell" && openLands(s, who) >= 2) { T.decl++; T.declR++; }
      if (!s.stack.length && s.active === who && (s.step === "main1" || s.step === "main2") && openLands(s, who) >= 3) { T.passMain++; T.passMainR++; }
    }
    if (m.t === "land" && s.active === who) this.land = true;
    if (m.t === "cast") { T.castR++; T.sinceCast = 0; if (m.targets?.some(t => t.k === "s")) T.counters++; }
    for (const x of [0, 1]) { const d = (after.draws || [0, 0])[x] - this.draws[x]; if (d > 0) this.t[x].drawR += d; this.draws[x] = (after.draws || [0, 0])[x]; }
    if (after.turn !== this.turn) {
      if (this.active >= 0 && !this.land && this.turn > 0) { this.t[this.active].noLand++; this.t[this.active].noLandR++; }
      for (const X of this.t) { X.declR *= 0.6; X.noLandR *= 0.6; X.drawR *= 0.6; X.castR *= 0.6; X.passMainR *= 0.6; X.sinceCast++; }
      this.turn = after.turn; this.active = after.active; this.land = false;
    }
  }
  /** What `me` has seen of the other player's play. */
  of(me, s) {
    const T = this.t[other(me)], c = v => Math.min(5, v) / 5;
    return [c(T.decl), c(T.declR), c(T.counters), c(T.noLand), c(T.noLandR), c(T.drawR), c(T.castR), c(T.passMain), c(T.passMainR), c(T.sinceCast), (s.mull?.n?.[other(me)] || 0) / 3];
  }
}

// ---------- the belief net ----------
export const BX = EXT_N + TRACK_N + 1;
const BX_BUF = new Float32Array(BX), EXT_BUF = new Float32Array(EXT_N);
/** The belief net's input for `me`: the view with only the known part of the other hand, the Tracker, the unknown slots. */
export function beliefInput(s, me, tracker, seen = seenBy(s, me), out = BX_BUF) {
  ext(s, me, seen.known, EXT_BUF, seen.unseen);
  out.set(EXT_BUF, 0); out.set(tracker ? tracker.of(me, s) : new Array(TRACK_N).fill(0), EXT_N); out[EXT_N + TRACK_N] = seen.unknown / 7;
  return out;
}
/** A belief net (lab/zero/belief_np.py: { W1, b1, W2, b2 }) as (s, me, tracker) → { counts (expected, by name), p (each unknown
 *  slot's chance by name), known, unknown, unseen }; with no net, the unseen-pool prior alone. */
export function beliefOf(net) {
  const H = net ? net.H : 0, W1 = net ? Float32Array.from(net.W1) : null, b1 = net ? Float32Array.from(net.b1) : null, W2 = net ? Float32Array.from(net.W2) : null, b2 = net ? Float32Array.from(net.b2) : null, h = new Float32Array(H);
  return (s, me, tracker) => {
    const seen = seenBy(s, me), z = new Float32Array(NN);
    if (net) {
      const x = beliefInput(s, me, tracker, seen);
      h.set(b1);
      for (let i = 0; i < BX; i++) { const v = x[i]; if (!v) continue; const r = i * H; for (let o = 0; o < H; o++) h[o] += v * W1[r + o]; }
      for (let o = 0; o < H; o++) if (h[o] < 0) h[o] = 0;
      z.set(b2);
      for (let o = 0; o < H; o++) { const v = h[o]; if (!v) continue; const r = o * NN; for (let n = 0; n < NN; n++) z[n] += v * W2[r + n]; }
    }
    let top = -Infinity;
    for (let n = 0; n < NN; n++) { z[n] = seen.unseen[n] > 0 ? z[n] + Math.log(seen.unseen[n]) : -Infinity; if (z[n] > top) top = z[n]; }
    const p = new Float32Array(NN); let sum = 0;
    for (let n = 0; n < NN; n++) { p[n] = z[n] === -Infinity ? 0 : Math.exp(z[n] - top); sum += p[n]; }
    for (let n = 0; n < NN; n++) p[n] = sum ? p[n] / sum : 0;
    const counts = new Float32Array(NN);
    for (let n = 0; n < NN; n++) counts[n] = seen.known[n] + p[n] * seen.unknown;
    return { counts, p, ...seen };
  };
}
/** Hidden cards dealt by a belief (dandan-think.js determinize's `deal`): the other hand's unknown slots drawn from the pool
 *  one at a time, a card's weight its name's chance over that name's unseen copies; the rest of the pool shuffled. */
export function dealBy(p) {
  return (pool, slots, rng) => {
    const left = pool.slice(), hand = [];
    for (let j = 0; j < slots && left.length; j++) {
      let tot = 0;
      const w = left.map(id => { const n = nameAt(id), v = n >= 0 ? p[n] + 1e-4 : 1e-4; tot += v; return v; });
      let r = rng() * tot, i = 0;
      while (i < left.length - 1 && (r -= w[i]) > 0) i++;
      hand.push(left[i]); left.splice(i, 1);
    }
    for (let i = left.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [left[i], left[j]] = [left[j], left[i]]; }
    return [...hand, ...left];
  };
}

// ---------- the value net on the extended view (face up) ----------
/** A value net of value_np.py's layer format over [dandan-eval.js features(s, x), ext(s, x, the other hand as dealt)], as a
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
