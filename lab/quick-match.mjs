// A quick match between two builds of the computer at Medium (the hand-written scorer, no look-ahead) or a few Hard deals:
// the same pairing as match.mjs (every deal played twice with the seats swapped) in seconds a game, so a change to what
// Medium does, which Hard plays out in its head too, can be seen over thousands of deals before a real match is spent.
// usage: node lab/quick-match.mjs <A dir> <B dir> <first pair> <pairs> <out.jsonl> [player: medium | hard<deals>, both sides]
import fs from "node:fs";
import path from "node:path";
import { J } from "./lib.mjs";
const [dirA, dirB, from, pairs, out, spec = "medium"] = [path.resolve(process.argv[2]), path.resolve(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6], process.argv[7]];
async function player(dir) {
  if (spec === "medium") { const pol = await import(`${dir}/dandan-policy.js`); return { move: (s, seat) => pol.policyMove(s, seat, { rng: Math.random }) }; }
  const th = await import(`${dir}/dandan-think.js`), deals = Number(spec.replace("hard", ""));
  return { move: (s, seat) => th.thinkMove(s, seat, { deals, ms: 1e9 }) };
}
const { rules } = await import(`${dirA}/dandan-rules.js`), { newRecord, applyMove, seeded, mix } = await import(`${dirA}/seats.js`);
const A = await player(dirA), B = await player(dirB);
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(l => { const r = JSON.parse(l); return r.pair * 2 + r.aSeat; }) : []);
const realRandom = Math.random;
for (let p = from; p < from + pairs; p++) for (const aSeat of [0, 1]) {
  if (done.has(p * 2 + aSeat)) continue;
  let G = newRecord(rules, { seats: 2, seed: 5000 + p, now: 0 }), moves = 0;
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state)), pl = who === aSeat ? A : B;
    Math.random = seeded(mix(5000 + p, i + 1));
    const move = pl.move(s, who);
    G = applyMove(rules, G, who, move, 0).G; moves++;
  }
  Math.random = realRandom;
  const st = G.state;
  fs.appendFileSync(out, JSON.stringify({ pair: p, aSeat, winner: st.winner, aWon: st.winner === aSeat ? 1 : st.winner < 0 ? 0.5 : 0, why: st.why, turns: st.turn, life: st.life, lib: st.lib.length, moves }) + "\n");
}
