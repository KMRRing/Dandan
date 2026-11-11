// Many judges from Hard's own games at once (Korbi, 11 November 2026: "build 50 different SVNs from this data and have them
// fight"). Each shard trains one variant, by its number in VARIANTS: what it reads (the judge's 100 numbers, or those and the
// squeeze inputs, dandan-eval.js featuresPlus), its shape (today's 32·16 started from today's weights, or wider ones from
// scratch), what it learns (the game's result, or that blended with what Hard's search found the position worth) and whether
// a card in hand may lower its holder's chance (the floor rule, as lab/judge-train.mjs `hand`). Every fifth game is held out,
// and each variant is screened there against today's judge: Brier score against the result overall, in slow positions (no
// Dandân able to attack, the library over 20: the squeeze) and late ones (library 20 or less), and the share of held cards
// worth less than nothing to it. One JSON line: { variant, spec, epoch, metrics, today, layers } (layers as dandan-eval reads).
// usage: node lab/judge-variants.mjs <shard> <shards> <out> <self-play job ids, comma-separated> [variants: e.g. 14,15 (shard n trains
//        the n-th listed; else shard n trains variant n)] [warm start: a file in judges/ of the variant's width (else today's weights)]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { features, featuresPlus, FEATURES, PLUS } from "../dandan-eval.js";
import { creatures, needType, isLand, typesOf, other } from "../dandan-core.js";

const [shard, , out, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const VARIANTS = [];
for (const plus of [false, true]) for (const shape of ["32x16 warm", "64x32", "128x64x32"]) for (const blend of [0, 0.5]) for (const floor of [0, 1])
  VARIANTS.push({ plus, shape, blend, floor });
const only = process.argv[6] && process.argv[6] !== "-" ? process.argv[6].split(",").map(Number) : null, fromFile = process.argv[7];
const vNo = only ? only[shard] : shard, V = VARIANTS[vNo];
if (!V) { console.log(`no variant ${shard} (there are ${VARIANTS.length})`); process.exit(0); }
const N = FEATURES.length, HALF = (N - 3 - 17) / 2, M = V.plus ? N + 2 * PLUS : N;
const featuresOf = (s, me) => Float64Array.from(V.plus ? featuresPlus(s, me) : features(s, me));
const swap = a => {
  const t = new Float64Array(M);
  t.set(a.subarray(HALF, 2 * HALF), 0); t.set(a.subarray(0, HALF), HALF); t.set(a.subarray(2 * HALF, N), 2 * HALF); t[2 * HALF] = 1 - a[2 * HALF];
  if (M > N) { t.set(a.subarray(N + PLUS, N + 2 * PLUS), N); t.set(a.subarray(N, N + PLUS), N + PLUS); }
  return t;
};

// ---------- the network: an MLP, ReLU hidden layers, g(mine) − g(theirs) ----------
const src = fs.readFileSync(new URL("../dandan-eval.js", import.meta.url), "utf8");
const LAYERS0 = JSON.parse(src.slice(src.indexOf("const LAYERS = [") + 15, src.indexOf("];", src.indexOf("const LAYERS = [")) + 1).replace(/,\s*\]$/, "]"));
const dequant = L => {
  const [nIn, nOut] = L.n, raw = Buffer.from(L.q, "base64"), W = new Float64Array(nIn * nOut), b = new Float64Array(nOut);
  for (let i = 0; i < raw.length; i++) { let v = raw[i]; if (v > 127) v -= 256; W[i] = v * L.s[i % nOut]; }
  if (L.b.length) b.set(L.b);
  return { nIn, nOut, W, b };
};
const quant = (L, last) => {
  const { nIn, nOut, W, b } = L, s = new Array(nOut).fill(0), q = Buffer.alloc(nIn * nOut);
  for (let i = 0; i < W.length; i++) s[i % nOut] = Math.max(s[i % nOut], Math.abs(W[i]) / 127);
  for (let i = 0; i < W.length; i++) { const o = i % nOut, v = s[o] ? Math.round(W[i] / s[o]) : 0; q[i] = (v + 256) % 256; }
  return { n: [nIn, nOut], q: q.toString("base64"), s: s.map(x => +x.toPrecision(6)), b: last ? [] : [...b].map(x => +x.toPrecision(6)) };
};
let rnd = 99991 + shard;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
let NET;
const warm = V.shape.endsWith("warm");
if (warm) {
  // today's weights; the squeeze inputs (if read) start at nothing, so the start is today's judge exactly
  if (fromFile) {
    NET = JSON.parse(fs.readFileSync(new URL(`../judges/${fromFile}`, import.meta.url), "utf8")).layers.map(dequant);
    if (NET[0].nIn !== M) throw new Error(`${fromFile} reads ${NET[0].nIn} numbers, variant ${vNo} ${M}`);
  } else {
    NET = LAYERS0.map(dequant);
    if (M > N) { const L = NET[0], W = new Float64Array(M * L.nOut); W.set(L.W); NET[0] = { ...L, nIn: M, W }; }
  }
} else {
  const sizes = [M, ...V.shape.split("x").map(Number), 1];
  NET = sizes.slice(1).map((nOut, l) => { const nIn = sizes[l], W = new Float64Array(nIn * nOut).map(() => gauss() * Math.sqrt(2 / nIn)); return { nIn, nOut, W, b: new Float64Array(nOut) }; });
}
const NET0 = NET.map(L => ({ ...L, W: Float64Array.from(L.W), b: Float64Array.from(L.b) }));
function forward(net, x) {
  const acts = [x]; let h = x;
  net.forEach((L, l) => {
    const y = Float64Array.from(L.b);
    for (let i = 0; i < L.nIn; i++) { const v = h[i]; if (!v) continue; const r = i * L.nOut; for (let o = 0; o < L.nOut; o++) y[o] += v * L.W[r + o]; }
    if (l < net.length - 1) for (let o = 0; o < L.nOut; o++) if (y[o] < 0) y[o] = 0;
    acts.push(y); h = y;
  });
  return acts;
}
function backward(net, acts, dOut, grads) {
  let d = Float64Array.of(dOut);
  for (let l = net.length - 1; l >= 0; l--) {
    const L = net[l], x = acts[l], G = grads[l], dx = new Float64Array(L.nIn);
    for (let o = 0; o < L.nOut; o++) G.b[o] += d[o];
    for (let i = 0; i < L.nIn; i++) { const v = x[i], r = i * L.nOut; let s = 0; for (let o = 0; o < L.nOut; o++) { if (v) G.W[r + o] += v * d[o]; s += L.W[r + o] * d[o]; } dx[i] = s; }
    if (l > 0) for (let i = 0; i < L.nIn; i++) if (acts[l][i] <= 0) dx[i] = 0;
    d = dx;
  }
}
const chance = (net, a) => 1 / (1 + Math.exp(forward(net, swap(a)).at(-1)[0] - forward(net, a).at(-1)[0]));
function pGrad(net, a, coef, G) {
  const A = forward(net, a), B = forward(net, swap(a)), p = 1 / (1 + Math.exp(B.at(-1)[0] - A.at(-1)[0])), d = coef * p * (1 - p);
  backward(net, A, d, G); backward(net, B, -d, G);
  return p;
}

