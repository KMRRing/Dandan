// Plan bots against each other in the part of the game a plan is for (lab/PLANS.md; Korbi, 10 November 2026: "the squeeze
// and deck bots should prove themselves against the tempo bot in instances that obviously should favour them"). The settings
// are fixed beforehand, by position, never by result:
//   mid  the library at 25 to 55 cards, both players at 12 life or more, and no Dandân able to kill within two turns
//   end  the library at 20 cards or fewer
// A deal is played by two tempo Medium (today's) until the first quiet main phase in the setting; from there the two plans
// play it out, then again from the same position with the seats swapped. A deal that never reaches the setting is skipped.
// One row a game: { pair, aSeat, aWon (plan A's score), skip?, phase, from: { lib, life, hands, lands }, turns, why }.
// usage: node lab/plan-match.mjs <shard> <shards> <out.jsonl> <pairs> <plan A> <plan B> <mid | end> [first deal 0]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { creatures, needType, isLand, typesOf, other } from "../dandan-core.js";

const [shard, shards, out, pairs, A, B, phase, from = 0] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5]), process.argv[6], process.argv[7], process.argv[8], Number(process.argv[9] ?? 0)];
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random;
const quiet = st => st.step === "main1" && !st.stack.length && !st.pending;
/** The damage the seat's Dandâns able to hit `seat` would deal in two of their turns. */
const threat = (st, seat) => 8 * creatures(st, other(seat)).filter(d => st.bf.some(l => l.ctl === seat && isLand(l) && typesOf(l).includes(needType(d)))).length;
const SETTING = {
  mid: st => st.lib.length >= 25 && st.lib.length <= 55 && st.life.every(l => l >= 12) && [0, 1].every(x => threat(st, x) < st.life[x]),
  end: st => st.lib.length <= 20,
};
if (!SETTING[phase]) throw new Error("phase: mid or end");
const move = (G, i, style) => {
  const who = rules.toMove(G.state), s = rules.restore(J(G.state));
  Math.random = seeded(mix(G.seed, i + 1));
  const r = applyMove(rules, G, who, policyMove(s, who, { rng: Math.random, style: style(who) }), 0);
  Math.random = realRandom;
  if (r.error) throw new Error(r.error);
  return r.G;
};
const base = Math.floor(pairs / shards), extra = pairs % shards, first = from + shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
for (let p = first; p < first + n; p++) {
  // the starting position: two tempo players until the setting is reached
  let G = newRecord(rules, { seats: 2, seed: 7000000 + p, now: 0 }), i = 0;
  for (; i < 4000 && !rules.over(G.state) && !(quiet(G.state) && SETTING[phase](G.state)); i++) G = move(G, i, () => "tempo");
  if (rules.over(G.state) || i >= 4000) { for (const aSeat of [0, 1]) fs.appendFileSync(out, JSON.stringify({ pair: p, aSeat, skip: 1, phase }) + "\n"); continue; }
  const st = G.state, start = { lib: st.lib.length, life: [...st.life], hands: [st.hand[0].length, st.hand[1].length], lands: [0, 1].map(x => st.bf.filter(l => l.ctl === x && isLand(l)).length) };
  for (const aSeat of [0, 1]) {
    let H = J(G), k = i;
    for (; k < 6000 && !rules.over(H.state); k++) H = move(H, k, who => (who === aSeat ? A : B));
    const w = H.state.winner;
    fs.appendFileSync(out, JSON.stringify({ pair: p, aSeat, aWon: w === aSeat ? 1 : w < 0 ? 0.5 : 0, phase, from: start, turns: H.state.turn, why: H.state.why }) + "\n");
  }
}
