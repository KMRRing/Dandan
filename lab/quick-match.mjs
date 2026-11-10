// A quick match between two builds of the computer at Medium (the hand-written scorer, no look-ahead) or a few Hard deals:
// the same pairing as match.mjs (every deal played twice with the seats swapped) in seconds a game, so a change to what
// Medium does, which Hard plays out in its head too, can be seen over thousands of deals before a real match is spent.
// usage: node lab/quick-match.mjs <A dir> <B dir> <first pair> <pairs> <out.jsonl> [player: medium | hard<deals>, both sides] [late: 0]
// late > 0 (10 November 2026, for the late game Korbi finds weak): both sides play A's Medium until the library has that many
// cards or fewer at the start of a main phase with nothing on the stack, and the two builds play only the rest; a deal whose
// game is over before that is skipped (a row with skip: 1). The same position starts both games of a pair.
import fs from "node:fs";
import path from "node:path";
import { J } from "./lib.mjs";
const [dirA, dirB, from, pairs, out, spec = "medium", late = 0] = [path.resolve(process.argv[2]), path.resolve(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6], process.argv[7], Number(process.argv[8] ?? 0)];
async function player(dir) {
  if (spec === "medium") { const pol = await import(`${dir}/dandan-policy.js`); return { move: (s, seat) => pol.policyMove(s, seat, { rng: Math.random }) }; }
  const th = await import(`${dir}/dandan-think.js`), deals = Number(spec.replace("hard", ""));
  return { move: (s, seat) => th.thinkMove(s, seat, { deals, ms: 1e9 }) };
}
const { rules } = await import(`${dirA}/dandan-rules.js`), { newRecord, applyMove, seeded, mix } = await import(`${dirA}/seats.js`);
const A = await player(dirA), B = await player(dirB), pol = await import(`${dirA}/dandan-policy.js`);
/** Medium for both sides until the library is down to `late` cards at a quiet main phase: the record and the move count, or null for a game already over. */
function lateStart(G) {
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const st = G.state;
    if (st.lib.length <= late && st.step === "main1" && !st.stack.length && !st.pending) return { G, i };
    const who = rules.toMove(st), s = rules.restore(J(st));
    Math.random = seeded(mix(G.seed, i + 1));   // as the game itself goes on below
    G = applyMove(rules, G, who, pol.policyMove(s, who, { rng: Math.random }), 0).G;
  }
  return null;
}
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(l => { const r = JSON.parse(l); return r.pair * 2 + r.aSeat; }) : []);
const realRandom = Math.random;
for (let p = from; p < from + pairs; p++) for (const aSeat of [0, 1]) {
  if (done.has(p * 2 + aSeat)) continue;
  let G = newRecord(rules, { seats: 2, seed: 5000 + p, now: 0 }), moves = 0, i0 = 0;
  if (late > 0) {
    const at = lateStart(G);
    Math.random = realRandom;
    if (!at) { fs.appendFileSync(out, JSON.stringify({ pair: p, aSeat, skip: 1 }) + "\n"); continue; }
    ({ G, i: i0 } = at);
  }
  for (let i = i0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state)), pl = who === aSeat ? A : B;
    Math.random = seeded(mix(5000 + p, i + 1));
    const move = pl.move(s, who);
    G = applyMove(rules, G, who, move, 0).G; moves++;
  }
  Math.random = realRandom;
  const st = G.state;
  fs.appendFileSync(out, JSON.stringify({ pair: p, aSeat, winner: st.winner, aWon: st.winner === aSeat ? 1 : st.winner < 0 ? 0.5 : 0, why: st.why, turns: st.turn, ...(late > 0 ? { late } : {}), life: st.life, lib: st.lib.length, moves }) + "\n");
}