// ---------- the positions (as lab/judge-train.mjs: quiet positions of the games, each with the search's value) ----------
const slowOf = s => s.lib.length > 20 && [0, 1].every(x => !creatures(s, x).some(d => s.bf.some(l => l.ctl === other(x) && isLand(l) && typesOf(l).includes(needType(d)))));
const data = [];
let games = 0;
for (const id of ids.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line), at = new Map((rec.dec || []).map(d => [d.i, d]));
  const hold = games++ % 5 === 0;
  let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 });
  for (let i = 0; i < rec.moves.length; i++) {
    const [seat, move] = rec.moves[i], s = G.state;
    // a game with no search kept (Medium against Medium, lab/selfplay.mjs medium:…): every third quiet decision, labelled by the result
    const d = at.get(i) || (!at.size && i % 3 === 0 ? { seat, pick: 0, list: [[0, 0, -1]], medium: true } : null);
    if (d && d.pick >= 0 && !s.stack.length && !s.pending && Number.isFinite(d.list[d.pick][2])) {
      const me = d.seat, won = rec.winner === me ? 1 : rec.winner < 0 ? 0.5 : 0, search = d.medium ? won : d.list[d.pick][2];
      const st = rules.restore(JSON.parse(JSON.stringify(s)));
      const row = { a: featuresOf(st, me), y: V.blend * search + (1 - V.blend) * won, won, lib: s.lib.length, slow: slowOf(s), hold };
      if (V.floor || hold) {
        // the position with one card gone from each hand, read afresh (the squeeze inputs move with the hand)
        row.w = [me, other(me)].map(x => {
          if (!st.hand[x].length) return null;
          const t = rules.restore(JSON.parse(JSON.stringify(s))), k = Math.floor(rand() * t.hand[x].length);
          t.lib.push(t.hand[x].splice(k, 1)[0]);
          return featuresOf(t, me);
        });
      }
      data.push(row);
    }
    const r = applyMove(rules, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
const train = data.filter(r => !r.hold), test = data.filter(r => r.hold);

// ---------- the screen ----------
function screen(p) {
  const brier = rows => rows.length ? +(rows.reduce((a, r) => a + (p(r) - r.won) ** 2, 0) / rows.length).toFixed(4) : null;
  let n = 0, bad = 0;
  for (const r of test) (r.w || []).forEach((x, side) => {
    if (!x) return;
    n++;
    const d = p({ a: x }) - p(r);
    if (side === 0 ? d > 0.01 : d < -0.01) bad++;
  });
  return { all: brier(test), slow: brier(test.filter(r => r.slow)), late: brier(test.filter(r => r.lib <= 20)), flaws: n ? +(bad / n).toFixed(4) : null };
}

// ---------- training ----------
const zero = () => NET.map(L => ({ W: new Float64Array(L.W.length), b: new Float64Array(L.b.length) }));
const m1 = zero(), m2 = zero(), lr = warm ? 3e-4 : 1e-3, pull = warm ? 1e-4 : 0, epochs = warm ? 4 : 10;
let t = 0, best = { loss: Infinity, net: null, epoch: 0 };
const heldLoss = () => test.reduce((s, r) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, chance(NET, r.a))); return s - (r.won * Math.log(p) + (1 - r.won) * Math.log(1 - p)); }, 0) / test.length;
for (let e = 1; e <= epochs; e++) {
  const order = train.map((_, i) => i).sort(() => rand() - 0.5);
  for (let k = 0; k < order.length; k += 64) {
    const G = zero(), batch = order.slice(k, k + 64);
    for (const i of batch) {
      // cross-entropy on the label: d/dg(mine) is p − y; pGrad takes it per unit of p(1 − p)
      const r = train[i], p = chance(NET, r.a);
      pGrad(NET, r.a, (p - r.y) / (p * (1 - p) + 1e-9) / batch.length, G);
      if (V.floor && r.w) r.w.forEach((x, side) => {
        if (!x) return;
        const q = chance(NET, x), gap = side === 0 ? q - p : p - q;
        if (gap <= 0) return;
        const sign = side === 0 ? 1 : -1;
        pGrad(NET, x, sign / batch.length, G); pGrad(NET, r.a, -sign / batch.length, G);
      });
    }
    t++;
    NET.forEach((L, l) => {
      for (const key of ["W", "b"]) {
        const w = L[key], g = G[l][key], w0 = NET0[l][key], Mm = m1[l][key], Vv = m2[l][key];
        for (let i = 0; i < w.length; i++) {
          const gi = g[i] + pull * (w[i] - w0[i]);
          Mm[i] = 0.9 * Mm[i] + 0.1 * gi; Vv[i] = 0.999 * Vv[i] + 0.001 * gi * gi;
          w[i] -= (lr * (Mm[i] / (1 - 0.9 ** t))) / (Math.sqrt(Vv[i] / (1 - 0.999 ** t)) + 1e-8);
        }
      }
    });
  }
  const held = heldLoss();
  if (held < best.loss) best = { loss: held, epoch: e, net: NET.map(L => ({ ...L, W: Float64Array.from(L.W), b: Float64Array.from(L.b) })) };
}
const layers = best.net.map((L, l) => quant(L, l === best.net.length - 1)), rounded = layers.map(dequant);
const metrics = screen(r => chance(rounded, r.a));
// today's judge on the same positions: it reads the first N numbers
const NET_TODAY = LAYERS0.map(dequant), base = screen(r => chance0(NET_TODAY, r.a.subarray(0, N)));
function chance0(net, a) {
  const b = new Float64Array(N); b.set(a.subarray(HALF, 2 * HALF), 0); b.set(a.subarray(0, HALF), HALF); b.set(a.subarray(2 * HALF, N), 2 * HALF); b[2 * HALF] = 1 - a[2 * HALF];
  return 1 / (1 + Math.exp(forward(net, b).at(-1)[0] - forward(net, a).at(-1)[0]));
}
const line = { variant: vNo, from: fromFile || "today", spec: V, games, positions: data.length, epoch: best.epoch, metrics, today: base, layers };
console.log(JSON.stringify({ ...line, layers: undefined }));
fs.writeFileSync(out, JSON.stringify(line) + "\n");
