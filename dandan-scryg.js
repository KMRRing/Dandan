// Scry G, the general dealer (17 Nov 2026, Korbi 16:15-16:29: "belief network, which is used by policy network, and which sets
// the reality for the value network"; "the most general solution possible, very simple and elegant"). One network that guesses
// the cards the other player knows and the seat doesn't (their hidden hand, and the library places only they know: observe's
// theirLib), card by card, from what the seat has seen:
//   - the position: generalView with no belief (every card by its pool slot and its printed facts, from the card files), the
//     copies of each card the seat hasn't seen (an input, and the counting mask on the output: no card is dealt with no copy left;
//     Korbi 16:29), how many cards there are to guess;
//   - the record: every move as the seat saw it (its marks, generalMarks, on the move with the cards it didn't see blanked), every
//     priority point and draw (as Record12: nothing depends on where the engine stopped to ask), each with its own context. Each
//     event embedded, e = ReLU(We·ev + be); read by attention from the position, keys aged by how many turns back the event was
//     (a clue ten turns ago can weigh as much as one now: Korbi 16:26), with the record's mean beside it;
//   - the cards dealt so far: each card's odds given those before it (autoregressive), so a whole hand's chance is the product.
// Trained on Zero's games with the true cards (lab/zero/scryg_torch.py, rows from lab/zero/scryg-pack.mjs). Nothing in it names a
// card or a rule. Browser-safe (no node modules).
import { observe, HIDDEN } from "./dandan-view.js";
import { generalView, generalMarks, viewSize, answers, POOL } from "./dandan-general.js";
import { DECK, TOKEN_AT, CARDS, HALVES, parseCost } from "./dandan-cards.js";
import { affords } from "./dandan-core.js";

const other = x => 1 - x;
const STEPS = ["mull", "upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end", "over"];
const TOKEN_NAME = Object.keys(CARDS).find(n => CARDS[n].type === "token");
const nameOf = id => (id == null || id < 0 ? null : id >= TOKEN_AT ? TOKEN_NAME : DECK[id]);
/** An event's context numbers: whose, a pass, a draw (how many), the step, whose turn, the stack, lands untapped, hands, library,
 *  turn, lives. */
export const CTX_N = 3 + STEPS.length + 10;
// the dealer's added inputs (23 Nov 2026, Fable 17:30Z and 18:00Z, items 2a and 2b; a net says which in its "feat"):
//   a  each event's could-have-acted marks: for each card the seat hasn't seen, whether the one acting (a pass above all) had the
//      mana open and the timing to cast it then (P.V more context numbers);
//   b  the hidden hand's age: of the cards the seat can't see in the other hand, how many must have been held 1, 2, 4 and 8 turns
//      or more (the hand's size less every card that came into it since), ÷7 (AGE_N more position numbers)
export const AGE_N = 4, AGES = [1, 2, 4, 8];
export const ctxN = (P = POOL, feat = {}) => CTX_N + (feat.a ? P.V : 0);
export const evSize = (P = POOL, feat = {}) => P.MARK_N + ctxN(P, feat);
export const posSize = (P = POOL, v = 2, feat = {}) => viewSize(P, v) + P.V + 2 + (feat.b ? AGE_N : 0);
const halvesOf = n => HALVES[n] || [n];
// a card name's castable halves: { cost, instant } (lands and tokens none)
const CAST = new Map();
const castOf = n => { if (!CAST.has(n)) CAST.set(n, halvesOf(n).map(h => CARDS[h]).filter(c => c && c.type !== "land" && c.type !== "token").map(c => ({ cost: parseCost(c.cost), instant: c.type === "instant" || !!c.flash }))); return CAST.get(n); };
const IDK = new Set(["card", "cards", "id", "ids", "src", "att", "blk", "attackers", "blockers", "pairs"]);

