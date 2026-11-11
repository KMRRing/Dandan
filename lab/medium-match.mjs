// Medium with some TUNE switches set against Medium as it is: every deal played twice, seats swapped, both seats the same plan
// (tempo on even deals, squeeze on odd). One row a deal: { pair, a: A's score over its two games }. Sum with
// lab/medium-match-sum.mjs (or read the last line this prints).
// usage: node lab/medium-match.mjs <shard> <shards> <out> <switches, e.g. tiWeak=1,redraw=1> [pairs 500] [first seed 50000]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove, TUNE } from "../dandan-policy.js";
import { J } from "./lib.mjs";
const [shard, shards, out, sw] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const pairs = Number(process.argv[6] ?? 500), first = Number(process.argv[7] ?? 50000);
const base = { ...TUNE }, mine = Object.fromEntries(sw.split(",").map(kv => kv.split("=")).map(([k, v]) => [k, Number(v)]));
for (const k of Object.keys(mine)) if (!(k in TUNE)) throw new Error(`no switch ${k}`);
const realRandom = Math.random;
function game(seed, aSeat, style) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Object.assign(TUNE, base, who === aSeat ? mine : {});
    Math.random = seeded(mix(seed, i + 1));
    const m = policyMove(s, who, { style, rng: Math.random });
    Math.random = realRandom;
    G = applyMove(rules, G, who, m, 0).G;
  }
  Object.assign(TUNE, base);
  const w = G.state.winner;
  return w === aSeat ? 1 : w == null || w < 0 ? 0.5 : 0;
}
let n = 0, t = 0;
for (let p = shard; p < pairs; p += shards) {
  const seed = first + p, style = p % 2 ? "squeeze" : "tempo", g = [game(seed, 0, style), game(seed, 1, style)];
  fs.appendFileSync(out, JSON.stringify({ pair: p, a: (g[0] + g[1]) / 2, games: g }) + "\n");
  n++; t += (g[0] + g[1]) / 2;
}
console.log(JSON.stringify({ sw, pairs: n, score: +(t / n).toFixed(4) }));
