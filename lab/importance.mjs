// Which of a judge's inputs matter (permutation importance): positions from Medium-against-Medium games (the start of each
// turn, labelled with the result), and for each input (mine and theirs together, the way the judge reads them) its values
// shuffled across the positions: how much worse the judge predicts (Brier, ×1000) without it. An input the judge ignores
// costs nothing. Also each input's first-layer weight (the sum of its weights' sizes).
// usage: node lab/importance.mjs [judge: a file in judges/, "today", or @<job> (a judge-variants run)] [games 300] [variant: which line of the job, by its variant number]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix, shuffle } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { FEATURES, PLUS, PLUS_NAMES, features, featuresPlus, build, score } from "../dandan-eval.js";
import { J, readParts } from "./lib.mjs";
const [file = "ag-v14.json", games = 300, variant] = process.argv.slice(2).map((x, i) => (i ? Number(x) : x));
const src = fs.readFileSync(new URL("../dandan-eval.js", import.meta.url), "utf8");
const fromJob = async () => { const ls = (await readParts(file.slice(1))).flatMap(t => t.split("\n").filter(Boolean)).map(l => JSON.parse(l)); return (variant == null ? ls[0] : ls.find(l => l.variant === variant)).layers; };
const layers = file.startsWith("@") ? await fromJob() : file === "today" ? JSON.parse(src.slice(src.indexOf("const LAYERS = ") + 15, src.indexOf("];", src.indexOf("const LAYERS = ")) + 1)) : JSON.parse(fs.readFileSync(new URL(`../judges/${file}`, import.meta.url), "utf8")).layers;
const net = build(layers), M = net[0].nIn, N = FEATURES.length, plus = M > N, half = (N - 3 - 17) / 2;
const swap = a => {
  const t = new Float32Array(M);
  t.set(a.subarray(half, 2 * half), 0); t.set(a.subarray(0, half), half); t.set(a.subarray(2 * half, N), 2 * half); t[2 * half] = 1 - a[2 * half];
  if (plus) { t.set(a.subarray(N + PLUS, N + 2 * PLUS), N); t.set(a.subarray(N, N + PLUS), N + PLUS); }
  return t;
};
const chance = a => 1 / (1 + Math.exp(score(net, swap(a)) - score(net, a)));
// positions
const rows = [], real = Math.random;
for (let g = 0; g < games; g++) {
  const seed = 90000 + g, style = g % 2 ? "squeeze" : "tempo", pos = [];
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), lastTurn = -1;
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const s = G.state, who = rules.toMove(s);
    if (s.turn !== lastTurn && !s.stack.length && !s.pending) { lastTurn = s.turn; const st = rules.restore(J(s)); pos.push((plus ? featuresPlus : features)(st, st.active)); pos.at(-1).me = st.active; }
    Math.random = seeded(mix(seed, i + 1));
    const m = policyMove(rules.restore(J(s)), who, { style, rng: Math.random });
    Math.random = real;
    G = applyMove(rules, G, who, m, 0).G;
  }
  const w = G.state.winner;
  for (const a of pos) rows.push({ a, y: w === a.me ? 1 : w < 0 ? 0.5 : 0 });
}
const brier = rs => rs.reduce((t, r) => t + (chance(r.a) - r.y) ** 2, 0) / rs.length;
const base = brier(rows);
// inputs as the judge pairs them: each seat-feature with its "Them" twin, each squeeze input with the other seat's, shared alone
const groups = [];
for (let i = 0; i < half; i++) groups.push({ name: FEATURES[i], idx: [i, half + i] });
for (let i = 2 * half; i < N; i++) groups.push({ name: FEATURES[i], idx: [i] });
if (plus) for (let i = 0; i < PLUS; i++) groups.push({ name: `[squeeze] ${PLUS_NAMES[i]}`, idx: [N + i, N + PLUS + i] });
const W0 = net[0], weightOf = i => { let t = 0; for (let o = 0; o < W0.nOut; o++) t += Math.abs(W0.W[i * W0.nOut + o]); return t; };
const r = seeded(7), out = [];
for (const g of groups) {
  const order = shuffle(rows.map((_, k) => k), r), saved = rows.map(x => g.idx.map(i => x.a[i]));
  rows.forEach((x, k) => g.idx.forEach((i, j) => { x.a[i] = saved[order[k]][j]; }));
  const worse = brier(rows) - base;
  rows.forEach((x, k) => g.idx.forEach((i, j) => { x.a[i] = saved[k][j]; }));
  out.push({ name: g.name, worse: 1000 * worse, weight: g.idx.reduce((t, i) => t + weightOf(i), 0) });
}
out.sort((a, b) => b.worse - a.worse);
console.log(`${file}: ${rows.length} positions from ${games} Medium games, Brier ${base.toFixed(4)}; Brier ×1000 lost when an input is scrambled:`);
for (const o of out) console.log(`${o.worse.toFixed(2).padStart(7)}  ${o.name.padEnd(34)} weight ${o.weight.toFixed(2)}`);
