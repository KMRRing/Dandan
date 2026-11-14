// Scry 2 (14 Nov 2026, Korbi 14:34: "simulate 1000 hands and every time the player makes a move or draws a card, update what
// hand they could have based on the policy engine and known facts"): a particle filter over the other player's hidden hand.
// Each particle is a whole hand, a count by card name for the cards `me` doesn't know. After every move:
//   1. the other player decided with priority, or answered a public question (attack, block, keep or mulligan, a pick, a
//      name…): each particle's weight × (ε + the chance Zero's policy, holding that hand, makes that very move). A pass with a
//      counter in hand weighs against that hand only where Zero would have countered with it (Korbi 10:54).
//   2. the facts: a card that left their hand and is now seen (cast, discarded, revealed) is taken out of each particle (one without it is dropped); a card that left unseen (put back, bottomed, shuffled away) is taken out at random; a card
//      drawn unseen is drawn into each particle from what that particle leaves unseen;  a particle holding more of a name than
//      `me` hasn't seen is repaired from the pool.
//   3. when a few particles carry the weight (effective size under half), resample; a few of the copies get one card swapped,
//      so the set doesn't collapse to one hand.
// No net is trained: Zero's own policy and question head are the model of the other player, so Scry 2 reads better as Zero
// plays better. Out: the expected count of each name and the chance of at least one (the policy's inputs, as Scry 1's), and
// deal(): a whole hand drawn by weight, its names given ids from the search's unseen pool (dandan-think.js determinize).
import { DECK, NAMES, TOKEN_AT } from "../../dandan-cards.js";
import { knownIn } from "../../dandan-core.js";
import { viewInto, marksOf, freeScorer, VIEW_N } from "../../dandan-netpolicy.js";
import { ext, EXT_N, NN, seenBy, unknownSlots } from "./zero-view.mjs";

const AT = new Map(NAMES.map((n, i) => [n, i]));
const nameAt = id => (id != null && id < TOKEN_AT ? AT.get(DECK[id]) ?? -1 : -1);
const other = x => 1 - x;
const PUBLIC_Q = new Set(["attack", "block", "pick", "owner", "bend", "retarget", "name", "mull", "discard"]);

/** Draw `k` names from a count vector (without putting back) into `into`; the counts are used up. */
function drawFrom(pool, k, rng, into) {
  let total = 0;
  for (let n = 0; n < NN; n++) total += pool[n];
  for (let j = 0; j < k && total > 0; j++) {
    let r = rng() * total, n = 0;
    while (n < NN - 1 && (r -= pool[n]) >= 0) n++;
    if (pool[n] <= 0) { n = pool.findIndex(v => v > 0); if (n < 0) break; }
    pool[n]--; into[n]++; total--;
  }
}

/**
 * One observer's filter. `me` the observer; `policy`/`qpolicy` Zero's nets (freeScorer form; null: facts only); `qMarks` and
 * `options` from zero-lib.mjs (passed in, no import cycle).
 */
