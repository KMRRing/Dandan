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

// ---------- Scry 2d (14 Nov 2026, Korbi 16:00): the hands they COULD STILL hold ----------
// Korbi: "The 1000 hands should be a thousand hands that the player could still have. If they play a Memory Lapse all it tells
// is that the previous hand contained a Memory Lapse, it says very little about the cards still left. If the player doesn't
// play a card, hands containing it should be ruled out unless the policy thinks keeping it is the play; struck means REPLACED
// with randomly chosen hands that are fully compliant with the previous plays thus far."
// Each hand names every unknown card of the other hand by its slot (a physical card, followed from when it came in; its name
// never read). After every move:
//   - the other player's decision: each hand's weight × (ε + the chance Zero's policy, holding it, makes that move); a telling
//     decision (the hands disagree: the best explains it at least twice as well as the worst) goes into the log, with the
//     slots in hand then;
//   - a slot seen leaving (cast, discarded, revealed) as card X: a hand naming it X keeps its other cards; a hand naming X on
//     another slot of theirs swaps the two; a hand with no X can't be right and is struck;
//   - a slot leaving unseen is dropped from every hand; a new unseen slot (a draw) gets a card from what each hand leaves unseen;
//   - struck hands, and hands under a thousandth of the best's weight, are REPLACED: a copy of a hand still standing (by
//     weight), then one of its cards changed to another the pool allows, kept by the log's verdict (Metropolis: the ratio of how
//     well the two explain every logged decision), so the set stays full and every hand in it fits all plays so far.
const LOG_K = 8;
export class SlotFilter {
  // tau: the policy's temperature (under 1 sharpens: Korbi 15:50, the engine against itself should be read as playing its best)
  // kappa (Korbi 16:22: the floor should follow how big the gap is): when set, a hand's factor is exp(−regret / kappa), regret
  // the policy's score of its best move less that of the move made in that hand's world: two plays about as good keep both
  // hands near 1, a clear blunder in a hand's world drops it toward eps (then a small floor for a real misplay)
  // net (Scry fusion, 16 Nov 2026, Korbi: one set of hands, the net's knowledge on top): a function (s) → Scry 1's chances by
  // unknown slot (unknownSlots order). Then the filter only strikes and replaces (what they could hold), the policy's regret
  // weighing is off, and each hand's weight at the root is Scry 1's chance of that hand over the pool's own (importance: the
  // hands were drawn from the pool), so the net says how likely each possible hand is
  constructor(me, { policy = null, qpolicy = null, options, qMarks, n = 2000, eps = 0.005, tau = 0.1, kappa = 1, net = null, rng = Math.random } = {}) {
    Object.assign(this, { me, opp: other(me), options, qMarks, N: n, eps, tau, kappa, net, rng });
    this.score = policy ? freeScorer(policy) : null; this.qscore = qpolicy ? freeScorer(qpolicy) : null;
    this.wide = !!(policy && policy.net.XN > VIEW_N);
    this.XB = new Float32Array(VIEW_N + EXT_N); this.EB = new Float32Array(EXT_N);
    this.slots = []; this.H = []; this.w = new Float64Array(n); this.log = []; this.gone = new Map(); this.ready = false;
  }
  reset(s) {
    const { unseen } = seenBy(s, this.me);
    this.slots = unknownSlots(s, this.me);
    this.H = Array.from({ length: this.N }, () => this.fresh(Float64Array.from(unseen), this.slots.length));
    this.w.fill(1 / this.N); this.log = []; this.gone = new Map(); this.ready = true;
  }
  fresh(pool, k) { const h = new Int8Array(k), cnt = new Int8Array(NN); drawFrom(pool, k, this.rng, cnt); let j = 0; for (let n = 0; n < NN; n++) for (let c = 0; c < cnt[n]; c++) h[j++] = n; for (let i = k - 1; i > 0; i--) { const r = Math.floor(this.rng() * (i + 1)); [h[i], h[r]] = [h[r], h[i]]; } return h; }
  /** The world of position s with the other hand's unknown slots named as `names` (slot id → name). */
  world(s, names, pool) {
    const w = { ...s, hand: s.hand.map(x => x.slice()) }, take = pool.map(a => a.slice()), hand = w.hand[this.opp];
    for (let i = 0; i < hand.length; i++) { const n = names.get(hand[i]); if (n != null) { const id = take[n].pop(); if (id != null) hand[i] = id; } }
    return w;
  }
  poolIds(s) {
    const out = Array.from({ length: NN }, () => []), bit = 1 << this.me;
    for (const id of unknownSlots(s, this.me)) { const n = nameAt(id); if (n >= 0) out[n].push(id); }
    for (const id of s.lib) if (!(s.kn?.find(e => e[0] === id)?.[1] & bit)) { const n = nameAt(id); if (n >= 0) out[n].push(id); }
    return out;
  }
  viewIn(w) { return HandFilter.prototype.viewIn.call(this, w); }
  /** The chance Zero, its hand named `names` in position s, makes move m (target marks). */
  chance(s, names, pool, target, q) {
    const w = this.world(s, names, pool), ms = this.options(w, this.opp);
    if (ms.length < 2) return 1;
    const marks = ms.map(x => (q ? this.qMarks(w, this.opp, x) : marksOf(w, this.opp, x))), k = marks.findIndex(x => JSON.stringify(x) === target);
    if (k < 0) return 0;
    const v = (q ? this.qscore : this.score)(this.viewIn(w), marks), top = Math.max(...v), T = this.tau;
    if (this.kappa) return Math.exp(-(top - v[k]) / this.kappa);
    let z = 0; for (const y of v) z += Math.exp((y - top) / T);
    return Math.exp((v[k] - top) / T) / z;
  }
  namesOf(h, slots = this.slots) { const m = new Map(); slots.forEach((id, j) => m.set(id, h[j])); return m; }
  /** How well hand h explains every logged decision (product of ε + chance); the slots gone since keep their seen names. */
  logLik(h) {
    let l = 0;
    const cur = this.namesOf(h);
    for (const e of this.log) {
      const names = new Map();
      for (const id of e.slots) { const n = cur.has(id) ? cur.get(id) : this.gone.get(id); if (n != null) names.set(id, n); }
      l += Math.log(this.eps + (1 - this.eps) * this.chance(e.s, names, e.pool, e.target, e.q));
    }
    return l;
  }
  weigh(s, m) {
    const q = !!s.pending, sc = q ? this.qscore : this.score;
    if (!sc || (q && !PUBLIC_Q.has(s.pending.t))) return;
    const target = JSON.stringify(q ? this.qMarks(s, this.opp, m) : marksOf(s, this.opp, m)), pool = this.poolIds(s), memo = new Map();
    let lo = 1, hi = 0;
    for (let i = 0; i < this.N; i++) {
      const key = this.H[i].join(",");
      let p = memo.get(key);
      if (p == null) { p = this.chance(s, this.namesOf(this.H[i]), pool, target, q); memo.set(key, p); }
      lo = Math.min(lo, p); hi = Math.max(hi, p);
      this.w[i] *= this.eps + (1 - this.eps) * p;
    }
    // a telling decision: the hands disagree about it
    if (this.eps + hi >= 2 * (this.eps + lo)) { this.log.push({ s, slots: this.slots.slice(), pool, target, q }); if (this.log.length > LOG_K) this.log.shift(); }
  }
  reconcile(s, after) {
    const me = this.me, o = this.opp, nowUnknown = unknownSlots(after, me), nowSet = new Set(nowUnknown);
    const seenNow = new Set([...after.yard, ...after.exile, ...after.bf.map(p => p.id), ...after.stack.map(it => it.card)]), knownAfter = new Set(knownIn(after, o, me));
    const struck = new Uint8Array(this.N);
    // slots leaving the unknown hand
    this.slots.forEach((id, j) => {
      if (nowSet.has(id)) return;
      const n = nameAt(id);
      if ((seenNow.has(id) || knownAfter.has(id)) && n >= 0) {
        this.gone.set(id, n);
        for (let i = 0; i < this.N; i++) {
          const h = this.H[i];
          if (h[j] === n) continue;
          const k = h.findIndex((x, t) => x === n && t !== j && nowSet.has(this.slots[t]));
          if (k >= 0) { h[k] = h[j]; h[j] = n; } else struck[i] = 1;
        }
      }
    });
    // the new slot list: the slots that stay, then the new unseen ones (draws), named from what each hand leaves unseen
    const keep = this.slots.map((id, j) => [id, j]).filter(([id]) => nowSet.has(id)), keepSet = new Set(keep.map(([id]) => id)), added = nowUnknown.filter(id => !keepSet.has(id));
    const { unseen } = seenBy(after, me);
    for (let i = 0; i < this.N; i++) {
      const old = this.H[i], h = new Int8Array(keep.length + added.length);
      keep.forEach(([, j], t) => { h[t] = old[j]; });
      const pool = Float64Array.from(unseen);
      for (let t = 0; t < keep.length; t++) pool[h[t]]--;
      if (pool.some(v => v < 0)) struck[i] = 1;                     // more of a name than `me` hasn't seen: can't be right
      const extra = new Int8Array(NN); drawFrom(pool.map(v => Math.max(0, v)), added.length, this.rng, extra);
      let t = keep.length; for (let n = 0; n < NN; n++) for (let c = 0; c < extra[n]; c++) h[t++] = n;
      this.H[i] = t === h.length ? h : h.slice(0, t);
      if (t !== h.length) struck[i] = 1;
    }
    this.slots = [...keep.map(([id]) => id), ...added];
    // struck and spent hands replaced by copies of standing ones, moved by the log
    let top = 0;
    for (let i = 0; i < this.N; i++) if (struck[i]) this.w[i] = 0; else top = Math.max(top, this.w[i]);
    if (top <= 0) { const log = this.log, gone = this.gone; this.reset(after); this.log = log; this.gone = gone; return; }
    const alive = [], cum = []; let c = 0;
    for (let i = 0; i < this.N; i++) if (this.w[i] >= top * 1e-3) { alive.push(i); c += this.w[i]; cum.push(c); }
    const total = c, replaced = [];
    for (let i = 0; i < this.N; i++) if (this.w[i] < top * 1e-3) {
      let r = this.rng() * total, a = 0; while (a < cum.length - 1 && cum[a] < r) a++;
      this.H[i] = Int8Array.from(this.H[alive[a]]); this.w[i] = this.w[alive[a]]; replaced.push(i);
    }
    for (const i of replaced) this.move(i, unseen);
    let z = 0; for (let i = 0; i < this.N; i++) z += this.w[i];
    for (let i = 0; i < this.N; i++) this.w[i] /= z;
  }
  /** One Metropolis step on hand i: a card renamed to one the pool allows, kept by the log's verdict. */
  move(i, unseen) {
    const h = this.H[i];
    if (!h.length) return;
    const pool = Float64Array.from(unseen); for (const n of h) pool[n]--;
    const j = Math.floor(this.rng() * h.length), cand = []; for (let n = 0; n < NN; n++) if (pool[n] > 0 && n !== h[j]) for (let c = 0; c < pool[n]; c++) cand.push(n);
    if (!cand.length) return;
    const g = Int8Array.from(h); g[j] = cand[Math.floor(this.rng() * cand.length)];
    // proposal symmetric enough (a uniform card of the pool); accept by the logged decisions
    const a = this.log.length ? Math.exp(Math.min(0, this.logLik(g) - this.logLik(h))) : 1;
    if (this.rng() < a) this.H[i] = g;
  }
  update(s, who, m, after) {
    if (!this.ready) this.reset(s);
    if (!this.net && who === this.opp && this.options(s, who).length >= 2) this.weigh(s, m);
    this.reconcile(s, after);
  }
  counts() { const c = new Float64Array(NN); let u = 0; for (let i = 0; i < this.N; i++) { for (const n of this.H[i]) c[n] += this.w[i]; u += this.w[i] * this.H[i].length; } return { c, u }; }
  /** The weights to read and deal by: the filter's own, or (fused) each hand's chance under Scry 1 over its chance under the pool. */
  weightsAt(s) {
    if (!this.net) return this.w;
    const ids = unknownSlots(s, this.me), P = this.net(s), at = new Map(ids.map((id, j) => [id, P[j]])), unseen = seenBy(s, this.me).unseen;
    let tot = 0; for (let n = 0; n < NN; n++) tot += unseen[n];
    const lw = new Float64Array(this.N);
    let top = -Infinity;
    for (let i = 0; i < this.N; i++) {
      let l = Math.log(this.w[i] || 1e-300);
      this.slots.forEach((id, j) => { const p = at.get(id), n = this.H[i][j]; if (p && unseen[n] > 0) l += Math.log(p[n] + 1e-6) - Math.log(unseen[n] / tot); });
      lw[i] = l; if (l > top) top = l;
    }
    let z = 0; for (let i = 0; i < this.N; i++) { lw[i] = Math.exp(lw[i] - top); z += lw[i]; }
    for (let i = 0; i < this.N; i++) lw[i] /= z;
    return lw;
  }
  belief(s) {
    if (!this.ready) this.reset(s);
    const known = seenBy(s, this.me).known, counts = Float32Array.from(known), any = new Float32Array(NN), w = (this.dw = this.weightsAt(s));
    for (let i = 0; i < this.N; i++) { const seen = new Set(); for (const n of this.H[i]) { counts[n] += w[i]; seen.add(n); } for (const n of seen) any[n] += w[i]; }
    for (let n = 0; n < NN; n++) if (known[n] > 0) any[n] = 1;
    return { counts, any };
  }
  deal() {
    const w = this.dw || this.w;
    return (pool, slots, rng) => {
      let r = rng(), i = 0; while (i < this.N - 1 && (r -= w[i]) > 0) i++;
      const want = new Int8Array(NN); for (const n of this.H[i]) want[n]++;
      return HandFilter.prototype.deal.call({ N: 1, w: [1], P: [want] })(pool, slots, rng);
    };
  }
  marginals(s) { if (!this.ready) this.reset(s); const { c, u } = this.counts(); return { p: c, u }; }
  landsAtLeast(k, lands, s) { if (!this.ready) this.reset(s); let pr = 0; for (let i = 0; i < this.N; i++) { let c = 0; for (const n of this.H[i]) if (lands[n]) c++; if (c >= k) pr += this.w[i]; } return pr; }
}
