// Monte on the general encoding (17 Nov 2026, stage 3 step 3): Zero 2's engine (one policy for moves and answers, Scry 1.2's
// belief dealing the hidden cards, the value net face up) with every input and mark from dandan-general.js, so nothing in it
// names a card. Nets: <name>-gpolicy.json (lab/policy_np.py --form head on a pack made with ENC=general), <name>-gvalue.json
// (lab/zero/value_np.py on the same pack's value rows), the Scry 1.2 file it was packed with.
import { freeScorer } from "../../dandan-netpolicy.js";
import { think } from "../../dandan-think.js";
import { zeroOptions, PASS } from "../../dandan-zero.js";
import { generalView, valueView, generalMarks, onPool, viewSize, POOL } from "../../dandan-general.js";
import { Scry12 } from "./scry12.mjs";
import { Wall } from "./wall.mjs";
import { DECK } from "../../dandan-cards.js";
import { NN } from "../../dandan-zeroview.js";   // the app's own: the page loads this file (no node modules)

/** The one policy as the look-aheads' player and the tree's focus, for priority and for questions alike. */
export function generalPlayer(policy, ctx) {
  const score = policy ? freeScorer(policy) : null, none = new Float32Array(POOL.V), XB = new Float32Array(viewSize());
  if (policy && policy.net.XN !== XB.length) throw new Error(`the general policy reads ${policy.net.XN} inputs, not ${XB.length}`);
  const view = (s, seat) => generalView(s, seat, ctx.counts[seat] ?? none, ctx.any[seat] ?? null, POOL, XB);
  const scores = (s, seat, ms) => score(view(s, seat), ms.map(m => generalMarks(s, seat, m)));
  const rollout = (s, seat, rng) => {
    const ms = zeroOptions(s, seat);
    if (ms.length <= 1) return ms[0] ?? PASS;
    if (!score) return ms[Math.floor(rng() * ms.length)];
    const sc = scores(s, seat, ms);
    let b = 0;
    for (let k = 1; k < sc.length; k++) if (sc[k] > sc[b]) b = k;
    return ms[b];
  };
  // the fewest top options holding 90% of the policy's probability, for the tree: with priority (focus) and at a question (qfocus)
  const top = (s, seat, mass = 0.9, most = 6) => {
    const ms = zeroOptions(s, seat), sc = scores(s, seat, ms);
    const order = sc.map((v, k) => k).sort((a, b) => sc[b] - sc[a] || a - b), best = sc[order[0]];
    const e = order.map(k => Math.exp(sc[k] - best)), z = e.reduce((a, b) => a + b, 0), out = [];
    let cum = 0;
    for (let r = 0; r < order.length && out.length < most; r++) { out.push(ms[order[r]]); cum += e[r] / z; if (cum >= mass) break; }
    return out;
  };
  // the policy's chances of the options (softmax of its scores): the particle wall's likelihood of a play
  const probs = (s, seat, ms) => {
    const sc = scores(s, seat, ms), m = Math.max(...sc), e = sc.map(v => Math.exp(v - m)), z = e.reduce((a, b) => a + b, 0);
    return e.map(v => v / z);
  };
  return { rollout, focus: score ? top : null, qfocus: score ? top : null, probs: score ? probs : null };
}

