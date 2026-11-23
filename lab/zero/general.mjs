// Monte on the general encoding (17 Nov 2026, stage 3 step 3): Zero 2's engine (one policy for moves and answers, Scry 1.2's
// belief dealing the hidden cards, the value net face up) with every input and mark from dandan-general.js, so nothing in it
// names a card. Nets: <name>-gpolicy.json (lab/policy_np.py --form head on a pack made with ENC=general), <name>-gvalue.json
// (lab/zero/value_np.py on the same pack's value rows), the Scry 1.2 file it was packed with.
import { freeScorer, firstLayer } from "../../dandan-netpolicy.js";
import { think } from "../../dandan-think.js";
import { zeroOptions, PASS } from "../../dandan-zero.js";
import { generalView, valueView, generalMarks, onPool, viewSize, VIEW_VERSIONS, POOL } from "../../dandan-general.js";
import { Scry12 } from "./scry12.mjs";
import { ScryG } from "./scryg.mjs";
import { determinize, seedOf } from "../../dandan-think.js";
import { seeded, mix } from "../../seats.js";
import { Wall } from "./wall.mjs";
import { DECK } from "../../dandan-cards.js";
import { NN } from "../../dandan-zeroview.js";
import { kernel } from "../../dandan-kernel.js";   // the app's own: the page loads this file (no node modules)

// the compiled kernel (dandan-kernel.js, lab/kernel/kernel.c) unless NO_KERNEL is set (the lab's A/B) or it can't load here
const useKernel = () => (typeof process !== "undefined" && process.env?.NO_KERNEL ? null : kernel());

