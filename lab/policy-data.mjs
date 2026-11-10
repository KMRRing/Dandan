// The learned policy's lessons (dandan-netpolicy.js): Medium against Medium, and at every decision with priority the
// position, each legal move's marks, and the one Medium chose. One line a decision:
//   { g: game, x: the position's numbers (rounded), m: [[marks of each choice]], y: Medium's choice }
// Decisions with one choice (nothing but passing) are left out. usage:
// node lab/policy-data.mjs <shard> <shards> <out> [games 400] [first seed 50000]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { stateOf, marksOf, choices } from "../dandan-netpolicy.js";

const [shard, shards, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const games = Number(process.argv[5] ?? 400), first = Number(process.argv[6] ?? 50000);
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random, key = m => JSON.stringify(m);

for (let n = shard; n < games; n += shards) {
  const seed = first + n, lines = [];
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const m = policyMove(s, who, { rng: Math.random });
    Math.random = realRandom;
    if (!s.pending) {
      const t = rules.restore(J(G.state)), list = choices(t, who), y = list.findIndex(c => key(c) === key(m));
      if (list.length > 1 && y >= 0) lines.push(JSON.stringify({ g: seed, x: Array.from(stateOf(t, who), v => Math.round(v * 1000) / 1000), m: list.map(c => marksOf(t, who, c)), y }));
    }
    const r = applyMove(rules, G, who, m, 0);
    if (r.error) break;
    G = r.G;
  }
  if (lines.length) fs.appendFileSync(out, lines.join("\n") + "\n");
}