/** The value net (value_np.py's layer format) over valueView, face up: the chance `me` wins, sigmoid(g(mine) − g(theirs)). */
export function generalJudge(value) {
  if (!value) return null;
  const net = value.layers.map(L => {
    const [nIn, nOut] = L.n, raw = Uint8Array.from(atob(L.q), c => c.charCodeAt(0)), W = new Float32Array(nIn * nOut), b = new Float32Array(nOut);
    for (let i = 0; i < raw.length; i++) { let v = raw[i]; if (v > 127) v -= 256; W[i] = v * L.s[i % nOut]; }
    if (L.b.length) b.set(L.b);
    return { nIn, nOut, W, b, y: new Float32Array(nOut) };
  });
  const N = viewSize();
  if (net[0].nIn !== N) throw new Error(`the general value net reads ${net[0].nIn} inputs, not ${N}`);
  const g = x => {
    let a = x;
    net.forEach((L, li) => {
      L.y.set(L.b);
      for (let i = 0; i < L.nIn; i++) { const v = a[i]; if (!v) continue; const r = i * L.nOut; for (let o = 0; o < L.nOut; o++) L.y[o] += v * L.W[r + o]; }
      if (li < net.length - 1) for (let o = 0; o < L.nOut; o++) if (L.y[o] < 0) L.y[o] = 0;
      a = L.y;
    });
    return a[0];
  };
  const xs = [new Float32Array(N), new Float32Array(N)];
  return (s, me) => {
    if (s.over) return s.winner < 0 ? 0.5 : s.winner === me ? 1 : 0;
    const a = g(valueView(s, me, POOL, xs[0])), b = g(valueView(s, 1 - me, POOL, xs[1]));
    return 1 / (1 + Math.exp(b - a));
  };
}

/** What the particle wall (lab/zero/wall.mjs) needs of Dandân's rules: the options, the cards' names, the fields holding ids. */
export const dandanEngine = () => ({ options: zeroOptions, nameOf: id => DECK[id] ?? `token ${id}`, IDKEYS: ["card", "cards", "id", "ids", "src", "att", "blk", "attackers", "blockers", "pairs"] });

/** The general Monte whole: { policy, value, scry12 } nets as read from their files; the interface of dandan-zero.js makeZero. */
// wall (17 Nov 2026, Korbi: the particle wall): the worlds the search deals come from lab/zero/wall.mjs, Scry 1.2 its proposal;
// { n, eps, beta, … } its settings, true the defaults. The other player's belief (the policy's input when it plays them) is then
// read in a world drawn from the wall, not in the real game, where it would see their real hand.
export function makeGeneral({ policy = null, value = null, scry12 = null, wall = null } = {}) {
  const ctx = { counts: [new Float32Array(POOL.V), new Float32Array(POOL.V)], any: [null, null] }, player = generalPlayer(policy, ctx), judge = generalJudge(value);
  const W = wall ? (wall === true ? {} : wall) : null, engine = W ? dandanEngine() : null;
  let filters = null, walls = null;
  const fresh = () => {
    filters = scry12 ? [new Scry12(0, scry12), new Scry12(1, scry12)] : null;
    walls = W ? [0, 1].map(x => new Wall(x, engine, { ...W, seed: (W.seed || 1) + x, policy: player.probs, dealer: filters ? filters[x] : null })) : null;
  };
  fresh();
  return {
    player, judge, wide: true, dealing: !!scry12, filters: () => filters, walls: () => walls, scry: null,
    reset: fresh,
    tracker: () => null,
    seen(s, who, m, after) { if (filters) for (const f of filters) f.update(s, who, m, after); if (walls) for (const w of walls) w.seen(s, who, m, after); },
    root(s, seat) {
      if (!filters) return {};
      const mine = filters[seat].belief(s), o = 1 - seat;
      let world = null;
      if (walls) { walls[seat].ensure(); world = walls[seat].sample(Math.random); }
      const theirs = filters[o].belief(world || s);
      ctx.counts[seat] = onPool(mine.counts); ctx.any[seat] = onPool(mine.any);
      ctx.counts[o] = onPool(theirs.counts); ctx.any[o] = onPool(theirs.any);
      const sd = filters[seat].deal(), wd = walls ? walls[seat].deal() : null;
      return { deal: wd ? (pool, n, rng) => wd(pool, n, rng) || sd(pool, n, rng) : sd };
    },
    think(s, seat, deals, extra = {}) {
      const { qtree, ...rest } = extra;
      return think(s, seat, { deals, ms: 1e9, all: true, options: zeroOptions, weigh: false, rollout: player.rollout, judge, focus: player.focus,
        ...(qtree ? { qfocus: player.qfocus } : {}), ...this.root(s, seat), ...rest });
    },
  };
}
export { NN };
