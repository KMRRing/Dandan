// How much stronger is the look-ahead (Hard) than Medium, the quick player it is built on? (9 November 2026: the headroom
// for an expert iteration, where the search teaches Medium and the judge: the first round can gain at most this much.)
// Every deal is played twice with the seats swapped, as in a Bot match (lab/match.mjs, the same deals: seed 5000 + pair).
// Hard thinks `hardDeals` deals a decision; Medium is dandan-bot.js's medium level. Run by the Lab workflow, a share of the
// pairs in each job: usage: node lab/headroom.mjs <shard> <shards> <out.jsonl> <hardDeals 256> <pairs 120>
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { thinkMove } from "../dandan-think.js";
import { botMove } from "../dandan-bot.js";
import { J, hr } from "./lib.mjs";

const [shard, shards, out, hardDeals, pairs] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5] || 256), Number(process.argv[6] || 120)];
const base = Math.floor(pairs / shards), extra = pairs % shards, first = shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);   // lab/shard.mjs's split
const budget = { deals: hardDeals, ms: 1e9 };
const realRandom = Math.random;
for (let p = first; p < first + n; p++) for (const hardSeat of [0, 1]) {
  let G = newRecord(rules, { seats: 2, seed: 5000 + p, now: 0 }), moves = 0;
  const t0 = hr();
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(5000 + p, i + 1));
    const move = who === hardSeat ? thinkMove(s, who, budget) : botMove(s, who, { rng: seeded(mix(9000 + p, i + 1)), level: "medium" });
    G = applyMove(rules, G, who, move, 0).G; moves++;
  }
  Math.random = realRandom;
  const st = G.state;
  fs.appendFileSync(out, JSON.stringify({ pair: p, hardSeat, winner: st.winner, hardWon: st.winner === hardSeat ? 1 : st.winner < 0 ? 0.5 : 0, why: st.why, turns: st.turn, lib: st.lib.length, moves, ms: Math.round(hr() - t0) }) + "\n");
}
