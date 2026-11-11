// Hard valuing Mind Bend and Piracy Charm as gems (Korbi, 11 November 2026) against Hard as it is: Medium's gems switch on in
// A's look-ahead (its playouts), and A's judge told each gem in hand is worth `shift` more (on the logit of the chance, mine
// minus theirs, so the judge stays antisymmetric). Every deal twice, seats swapped. Rows as lab/judge-match.mjs (its -sum reads them).
// usage: node lab/gem-match.mjs <shard> <shards> <out> [shift 0.16] [deals 64] [pairs 200] [first seed 140000]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { thinkMove } from "../dandan-think.js";
import { winChance } from "../dandan-eval.js";
import { TUNE } from "../dandan-policy.js";
import { DECK } from "../dandan-cards.js";
const [shard, shards, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const shift = Number(process.argv[5] ?? 0.16), deals = Number(process.argv[6] ?? 64), pairs = Number(process.argv[7] ?? 200), first = Number(process.argv[8] ?? 140000);
const GEM = new Set(["Mind Bend", "Piracy Charm"]), gems = h => h.filter(id => GEM.has(DECK[id])).length;
const logit = p => Math.log(p / (1 - p)), sig = x => 1 / (1 + Math.exp(-x));
const judgeA = (s, seat) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, winChance(s, seat))); return sig(logit(p) + shift * (gems(s.hand[seat]) - gems(s.hand[1 - seat]))); };
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random;
function game(seed, aSeat) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    TUNE.gems = who === aSeat ? 1 : 0;
    const m = thinkMove(s, who, { deals, ms: 1e9, judge: who === aSeat ? judgeA : winChance });
    TUNE.gems = 0;
    Math.random = realRandom;
    const r = applyMove(rules, G, who, m, 0);
    if (r.error) throw new Error(`deal ${seed} move ${i}: ${r.error}`);
    G = r.G;
  }
  const w = G.state.winner;
  return w === aSeat ? 1 : w == null || w < 0 ? 0.5 : 0;
}
for (let p = shard; p < pairs; p += shards) {
  const seed = first + p, g = [game(seed, 0), game(seed, 1)];
  fs.appendFileSync(out, JSON.stringify({ pair: p, a: (g[0] + g[1]) / 2, games: g }) + "\n");
}