const visibleIds = v => {
  const ids = new Set(), add = id => { if (id >= 0) ids.add(id); };
  for (const z of [v.hand[0], v.hand[1], v.lib, v.yard, v.exile]) z.forEach(add);
  v.bf.forEach(p => add(p.id)); v.stack.forEach(it => typeof it.card === "number" && add(it.card));
  return ids;
};
const mask = (m, vis) => {
  const walk = (x, idk) => Array.isArray(x) ? x.map(y => walk(y, idk)) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, idk || IDK.has(k))]))
    : idk && typeof x === "number" ? (vis.has(x) ? x : HIDDEN) : x;
  return walk(m, false);
};
const untapped = (s, x) => s.bf.reduce((a, p) => a + (p.ctl === x && !p.tapped && CARDS[nameOf(p.id)]?.type === "land" ? 1 : 0), 0);

/** One event as `me` saw it: { marks (indices), ctx (CTX_N), turn }. `s` the position (true; only its observation is read). */
export function eventG(s, who, m, me, seenAfter = null, P = POOL, feat = {}) {
  const o = observe(s, me), vis = visibleIds(o);
  if (seenAfter) for (const id of seenAfter) vis.add(id);
  const pass = m.t === "pass", draw = m.t === "draw";
  // legacy marks (a block as its count): the events as every dealer so far was trained on (block pairs: the policy's, 18 Nov)
  const marks = pass || draw ? [] : generalMarks(o, me, mask(m, vis), P, true);
  const ctx = new Float32Array(ctxN(P, feat)), st = STEPS.indexOf(o.mull && !(o.mull.done?.[0] && o.mull.done?.[1]) ? "mull" : o.step);
  ctx[0] = who === other(me) ? 1 : 0; ctx[1] = pass ? 1 : 0; ctx[2] = draw ? Math.min(4, m.n) / 4 : 0;
  if (st >= 0) ctx[3 + st] = 1;
  let k = 3 + STEPS.length;
  const top = o.stack[o.stack.length - 1];
  ctx[k++] = o.active === who ? 1 : 0; ctx[k++] = o.stack.length ? 1 : 0; ctx[k++] = top && top.ctl !== who ? 1 : 0;
  ctx[k++] = Math.min(6, untapped(o, who)) / 6; ctx[k++] = Math.min(6, untapped(o, other(who))) / 6;
  ctx[k++] = Math.min(10, o.hand[who].length) / 10; ctx[k++] = Math.min(10, o.hand[other(who)].length) / 10;
  ctx[k++] = Math.min(80, o.lib.length) / 80; ctx[k++] = Math.max(0, Math.min(20, o.life?.[who] ?? 20)) / 20; ctx[k++] = Math.max(0, Math.min(20, o.life?.[other(who)] ?? 20)) / 20;
  if (feat.a) {
    // could it have cast each card the seat hasn't seen, there and then: the timing (an instant or flash with priority, any other
    // spell in its own main phase on an empty stack) and the mana open (affords: the lands untapped and the pool)
    const main = o.active === who && /^main/.test(o.step || "") && !o.stack.length, unseen = new Set((o.unseenIds || []).map(nameOf));
    P.vocab.forEach((n, j) => { if (unseen.has(n) && castOf(n).some(c => (c.instant || main) && affords(o, who, c.cost))) ctx[CTX_N + j] = 1; });
  }
  return { marks, ctx, turn: o.turn || 0 };
}

/** The record as `me` sees it (honest, as Record12: every move but a pass of priority, then every priority point and draw it led to). */
export class RecordG {
  constructor(me, P = POOL, feat = {}) { this.me = me; this.P = P; this.feat = feat; this.events = []; this.came = []; }
  update(s, who, m, after) {
    const seen = visibleIds(observe(after, this.me));
    if (m.t !== "pass" || s.pending) this.events.push(eventG(s, who, m, this.me, seen, this.P, this.feat));
    for (const p of after.passPoints || []) this.events.push(eventG(p.s, p.seat, p.draw ? { t: "draw", n: p.draw } : { t: "pass" }, this.me, null, this.P, this.feat));
    // the other hand's intake (feat b): the cards that came into it on this move, by turn (a rise in its size; a move that both
    // plays and draws counts what it drew less what it played, so the ages are lower bounds)
    if (this.feat.b) { const o = other(this.me), up = after.hand[o].length - s.hand[o].length; if (up > 0) this.came.push([after.turn || 0, up]); }
  }
  /** feat b: of the hidden cards in the other hand, how many must have been held AGES turns or more, ÷7 */
  ages(s, hidden) {
    const now = s.turn || 0, n = s.hand[other(this.me)].length;
    return AGES.map(k => { let since = 0; for (const [t, c] of this.came) if (t > now - k) since += c; return Math.max(0, Math.min(hidden, n - since)) / 7; });
  }
}

