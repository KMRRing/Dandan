// The general Monte playing Schafkopf (Fable, 24 Nov 2026 18:50Z): dandan-think.js's search with the rules engine's hooks
// (sk-rules.js), the same search for the bidding as for the cards. Bare (step 2, the baseline, as Zero's generation 0 was
// for Dandan): no nets yet, so the play-outs past the tree are uniform over the legal moves and the deal is played to its
// end, where the payoff is exact. A seat's value is 0.5 + 0.5 × payoff ÷ SD: with two seats and payoff ±1 that is Dandan's
// win chance exactly, so the search's constants (the exploration, the pruning spread, the close-call gap) read in standard
// deviations of the per-deal payoff for every game (Fable 18:50Z: one framework constant, no per-game tuning).
import { think } from "../../dandan-think.js";
import { schafkopf as G } from "./sk-rules.js";

/** The per-deal payoff's standard deviation, in tariffs: 6.73 at a table of four Codex Medium (lab/schafkopf/sk-sd.mjs, 400
 *  deals), until the baseline's own games measure it. */
export const SD = 6.73;
export const judgeOf = (sd = SD) => c => G.payoff(c).map(p => 0.5 + 0.5 * p / sd);
export const uniform = (c, who, rng) => { const ms = G.options(c, who); return ms[Math.floor(rng() * ms.length)]; };

/** The bare search's decision for the seat to move: { best, list } as dandan-think.js think gives it. */
export function bareThink(s, seat, { deals = 256, sd = SD, rollout = uniform } = {}) {
  return think(s, seat, { deals, ms: 1e9, all: true, options: G.options, rollout, judge: judgeOf(sd), game: G, hold: false });
}
