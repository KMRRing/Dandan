// The particle wall (17 Nov 2026, Korbi 14:31-15:57): "start with the current game state, identify the cards that you don't yet
// know, and think what could they be", the dealer proposing, the policy judging, the unlikely replaced.
//
// A world is a guess at the cards the other player knows and the seat doesn't: their hidden hand, and the library places only they
// know (cards they put back on top or on the bottom, or looked at: observe's theirLib), which come from what they held or saw,
// not from the unseen pool at random (Korbi 16:14). The rest of the library is the rest of the unseen cards, in an order nobody
// knows, shuffled afresh at every deal. Before every search (ensure):
//   - the worlds follow what happened since the last search: a card that came out of the hidden hand where the seat can see it
//     (cast, played, discarded face up) leaves each world's hand (a world without it is impossible and goes); cards drawn unseen
//     join each world's hand as random cards of the unseen pool (a draw is random); cards that left unseen (put back) leave at
//     random;
//   - each world is weighed by the other player's decisions since (back-calculated, below);
//   - worlds weighing under `cut` (1%) of the heaviest are replaced by new ones the dealer deals (the belief net reading the
//     whole record: Scry 1.2 until the general dealer), each weighed on the other player's last `window` decisions;
//   - the search deals each of its worlds from one drawn by weight.
// The judge (back-calculation): at a past decision of theirs, the position as the seat saw it, their hidden cards filled from the
// world's hand (as many as they held then, drawn from it; the cards that decision showed among them), the policy's chance of the
// play they made there (the options that look the same to the seat summed), softened: (1 − eps)·p + eps·(a random player's
// share), raised to beta. Which of a world's cards were held at each decision isn't known; it is guessed at random from the
// world's hand. Nothing here names a card or a rule: the engine passes the options, the ids' names and the fields holding ids.
import { observe, HIDDEN } from "../../dandan-view.js";

const other = x => 1 - x;
const lcg = x => () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
const logsumexp = a => { if (!a.length) return -Infinity; const m = Math.max(...a); return m === -Infinity ? m : m + Math.log(a.reduce((t, x) => t + Math.exp(x - m), 0)); };
const J = x => JSON.parse(JSON.stringify(x));

export class Wall {
  /**
   * me: the seat; engine: { options(s, seat), nameOf(id), IDKEYS }; policy(s, seat, ms) the policy's chances of the options
   * (null: a random player's); dealer: { sample(k, rng) → { names } } at the current position (null: random hands).
   * n worlds; window: the other player's decisions a new world is weighed on; cut: a world under this share of the heaviest is
   * replaced.
   */
  constructor(me, engine, { policy = null, dealer = null, n = 1024, eps = 0.05, beta = 1, window = 40, cut = 0.01, seed = 1 } = {}) {
    Object.assign(this, { me, E: engine, policy, dealer, N: n, eps, beta, window, cut });
    this.rng = lcg(seed * 7919 + me + 1);
    this.IDK = new Set(engine.IDKEYS);
    this.decisions = [];   // the other player's decisions: { view (before), m (masked), before (ids seen), shown (names) }
    this.worlds = []; this.view = null; this.done = 0;   // done: decisions already weighed into the worlds
    this.stats = { dealt: 0, gone: 0, replaced: 0, weighed: 0 };
  }