/** The one policy as the look-aheads' player and the tree's focus, for priority and for questions alike. */
export function generalPlayer(policy, ctx) {
  // the view as long as the net reads (version 1 or 2: dandan-general.js)
  const K = useKernel(), score = policy ? (K && K.head2(policy)) || freeScorer(policy, { carry: true }) : null, none = new Float32Array(POOL.V), XB = new Float32Array(policy ? policy.net.XN : viewSize());
  if (policy && !VIEW_VERSIONS(POOL).includes(policy.net.XN)) throw new Error(`the general policy reads ${policy.net.XN} inputs, not a view's (${VIEW_VERSIONS(POOL)})`);
  const view = (s, seat) => generalView(s, seat, ctx.counts[seat] ?? none, ctx.any[seat] ?? null, POOL, XB, ctx.ans?.[seat] ?? null);
  const legacy = !!policy && policy.net.XN < viewSize(POOL, 3);   // a policy from before version 3: its block marks as trained
  const scores = (s, seat, ms) => score(view(s, seat), ms.map(m => generalMarks(s, seat, m, POOL, legacy)));
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
export function generalJudge(value, raw = false) {
  if (!value) return null;
  const net = value.layers.map(L => {
    const [nIn, nOut] = L.n, raw = Uint8Array.from(atob(L.q), c => c.charCodeAt(0)), W = new Float32Array(nIn * nOut), b = new Float32Array(nOut);
    for (let i = 0; i < raw.length; i++) { let v = raw[i]; if (v > 127) v -= 256; W[i] = v * L.s[i % nOut]; }
    if (L.b.length) b.set(L.b);
    return { nIn, nOut, W, b, y: new Float32Array(nOut) };
  });
  // a net on a subset of the view (20 Nov 2026: value_np.py --cols, dandan-general.js viewColumns) reads those columns of it
  const cols = value.cols ? Int32Array.from(value.cols) : null, N = cols ? viewSize(POOL, 3) : net[0].nIn;
  if (cols ? cols.length !== net[0].nIn : !VIEW_VERSIONS(POOL).includes(N)) throw new Error(`the general value net reads ${net[0].nIn} inputs, not a view's (${VIEW_VERSIONS(POOL)})${cols ? " nor its columns" : ""}`);
  const sub = cols ? [new Float32Array(cols.length), new Float32Array(cols.length)] : null;
  const pick = (x, side) => { if (!cols) return x; const y = sub[side]; for (let i = 0; i < cols.length; i++) y[i] = x[cols[i]]; return y; };
  // the compiled kernel when it loads (one net for each side's view, each carrying its own first layer), else the JavaScript with
  // the first layer carried between calls (dandan-netpolicy.js firstLayer)
  const K = useKernel(), compiled = K ? [K.mlp(net), K.mlp(net)] : null;
  const L0 = net[0], first = [firstLayer(L0.nIn, L0.nOut, L0.W, L0.b), firstLayer(L0.nIn, L0.nOut, L0.W, L0.b)];
  const g = (x, side) => {
    if (compiled) return compiled[side](x);
    let a = x;
    net.forEach((L, li) => {
      if (li === 0) first[side](x, L.y);
      else {
        L.y.set(L.b);
        for (let i = 0; i < L.nIn; i++) { const v = a[i]; if (!v) continue; const r = i * L.nOut; for (let o = 0; o < L.nOut; o++) L.y[o] += v * L.W[r + o]; }
      }
      if (li < net.length - 1) for (let o = 0; o < L.nOut; o++) if (L.y[o] < 0) L.y[o] = 0;
      a = L.y;
    });
    return a[0];
  };
  const xs = [new Float32Array(N), new Float32Array(N)];
  // raw (23 Nov 2026, the margin term): one output read from this seat's side alone, as value_np.py trained it (gaux.f32's columns)
  if (raw) return (s, me) => g(pick(valueView(s, me, POOL, xs[0]), 0), 0);
  return (s, me) => {
    if (s.over) return s.winner < 0 ? 0.5 : s.winner === me ? 1 : 0;
    const a = g(pick(valueView(s, me, POOL, xs[0]), 0), 0), b = g(pick(valueView(s, 1 - me, POOL, xs[1]), 1), 1);
    return 1 / (1 + Math.exp(b - a));
  };
}

/** What the particle wall (lab/zero/wall.mjs) needs of Dandân's rules: the options, the cards' names, the fields holding ids. */
export const dandanEngine = () => ({ options: zeroOptions, nameOf: id => DECK[id] ?? `token ${id}`, IDKEYS: ["card", "cards", "id", "ids", "src", "att", "blk", "attackers", "blockers", "pairs"] });

/** The general Monte whole: { policy, value, scry12 } nets as read from their files; the interface of dandan-zero.js makeZero. */
// wall (17 Nov 2026, Korbi: the particle wall): the worlds the search deals come from lab/zero/wall.mjs, Scry 1.2 its proposal;
// { n, eps, beta, … } its settings, true the defaults. The other player's belief (the policy's input when it plays them) is then
// read in a world drawn from the wall, not in the real game, where it would see their real hand.
// scryg (17 Nov 2026, Korbi 16:29: the general dealer, lab/zero/scryg.mjs): the belief, when given, in place of Scry 1.2; its
// counts are on the pool already. The other player's belief (the policy's input when it plays them in the search) is read in a
// world dealt from the seat's own belief, never in the real game (where it would read their real hand).
const OTHER_WORLDS = 4;
export function makeGeneral({ policy = null, value = null, scry12 = null, scryg = null, wall = null, margin = null, speed = null } = {}) {
  const ctx = { counts: [new Float32Array(POOL.V), new Float32Array(POOL.V)], any: [null, null], ans: [null, null] }, player = generalPlayer(policy, ctx), judge = generalJudge(value);
  // the margin term (23 Nov 2026, Fable 11:45Z item 2 and 12:35Z): a leaf scores p + clip(w × (m − k × (2p − 1) × t), ±cap), m the
  // predicted margin (the winner's life at the end /20, + if this seat wins), t the predicted turns left (/40): wider wins and,
  // when ahead, faster ones (when behind, slower) break the ties the win chance can't; at the game's end m and t are as they are.
  // Capped so it is never worth more than cap (2 points). margin=<w>:<k>[:<cap>] on think; nets <name>-gmargin, -gspeed
  const M = margin && speed ? [generalJudge(margin, true), generalJudge(speed, true)] : null;
  const marginJudge = spec => {
    const [w, k, cap = 0.02] = String(spec).split(":").map(Number);
    return (s, me) => {
      const p = judge(s, me);
      const m = s.over ? (s.winner === me ? 1 : s.winner < 0 ? 0 : -1) * Math.max(0, s.life[s.winner] ?? 0) / 20 : M[0](s, me), t = s.over ? 0 : Math.min(1, Math.max(0, M[1](s, me)));
      return p + Math.max(-cap, Math.min(cap, w * (m - k * (2 * p - 1) * t)));
    };
  };
  const W = wall ? (wall === true ? {} : wall) : null, engine = W ? dandanEngine() : null;
  let filters = null, walls = null;
  const fresh = () => {
    filters = scryg ? [new ScryG(0, scryg), new ScryG(1, scryg)] : scry12 ? [new Scry12(0, scry12), new Scry12(1, scry12)] : null;
    // a policy from before view version 3 learned the belief with the library places only they know counted as hand cards
    // (fixed 18 Nov 2026): it gets the belief it was trained on, so the older nets play as they did in matches against the new
    if (scryg && policy && policy.net.XN < viewSize(POOL, 3)) for (const f of filters) f.legacy = true;
    walls = W ? [0, 1].map(x => new Wall(x, engine, { ...W, seed: (W.seed || 1) + x, policy: player.probs, dealer: filters ? filters[x] : null })) : null;
  };
  fresh();
  // the policy as the search's prior (19 Nov 2026, Korbi: "do both"; sized by Fable 14:49 local): with priority, each option's score
  // is its searched mean plus k × ln(the policy's chance of it), k = c × the standard error of the gap between the search's top
  // two (gapSe, dandan-think.js: deal by deal over shared deals), so the policy decides only what the search's own noise can't
  // (about 0.01 at 256 deals, half that at 1,024). A tie-break, not AlphaZero's steering of the search. The means are unchanged:
  // they are the policy's targets and the resign check's. Questions (options outside zeroOptions) are left as the search ranks them.
  // multi (22 Nov 2026, Fable): each option's score also less its group's lift (dandan-think.js groupLifts): the best of one
  // card's several ways is noisily high, by the part of their noise they don't share
  const withPrior = (r, s, seat, c, multi = false) => {
    if (r.only || !r.list || r.list.length < 2) return r;
    const ms = zeroOptions(s, seat), at = new Map(ms.map((m, i) => [JSON.stringify(m), i]));
    if (!r.list.every(o => at.has(JSON.stringify(o.move)))) return r;
    const byMean = [...r.list].sort((a, b) => b.mean - a.mean), se = byMean[1].gapSe ?? byMean[0].gapSe;
    if (se == null && c) return r;
    const k = c ? c * se : 0, p = c ? player.probs(s, seat, ms) : null;
    let best = null;
    for (const o of r.list) {
      o.prior = p ? p[at.get(JSON.stringify(o.move))] : null;
      o.score = o.mean - (multi ? o.groupLift || 0 : 0) + (p ? k * Math.log(Math.max(o.prior, 1e-4)) : 0);
      if (!best || o.score > best.score) best = o;
    }
    return { ...r, best: best.move, list: [...r.list].sort((a, b) => b.score - a.score), priorK: k };
  };
  return {
    player, judge, wide: true, dealing: !!(scry12 || scryg), filters: () => filters, walls: () => walls, scry: null,
    reset: fresh,
    tracker: () => null,
    seen(s, who, m, after) { if (filters) for (const f of filters) f.update(s, who, m, after); if (walls) for (const w of walls) w.seen(s, who, m, after); },
    root(s, seat, salt = 0) {
      if (!filters) return {};
      const mine = filters[seat].belief(s), o = 1 - seat, on = scryg ? x => x : onPool;
      const sd = filters[seat].deal(), wd = walls ? walls[seat].deal() : null;
      // the other player's belief about the seat's hand, averaged over OTHER_WORLDS worlds dealt from the seat's own belief
      // (Fable 15:10Z: one world a search is a bias; never the real game, where it would read their real hand)
      if (walls) walls[seat].ensure();
      const tc = new Float32Array(POOL.V), ta = new Float32Array(POOL.V);
      let tans = 0;
      // seeded from what the seat sees (22 Nov 2026): with Math.random here the same position got different means on every
      // run (the suite's verdicts and the honesty test's means moved by a point or two); now one position, one search
      const rw = seeded(mix(mix(seedOf(s, seat), 0x07e5), salt || 0));   // salt: as think's, a fresh draw (lab/suite.mjs seeds=)
      for (let w = 0; w < OTHER_WORLDS; w++) {
        const world = (walls && walls[seat].sample(rw)) || determinize(s, seat, rw, false, false, (pool, n, rng) => sd(pool, n, rng) || pool);
        const b = filters[o].belief(world), c = on(b.counts), a = on(b.any);
        for (let k = 0; k < POOL.V; k++) { tc[k] += c[k] / OTHER_WORLDS; ta[k] += a[k] / OTHER_WORLDS; }
        tans += (b.ans ?? 0) / OTHER_WORLDS;
      }
      ctx.counts[seat] = on(mine.counts); ctx.any[seat] = on(mine.any); ctx.ans[seat] = mine.ans ?? null;
      ctx.counts[o] = tc; ctx.any[o] = ta; ctx.ans[o] = scryg ? tans : null;
      return { deal: wd ? (pool, n, rng) => wd(pool, n, rng) || sd(pool, n, rng) : sd };
    },
    think(s, seat, deals, extra = {}) {
      const { qtree, prior, multi, policyOnly, margin: mspec, ...rest } = extra;
      if (mspec && !M) throw new Error("margin=: these nets have no -gmargin and -gspeed");
      // policyOnly (23 Nov 2026, Fable 11:35Z, zpol001): no search; the policy's top move, on the same beliefs the search would use
      if (policyOnly) { this.root(s, seat, rest.salt); const n = zeroOptions(s, seat).length; return { best: player.rollout(s, seat, Math.random), list: [], only: n <= 1, policyOnly: true }; }
      const r = think(s, seat, { deals, ms: 1e9, all: true, options: zeroOptions, weigh: false, rollout: player.rollout, judge: mspec ? marginJudge(mspec) : judge, focus: player.focus,
        ...(qtree ? { qfocus: player.qfocus } : {}), ...this.root(s, seat, rest.salt), ...rest });
      return (prior && policy) || multi ? withPrior(r, s, seat, prior && policy ? prior : 0, !!multi) : r;
    },
  };
}
export { NN };
