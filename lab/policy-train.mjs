// Stage 1's model (monte-plan.md 3.3, 11 November 2026): Medium's own move scores plus a learned correction, trained
// to rank the moves as the search did. For a decision with candidates a:
//   score(a) = α·s(a) + β·[a is Medium's pick] + f(x, marks(a), s(a))
// s: Medium's score of the move (lab/export.mjs), f: a small network (the position's part of the first layer once, each
// move's marks and its Medium score added; 64 → 32 → 1). f's last layer starts at zero and β large, so the model starts
// as Medium exactly and moves only where the data say so. Target: p(a) ∝ exp(q(a) / T) over the listed candidates
// (q: the search's mean; T 0.02, so a move 2 points behind gets about a third of the leader's weight); loss: cross-entropy,
// Deep decisions weighted 1 and shortlist ones `light`. Held out: the export's every fifth game.
// G0, printed at the end on held-out Deep decisions: the value given up against the search's best move (its mean minus the
// chosen move's, in points), Medium's pick against the model's; it passes when the model gives up at least a quarter less.
// One JSON line out: { alpha, beta, net, metrics }; dandan-netpolicy.js makePlus reads it.
// usage: node lab/policy-train.mjs <shard> <shards> <out> <export job ids, comma-separated> [epochs 6] [lr 1e-3] [H1 64] [H2 32] [T 0.02] [light 0.3]
import fs from "node:fs";
import { labStore } from "./lib.mjs";
import { MOVE_N } from "../dandan-netpolicy.js";

const [shard, , out, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const EPOCHS = Number(process.argv[6]) || 6, LR = Number(process.argv[7]) || 1e-3, H1 = Number(process.argv[8]) || 64, H2 = Number(process.argv[9]) || 32;
const T = Number(process.argv[10]) || 0.02, LIGHT = process.argv[11] != null ? Number(process.argv[11]) : 0.3;
const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a, `(memory ${Math.round(process.memoryUsage().rss / 1e6)} MB)`);

// ---------- the decisions, packed ----------
const train = [], held = [];
let XN = 0;
const store = await labStore();
for (const id of ids.split(",")) for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
  for (const line of ((await store.get(name)) || "").split("\n")) {
    if (!line) continue;
    const d = JSON.parse(line);
    XN = d.x.length;
    const q = d.c.map(c => c.q), qmax = Math.max(...q);
    const D = {
      x: Float32Array.from(d.x), m: d.c.map(c => Int16Array.from(c.m)), s: Float32Array.from(d.c.map(c => c.s)), q: Float32Array.from(q),
      med: d.med, pick: d.pick, deep: d.deep, w: d.deep ? 1 : LIGHT,
      // the target: softmax of the search's means at temperature T
      p: (() => { const e = q.map(v => Math.exp((v - qmax) / T)), z = e.reduce((a, b) => a + b, 0); return Float32Array.from(e, v => v / z); })(),
    };
    (d.hold ? held : train).push(D);
  }
}
say(`read ${train.length} training and ${held.length} held-out decisions, ${XN} position inputs`);

// ---------- the model ----------
const rnd = (() => { let a = 12345 + shard; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 2 ** 32 - 0.5; }; })();
const P = {
  alpha: Float64Array.of(1 / 0.3), beta: Float64Array.of(10),
  wx: Float64Array.from({ length: XN * H1 }, () => rnd() * 2 * Math.sqrt(1 / XN)), wm: Float64Array.from({ length: MOVE_N * H1 }, () => rnd() * 2 * Math.sqrt(1 / 8)),
  ws: Float64Array.from({ length: H1 }, () => rnd() * 0.2), b1: new Float64Array(H1),
  w2: Float64Array.from({ length: H1 * H2 }, () => rnd() * 2 * Math.sqrt(2 / H1)), b2: new Float64Array(H2), w3: new Float64Array(H2),
};
const zero = () => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, new Float64Array(v.length)]));
const M = zero(), V = zero();
let step = 0;

/** Scores of a decision's candidates, with what the backward pass needs. */
function forward(D) {
  const base = Float64Array.from(P.b1);
  for (let i = 0; i < XN; i++) { const v = D.x[i]; if (v === 0) continue; const r = i * H1; for (let o = 0; o < H1; o++) base[o] += v * P.wx[r + o]; }
  const K = D.m.length, h1s = [], h2s = [], sc = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const h1 = Float64Array.from(base);
    for (const i of D.m[k]) { const r = i * H1; for (let o = 0; o < H1; o++) h1[o] += P.wm[r + o]; }
    const s = D.s[k];
    for (let o = 0; o < H1; o++) { h1[o] += s * P.ws[o]; if (h1[o] < 0) h1[o] = 0; }
    const h2 = Float64Array.from(P.b2);
    for (let o = 0; o < H1; o++) { const h = h1[o]; if (h === 0) continue; const r = o * H2; for (let o2 = 0; o2 < H2; o2++) h2[o2] += h * P.w2[r + o2]; }
    let f = 0;
    for (let o2 = 0; o2 < H2; o2++) { if (h2[o2] < 0) h2[o2] = 0; f += h2[o2] * P.w3[o2]; }
    sc[k] = P.alpha[0] * s + (k === D.med ? P.beta[0] : 0) + f;
    h1s.push(h1); h2s.push(h2);
  }
  return { sc, h1s, h2s };
}
const softmax = sc => { const mx = Math.max(...sc), e = Array.from(sc, v => Math.exp(v - mx)), z = e.reduce((a, b) => a + b, 0); return e.map(v => v / z); };

