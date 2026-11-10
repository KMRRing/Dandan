// Where a plan would lock in what Hard lets slip (Korbi, 10 November 2026: "situations where Hard does something questionable
// where a bot hard-coded to play for a specific target would likely lock in the win": letting their spells resolve one for one
// when sure to out-accelerate and squeeze them out; ignoring their threats, or holding draw and put-back effects, to set up a
// deck-out). From positions of Hard's own games (self-play batches) in a plan's setting (lab/plan-match.mjs: mid, end), the side
// to move is played on to the end in `deals` deals (the library's order dealt afresh each time, as no one knows it):
//   hard   by Hard at `think` deals, against Hard at `think` deals
//   <plan> by a Medium playing that plan, against the same Hard
// One row a position: { seed, i, phase, seat, lib, life, hands, lands, hardMove, hard: its score, plans: { name: { move, score } } }.
// The positions where a plan scores well above Hard are the finds. usage:
// node lab/locks.mjs <shard> <shards> <out> <self-play job ids, comma-separated> [plans squeeze] [deals 24] [think 16] [every 6th quiet turn]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { think, thinkMove } from "../dandan-think.js";
import { moveName } from "../dandan-words.js";
import { creatures, needType, isLand, typesOf, other } from "../dandan-core.js";

const [shard, shards, out, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const plans = (process.argv[6] ?? "squeeze").split(","), deals = Number(process.argv[7] ?? 24), depth = Number(process.argv[8] ?? 16), every = Number(process.argv[9] ?? 6);
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random;
const threat = (st, seat) => 8 * creatures(st, other(seat)).filter(d => st.bf.some(l => l.ctl === seat && isLand(l) && typesOf(l).includes(needType(d)))).length;
const phaseOf = st => (st.lib.length <= 20 ? "end" : st.lib.length <= 55 && st.life.every(l => l >= 12) && [0, 1].every(x => threat(st, x) < st.life[x]) ? "mid" : null);
const hard = { deals: depth, ms: 1e9 };

/** The side `seat` played by `mine` (a move function) from G to the end, the other by Hard: 1 won, 0 lost, a half drawn. */
function playOut(G, seat, mine, salt) {
  const st = J(G.state), rng = seeded(salt);
  for (let a = st.lib.length - 1; a > 0; a--) { const b = Math.floor(rng() * (a + 1)); [st.lib[a], st.lib[b]] = [st.lib[b], st.lib[a]]; }
  let H = { ...G, seed: salt >>> 0, moves: [], state: st };
  for (let i = 0; i < 4000 && !rules.over(H.state); i++) {
    const who = rules.toMove(H.state), s = rules.restore(J(H.state));
    Math.random = seeded(mix(salt, i + 1));
    const m = who === seat ? mine(s, who) : thinkMove(s, who, hard);
    Math.random = realRandom;
    const r = applyMove(rules, H, who, m, 0);
    if (r.error) throw new Error(r.error);
    H = r.G;
  }
  const w = H.state.winner;
  return w === seat ? 1 : w < 0 || w == null ? 0.5 : 0;
}

let k = 0;
for (const id of ids.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line);
  let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 }), lastTurn = -1, quietTurns = 0;
  for (let i = 0; i < rec.moves.length; i++) {
    const [seat, move] = rec.moves[i], st = G.state;
    const ph = phaseOf(st);
    if (ph && st.turn !== lastTurn && seat === st.active && !st.stack.length && !st.pending && st.step === "main1") {
      lastTurn = st.turn;
      if (quietTurns++ % every === 0 && k++ % shards === shard) {
        const s = rules.restore(J(st)), row = { seed: rec.seed, i, phase: ph, seat, lib: st.lib.length, life: [...st.life], hands: [st.hand[0].length, st.hand[1].length], lands: [0, 1].map(x => st.bf.filter(l => l.ctl === x && isLand(l)).length), hardMove: moveName(move, s, seat), plans: {} };
        let sum = 0;
        for (let d = 0; d < deals; d++) sum += playOut(G, seat, (s2, who) => thinkMove(s2, who, hard), mix(rec.seed * 31 + i, d + 1));
        row.hard = +(sum / deals).toFixed(3);
        for (const plan of plans) {
          const mine = (s2, who) => policyMove(s2, who, { rng: Math.random, style: plan });
          let t = 0;
          for (let d = 0; d < deals; d++) t += playOut(G, seat, mine, mix(rec.seed * 31 + i, d + 1));
          row.plans[plan] = { move: moveName(policyMove(rules.restore(J(st)), seat, { rng: seeded(1), style: plan }), s, seat), score: +(t / deals).toFixed(3) };
        }
        fs.appendFileSync(out, JSON.stringify(row) + "\n");
      }
    }
    const r = applyMove(rules, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