export class HandFilter {
  // eps: the floor under the policy's chance of a move (it is no perfect model of the other player); prior (Scry 2b): a Scry 1
  // belief, (s, me) → its slot distributions in unknownSlots order, that deals fresh particles and draws in place of the pool
  constructor(me, { policy = null, qpolicy = null, options, qMarks, n = 1024, eps = 0.03, prior = null, rng = Math.random } = {}) {
    Object.assign(this, { me, opp: other(me), options, qMarks, N: n, eps, prior, rng });
    this.score = policy ? freeScorer(policy) : null; this.qscore = qpolicy ? freeScorer(qpolicy) : null;
    this.wide = !!(policy && policy.net.XN > VIEW_N);
    this.P = []; this.w = new Float64Array(n); this.ready = false;
    this.XB = new Float32Array(VIEW_N + EXT_N); this.EB = new Float32Array(EXT_N);
  }
  /** Fresh particles: the unknown slots dealt from the unseen pool. */
  reset(s) {
    const { unseen, unknown } = seenBy(s, this.me), slots = this.prior ? this.prior(s, this.me) : null;
    this.P = Array.from({ length: this.N }, () => {
      const h = new Int8Array(NN), pool = Float64Array.from(unseen);
      if (slots) for (const d of slots) this.drawOne(pool, d, h); else drawFrom(pool, unknown, this.rng, h);
      return h;
    });
    this.w.fill(1 / this.N); this.ready = true;
  }
  /** One card into h by a slot distribution d (Scry 1's), as far as the pool allows; the pool used up. */
  drawOne(pool, d, h) {
    let tot = 0;
    for (let n = 0; n < NN; n++) tot += pool[n] > 0 ? d[n] + 1e-6 : 0;
    if (tot <= 0) return;
    let r = this.rng() * tot, n = 0;
    for (; n < NN - 1; n++) { const v = pool[n] > 0 ? d[n] + 1e-6 : 0; if ((r -= v) < 0) break; }
    if (pool[n] <= 0) n = pool.findIndex(v => v > 0);
    if (n >= 0) { pool[n]--; h[n]++; }
  }
  /** The other player's world as particle `h` has it: their unknown slots given ids of those names from the pool. */
  worldOf(s, h, ids, poolIds) {
    const w = { ...s, hand: s.hand.map(x => x.slice()) }, take = poolIds.map(a => a.slice()), hand = w.hand[this.opp];
    const names = [];
    for (let n = 0; n < NN; n++) for (let k = 0; k < h[n]; k++) names.push(n);
    let j = 0;
    for (let i = 0; i < hand.length; i++) if (ids.has(hand[i])) { const n = names[j++]; const id = n != null ? take[n].pop() : undefined; if (id != null) hand[i] = id; }
    return w;
  }
  /** Ids of each name among the cards `me` hasn't seen (the other hand's unknown slots and the unknown library). */
  poolIds(s, ids) {
    const out = Array.from({ length: NN }, () => []), bit = 1 << this.me;
    for (const id of ids) { const n = nameAt(id); if (n >= 0) out[n].push(id); }
    for (const id of s.lib) if (!(s.kn?.find(e => e[0] === id)?.[1] & bit)) { const n = nameAt(id); if (n >= 0) out[n].push(id); }
    return out;
  }
  /** The other player's view of their own decision in a world (their belief about `me` as the pool's odds). */
  viewIn(w) {
    const x = viewInto(w, this.opp);
    if (!this.wide) return x;
    const seen = seenBy(w, this.opp), tot = seen.unseen.reduce((a, b) => a + b, 0) || 1, c = new Float32Array(NN), any = new Float32Array(NN);
    for (let n = 0; n < NN; n++) { c[n] = seen.known[n] + seen.unknown * seen.unseen[n] / tot; any[n] = seen.known[n] > 0 ? 1 : 1 - (1 - seen.unseen[n] / tot) ** seen.unknown; }
    this.XB.set(x, 0); this.XB.set(ext(w, this.opp, c, this.EB, null, any), VIEW_N);
    return this.XB;
  }
  /** Step 1: weigh each particle by the chance Zero, holding it, makes move m in position s. */
  weigh(s, m) {
    const q = !!s.pending, sc = q ? this.qscore : this.score;
    if (!sc || (q && !PUBLIC_Q.has(s.pending.t))) return;
    const target = JSON.stringify(q ? this.qMarks(s, this.opp, m) : marksOf(s, this.opp, m));
    const ids = new Set(unknownSlots(s, this.me)), pool = this.poolIds(s, ids);
    const memo = new Map();   // the same hand twice (resampled copies) is weighed once
    for (let i = 0; i < this.N; i++) {
      if (this.w[i] === 0) continue;
      const key = this.P[i].join(",");
      if (memo.has(key)) { this.w[i] *= memo.get(key); continue; }
      const w = this.worldOf(s, this.P[i], ids, pool), ms = this.options(w, this.opp);
      if (ms.length < 2) { memo.set(key, 1); continue; }
      const marks = ms.map(x => (q ? this.qMarks(w, this.opp, x) : marksOf(w, this.opp, x))), k = marks.findIndex(x => JSON.stringify(x) === target);
      let p = 0;
      if (k >= 0) {
        const v = sc(this.viewIn(w), marks), top = Math.max(...v);
        let z = 0;
        for (const y of v) z += Math.exp(y - top);
        p = Math.exp(v[k] - top) / z;
      }
      const f = this.eps + (1 - this.eps) * p;
      memo.set(key, f); this.w[i] *= f;
    }
  }
  /** Step 2: the facts of the move from s to after. */
  reconcile(s, after) {
    const me = this.me, o = this.opp, unknownBefore = new Set(unknownSlots(s, me)), nowHand = new Set(after.hand[o]);
    const knownAfter = new Set(knownIn(after, o, me)), seenNow = new Set([...after.yard, ...after.exile, ...after.bf.map(p => p.id), ...after.stack.map(it => it.card)]);
    const out = new Int8Array(NN);
    let hiddenOut = 0, hiddenIn = 0;
    for (const id of unknownBefore) {
      if (nowHand.has(id) && !knownAfter.has(id)) continue;                       // still in hand, still unknown
      const n = nameAt(id);
      if ((seenNow.has(id) || knownAfter.has(id)) && n >= 0) out[n]++; else hiddenOut++; // left (or became known) seen: by name
    }
    const beforeHand = new Set(s.hand[o]);
    for (const id of after.hand[o]) if (!beforeHand.has(id) && !knownAfter.has(id)) hiddenIn++;
    const { unseen, unknown } = seenBy(after, me);
    // Scry 2b: the new unknown slots' distributions from Scry 1 at the position after
    let newSlots = null;
    if (this.prior && hiddenIn) { const ids = unknownSlots(after, me), d = this.prior(after, me); newSlots = ids.map((id, j) => (!beforeHand.has(id) ? d[j] : null)).filter(Boolean); }
    for (let i = 0; i < this.N; i++) {
      const h = this.P[i];
      // a card seen leaving: out of the particle by name; a particle without it can't be the hand (weight 0). Repairing it instead
      // (another card out in its place) leaves its other cards chosen for not being that card, a bias against every card played.
      for (let n = 0; n < NN; n++) if (out[n]) { if (h[n] < out[n]) { this.w[i] = 0; h[n] = 0; } else h[n] -= out[n]; }
      for (let k = 0; k < hiddenOut; k++) { const has = []; for (let n = 0; n < NN; n++) for (let c = 0; c < h[n]; c++) has.push(n); if (!has.length) break; h[has[Math.floor(this.rng() * has.length)]]--; }
      // what this particle leaves unseen: the pool less its own hand; more of a name than that is repaired
      const pool = Float64Array.from(unseen);
      for (let n = 0; n < NN; n++) { if (h[n] > pool[n]) h[n] = Math.max(0, pool[n]); pool[n] -= h[n]; }
      let size = h.reduce((a, b) => a + b, 0);
      if (hiddenIn || size !== unknown) {
        if (size > unknown) { for (let n = NN - 1; n >= 0 && size > unknown; n--) while (h[n] > 0 && size > unknown) { h[n]--; pool[n]++; size--; } }
        if (newSlots && newSlots.length === unknown - size) for (const d of newSlots) this.drawOne(pool, d, h);
        else drawFrom(pool, unknown - size, this.rng, h);
      }
    }
    let total = 0;
    for (let i = 0; i < this.N; i++) total += this.w[i];
    if (total <= 0) { this.reset(after); return; }
    for (let i = 0; i < this.N; i++) this.w[i] /= total;
    this.resample(after, unseen);
  }
  /** Step 3: systematic resampling when the effective size is under half; one card swapped in three copies in ten. */
  resample(s, unseen) {
    let ess = 0;
    for (let i = 0; i < this.N; i++) ess += this.w[i] * this.w[i];
    if (1 / ess >= this.N / 2) return;
    const next = [], step = 1 / this.N;
    let u = this.rng() * step, c = this.w[0], i = 0;
    for (let k = 0; k < this.N; k++) {
      while (u > c && i < this.N - 1) c += this.w[++i];
      const h = Int8Array.from(this.P[i]);
      if (next.length && this.rng() < 0.3) {
        const has = []; for (let n = 0; n < NN; n++) for (let r = 0; r < h[n]; r++) has.push(n);
        if (has.length) { const pool = Float64Array.from(unseen); for (let n = 0; n < NN; n++) pool[n] -= h[n]; h[has[Math.floor(this.rng() * has.length)]]--; drawFrom(pool.map(v => Math.max(0, v)), 1, this.rng, h); }
      }
      next.push(h); u += step;
    }
    this.P = next; this.w.fill(1 / this.N);
  }
  /** After every move: who moved what, the position before and after. */
  update(s, who, m, after) {
    if (!this.ready) this.reset(s);
    if (who === this.opp && this.options(s, who).length >= 2) this.weigh(s, m);
    this.reconcile(s, after);
  }
  /** The belief as Scry 1 gives it: expected counts by name (known cards included) and the chance of at least one. */
  belief(s) {
    if (!this.ready) this.reset(s);
    const known = seenBy(s, this.me).known, counts = Float32Array.from(known), any = new Float32Array(NN);
    for (let i = 0; i < this.N; i++) { const h = this.P[i], wi = this.w[i]; for (let n = 0; n < NN; n++) { counts[n] += wi * h[n]; if (h[n] > 0) any[n] += wi; } }
    for (let n = 0; n < NN; n++) if (known[n] > 0) any[n] = 1;
    return { counts, any };
  }
  /** determinize's deal: a particle drawn by weight, its names given ids from the pool; the rest of the pool shuffled. */
  deal() {
    return (pool, slots, rng) => {
      let r = rng(), i = 0;
      while (i < this.N - 1 && (r -= this.w[i]) > 0) i++;
      const h = Int8Array.from(this.P[i]), left = pool.slice(), hand = [];
      for (let j = left.length - 1; j > 0; j--) { const k = Math.floor(rng() * (j + 1)); [left[j], left[k]] = [left[k], left[j]]; }
      for (let j = 0; j < left.length && hand.length < slots; j++) { const n = nameAt(left[j]); if (n >= 0 && h[n] > 0) { h[n]--; hand.push(left[j]); left.splice(j--, 1); } }
      while (hand.length < slots && left.length) hand.push(left.shift());   // a particle the pool can't fill: the rest at random
      return [...hand, ...left];
    };
  }
  /** For the scorecard: each particle's chance of two or more lands, by weight, and the per-card loss of the truth. */
  marginals(s) { if (!this.ready) this.reset(s); const p = new Float64Array(NN); let u = 0; for (let i = 0; i < this.N; i++) { const h = this.P[i]; let s = 0; for (let n = 0; n < NN; n++) { p[n] += this.w[i] * h[n]; s += h[n]; } u += this.w[i] * s; } return { p, u }; }
  landsAtLeast(k, lands, s) { if (!this.ready) this.reset(s); let pr = 0; for (let i = 0; i < this.N; i++) { let c = 0; for (let n = 0; n < NN; n++) if (lands[n]) c += this.P[i][n]; if (c >= k) pr += this.w[i]; } return pr; }
}
