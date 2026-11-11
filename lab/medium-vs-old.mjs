// Medium as it is against Medium from another checkout (an older commit): every deal twice, seats swapped, both seats the same
// plan (tempo on even deals, squeeze on odd). Rows { pair, a, games }, A being this checkout. Sum: lab/medium-match-sum.mjs.
// usage: node lab/medium-vs-old.mjs <shard> <shards> <out> <old dir> [pairs 1000] [first seed 60000]
import fs from "node:fs";
import path from "node:path";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { J } from "./lib.mjs";
const [shard, shards, out, old] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const pairs = Number(process.argv[6] ?? 1000), first = Number(process.argv[7] ?? 60000);
const oldMove = (await import(`${path.resolve(old)}/dandan-policy.js`)).policyMove;
const realRandom = Math.random;
function game(seed, aSeat, style) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const m = (who === aSeat ? policyMove : oldMove)(s, who, { style, rng: Math.random });
    Math.random = realRandom;
    const r = applyMove(rules, G, who, m, 0);
    if (r.error) throw new Error(r.error);
    G = r.G;
  }
  const w = G.state.winner;
  return w === aSeat ? 1 : w == null || w < 0 ? 0.5 : 0;
}
for (let p = shard; p < pairs; p += shards) {
  const seed = first + p, style = p % 2 ? "squeeze" : "tempo", g = [game(seed, 0, style), game(seed, 1, style)];
  fs.appendFileSync(out, JSON.stringify({ pair: p, a: (g[0] + g[1]) / 2, games: g, style }) + "\n");
}