/** One decision's gradient (cross-entropy to the target), added into G; returns its loss. */
function backward(D, G) {
  const { sc, h1s, h2s } = forward(D), pr = softmax(sc), K = sc.length;
  let loss = 0;
  for (let k = 0; k < K; k++) if (D.p[k] > 0) loss -= D.p[k] * Math.log(pr[k] + 1e-12);
  const gb1 = new Float64Array(H1);
  for (let k = 0; k < K; k++) {
    const g = D.w * (pr[k] - D.p[k]);
    if (g === 0) continue;
    G.alpha[0] += g * D.s[k];
    if (k === D.med) G.beta[0] += g;
    const h1 = h1s[k], h2 = h2s[k], g2 = new Float64Array(H2);
    for (let o2 = 0; o2 < H2; o2++) { G.w3[o2] += g * h2[o2]; if (h2[o2] > 0) { g2[o2] = g * P.w3[o2]; G.b2[o2] += g2[o2]; } }
    const g1 = new Float64Array(H1);
    for (let o = 0; o < H1; o++) {
      if (h1[o] <= 0) continue;
      const r = o * H2;
      let v = 0;
      for (let o2 = 0; o2 < H2; o2++) { if (g2[o2] === 0) continue; G.w2[r + o2] += h1[o] * g2[o2]; v += P.w2[r + o2] * g2[o2]; }
      g1[o] = v;
    }
    for (const i of D.m[k]) { const r = i * H1; for (let o = 0; o < H1; o++) G.wm[r + o] += g1[o]; }
    for (let o = 0; o < H1; o++) { G.ws[o] += g1[o] * D.s[k]; gb1[o] += g1[o]; }
  }
  for (let o = 0; o < H1; o++) G.b1[o] += gb1[o];
  for (let i = 0; i < XN; i++) { const v = D.x[i]; if (v === 0) continue; const r = i * H1; for (let o = 0; o < H1; o++) G.wx[r + o] += v * gb1[o]; }
  return D.w * loss;
}
function adam(G, n) {
  step++;
  const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** step, c2 = 1 - b2 ** step;
  for (const k in P) {
    const p = P[k], g = G[k], m = M[k], v = V[k];
    for (let i = 0; i < p.length; i++) {
      const gi = g[i] / n;
      if (gi === 0 && m[i] === 0) continue;
      m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      p[i] -= (LR * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + 1e-8);
    }
  }
}

// ---------- G0: value given up against the search's best, on held-out Deep decisions ----------
function measure(set) {
  let n = 0, med = 0, mod = 0, agreeMed = 0, agreeMod = 0, loss = 0;
  for (const D of set) {
    if (!D.deep) continue;
    const { sc } = forward(D), qmax = Math.max(...D.q);
    let best = 0;
    for (let k = 1; k < sc.length; k++) if (sc[k] > sc[best]) best = k;
    const pr = softmax(sc);
    for (let k = 0; k < sc.length; k++) if (D.p[k] > 0) loss -= D.p[k] * Math.log(pr[k] + 1e-12);
    n++; med += qmax - D.q[D.med]; mod += qmax - D.q[best];
    agreeMed += D.med === D.pick ? 1 : 0; agreeMod += best === D.pick ? 1 : 0;
  }
  return n ? { decisions: n, loss: +(loss / n).toFixed(4), mediumGivesUp: +((100 * med) / n).toFixed(3), modelGivesUp: +((100 * mod) / n).toFixed(3), mediumAgrees: +(agreeMed / n).toFixed(4), modelAgrees: +(agreeMod / n).toFixed(4) } : { decisions: 0 };
}

let best = { ...measure(held), epoch: 0 }, bestP = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, Array.from(v)]))));
say("before training (Medium exactly):", JSON.stringify(best));
const BATCH = 64, order = train.map((_, i) => i);
for (let e = 1; e <= EPOCHS; e++) {
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor((rnd() + 0.5) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let G = zero(), n = 0, tl = 0;
  for (const idx of order) {
    tl += backward(train[idx], G);
    if (++n % BATCH === 0) { adam(G, BATCH); G = zero(); }
  }
  const h = measure(held);
  say(`epoch ${e}: training loss ${(tl / order.length).toFixed(4)}, held out ${JSON.stringify(h)}, alpha ${P.alpha[0].toFixed(3)}, beta ${P.beta[0].toFixed(3)}`);
  if (h.loss < best.loss) { best = { ...h, epoch: e }; bestP = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, Array.from(v)])))); }
}
const r5 = a => a.map(v => Math.round(v * 1e5) / 1e5);
const net = { XN, H1, H2, wx: r5(bestP.wx), wm: r5(bestP.wm), ws: r5(bestP.ws), b1: r5(bestP.b1), w2: r5(bestP.w2), b2: r5(bestP.b2), w3: r5(bestP.w3) };
const g0 = best.mediumGivesUp > 0 ? +(1 - best.modelGivesUp / best.mediumGivesUp).toFixed(4) : 0;
const metrics = { ...best, train: train.length, held: held.length, g0Reduction: g0, g0Pass: g0 >= 0.25 };
console.log(JSON.stringify({ metrics, alpha: bestP.alpha[0], beta: bestP.beta[0], epochs: EPOCHS, lr: LR, T, light: LIGHT }));
fs.writeFileSync(out, JSON.stringify({ alpha: bestP.alpha[0], beta: bestP.beta[0], net, metrics }) + "\n");
