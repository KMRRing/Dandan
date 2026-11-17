// The particle wall (17 Nov 2026, Korbi 14:31-14:38: "the general dealer should consume the game state, the past actions,
// decisions, the current particle filter, and deal the most likely belief states that currently aren't reflected in the
// particle filter. then the particle filter should back calculate for each the probability based on the policy network
// simulation. if it's not a possible hand, try a few more times. if it continues to fail … gibbs … on survivors").
//
// A particle is a whole hidden world: the game as it could truly be, played by the rules engine from the deal on, every card the
// seat can't see somewhere definite. After every move the wall plays the move in each world:
//   - its own moves as they were; the other player's as the rules allow them there, keeping only those whose result looks
//     the same to the seat as what really happened (a card cast from the hand names it; a card put back names none);
//   - the other player's decision weighs the world by how likely the policy net makes that play there (the sum over the
//     options that look the same), softened: (1 − eps)·p + eps·(the share a random player would give), raised to beta (< 1:
//     one surprising play, a bluff, a mistake or a human, doesn't wipe out the world holding the true hand);
//   - a world where the play could not have happened is dead.
// What the seat sees is kept equal in every world: a card it sees has the same id there (copies of one card are swapped freely,
// they are the same card), and where a world holds the wrong card where the seat now sees one (a draw), that card is swapped
// with one nobody has seen (a library card neither player knows), which no decision can have depended on. Nothing else moves.
//
// The real game stops only where a player has something to do, which hangs on their hand; the world's rules stop at every
// priority and the world is played on, each passing, to where the real game stands (the world never learns from where the real
// game stopped). A card is exchanged in a world only for one no decision can have depended on (a library card neither player
// has seen, or any card before the other player's first decision); a world that can't show what the real game shows any other
// way is impossible, and dies (Korbi 15:42: no repairs: the dealer deals new worlds instead).
//
// Before each search (ensure): the wall resampled when it thins (equal weights), then moved by Metropolis-Hastings (`moves`):
// a whole-hand move (the dealer deals the other hand's hidden cards; the world played again from the deal with the same chance
// and the same plays; kept with the chance of the likelihood's ratio: the judge's verdict on the dealer's proposal), and a one-card
// move (Gibbs's cheap form). mode "poe" (the default for the general Monte): the belief is the dealer's × the plays' likelihood;
// "is": the random deal's × the likelihood. A world dies where the real game rules it out; an empty wall leaves the search to Scry.
//
// Nothing in it names a card or a rule: the engine is passed in (dealing, a move, a copy, the options, the ids' names, the
// fields that hold ids). The search deals its worlds from the wall: each deal a world drawn by weight.
import { observe, HIDDEN } from "../../dandan-view.js";

const other = x => 1 - x;
const lcg = x => () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
const logsumexp = a => { const m = Math.max(...a); return m === -Infinity ? m : m + Math.log(a.reduce((t, x) => t + Math.exp(x - m), 0)); };

/** Every zone position of a state or a view that holds a card: [get, set] pairs, in a fixed order. */
function slots(s) {
  const out = [];
  const arr = (a, tag) => a.forEach((_, i) => out.push([() => a[i], v => (a[i] = v), tag, i]));
  arr(s.hand[0], "h0"); arr(s.hand[1], "h1"); arr(s.lib, "lib"); arr(s.yard, "yard"); arr(s.exile, "exile");
  s.bf.forEach((p, i) => out.push([() => p.id, v => (p.id = v), "bf", i]));
  s.stack.forEach((it, i) => { if (typeof it.card === "number") out.push([() => it.card, v => (it.card = v), "st", i]); });
  return out;
}
/** Where a game stands, in the fields a pass moves on (and the zones' sizes): a world playing on stops when it reaches the real one. */
const sig = s => JSON.stringify([s.turn, s.step, s.active, s.prio, s.passes, s.stack.length, s.pending ? [s.pending.t, s.pending.seat] : 0, s.over, zoneSizes(s), s.life]);
const zoneSizes = s => [s.hand[0].length, s.hand[1].length, s.lib.length, s.yard.length, s.exile.length, s.bf.length, s.stack.length].join(",");

export class Wall {
  /**
   * me: the seat; engine: { deal(rng) a fresh game, act(s, seat, m, rng) (s moved, or a string), copy(s), options(s, seat),
   * nameOf(id), IDKEYS (the keys whose numbers are card ids), refresh?(s) (questions re-asked after a deal is changed) };
   * policy(s, seat, ms) the policy's chances of the options (null: a random player); dealer: { sample(k, rng) → names, logq
   * } at the current position (null: no proposals, the random deal only).
   */
  constructor(me, engine, { policy = null, dealer = null, n = 32, eps = 0.05, beta = 0.5, lambda = 0.25, tries = 3, moves = 8, seed = 1, rngOf = null, refresh = 0, mode = "is", passes = 1 } = {}) {
    // rngOf(i): the chance the rules use at move i (the lab's test passes the game's own, so the true deal replays exactly).
    // refresh: new worlds from the dealer before every search (Korbi: "deal the most likely belief states that currently aren't
    // reflected"), the lightest worlds making room. mode: "is" weighs a dealt world by its plays × prior ÷ the dealer's chance
    // (importance sampling: the belief is the plays' alone); "poe" by its plays alone, the dealer's deal its prior (the dealer
    // and the policy as two experts multiplied: what the dealer learnt counts, the history counted twice; tempered by beta)
    // passes: the other player's passes on the way weighed too (0: only their plays seen)
    Object.assign(this, { me, E: engine, policy, dealer, N: n, eps, beta, lambda, tries, movesMH: moves, rngOf, refresh, mode, passes });
    this.rng = lcg(seed * 7919 + me + 1);
    this.events = []; this.parts = []; this.base = null; this.stats = { born: 0, dead: 0, mh: 0, accepted: 0, rejuvenated: 0 };
    this.IDK = new Set(engine.IDKEYS);
  }

