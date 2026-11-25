// The general Monte playing Schafkopf (Fable, 24 Nov 2026 18:50Z): dandan-think.js's search with the rules engine's hooks
// (sk-rules.js), the same search for the bidding as for the cards. Bare (step 2, the baseline, as Zero's generation 0 was
// for Dandan): no nets yet, so the play-outs past the tree are uniform over the legal moves and the deal is played to its
// end, where the payoff is exact. A seat's value is 0.5 + 0.5 × payoff ÷ SD: with two seats and payoff ±1 that is Dandan's
// win chance exactly, so the search's constants (the exploration, the pruning spread, the close-call gap) read in standard
// deviations of the per-deal payoff for every game (Fable 18:50Z: one framework constant, no per-game tuning). The unit leaves
// 0..1 on big deals (a solo with Laufende is several SDs) and nothing clips it: the means, the pruning and the tree's choices
// take it as it is (Fable 20:38Z: clipping would make a big solo worth no more than a small one).
import { think } from "../../dandan-think.js";
import { schafkopf as G } from "./sk-rules.js";
import { valuePayoff } from "./sk-net.js";

/** The per-deal payoff's standard deviation, in tariffs: 5.50 at ska-base's four-Codex-Hard tables (78,944 seat-deals, 24 Nov
 *  2026; Fable 20:38Z: fixed from job 1). Jobs ska-base, ska-close and ska-self ran with the provisional 6.73 (four Codex Medium). */
export const SD = 5.5;
export const judgeOf = (sd = SD) => c => G.payoff(c).map(p => 0.5 + 0.5 * p / sd);
export const uniform = (c, who, rng) => { const ms = G.options(c, who); return ms[Math.floor(rng() * ms.length)]; };

/** The bare search's decision for the seat to move: { best, list } as dandan-think.js think gives it. */
/** close: { gap, mult }, a decision whose top two means are within gap (value units) searched again at mult times the deals. */
/** dealer: a determinize in place of the rules' even one (sk-belief.js, Fable 02:10Z). valueMix { net, w } (Fable 03:12Z): at a bid,
 *  each option's mean is (1 − w) × its play-out mean + w × the value net's payoff for the seat at the position after that bid, in
 *  value units, and the bid goes to the best mix; the play-out mean stays as `playout`. The value net was trained on real outcomes
 *  of searched self-play, where the play-outs are policy-quality: it corrects what the play-outs flatter. */
export function bareThink(s, seat, { deals = 256, sd = SD, rollout = uniform, close = null, dealer = null, valueMix = null } = {}) {
  const r = think(s, seat, { deals, ms: 1e9, all: true, options: G.options, rollout, judge: judgeOf(sd), game: dealer ? { ...G, determinize: dealer } : G, hold: false, ...(close ? { deeper: close } : {}) });
  if (!valueMix || s.step !== "bid" || r.only) return r;
  const { net, w } = valueMix;
  const list = r.list.map(c => {
    const after = G.fork(s);
    G.act(after, seat, c.move, () => 0);
    const v = 0.5 + 0.5 * valuePayoff(net, after, seat) / sd;
    return { ...c, playout: c.mean, value: v, mean: (1 - w) * c.mean + w * v };
  }).sort((a, b) => b.mean - a.mean);
  return { ...r, best: list[0].move, list, valueMix: w };
}