/** What the guess is about at a position: the unseen copies by pool slot, the cards to guess (hidden hand + library places only
 *  they know) and their true names (for the packer and the scorecard; null where the seat runs it). */
export function targetsOf(s, me, P = POOL, truth = true) {
  const o = observe(s, me), opp = other(me), vis = visibleIds(o), u = new Float32Array(P.V);
  for (const id of o.unseenIds) { const i = P.at.get(nameOf(id)); if (i != null) u[i]++; }
  const handN = o.hand[opp].filter(id => id < 0).length, libN = o.theirLib?.length || 0;
  let names = null;
  if (truth) {
    const known = new Set(o.hand[opp].filter(id => id >= 0));
    names = [...s.hand[opp].filter(id => !known.has(id)), ...(o.theirLib || []).map(i => s.lib[i])].map(id => P.at.get(nameOf(id)));
  }
  return { u, handN, libN, names, vis };
}
/** The position's input (posSize): generalView with no belief, the unseen copies (÷4), the cards to guess in the hand and in the
 *  library (÷7). */
export function posInput(s, me, t, P = POOL, out = new Float32Array(posSize(P)), rec = null) {
  const extra = rec?.feat?.b ? AGE_N : 0, b = out.length - P.V - 2 - extra;   // the view as long as the net reads (version 1 or 2)
  generalView(s, me, new Float32Array(P.V), null, P, out.subarray(0, b));
  for (let i = 0; i < P.V; i++) out[b + i] = t.u[i] / 4;
  out[b + P.V] = t.handN / 7; out[b + P.V + 1] = t.libN / 7;
  if (extra) rec.ages(s, t.handN).forEach((v, i) => (out[b + P.V + 2 + i] = v));
  return out;
}

// ---------- the net (lab/zero/scryg_torch.py's export: dense float layers) ----------
const F = a => Float32Array.from(a);
/** y = W·x + b for a dense W (nOut × nIn, row-major), x sparse-ish. */
function affine(W, b, x, nIn, nOut, out = new Float32Array(nOut)) {
  out.set(b);
  for (let i = 0; i < nIn; i++) { const v = x[i]; if (!v) continue; for (let o = 0; o < nOut; o++) out[o] += v * W[o * nIn + i]; }
  return out;
}
const relu = a => { for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0; return a; };