  // ---------- the seat's view ----------
  /** The view's comparable form: everything the seat sees, the bookkeeping fields aside, knowledge only of cards it sees. */
  key(v) {
    const vis = this.visible(v), o = {}, opp = other(this.me);
    for (const k of Object.keys(v).sort()) if (!SKIP.has(k)) o[k] = v[k];
    // the other hand as a set: the cards the seat knows there and how many it doesn't (the order of a hand is where its cards came
    // in, and which of them left unseen is not the seat's to know)
    o.hand = [v.hand[this.me], { known: v.hand[opp].filter(id => id >= 0).sort((a, b) => a - b), hidden: v.hand[opp].filter(id => id < 0).length }];
    // a question of the seat's that lists cards it can't otherwise see (a search of the library): their names, as a set
    if (v.pending && v.pending.seat === this.me) o.pending = this.named(v.pending, vis);
    const kn = list => (list || []).filter(e => vis.has(e[0])).map(e => `${e[0]}:${e[1]}`).sort();
    o.kn = kn(v.kn); o.kh = kn(v.kh);
    // cards shown and gone back (a free mulligan's hand): what was seen is their names, not which copy
    if (v.reveal) o.reveal = { seat: v.reveal.seat, cards: v.reveal.cards.map(id => this.E.nameOf(id)) };
    return JSON.stringify(o);
  }
  /** A question's first list of cards (an array under an id key: a search's cards), or null. */
  listOf(q) {
    let out = null;
    const walk = (x, idk) => { if (out) return; if (Array.isArray(x)) { if (idk && x.length && x.every(y => typeof y === "number")) out = x; else x.forEach(y => walk(y, idk)); } else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, idk || this.IDK.has(k)); };
    walk(q, false);
    return out;
  }
  /**
   * A card a question lists in the real game (a search of the library, the top cards to order) that the world's question lacks:
   * a listed card the list doesn't need (`need`: the names it must hold) exchanged for a copy of `name` from the library that
   * neither player has seen (the question being the first decision on those cards). False if there is none: the world dies.
   */
  relist(p, v, name, need) {
    const q = p.s.pending, list = q && this.listOf(q);
    if (!list) return false;
    const vis = this.visible(v), listed = new Set(list), opp = other(this.me), kn = new Map(p.s.kn), pick = a => a[Math.floor(p.rng() * a.length)];
    const lib = p.s.lib.filter((id, i) => v.lib[i] === HIDDEN && !listed.has(id) && !((kn.get(id) || 0) & (1 << opp)) && this.E.nameOf(id) === name);
    const spare = list.filter(id => !vis.has(id) && !need.has(this.E.nameOf(id)));
    if (!spare.length || !lib.length) return false;
    this.swap(p, pick(spare), pick(lib));
    return true;
  }
  /** A question's card lists with the cards the seat can't see as names, sorted. */
  named(q, vis) {
    const walk = (x, idk) => Array.isArray(x) ? (idk && x.every(y => typeof y === "number") ? x.map(y => (vis.has(y) ? y : this.E.nameOf(y))).sort() : x.map(y => walk(y, idk)))
      : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, idk || this.IDK.has(k))])) : idk && typeof x === "number" && !vis.has(x) ? this.E.nameOf(x) : x;
    return walk(q, false);
  }
  visible(v) {
    const ids = new Set();
    for (const [get] of slots(v)) { const id = get(); if (id >= 0) ids.add(id); }
    return ids;
  }
  /** The move with every card id the seat doesn't see (before or after) as HIDDEN. */
  mask(m, vis) {
    const walk = (x, idk) => Array.isArray(x) ? x.map(y => walk(y, idk)) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, idk || this.IDK.has(k))]))
      : idk && typeof x === "number" ? (vis.has(x) ? x : HIDDEN) : x;
    return walk(m, false);
  }
  /** Could option `b` (a world's) be the move `a` (the real one, masked)? Ids seen before the move: the same id; seen only after
   *  it (a card it showed): the same card; unseen: any. */
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

  // ---------- a world's cards ----------
  /** Two cards exchanged everywhere in a world (and in its record of where each began). */
  swap(p, a, b) {
    if (a === b) return;
    const sw = x => (x === a ? b : x === b ? a : x), S = p.s;
    for (const [get, set] of slots(S)) set(sw(get()));
    for (const e of S.kn) e[0] = sw(e[0]);
    for (const e of S.kh || []) e[0] = sw(e[0]);
    // (a card shown in the past stays the card shown: the record of what was seen is not moved; it is compared by name)
    const deep = (x, idk) => {
      if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) { if (idk && typeof x[i] === "number") x[i] = sw(x[i]); else deep(x[i], idk); } }
      else if (x && typeof x === "object") for (const k of Object.keys(x)) { const v = x[k], ik = idk || this.IDK.has(k); if (ik && typeof v === "number") x[k] = sw(v); else deep(v, ik); }
    };
    deep(S.pending, false); deep(S.combat, false);
    for (const it of S.stack) { if (typeof it.src === "number") it.src = sw(it.src); deep(it.d, false); }
    const fa = p.fill.get(a), fb = p.fill.get(b);
    if (fb !== undefined) p.fill.set(a, fb); else p.fill.delete(a);
    if (fa !== undefined) p.fill.set(b, fa); else p.fill.delete(b);
  }
  /** Ids no one could have told apart from another (a library card neither player knows; at the deal also the other hand). */
  free(p, v, name) {
    const out = [], S = p.s, opp = other(this.me), kn = new Map(S.kn);
    S.lib.forEach((id, i) => { if (v.lib[i] === HIDDEN && !((kn.get(id) || 0) & (1 << opp)) && !p.keep?.has(id) && this.E.nameOf(id) === name) out.push(id); });
    if (p.fresh) for (const id of this.hiddenIn(p, v)) if (!p.keep?.has(id) && this.E.nameOf(id) === name) out.push(id);
    return out;
  }
  /** The world's cards in the other hand that the seat doesn't know are there (the hand a set: v's known cards aside). */
  hiddenIn(p, v) { const opp = other(this.me), known = new Set(v.hand[opp].filter(id => id >= 0)); return p.s.hand[opp].filter(id => !known.has(id)); }
  /** Whether a card lies in the world's library where neither player knows it (v: what the seat sees there). */
  isFree(p, v, id) {
    const i = p.s.lib.indexOf(id);
    if (i < 0 || v.lib[i] !== HIDDEN) return false;
    const e = p.s.kn.find(x => x[0] === id);
    return !e || !(e[1] & (1 << other(this.me)));
  }
  /** The world made to show what the seat sees in `v`: false if it can't be. */
  reconcile(p, v) {
    if (zoneSizes(p.s) !== zoneSizes(v)) { if (this.debug) this.why2 = `sizes ${zoneSizes(p.s)} ≠ ${zoneSizes(v)}`; return false; }
    const want = slots(v), opp = other(this.me), oh = `h${opp}`;
    for (let j = 0; j < want.length; j++) {
      const c = want[j][0]();
      if (c < 0 || want[j][2] === oh) continue;
      const here = slots(p.s)[j], d = here[0]();
      if (d === c) continue;
      if (this.E.nameOf(d) !== this.E.nameOf(c)) {
        const f = this.free(p, v, this.E.nameOf(c));
        if (!f.length) { this.missing = { mine: this.E.nameOf(c), d }; if (this.debug) this.why2 = `no ${this.E.nameOf(c)} for ${here[2]} ${here[3]}`; return false; }
        this.swap(p, d, f[Math.floor(p.rng() * f.length)]);
      }
      this.swap(p, here[0](), c);   // the same card: only which copy
    }
    // the other hand as a set: each card the seat knows there, there in the world (a copy of it there renamed)
    for (const c of v.hand[opp]) {
      if (c < 0 || p.s.hand[opp].includes(c)) continue;
      const hid = this.hiddenIn(p, v).filter(id => this.E.nameOf(id) === this.E.nameOf(c));
      if (hid.length) { this.swap(p, hid[0], c); continue; }
      this.missing = { theirs: [this.E.nameOf(c)] };
      if (this.debug) this.why2 = `their hand lacks ${this.E.nameOf(c)}`;
      return false;
    }
    // a question of the seat's listing cards it can't otherwise see (a search of its library): the same names in the world
    if (v.pending && v.pending.seat === this.me && p.s.pending) {
      const vis = this.visible(v), list = q => { const out = []; const walk = (x, idk) => Array.isArray(x) ? x.forEach(y => (idk && typeof y === "number" ? !vis.has(y) && out.push(y) : walk(y, idk))) : x && typeof x === "object" && Object.entries(x).forEach(([k, y]) => walk(y, idk || this.IDK.has(k))); walk(q, false); return out; };
      const real = list(v.pending).map(id => this.E.nameOf(id)), mine = list(p.s.pending);
      const need = new Map(); for (const n of real) need.set(n, (need.get(n) || 0) + 1);
      const extra = [];
      for (const id of mine) { const n = this.E.nameOf(id); if (need.get(n) > 0) need.set(n, need.get(n) - 1); else extra.push(id); }
      const needs = new Set(real);
      for (const [n, k] of need) for (let t = 0; t < k; t++) {
        // a card of the name the real list has and the world's lacks: from the library cards neither player has seen
        if (!this.relist(p, v, n, needs)) { this.missing = { listed: n, names: real }; if (this.debug) this.why2 = `the question lists no ${n}`; return false; }
      }
      if (extra.length) { if (this.debug) this.why2 = "the question lists more"; return false; }
    }
    // cards shown and gone back (a free mulligan's hand, now in the library): the same names, swapped in from cards nobody knows
    if (v.reveal) {
      if (!p.s.reveal || p.s.reveal.cards.length !== v.reveal.cards.length) return false;
      if (!p.fresh && v.reveal.cards.some((id, i) => this.E.nameOf(id) !== this.E.nameOf(p.s.reveal.cards[i]))) return false;
      for (let i = 0; i < v.reveal.cards.length; i++) {
        const want = this.E.nameOf(v.reveal.cards[i]), d = p.s.reveal.cards[i];
        if (this.E.nameOf(d) === want) continue;
        const kn = new Map(p.s.kn), opp = other(this.me), loose = id => p.s.lib.includes(id) && !((kn.get(id) || 0) & (1 << opp));
        if (!loose(d)) return false;
        const f = this.free(p, v, want);
        if (!f.length) return false;
        this.swap(p, d, f[Math.floor(p.rng() * f.length)]);
      }
    }
    this.E.refresh?.(p.s);   // the questions the rules ask of a hand, asked of the hand as it now is
    return true;
  }

  // ---------- following the game ----------
  /** After every real move: `s` the position, `who` the mover, `m` the move, `after` where it led. Only what the seat sees of
   *  them is kept. */
  seen(s, who, m, after) {
    const vb = observe(s, this.me), va = observe(after, this.me), before = this.visible(vb), seenIds = new Set([...before, ...this.visible(va)]);
    if (!this.base && !this.off) this.begin(vb);
    if (!this.base) return;
    const ev = { who, m: who === this.me ? m : this.mask(m, seenIds), before, view: va, key: this.key(va) };
    this.events.push(ev);
    const i = this.events.length - 1;
    for (const p of this.parts) if (p.alive && !this.step(p, ev, i)) { p.alive = false; this.stats.dead++; const k = String(this.why).replace(/:.*/, "") + ` (${ev.m.t})`; (this.stats.why ||= {})[k] = (this.stats.why[k] || 0) + 1; }
    this.view = va;
  }
  /** The first position seen: the deal the worlds start from (a fresh deal made to show what the seat sees). */
  begin(v0) {
    this.v0 = v0; this.key0 = this.key(v0);
    for (let t = 0; t < 64 && !this.base; t++) {
      const r = lcg(Math.floor(this.rng() * 2 ** 31)), p = { s: this.E.deal(r, v0), fill: new Map(), fresh: true, rng: r };
      if (p.s.first !== v0.first || !this.reconcile(p, v0)) continue;
      this.E.refresh?.(p.s);
      if (this.key(observe(p.s, this.me)) !== this.key0) continue;
      // the positions the seat can't see at the deal, and the cards in them
      this.hidden0 = [];
      slots(p.s).forEach(([get], j) => { if (slots(v0)[j][0]() === HIDDEN) this.hidden0.push(j); });
      this.base = p.s;
    }
    if (!this.base) { this.off = true; return; }   // joined mid-game, or a deal the engine can't make again: the caller deals as before
    this.allIds = slots(this.base).map(([get]) => get());
  }
  /** A world at the deal with the hidden positions holding `ids` (in hidden0's order). */
  world(ids, seed) {
    const s = this.E.copy(this.base), at = slots(s), fill = new Map();
    this.hidden0.forEach((j, k) => { at[j][1](ids[k]); fill.set(ids[k], k); });
    this.E.refresh?.(s);
    return { s, fill, rng: lcg(seed), seed, trace: [], logl: 0, logw: 0, alive: true, fresh: true };
  }
  /**
   * One move played in a world; false if it couldn't have happened there. The world's rules stop at every priority (the real
   * game stops only where a player has something to do, which hangs on their hand: the world must not learn from where the real
   * game stopped), so after the move the world is played on, each player passing, until it stands where the real game stands;
   * every pass of the other player there is weighed as a play of theirs (a pass seen, or a pass the real game made for them:
   * the seat can't tell which).
   */
  step(p, ev, i, force = null) {
    const E = this.E, me = this.me, who = ev.who, opp = other(me);
    this.lastView = i > 0 ? this.events[i - 1].view : this.v0;
    if (p.s.over) return false;
    let ms = E.options(p.s, who);
    let cands = ms.filter(o => this.same(ev.m, o, ev.before));
    if (who === me && !cands.length) cands = [ev.m];   // a move of the seat's the options don't list (a concession): as it was
    if (who !== me && !cands.length && p.s.pending && this.listOf(p.s.pending)) {
      // a question of theirs listing cards (the top cards they look at) that lacks a card the real play shows: the listed cards
      // are exchanged for library cards neither has seen, when the question is the first decision on them
      const shown = new Set(), walk = (x, idk) => Array.isArray(x) ? x.forEach(y => walk(y, idk)) : x && typeof x === "object" ? Object.entries(x).forEach(([k, y]) => walk(y, idk || this.IDK.has(k))) : idk && typeof x === "number" && x >= 0 && !ev.before.has(x) && shown.add(x);
      walk(ev.m, false);
      const need = new Set([...shown].map(id => E.nameOf(id)));
      let fixed = false;
      for (const id of shown) { const nm = E.nameOf(id); if (!this.listOf(p.s.pending).some(x => E.nameOf(x) === nm) && this.relist(p, this.lastView, nm, need)) fixed = true; }
      if (fixed) { ms = E.options(p.s, who); cands = ms.filter(o => this.same(ev.m, o, ev.before)); }
    }
    if (!cands.length) {
      this.why = "no such play there";
      // the cards the play shows that the world's other hand lacks (a world built again puts them there: build)
      const shown = [], walk = (x, idk) => Array.isArray(x) ? x.forEach(y => walk(y, idk)) : x && typeof x === "object" ? Object.entries(x).forEach(([k, y]) => walk(y, idk || this.IDK.has(k))) : idk && typeof x === "number" && x >= 0 && !ev.before.has(x) && shown.push(E.nameOf(x));
      walk(ev.m, false);
      const held = this.hiddenIn(p, this.lastView).map(id => E.nameOf(id));
      this.missing = { theirs: shown.filter(n => !held.includes(n)) };
      return false;
    }
    const P = who !== me && ms.length >= 2 ? this.chances(p.s, who, ms) : null, ok = [];
    for (const o of cands) {
      const c = { s: E.copy(p.s), fill: new Map(p.fill), rng: p.rng, seed: p.seed, keep: p.keep, fresh: p.fresh, ll: 0 };
      const r = E.act(c.s, who, o, this.chance(p, i, 0));
      if (typeof r === "string" || !r) { this.why = `illegal: ${r}`; continue; }
      c.s = r;
      if (!this.settle(c, ev, i)) continue;
      // the play's own chance (softened), with the passes on the way
      c.w = (P ? (1 - this.eps) * (P[ms.indexOf(o)] ?? 0) + this.eps / ms.length : 1) * Math.exp(c.ll);
      ok.push({ o, c });
    }
    if (!ok.length) return false;
    if (who !== me) p.fresh = false;   // the other player has decided on their hand: it is no longer free to change
    const L = ok.reduce((a, x) => a + x.c.w, 0);
    let r = p.rng() * L, k = 0;
    while (k < ok.length - 1 && (r -= ok[k].c.w) > 0) k++;
    let pick = ok[k];
    if (force) pick = ok.find(x => JSON.stringify(x.o) === JSON.stringify(force)) || pick;   // the lab's test: the true play
    p.logl += this.beta * Math.log(L);
    p.s = pick.c.s; p.fill = pick.c.fill;
    (p.trace ||= [])[i] = pick.o;
    return true;
  }
  /** The chance the rules use in a world at move i (its k-th step there): fixed by the world's seed, so the world plays again the
   *  same (a move of Metropolis-Hastings replays it with two cards exchanged). */
  chance(p, i, k) { return this.rngOf ? this.rngOf(i) : lcg(((p.seed || 1) * 2654435761 + i * 40503 + k * 977) >>> 0); }
  /** The policy's chances of the options (a random player's without a policy), softened as the likelihood uses them. */
  chances(s, seat, ms) { return this.policy ? this.policy(s, seat, ms) : ms.map(() => 1 / ms.length); }
  /** The world after a move played on, passing, to where the real game stands (ev.view); false if it never gets there. */
  settle(c, ev, i) {
    const E = this.E, me = this.me, opp = other(me), want = sig(ev.view);
    for (let guard = 0; guard < 400; guard++) {
      if (sig(c.s) === want) {
        if (!this.reconcile(c, ev.view)) { this.why = "can't show what the seat sees" + (this.debug ? `: ${this.why2}` : ""); return false; }
        const k2 = this.key(observe(c.s, me));
        if (k2 === ev.key) return true;
        this.why = "looks different";
        if (this.debug) { let j = 0; while (k2[j] === ev.key[j]) j++; this.why += `: …${k2.slice(Math.max(0, j - 120), j + 60)}  ≠  …${ev.key.slice(Math.max(0, j - 120), j + 60)}`; }
        return false;
      }
      if (c.s.over) { this.why = "over in the world"; return false; }
      if (c.s.pending) { this.why = `a question the real game didn't ask (${c.s.pending.t} of seat ${c.s.pending.seat})`; return false; }
      const seat = E.toMove(c.s);
      if (seat === opp && this.passes) {
        const ms = E.options(c.s, opp);
        if (ms.length >= 2) { const P = this.chances(c.s, opp, ms), k = ms.findIndex(m => m.t === "pass"); c.ll += Math.log((1 - this.eps) * (k >= 0 ? P[k] : 0) + this.eps / ms.length); }
      }
      const r = E.act(c.s, seat, E.PASS, this.chance(c, i, guard + 1));
      if (typeof r === "string" || !r) { this.why = `a pass refused: ${r}`; return false; }
      c.s = r;
    }
    this.why = "never got there";
    return false;
  }
  /** A world from the deal through every move so far, its hidden cards `ids`; null if it dies on the way. */
  replay(ids, keep = null, forced = null, seed = null, ex = null, probe = null) {
    const p = this.world(ids, seed ?? Math.floor(this.rng() * 2 ** 31));
    p.keep = keep; p.ex = ex;
    this.missing = null;
    for (let i = 0; i < this.events.length; i++) {
      const v = i > 0 ? this.events[i - 1].view : this.v0;
      if (probe) probe(p, v, i);
      // the world's exchanges at this move: two cards neither player had seen, swapped (a re-deal of the unseen library there)
      for (const [a, b] of ex?.get(i) || []) { if (!this.isFree(p, v, a) || !this.isFree(p, v, b)) { this.dead = { p, i }; this.missing = null; return null; } this.swap(p, a, b); }
      if (!this.step(p, this.events[i], i, forced?.[i])) { this.dead = { p, i }; return null; }
    }
    delete p.keep;
    return p;
  }

  // ---------- new worlds ----------
  /**
   * A world built (Korbi: "if it's not a possible hand, try a few more times"): played from the deal `ids`; where it dies for a
   * card the real game shows and the world doesn't have where it's shown (a card cast from their hand, a card drawn), that card's
   * place at the deal is exchanged with that of a card the world did have there, and the world is played again from the deal,
   * up to `tries` × 4 times. The world that survives has earned its weight: every play weighed on its own cards.
   */
  build(ids, seed = null) {
    ids = ids.slice();
    const ex = new Map(), sd = seed ?? Math.floor(this.rng() * 2 ** 31);
    for (let t = 0; t < this.tries * 4; t++) {
      const p = this.replay(ids, null, null, sd, ex);
      if (p) { p.ex = ex; return p; }
      const m = this.missing, d = this.dead;
      if (!d) return null;
      if (!m) { if (d.i < 4) { ids = this.shuffled(); ex.clear(); continue; } return null; }   // at the start: another deal
      const v = d.i > 0 ? this.events[d.i - 1].view : this.v0, held = this.hiddenIn(d.p, v), pick = a => a[Math.floor(this.rng() * a.length)];
      const vis = this.visible(v), hiddenNow = id => !vis.has(id);
      let x = null, y = null;
      if (m.theirs?.length) {
        // a copy of the card shown, from wherever it lay hidden, for one the other hand held
        const name = m.theirs[0], copies = this.allIds.filter(id => this.E.nameOf(id) === name && !held.includes(id) && hiddenNow(id));
        if (!copies.length || !held.length) return null;
        x = pick(copies); y = pick(held);
      } else if (m.mine) {
        // the card the seat drew, from the other hand where the world had it, for the one the world gave the seat
        const copies = held.filter(id => this.E.nameOf(id) === m.mine);
        if (!copies.length) return null;
        x = pick(copies); y = m.d;
      } else if (m.listed) {
        // a card the seat's search lists, from the other hand, for a library card the search doesn't list
        const copies = held.filter(id => this.E.nameOf(id) === m.listed);
        if (!copies.length) return null;
        const names = new Set(m.names), lib = d.p.s.lib.filter((id, i) => v.lib[i] === HIDDEN && !names.has(this.E.nameOf(id)));
        if (!lib.length) return null;
        x = pick(copies); y = pick(lib);
      } else return null;
      // when: the last move before which both lay in the library unseen by either (the world played again, watched); else at the deal
      let k = -1;
      this.replay(ids, null, null, sd, ex, (w, vv, i) => { if (i <= d.i && this.isFree(w, vv, x) && this.isFree(w, vv, y)) k = i; });
      if (k >= 0) { if (!ex.has(k)) ex.set(k, []); ex.get(k).push([x, y]); }
      else { const ix = ids.indexOf(x), iy = ids.indexOf(y); if (ix < 0 || iy < 0) return null; [ids[ix], ids[iy]] = [ids[iy], ids[ix]]; }
      this.stats.rebuilt = (this.stats.rebuilt || 0) + 1;
    }
    return null;
  }
  /** The hidden cards at the deal in random places. */
  shuffled() {
    const ids = this.hidden0.map(j => slots(this.base)[j][0]());
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    return ids;
  }
  /** The cards the other player holds now that the seat can't see, in a world. */
  heldNow(p) { return this.hiddenIn(p, this.view); }
  /**
   * One new world: dealt at random (chance lambda) or with the dealer's hand placed where the other hand comes from (`dest`,
   * hidden0 indices found by a first replay), played through. Its log weight: likelihood + log prior − log proposal at dest.
   */
  propose(dest) {
    let ids = this.shuffled();
    const N = ids.length, now = new Set(this.heldNowAll());
    if (dest && this.dealer && this.rng() >= this.lambda) {
      // the dealer's names at dest, each a copy among the cards the seat can't see now (the first such in the shuffled order:
      // a copy at random)
      const { names } = this.dealer.sample(dest.length, this.rng), placed = new Set();
      for (let k = 0; k < dest.length; k++) {
        const q = ids.findIndex((id, j) => !placed.has(j) && now.has(id) && this.E.nameOf(id) === names[k]);
        if (q < 0) { ids = this.shuffled(); break; }   // not placeable: a random world
        [ids[q], ids[dest[k]]] = [ids[dest[k]], ids[q]]; placed.add(dest[k]);
      }
    }
    // the proposal's chance of the cards at dest against the random deal's (the rest is random in both)
    let lw = 0;
    if (dest && this.dealer) {
      const held = dest.map(q => ids[q]), prior = -held.reduce((a, _, j) => a + Math.log(N - j), 0);
      let qg = -Infinity;
      if (held.every(id => now.has(id))) {
        const nm = held.map(id => this.E.nameOf(id)), left = new Map();
        for (const id of now) left.set(this.E.nameOf(id), (left.get(this.E.nameOf(id)) || 0) + 1);
        let lc = 0;
        for (const x of nm) { lc -= Math.log(left.get(x)); left.set(x, left.get(x) - 1); }
        qg = this.dealer.logProb(nm) + lc;
      }
      lw = prior - logsumexp([Math.log(this.lambda) + prior, Math.log(1 - this.lambda) + qg]);
    }
    const p = this.build(ids);
    if (!p) return null;
    p.logw = (this.mode === "poe" ? 0 : lw) + p.logl;
    return p;
  }
  /** Every card the seat can't see now (the other hand's and the library's). */
  heldNowAll() { const vis = this.visible(this.view); return this.allIds.filter(id => !vis.has(id)); }
  /** Where (hidden0 index) the cards a world's other hand holds now began. */
  destOf(p) { return this.heldNow(p).map(id => p.fill.get(id)).filter(q => q !== undefined); }
  /** The hidden cards at the deal of a world as it now stands (its fill, after the swaps made on the way). */
  idsOf(p) {
    // null when the world's swaps moved a card the seat saw at the deal into a hidden place there (no deal holds it so)
    const ids = new Array(this.hidden0.length); for (const [id, q] of p.fill) ids[q] = id;
    if (!this.base0) this.base0 = new Set(this.hidden0.map(j => slots(this.base)[j][0]()));
    const seen = new Set();
    for (const id of ids) { if (id === undefined || seen.has(id) || !this.base0.has(id)) return null; seen.add(id); }
    return ids;
  }

  /** Before a search: the wall made whole. The first time, N random worlds; later, when it thins, resampled and new worlds added
   *  (the dealer's, then survivors moved). */
  ensure() {
    if (!this.base) return;
    if (!this.parts.length) {
      for (let t = 0; t < this.N * this.tries && this.parts.length < this.N; t++) { const p = this.build(this.shuffled()); if (p) { p.logw = p.logl; this.parts.push(p); this.stats.born++; } }
      if (this.parts.length) { this.parts = this.resample(this.parts, this.N); this.moveAll(); }
      return;
    }
    let live = this.parts.filter(p => p.alive);
    if (this.refresh && live.length) {
      // the dealer's new worlds, placed where the other hand comes from in a living world; the lightest make room
      const ref = live[Math.floor(this.rng() * live.length)], dest = this.destOf(ref);
      for (let t = 0, made = 0; t < this.refresh * this.tries && made < this.refresh && dest.length; t++) { const p = this.propose(dest); if (p) { live.push(p); made++; this.stats.born++; } }
      if (live.length > this.N) { live.sort((a, b) => b.logw - a.logw); live = live.slice(0, this.N); }
      this.parts = live;
    }
    if (live.length && this.ess() >= this.N / 2) { this.parts = live; this.moveAll(); return; }
    if (live.length) { this.stats.rejuvenated++; this.parts = this.resample(live, this.N); this.moveAll(); return; }
    this.stats.rejuvenated++;
    const fresh = live.length ? this.resample(live, Math.ceil(this.N / 2)) : [];
    // the dealer's worlds, placed where the other hand comes from in a living world (or a random one)
    const ref = live[0] || null;
    let made = 0;
    for (let t = 0; t < (this.N - fresh.length) * this.tries && fresh.length + made < this.N; t++) {
      const dest = ref ? this.destOf(ref) : null, p = this.propose(dest && dest.length ? dest : null);
      if (p) { fresh.push(p); made++; this.stats.born++; }
    }
    // short still: survivors moved (two hidden cards exchanged, one of the other hand's), kept by Metropolis-Hastings
    if (fresh.length < this.N && live.length) for (let t = 0; t < this.movesMH; t++) {
      const p = live[Math.floor(this.rng() * live.length)], ids = this.idsOf(p), dest = this.destOf(p);
      if (!ids) continue;
      if (!dest.length) break;
      const a = dest[Math.floor(this.rng() * dest.length)], b = Math.floor(this.rng() * ids.length);
      if (b === a || dest.includes(b) || this.E.nameOf(ids[a]) === this.E.nameOf(ids[b])) continue;
      [ids[a], ids[b]] = [ids[b], ids[a]];
      this.stats.mh++;
      const q = this.replay(ids);
      if (q && Math.log(this.rng()) < q.logl - p.logl) { q.logw = 0; fresh.push(q); this.stats.accepted++; if (fresh.length >= this.N) break; }
    }
    this.parts = fresh.length ? fresh : live;
    this.moveAll();
  }
  /** Before every search: Metropolis-Hastings moves (mh) on worlds at random, `moves` of them. */
  moveAll() {
    const live = this.parts.filter(p => p.alive);
    if (!live.length) return;
    for (let t = 0; t < this.movesMH; t++) {
      const j = Math.floor(this.rng() * this.parts.length), p = this.parts[j];
      if (!p.alive) continue;
      const q = t % 2 === 0 ? this.mhDeal(p) : this.mh(p);
      if (q) this.parts[j] = q;
    }
  }
  /**
   * One Metropolis-Hastings move of a world (Korbi: "gibbs … on survivors"): one of its hidden cards in the other hand exchanged
   * for a card nobody knows of a name the dealer suggests (its odds for one card), the world played again from the deal with the
   * same chance and the same plays (the exchanged cards' ids swapped in them), kept with the chance min(1, π'/π · q'/q). π: the
   * plays' likelihood (beta) × the prior ("is": the random deal, the same for both) or × the dealer's chance of the hand ("poe").
   */
  mh(p) {
    const v = this.view, hand = this.hiddenIn(p, v), opp = other(this.me);
    if (!hand.length) return null;
    const kn = new Map(p.s.kn), freeIds = p.s.lib.filter((id, i) => v.lib[i] === HIDDEN && !((kn.get(id) || 0) & (1 << opp)));
    if (!freeIds.length) return null;
    const odds = this.nameOdds(), byName = new Map();
    for (const id of freeIds) { const n = this.E.nameOf(id); if (!byName.has(n)) byName.set(n, []); byName.get(n).push(id); }
    const names = [...byName.keys()], w = names.map(n => odds(n) + 1e-3), z = w.reduce((x, y) => x + y, 0);
    let r = this.rng() * z, k = 0; while (k < names.length - 1 && (r -= w[k]) > 0) k++;
    const a = hand[Math.floor(this.rng() * hand.length)], bs = byName.get(names[k]), b = bs[Math.floor(this.rng() * bs.length)];
    if (this.E.nameOf(a) === names[k]) return null;
    const qf = Math.log(w[k] / z) - Math.log(bs.length);
    // the way back: a among the free cards, b in the hand
    const back = new Map(byName); back.set(names[k], bs.filter(id => id !== b)); if (!back.get(names[k]).length) back.delete(names[k]);
    const na = this.E.nameOf(a); back.set(na, [...(back.get(na) || []), a]);
    const wb = [...back.keys()].map(n => odds(n) + 1e-3), zb = wb.reduce((x, y) => x + y, 0), kb = [...back.keys()].indexOf(na);
    const qb = Math.log(wb[kb] / zb) - Math.log(back.get(na).length);
    const ids = this.idsOf(p), ia = ids ? ids.indexOf(a) : -1, ib = ids ? ids.indexOf(b) : -1;
    if (ia < 0 || ib < 0) return null;
    [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
    const sw = x => (x === a ? b : x === b ? a : x), mapMove = m => JSON.parse(JSON.stringify(m), (key, val) => (typeof val === "number" && this.IDK.has(key) ? sw(val) : Array.isArray(val) && this.IDK.has(key) ? val.map(y => (typeof y === "number" ? sw(y) : y)) : val));
    this.stats.mh++;
    const q = this.replay(ids, null, (p.trace || []).map(m => (m ? mapMove(m) : m)), p.seed);
    if (!q) return null;
    const base = h => (this.mode === "poe" && this.dealer ? this.dealer.logProb(this.heldNow(h).map(id => this.E.nameOf(id))) : 0);
    const logA = (q.logl - p.logl) + (base(q) - base(p)) + (qb - qf);
    if (Math.log(this.rng()) >= logA) return null;
    this.stats.accepted++;
    q.logw = p.logw;   // a move that keeps the belief keeps the world's weight
    return q;
  }
  /**
   * A whole-hand move (Korbi: "the dealer … deal[s] the most likely belief states …; the particle filter should back calculate
   * for each the probability based on the policy network simulation"): the dealer deals a whole hand for the other player's
   * hidden cards, the world's hidden cards there exchanged for copies nobody knows of those names, the world played again from
   * the deal with the same chance and the same plays, and kept with the chance min(1, π'/π · q/q'): with π the dealer's chance ×
   * the plays' likelihood ("poe") and q the dealer's, exactly the likelihood's ratio (the judge's verdict); with π the random
   * deal × the likelihood ("is"), the dealer's chances enter too.
   */
  mhDeal(p) {
    if (!this.dealer) return null;
    const v = this.view, hand = this.hiddenIn(p, v), opp = other(this.me);
    if (!hand.length) return null;
    const { names } = this.dealer.sample(hand.length, this.rng), kn = new Map(p.s.kn);
    const freeIds = p.s.lib.filter((id, i) => v.lib[i] === HIDDEN && !((kn.get(id) || 0) & (1 << opp)));
    // keep the hand's cards the deal names, exchange the rest for free copies of the names still wanted
    const want = [...names], keepIt = new Set(), pairs = [];
    for (const id of hand) { const j = want.indexOf(this.E.nameOf(id)); if (j >= 0) { want.splice(j, 1); keepIt.add(id); } }
    const out = hand.filter(id => !keepIt.has(id)), used = new Set();
    for (let k = 0; k < out.length; k++) {
      const b = freeIds.find(id => !used.has(id) && this.E.nameOf(id) === want[k]);
      if (b == null) return null;
      used.add(b); pairs.push([out[k], b]);
    }
    if (!pairs.length) return null;
    const ids = this.idsOf(p);
    if (!ids) return null;
    const map = new Map();
    for (const [a, b] of pairs) { const ia = ids.indexOf(a), ib = ids.indexOf(b); if (ia < 0 || ib < 0) return null; [ids[ia], ids[ib]] = [ids[ib], ids[ia]]; map.set(a, b); map.set(b, a); }
    const sw = x => map.get(x) ?? x, mapMove = m => JSON.parse(JSON.stringify(m), (key, val) => (typeof val === "number" && this.IDK.has(key) ? sw(val) : Array.isArray(val) && this.IDK.has(key) ? val.map(y => (typeof y === "number" ? sw(y) : y)) : val));
    this.stats.mh++;
    const q = this.replay(ids, null, (p.trace || []).map(m => (m ? mapMove(m) : m)), p.seed);
    if (!q) return null;
    const nm = h => this.heldNow(h).map(id => this.E.nameOf(id));
    let logA = q.logl - p.logl;
    if (this.mode !== "poe") logA += this.dealer.logProb(nm(p)) - this.dealer.logProb(nm(q));   // the random deal's chances are the same
    if (Math.log(this.rng()) >= logA) return null;
    this.stats.accepted++;
    q.logw = p.logw;   // a move that keeps the belief keeps the world's weight
    return q;
  }
  /** The dealer's odds for one hidden card of the other hand, by name (uniform without a dealer). */
  nameOdds() {
    if (!this.dealer?.marginal) return () => 1;
    const m = this.dealer.marginal();
    return n => m.get(n) || 0;
  }
  /** k worlds drawn by weight (systematic), equal weights after. */
  resample(live, k) {
    const lw = live.map(p => p.logw), z = logsumexp(lw), w = lw.map(x => Math.exp(x - z)), out = [];
    let u = this.rng() / k, c = w[0], i = 0;
    for (let j = 0; j < k; j++) { while (u > c && i < w.length - 1) c += w[++i]; out.push(this.clone(live[i])); u += 1 / k; }
    return out;
  }
  clone(p) { return { s: this.E.copy(p.s), fill: new Map(p.fill), rng: lcg(Math.floor(this.rng() * 2 ** 31)), logl: p.logl, logw: 0, alive: true }; }
  weights() { const live = this.parts.filter(p => p.alive), z = logsumexp(live.map(p => p.logw)); return live.map(p => ({ p, w: Math.exp(p.logw - z) })); }
  ess() { const w = this.weights(); return w.length ? 1 / w.reduce((a, x) => a + x.w * x.w, 0) : 0; }

  // ---------- for the search ----------
  /** One world drawn by weight. */
  draw(rng) { const w = this.weights(); if (!w.length) return null; let r = rng(), k = 0; while (k < w.length - 1 && (r -= w[k].w) > 0) k++; return w[k].p; }
  /** A dealer for determinize (pool, n, rng) → the other hand's hidden cards then the library's, from a world drawn by weight;
   *  null if the wall is empty (the caller deals as before). */
  deal() {
    if (!this.weights().length) return null;
    const opp = other(this.me), v = this.view;
    return (pool, n, rng) => {
      const p = this.draw(rng);
      const hand = this.hiddenIn(p, v), lib = p.s.lib.filter((_, i) => v.lib[i] === HIDDEN), out = [...hand, ...lib];
      const a = [...out].sort((x, y) => x - y), b = [...pool].sort((x, y) => x - y);
      return a.length === b.length && a.every((x, i) => x === b[i]) ? out : null;
    };
  }
  /** The weighted chance of each name among the other hand's hidden cards (for the scorecard and the policy's belief). */
  counts() {
    const out = new Map();
    for (const { p, w } of this.weights()) for (const id of this.heldNow(p)) { const nm = this.E.nameOf(id); out.set(nm, (out.get(nm) || 0) + w); }
    return out;
  }
  /** The log chance the wall gives the true hidden hand (a multiset of names; the lab's measure). */
  logTruth(names) {
    const key = h => h.map(id => this.E.nameOf(id)).sort().join("|"), t = [...names].sort().join("|");
    let hit = 0;
    for (const { p, w } of this.weights()) if (key(this.heldNow(p)) === t) hit += w;
    return Math.log(hit + 1e-9);
  }
}
const SKIP = new Set(["log", "ln", "obs", "adv", "reading", "tells", "cover", "by", "kn", "kh", "say"]);
