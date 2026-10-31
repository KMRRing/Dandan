// A match between two builds of the computer player (A and B), each a snapshot directory of the page's modules. Every deal is
// played twice with the seats swapped, so a lucky deal cancels. The arena (rules, runner) is A's; only the players differ.
// usage: node match.mjs <A dir> <B dir> <first pair> <pairs> <out.jsonl> [A budget "deals:ms"] [B budget]
import fs from "node:fs";
import path from "node:path";
import { J, hr } from "./lib.mjs";
const [dirA, dirB, from, pairs, out, bA, bB] = [path.resolve(process.argv[2]), path.resolve(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6], process.argv[7], process.argv[8]];
// "deals", "deals:ms" or "deals:ms:first" (the deals before the first look; ms may be empty); none: the build's own deepest
const budgetOf = (spec, DEPTH) => {
  if (!spec) return DEPTH.deepest;
  const [d, ms, first] = spec.split(":");
  return { deals: Number(d), ms: Number(ms || 1e9), ...(first ? { first: Number(first) } : {}) };
};
async function player(dir, spec) {
  const th = await import(`${dir}/dandan-think.js`), budget = budgetOf(spec, th.DEPTH);
  // as the page does it: the worker's thinkMove at every decision (a stop at the upkeep included), not botMove's quick pass there
  return { budget, move: (s, seat) => th.thinkMove(s, seat, budget) };
}
const { rules } = await import(`${dirA}/dandan-rules.js`), { newRecord, applyMove, seeded, mix } = await import(`${dirA}/seats.js`);
const A = await player(dirA, bA), B = await player(dirB, bB);
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(l => { const r = JSON.parse(l); return r.pair * 2 + r.aSeat; }) : []);
const realRandom = Math.random;
for (let p = from; p < from + pairs; p++) for (const aSeat of [0, 1]) {
  if (done.has(p * 2 + aSeat)) continue;
  let G = newRecord(rules, { seats: 2, seed: 5000 + p, now: 0 }), t = [0, 0], n = [0, 0], moves = 0;
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state)), isA = who === aSeat, pl = isA ? A : B;
    Math.random = seeded(mix(5000 + p, i + 1));                       // the quick policy's own dice: the same in every run of this game
    const t0 = hr(), move = pl.move(s, who), dt = hr() - t0;
    t[isA ? 0 : 1] += dt; if (dt > 1) n[isA ? 0 : 1]++;
    G = applyMove(rules, G, who, move, 0).G; moves++;
  }
  Math.random = realRandom;
  const st = G.state;
  fs.appendFileSync(out, JSON.stringify({ pair: p, aSeat, winner: st.winner, aWon: st.winner === aSeat ? 1 : st.winner < 0 ? 0.5 : 0, why: st.why, turns: st.turn, life: st.life, lib: st.lib.length, moves, msA: t[0], msB: t[1], nA: n[0], nB: n[1] }) + "\n");
}
