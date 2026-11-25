// Belief by what the others did (Fable, 25 Nov 2026 02:10Z, order 1): the worlds the search plays in are weighted by how likely our
// own policy net finds every bid and card the other seats chose, from each seat's own view in that world. A seat that bid a solo
// is then dealt the hands a player bids a solo with. No dealer net, no hand-written inference, general to any game with a policy.
// Per decision a pool of replay-legal worlds is drawn (sk-rules.js determinize) and weighted once; each of the search's deals is
// then drawn from the pool in proportion to its weight (resampling), so the search's means, pruning and standard errors stay
// as they are and are self-normalised by construction. Each factor is floored (FLOOR) so one surprising card can't zero a world.
import { schafkopf as G, replayWith } from "./sk-rules.js";
import { policyProbs } from "./sk-net.js";

export const BELIEF = { decisions: 0, ess: { bid: [], 1: [], 4: [] } };
const key = m => JSON.stringify(m);

/** A determinize for the search's game hooks: worlds drawn by weight from a pool of `pool` per position and seat. */
export function beliefDealer(net, { pool = 256, floor = 0.05 } = {}) {
  const cache = new WeakMap();
  return (s, seat, rng) => {
    const k = `${seat}:${(s.log || []).length}`, bySeat = cache.get(s) || cache.set(s, new Map()).get(s);
    let P = bySeat.get(k);
    if (!P) {
      const worlds = [], lw = [];
      for (let i = 0; i < pool; i++) {
        const w = G.determinize(s, seat, rng);
        let l = 0;
        replayWith(s, w.dealt, (x, who, m) => {
          if (who === seat) return;
          const ms = G.options(x, who);
          if (ms.length < 2) return;
          const { p } = policyProbs(net, x, who, ms), j = ms.findIndex(o => key(o) === key(m));
          l += Math.log(Math.max(floor, j >= 0 ? p[j] : 0));
        });
        worlds.push(w); lw.push(l);
      }
      const top = Math.max(...lw), wt = lw.map(x => Math.exp(x - top)), sum = wt.reduce((a, b) => a + b, 0);
      const cum = []; let c = 0; for (const x of wt) cum.push((c += x / sum));
      const ess = sum * sum / wt.reduce((a, x) => a + x * x, 0);
      P = { worlds, cum, ess };
      bySeat.set(k, P);
      BELIEF.decisions++;
      const at = s.step === "bid" ? "bid" : s.tricks.length === 1 ? 1 : s.tricks.length === 4 ? 4 : null;
      if (at != null) BELIEF.ess[at].push(ess);
    }
    const u = rng();
    let lo = 0, hi = P.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (P.cum[mid] < u) lo = mid + 1; else hi = mid; }
    return G.fork(P.worlds[lo]);
  };
}
/** The effective number of worlds, median and tenth percentile, at the bid and after tricks 1 and 4, in a line. */
export function beliefLine() {
  const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(f * (a.length - 1))].toFixed(0) : "-");
  return `belief: ${BELIEF.decisions} positions; effective worlds of 256, median / 10th percentile: bid ${q(BELIEF.ess.bid, 0.5)} / ${q(BELIEF.ess.bid, 0.1)}, trick 1 ${q(BELIEF.ess[1], 0.5)} / ${q(BELIEF.ess[1], 0.1)}, trick 4 ${q(BELIEF.ess[4], 0.5)} / ${q(BELIEF.ess[4], 0.1)}`;
}