export class ScryG {
  /** me: the seat; net: the export ({ P: sizes, Wx, bx, We, be, Wq, Wk, wa, Wv, W1, b1, Wc, W2, b2, D, A, H }). */
  constructor(me, net, P = POOL) {
    const n = net, feat = n.feat || {};
    this.me = me; this.P = P; this.feat = feat; this.CN = ctxN(P, feat); this.rec = new RecordG(me, P, feat); this.embs = [];
    if (n.V !== P.V || n.EV !== evSize(P, feat) || ![posSize(P, 1, feat), posSize(P, 2, feat)].includes(n.X)) throw new Error("Scry G: the net's sizes differ from the code's");
    this.X = n.X;
    Object.assign(this, { D: n.D, A: n.A, H: n.H });
    for (const k of ["Wx", "bx", "We", "be", "Wq", "Wk", "wa", "Wv", "W1", "b1", "Wc", "W2", "b2"]) this[k] = F(n[k]);
  }
  update(s, who, m, after) {
    this.rec.update(s, who, m, after);
    const EV = evSize(this.P, this.feat), D = this.D;
    for (let j = this.embs.length; j < this.rec.events.length; j++) {
      const ev = this.rec.events[j], e = Float32Array.from(this.be);
      for (const i of ev.marks) for (let o = 0; o < D; o++) e[o] += this.We[o * EV + i];
      for (let i = 0; i < this.CN; i++) { const v = ev.ctx[i]; if (v) for (let o = 0; o < D; o++) e[o] += v * this.We[o * EV + this.P.MARK_N + i]; }
      relu(e);
      // its key and value, kept (the age term is added at the query)
      const kk = affine(this.Wk, new Float32Array(this.A), e, D, this.A), vv = affine(this.Wv, new Float32Array(D), e, D, D);
      this.embs.push({ e, k: kk, v: vv, turn: ev.turn });
    }
  }
  /** The position's share of the hidden layer: g (H), from the position and the record read by attention. */
  base(s) {
    const t = targetsOf(s, this.me, this.P, false), x = posInput(s, this.me, t, this.P, new Float32Array(this.X), this.rec), X = x.length, { D, A, H } = this;
    const h0 = relu(affine(this.Wx, this.bx, x, X, H)), q = affine(this.Wq, new Float32Array(A), h0, H, A), now = s.turn || 0;
    const T = this.embs.length, sc = new Float32Array(T), c = new Float32Array(D), mean = new Float32Array(D);
    let top = -Infinity;
    for (let j = 0; j < T; j++) {
      const E = this.embs[j], age = Math.min(20, now - E.turn) / 10;
      let z = 0; for (let a = 0; a < A; a++) z += q[a] * (E.k[a] + this.wa[a] * age);
      sc[j] = z / Math.sqrt(A); if (sc[j] > top) top = sc[j];
    }
    let zs = 0;
    for (let j = 0; j < T; j++) { sc[j] = Math.exp(sc[j] - top); zs += sc[j]; }
    for (let j = 0; j < T; j++) { const w = sc[j] / zs, E = this.embs[j]; for (let o = 0; o < D; o++) { c[o] += w * E.v[o]; mean[o] += E.e[o] / T; } }
    const cat = new Float32Array(H + 2 * D); cat.set(h0); cat.set(c, H); cat.set(mean, H + D);
    const g = affine(this.W1, this.b1, cat, H + 2 * D, H);
    return { g, t };
  }
  /** A card's odds by pool slot: g the position's share, dealt the counts dealt before it, u the unseen copies. */
  card(g, dealt, u) {
    const { H } = this, V = this.P.V, h = Float32Array.from(g);
    for (let k = 0; k < V; k++) { const v = dealt[k]; if (v) for (let o = 0; o < H; o++) h[o] += (v / 4) * this.Wc[o * V + k]; }
    relu(h);
    const z = affine(this.W2, this.b2, h, H, V);
    let top = -Infinity;
    for (let k = 0; k < V; k++) { const left = u[k] - dealt[k]; z[k] = left > 0 ? z[k] + Math.log(left) : -Infinity; if (z[k] > top) top = z[k]; }
    let sum = 0;
    for (let k = 0; k < V; k++) { z[k] = z[k] === -Infinity ? 0 : Math.exp(z[k] - top); sum += z[k]; }
    for (let k = 0; k < V; k++) z[k] = sum ? z[k] / sum : 0;
    return z;
  }
  /** The belief at s: kept for the dealer; the expected counts by pool slot and the chance of at least one, from `hands` hands. */
  belief(s, hands = 256) {
    const { g, t } = this.base(s), V = this.P.V;
    this.last = { g, u: t.u, n: t.handN + t.libN, handN: t.handN, memo: new Map() };
    const counts = new Float32Array(V), any = new Float32Array(V), rng = lcg(1 + this.rec.events.length), A = answers(this.P);
    // the hand's cards alone (18 Nov 2026: the guess deals the hand first, then the library places only they know; those were
    // counted as hand cards before); ans (view version 3's counter window): the share of the hands dealt that hold an answer
    let ans = 0;
    if (this.last.n) for (let h = 0; h < hands; h++) {
      const d = this.hand(rng, this.legacy ? this.last.n : this.last.handN).dealt;   // legacy: as the nets before 18 Nov were trained (makeGeneral)
      let held = false;
      for (let k = 0; k < V; k++) if (d[k]) { counts[k] += d[k] / hands; any[k] += 1 / hands; if (A[k]) held = true; }
      if (held) ans += 1 / hands;
    }
    return { counts, any, ans };
  }
  next(dealt, key) { const L = this.last; let p = L.memo.get(key); if (!p) { p = this.card(L.g, dealt, L.u); L.memo.set(key, p); } return p; }
  /** One whole guess (all the cards to guess, card after card): slots in order, the counts, the log chance. */
  hand(rng, n = this.last.n) {
    const V = this.P.V, dealt = new Float32Array(V), slots = [];
    let key = "", lp = 0;
    for (let j = 0; j < n; j++) {
      const p = this.next(dealt, key);
      let r = rng(), c = 0; while (c < V - 1 && (r -= p[c]) > 0) c++;
      lp += Math.log(p[c] || 1e-12); dealt[c]++; key += c + "."; slots.push(c);
    }
    return { slots, dealt, lp };
  }
  // the dealer's interface (the search, the particle wall): names
  sample(k, rng) { const h = this.hand(rng, k); return { names: h.slots.map(i => this.P.vocab[i]), logq: h.lp }; }
  logProb(names) {
    const V = this.P.V, dealt = new Float32Array(V);
    let key = "", lp = 0;
    for (const n of names) { const c = this.P.at.get(n), p = this.next(dealt, key); lp += Math.log((c != null ? p[c] : 0) || 1e-12); dealt[c]++; key += c + "."; }
    return lp;
  }
  marginal() { const p = this.next(new Float32Array(this.P.V), ""), m = new Map(); this.P.vocab.forEach((n, k) => m.set(n, p[k])); return m; }
  /** A dealer for determinize: the hidden hand's cards, then the library's unseen places (those only they know from the guess,
   *  the rest shuffled), from one guess. The guess's first cards fill the hand, the rest their library places (which went where,
   *  only they know: in the order dealt). */
  deal() {
    const L = this.last;
    return (pool, n, rng) => {
      if (!L) return null;
      const { slots } = this.hand(rng), left = pool.slice(), take = k => { const j = left.findIndex(id => this.P.at.get(nameOf(id)) === k); return j < 0 ? null : left.splice(j, 1)[0]; };
      for (let i = left.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [left[i], left[j]] = [left[j], left[i]]; }
      // a guessed card the pool doesn't hold (one the seat is searching for stays where it is): a card of the pool at random instead
      const hand = slots.slice(0, n).map(take).map(id => (id == null ? left.pop() : id));
      return [...hand, ...left];
    };
  }
  /** The scorecard: −log chance of the true cards, as a chain and card by card (each with nothing dealt before it). */
  // only: the first `only` targets (the hidden hand's, which come first): the same cards Scry 1.2 is scored on (belief-eval.mjs)
  score(s, only = Infinity) {
    const t = targetsOf(s, this.me, this.P, true), { g } = this.base(s), V = this.P.V, dealt = new Float32Array(V), none = new Float32Array(V);
    let chain = 0, each = 0;
    if (only < t.names.length) t.names = t.names.slice(0, only);
    for (const y of t.names) { const p1 = this.card(g, none, t.u), pc = this.card(g, dealt, t.u); each -= Math.log((p1[y] || 0) + 1e-9); chain -= Math.log((pc[y] || 0) + 1e-9); dealt[y]++; }
    return { chain, each, n: t.names.length, p1: this.card(g, none, t.u), names: t.names };
  }
}
const lcg = x => () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
