// Hard with another judge (a lab/judge-train.mjs job's weights) against Hard with the game's judge: every deal played
// twice, seats swapped, both at the same thinking. One row a deal: { pair, a: A's score over its two games (0, 0.5, 1;
// a draw a half), games: [winner from A's side, …] }. lab/judge-match-sum.mjs reads them.
// usage: node lab/judge-match.mjs <shard> <shards> <out> <judge job, or job:variant> [deals 64] [pairs 600] [first seed 120000]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { thinkMove } from "../dandan-think.js";
import { makeJudge, winChance } from "../dandan-eval.js";

const [shard, shards, out, job] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const deals = Number(process.argv[6] ?? 64), pairs = Number(process.argv[7] ?? 600), first = Number(process.argv[8] ?? 120000);
// a judge job's weights: its first line, or with "job:N" the line of variant N (lab/judge-variants.mjs)
const [jobId, pick] = job.split(":");
const lines = (await readParts(jobId)).flatMap(t => t.split("\n").filter(Boolean)).map(l => JSON.parse(l));
const judgeA = makeJudge((pick == null ? lines[0] : lines.find(l => l.variant === Number(pick))).layers);
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random;

function game(seed, aSeat) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const m = thinkMove(s, who, { deals, ms: 1e9, judge: who === aSeat ? judgeA : winChance });
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
