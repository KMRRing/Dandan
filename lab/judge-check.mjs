// How far off is the judge (dandan-eval.js winChance), and where in the game? (10 November 2026: Korbi finds the computer weak
// in long games. Late in a game Hard looks two turns ahead and then takes the judge's word, unless 8 cards or fewer are left.)
// Games of Medium against Medium; at the start of turns, the position is valued twice for the seat to move: by the judge, and by
// playing it out to the end `k` times (Medium against Medium, the library shuffled each time, as neither player knows its order).
// The playouts are what the judge was trained to predict, so the gap between the two is the judge's own error, free of
// the noise of one game's result. One row a position: { seed, turn, lib, hand, judge, mc, k, won }.
// usage: node lab/judge-check.mjs <shard> <shards> <out.jsonl> <games> <k 64> [every nth turn: 1] [first seed 300000]
import fs from "node:fs";
import { J } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { winChance } from "../dandan-eval.js";

const [shard, shards, out, games, k = 64, every = 1, seed0 = 300000] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], ...process.argv.slice(5).map(Number)];
const realRandom = Math.random;
/** Medium against Medium from G to the end: the winner (-1 a draw). */
function playOut(G, salt) {
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(salt, i + 1));
    const r = applyMove(rules, G, who, policyMove(s, who, { rng: Math.random }), 0);
    Math.random = realRandom;
    if (r.error) throw new Error(r.error);
    G = r.G;
  }
  return rules.over(G.state) ? G.state.winner : -1;
}
const quiet = s => !s.stack.length && !s.pending;
for (let g = shard; g < games; g += shards) {
  const seed = seed0 + g;
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), lastTurn = -1;
  const rows = [];
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const st = G.state;
    if (st.turn !== lastTurn && st.step !== "mull" && quiet(st)) {
      lastTurn = st.turn;
      if (st.turn % every === 0) {
        const me = rules.toMove(st), judge = winChance(rules.restore(J(st)), me);
        let sum = 0;
        for (let j = 0; j < k; j++) {
          const salt = mix(seed * 977 + st.turn, j + 1), rng = seeded(salt), c = J(st);
          for (let a = c.lib.length - 1; a > 0; a--) { const b = Math.floor(rng() * (a + 1)); [c.lib[a], c.lib[b]] = [c.lib[b], c.lib[a]]; }
          const w = playOut({ ...G, seed: salt >>> 0, moves: [], state: c }, salt ^ 0x9e37);
          sum += w === me ? 1 : w < 0 ? 0.5 : 0;
        }
        rows.push({ seed, turn: st.turn, me, lib: st.lib.length, hand: st.hand[me].length, judge: +judge.toFixed(4), mc: +(sum / k).toFixed(4), k });
      }
    }
    const who = rules.toMove(st), s = rules.restore(J(st));
    Math.random = seeded(mix(seed, i + 1));
    G = applyMove(rules, G, who, policyMove(s, who, { rng: Math.random }), 0).G;
    Math.random = realRandom;
  }
  const w = G.state.winner;
  for (const r of rows) fs.appendFileSync(out, JSON.stringify({ ...r, won: w === r.me ? 1 : w < 0 ? 0.5 : 0 }) + "\n");
}
