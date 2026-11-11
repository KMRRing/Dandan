// Would a match need fewer games if the luck of the draws were taken off each result? (11 November 2026.) Backgammon and
// poker programs score matches this way: at every move the value net reads the position after it, and that reading is set
// against its average over K re-deals of the library cards nobody has seen. The difference is luck: it is zero on average
// whatever the players do, so a result less the game's sum of them is still a fair score, and a steadier one if the value
// net prices the draws well (a control variate). Tried here on Medium against Medium with one switch flipped, every deal
// from both seats as lab/hard-match.mjs plays them.
//
// Result with value net v14, 1,000 to 1,500 deal pairs a run: 1.07 to 1.22 times fewer games for the same range (landPlan,
// cScore), 1.16 to 1.18 on single games; more re-deals (32 for 8) change nothing. Not worth building into the matches. The
// reason is the finding: v14's sum of the draws' luck goes with the game's result at only 0.40, so most of what decides a
// game reaches it when the moves are made, not when the cards are drawn. A value net that priced a draw well would bring
// this towards the eight-fold and more that the games with strong value nets get; the figure is a yardstick for a value
// net that needs no match (`single.corr`, `adjusted.fewerGames`).
// usage: node lab/luck-adjust.mjs [pairs 1000] [first seed 500000] [re-deals 8] [switch landPlan, or name=value] [judge ag-v14.json]
import fs from "node:fs";
import { deal, act, toMove } from "../dandan-engine.js";
import { policyMove, TUNE } from "../dandan-policy.js";
import { makeJudge } from "../dandan-eval.js";
import { seeded, mix } from "../seats.js";
import { fork } from "../dandan-think.js";

const [pairs, first, K] = [Number(process.argv[2] ?? 1000), Number(process.argv[3] ?? 500000), Number(process.argv[4] ?? 8)];
const [key, val = "0"] = (process.argv[5] || "landPlan").split("="), judgeFile = process.argv[6] || "ag-v14.json";
const V = makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${judgeFile}`, import.meta.url), "utf8")).layers);

/** Side A is Medium as it is; side B has the one switch set to `val`. */
function move(isA, s, seat, rng) {
  if (isA) return policyMove(s, seat, { rng });
  const was = TUNE[key];
  TUNE[key] = Number(val);
  try { return policyMove(s, seat, { rng }); } finally { TUNE[key] = was; }
}
/** The library cards no seat has seen: the ones a re-deal may put in another order. */
const unseen = s => { const known = new Set(s.kn.filter(e => e[1]).map(e => e[0])); return s.lib.filter(id => !known.has(id)); };
/** A copy of the game with the library's unseen cards in another order (the places anyone knows stay as they are). */
function redeal(pre, rng) {
  const c = fork(pre), ids = unseen(pre), free = new Set(ids);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  let k = 0;
  c.lib = c.lib.map(id => (free.has(id) ? ids[k++] : id));
  return c;
}
/** One game: A's result and the luck A had by the value net's reading, summed over the moves that took an unseen card from the library. */
function game(seed, aSeat) {
  const s = deal({ rng: seeded(seed) });
  let luck = 0;
  for (let i = 0; i < 4000 && !s.over; i++) {
    const who = toMove(s), m = move(who === aSeat, s, who, seeded(mix(seed, 7919 + i))), pre = fork(s);
    if (typeof act(s, who, m, { rng: seeded(mix(seed, i + 1)), quiet: true }) === "string") throw new Error(`deal ${seed} move ${i}: a move refused`);
    const left = new Set(s.lib);
    if (!unseen(pre).some(id => !left.has(id))) continue;
    let mean = 0;
    for (let k = 0; k < K; k++) {
      const c = redeal(pre, seeded(mix(seed ^ 0x51ed, i * 64 + k + 1)));
      act(c, who, m, { rng: seeded(mix(seed ^ 0xabc, i * 64 + k + 1)), quiet: true });
      mean += V(c, aSeat);
    }
    luck += V(s, aSeat) - mean / K;
  }
  return { y: s.winner === aSeat ? 1 : s.winner < 0 ? 0.5 : 0, luck };
}

const raw = [], adj = [], gy = [], gl = [];
for (let p = 0; p < pairs; p++) {
  const g0 = game(first + p, 0), g1 = game(first + p, 1);
  gy.push(g0.y, g1.y); gl.push(g0.luck, g1.luck);
  raw.push((g0.y + g1.y) / 2); adj.push((g0.y - g0.luck + g1.y - g1.luck) / 2);
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const corr = (a, b) => { const ma = mean(a), mb = mean(b); return a.reduce((x, y, i) => x + (y - ma) * (b[i] - mb), 0) / (a.length - 1) / (sd(a) * sd(b)); };
const r = (x, d = 4) => +x.toFixed(d), one = gy.map((y, i) => y - gl[i]);
console.log(JSON.stringify({
  switch: `${key}=${val}`, judge: judgeFile, pairs, redeals: K,
  raw: { mean: r(mean(raw)), sd: r(sd(raw)), se: r(sd(raw) / Math.sqrt(pairs)) },
  luck: { mean: r(mean(gl)), se: r(sd(gl) / Math.sqrt(gl.length)) },
  adjusted: { mean: r(mean(adj)), sd: r(sd(adj)), se: r(sd(adj) / Math.sqrt(pairs)), fewerGames: r((sd(raw) / sd(adj)) ** 2, 2) },
  single: { sdResult: r(sd(gy)), sdLuck: r(sd(gl)), corr: r(corr(gy, gl), 3), fewerGames: r((sd(gy) / sd(one)) ** 2, 2) },
}));