  // ---------- what the seat sees ----------
  visible(v) {
    const ids = new Set(), add = id => { if (id >= 0) ids.add(id); };
    for (const z of [v.hand[0], v.hand[1], v.lib, v.yard, v.exile]) z.forEach(add);
    v.bf.forEach(p => add(p.id)); v.stack.forEach(it => typeof it.card === "number" && add(it.card));
    return ids;
  }
  /** The move with every card id the seat doesn't see (before or after) as HIDDEN. */
  mask(m, vis) {
    const walk = (x, idk) => Array.isArray(x) ? x.map(y => walk(y, idk)) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, idk || this.IDK.has(k))]))
      : idk && typeof x === "number" ? (vis.has(x) ? x : HIDDEN) : x;
    return walk(m, false);
  }
  /** Could option `b` be the move `a` (the real one, masked)? Ids seen before: the same id; seen only after (a card it showed):
   *  the same card; unseen: any. */
  same(a, b, before, idk = false) {
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => this.same(x, b[i], before, idk));
    if (a && typeof a === "object") {
      if (!b || typeof b !== "object") return false;
      const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
      return ka.length === kb.length && ka.every(k => this.same(a[k], b[k], before, idk || this.IDK.has(k)));
    }
    if (idk && typeof a === "number" && typeof b === "number") return a === HIDDEN || (before.has(a) ? a === b : this.E.nameOf(a) === this.E.nameOf(b));
    return a === b;
  }
  /** The ids the seat can't see in a view (the other hand's hidden cards and the library's). */
  unseen(v) { const vis = this.visible(v), out = []; for (const id of this.all) if (!vis.has(id)) out.push(id); return out; }
  /** How many of the other hand's cards the seat can't see. */
  hiddenCount(v) { return v.hand[other(this.me)].filter(id => id < 0).length; }
  /** How many cards a world names: the hidden hand and the library places only the other player knows. */
  heldCount(v) { return this.hiddenCount(v) + (v.theirLib?.length || 0); }

  /** After every real move (true states in; only what the seat sees of them is kept). */
  seen(s, who, m, after) {
    const vb = observe(s, this.me), va = observe(after, this.me);
    if (!this.all) {
      // every card id of the game (the seat knows the decks; ids are where cards sit, not what they are): the first position's
      const ids = new Set();
      for (const z of [s.hand[0], s.hand[1], s.lib, s.yard, s.exile]) z.forEach(id => ids.add(id));
      s.bf.forEach(p => ids.add(p.id)); s.stack.forEach(it => typeof it.card === "number" && ids.add(it.card));
      this.all = [...ids].sort((a, b) => a - b);
    }
    if (who === other(this.me)) {
      const before = this.visible(vb), vis = new Set([...before, ...this.visible(va)]), mm = this.mask(m, vis);
      // the cards this decision showed out of the hidden hand (ids seen after, not before)
      const shown = [], walk = (x, idk) => Array.isArray(x) ? x.forEach(y => walk(y, idk)) : x && typeof x === "object" ? Object.entries(x).forEach(([k, y]) => walk(y, idk || this.IDK.has(k))) : idk && typeof x === "number" && x >= 0 && !before.has(x) && shown.push(this.E.nameOf(x));
      walk(mm, false);
      this.decisions.push({ view: vb, m: mm, before, shown });
    }
    this.view = va;
  }

  // ---------- the judge ----------
  /** The log likelihood (beta-tempered) of the other player's decision d had they held `hand` (names): the hidden cards they
   *  held then drawn from it at random, the cards the decision showed among them. */
  judge(d, hand, rng) {
    const opp = other(this.me), u = this.hiddenCount(d.view), pool = [...hand], held = [];
    for (const n of d.shown) { const j = pool.indexOf(n); if (j >= 0) pool.splice(j, 1); held.push(n); }
    while (held.length < u && pool.length) held.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const s = this.fill(d.view, held, rng, pool);
    if (!s) return this.beta * Math.log(this.eps);
    let ms;
    try { ms = this.E.options(s, opp); } catch { return 0; }
    if (ms.length < 2) return 0;
    const ok = ms.map(o => this.same(d.m, o, d.before)), k = ok.filter(Boolean).length, P = this.policy ? this.policy(s, opp, ms) : null;
    let p = 0;
    ms.forEach((_, i) => { if (ok[i]) p += P ? P[i] : 1 / ms.length; });
    this.stats.weighed++;
    return this.beta * Math.log((1 - this.eps) * p + this.eps * Math.max(k, 1) / ms.length);
  }
  /** A position the seat saw (v) made whole: the other hand's hidden cards given the names `held` (copies among the unseen), the
   *  rest of the unseen in random order in the hand's other hidden places and the library's. Null if a name has no copy left. */
  fill(v, held, rng, theirs = []) {
    const opp = other(this.me), byName = new Map();
    for (const id of this.unseen(v)) { const n = this.E.nameOf(id); if (!byName.has(n)) byName.set(n, []); byName.get(n).push(id); }
    const s = J(v);
    let k = 0;
    for (let i = 0; i < s.hand[opp].length; i++) if (s.hand[opp][i] < 0 && k < held.length) {
      const a = byName.get(held[k++]);
      if (!a?.length) return null;
      s.hand[opp][i] = a.splice(Math.floor(rng() * a.length), 1)[0];
    }
    // the library places only they know: the world's other cards there, in random order (which went where, nobody but they know)
    const mine = [...theirs];
    for (let i = mine.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [mine[i], mine[j]] = [mine[j], mine[i]]; }
    for (const i of v.theirLib || []) {
      const a = mine.length ? byName.get(mine.pop()) : null;
      if (a?.length) s.lib[i] = a.splice(Math.floor(rng() * a.length), 1)[0];
    }
    const rest = [...byName.values()].flat();
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    for (let i = 0; i < s.hand[opp].length; i++) if (s.hand[opp][i] < 0) { if (!rest.length) return null; s.hand[opp][i] = rest.pop(); }
    for (let i = 0; i < s.lib.length; i++) if (s.lib[i] < 0) { if (!rest.length) return null; s.lib[i] = rest.pop(); }
    s.tells = [{}, {}]; s.log = []; delete s.observer;
    return s;
  }

  // ---------- the worlds ----------
  /** A new world's hand: the dealer's for the hidden cards now (random unseen names without a dealer). */
  deal1() {
    const k = this.heldCount(this.view);
    if (this.dealer) return this.dealer.sample(k, this.rng).names;
    const names = this.unseen(this.view).map(id => this.E.nameOf(id)), out = [];
    for (let j = 0; j < k && names.length; j++) out.push(names.splice(Math.floor(this.rng() * names.length), 1)[0]);
    return out;
  }
  /** A world's hand brought up to the current view: the cards shown out of the hidden hand since leave it (a world without one is
   *  impossible), cards drawn unseen join it at random from the unseen pool, cards gone unseen leave it at random. */
  follow(w, from) {
    const k = this.heldCount(this.view);
    for (let i = from; i < this.decisions.length; i++) for (const n of this.decisions[i].shown) {
      const j = w.names.indexOf(n);
      if (j < 0) return false;
      w.names.splice(j, 1);
    }
    const pool = this.unseen(this.view).map(id => this.E.nameOf(id));
    for (const n of w.names) { const j = pool.indexOf(n); if (j < 0) return false; pool.splice(j, 1); }
    while (w.names.length < k && pool.length) w.names.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
    while (w.names.length > k) w.names.splice(Math.floor(this.rng() * w.names.length), 1);
    return w.names.length === k;
  }
  /**
   * Before a search: the worlds brought up to date and weighed, the unlikely replaced by the dealer's. Every world is weighed on
   * the same decisions, the other player's last `window` (an old world kept its judgments decision by decision; a new one is
   * judged on them when dealt), so old and new stand level.
   */
  ensure() {
    if (!this.view) return;
    const from = this.done, upto = this.decisions.length, lo = Math.max(0, upto - this.window), kept = [];
    for (const w of this.worlds) {
      const was = [...w.names];
      if (!this.follow(w, from)) { this.stats.gone++; continue; }
      // the decisions since, each on a hand it held then: the cards it had or has, with those the decision showed
      const pool = [...new Set([...was, ...w.names])];
      for (let i = from; i < upto; i++) w.terms.set(i, this.judge(this.decisions[i], pool, this.rng));
      for (const i of w.terms.keys()) if (i < lo) w.terms.delete(i);
      kept.push(w);
    }
    this.done = upto;
    const sum = w => { let t = 0; for (const v of w.terms.values()) t += v; return t; };
    for (const w of kept) w.logw = sum(w);
    const top = Math.max(...kept.map(w => w.logw), -Infinity);
    this.worlds = kept.filter(w => w.logw >= top + Math.log(this.cut));
    this.stats.replaced += kept.length - this.worlds.length;
    // new worlds from the dealer: the hand at each decision back in the window, the world's now with the cards shown since
    for (let t = 0; this.worlds.length < this.N && t < this.N * 2; t++) {
      const names = this.deal1(), w = { names: [...names], terms: new Map(), logw: 0 }, shownSince = [];
      for (let i = upto - 1; i >= lo; i--) {
        w.terms.set(i, this.judge(this.decisions[i], names.concat(shownSince), this.rng));
        shownSince.push(...this.decisions[i].shown);
      }
      w.logw = sum(w);
      this.worlds.push(w); this.stats.dealt++;
    }
  }
  weights() {
    const z = logsumexp(this.worlds.map(w => w.logw));
    return this.worlds.map(w => ({ w, p: Math.exp(w.logw - z) }));
  }
  ess() { const ws = this.weights(); return ws.length ? 1 / ws.reduce((a, x) => a + x.p * x.p, 0) : 0; }
  /** One world drawn by weight, or null. */
  draw(rng) {
    const ws = this.weights();
    if (!ws.length) return null;
    let r = rng(), k = 0; while (k < ws.length - 1 && (r -= ws[k].p) > 0) k++;
    return ws[k].w;
  }
  /** A whole position from a world drawn by weight (the other player's belief is read in it), or null. */
  sample(rng) {
    const w = this.draw(rng);
    if (!w) return null;
    const { hand, lib } = this.split(w.names, rng);
    return this.fill(this.view, hand, rng, lib);
  }
  /** A world's names split: as many as the hand hides for the hand, the rest for the library places only they know (at random:
   *  which went back, nobody but they know). */
  split(names, rng) {
    const a = [...names];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const k = this.hiddenCount(this.view);
    return { hand: a.slice(0, k), lib: a.slice(k) };
  }
  /** A dealer for determinize (pool, n, rng) → the other hand's hidden cards then the library's: a world drawn by weight, its
   *  names on copies in the pool, the rest of the pool shuffled (the unseen library's order is nobody's). Null: deal as before. */
  deal() {
    if (!this.worlds.length) return null;
    const v = this.view, hidLib = []; v.lib.forEach((id, i) => { if (id < 0) hidLib.push(i); });
    const theirs = new Set(v.theirLib || []);
    return (pool, n, rng) => {
      const w = this.draw(rng);
      if (!w || w.names.length !== this.heldCount(v) || n !== this.hiddenCount(v)) return null;
      const { hand: hn, lib: ln } = this.split(w.names, rng), left = pool.slice(), take = nm => { const j = left.findIndex(id => this.E.nameOf(id) === nm); return j < 0 ? null : left.splice(j, 1)[0]; };
      const hand = hn.map(take), mine = ln.map(take);
      if (hand.includes(null) || mine.includes(null)) return null;
      for (let i = left.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [left[i], left[j]] = [left[j], left[i]]; }
      // the library's unseen places in order (determinize's): theirs from the world, the others from the shuffled rest
      if (pool.length !== n + hidLib.length) return [...hand, ...mine, ...left];   // a search of the seat's pins some: as before
      const lib = hidLib.map(i => (theirs.has(i) ? mine.pop() : left.pop()));
      return [...hand, ...lib];
    };
  }
  /** The weighted chance of each name among the other hand's hidden cards. */
  counts() {
    const out = new Map();
    for (const { w, p } of this.weights()) for (const n of w.names) out.set(n, (out.get(n) || 0) + p);
    return out;
  }
}
