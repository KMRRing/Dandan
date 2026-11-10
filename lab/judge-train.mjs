// The judge (dandan-eval.js) taught again from Hard's own games (lab/selfplay.mjs), 10 November 2026. Korbi: the computer is
// weak in long games, where Hard's look-ahead stops two turns on and takes the judge's word; the judge learned from Medium
// against Medium, so its word is what a position is worth to two Medium players. Here each quiet position of a Hard game
// (nothing on the stack, no question) is labelled with what the search found it worth to the seat to move (the mean of the
// move it played, over 256 deals) blended with how that game ended, and the network is trained on from its present weights
// (with a pull back towards them, as a few hundred games are little beside the 45,000 it learned from).
// Every fifth game is held out: the judge as it is and as trained are both scored on those, by library size, so the gain
// from each batch of games can be followed. The trained layers are written to <out> as one JSON line, in dandan-eval's form.
// usage: node lab/judge-train.mjs <shard> <shards> <out> <job ids, comma-separated: spb01,spb02> [blend 0.5] [epochs 40] [pull 1e-4] [lr 3e-4]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { features, FEATURES } from "../dandan-eval.js";

const [, , , , out, ids, blend = 0.5, epochs = 40, pull = 1e-4, lr = 3e-4] = process.argv.map((a, i) => (i >= 6 ? Number(a) : a));
const N = FEATURES.length, HALF = (N - 3 - 17) / 2;

// ---------- the present network, from dandan-eval.js's source ----------
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
const NET0 = LAYERS0.map(dequant), NET = NET0.map(L => ({ ...L, W: Float64Array.from(L.W), b: Float64Array.from(L.b) }));

// ---------- forward and backward for one side's features ----------
function forward(net, x) {
  const acts = [x];
  let h = x;
  net.forEach((L, l) => {
    const y = Float64Array.from(L.b);
    for (let i = 0; i < L.nIn; i++) { const v = h[i]; if (!v) continue; const r = i * L.nOut; for (let o = 0; o < L.nOut; o++) y[o] += v * L.W[r + o]; }
    if (l < net.length - 1) for (let o = 0; o < L.nOut; o++) if (y[o] < 0) y[o] = 0;
    acts.push(y); h = y;
  });
  return acts;
}
function backward(net, acts, dOut, grads) {           // dOut: d loss / d g, added into grads
  let d = Float64Array.of(dOut);
  for (let l = net.length - 1; l >= 0; l--) {
    const L = net[l], x = acts[l], G = grads[l], dx = new Float64Array(L.nIn);
    for (let o = 0; o < L.nOut; o++) G.b[o] += d[o];
    for (let i = 0; i < L.nIn; i++) { const v = x[i], r = i * L.nOut; let s = 0; for (let o = 0; o < L.nOut; o++) { if (v) G.W[r + o] += v * d[o]; s += L.W[r + o] * d[o]; } dx[i] = s; }
    if (l > 0) for (let i = 0; i < L.nIn; i++) if (acts[l][i] <= 0) dx[i] = 0;
    d = dx;
  }
}
const swap = a => { const t = new Float64Array(N); t.set(a.subarray(HALF, 2 * HALF), 0); t.set(a.subarray(0, HALF), HALF); t.set(a.subarray(2 * HALF), 2 * HALF); t[2 * HALF] = 1 - a[2 * HALF]; return t; };
const chance = (net, a, b) => 1 / (1 + Math.exp(forward(net, b).at(-1)[0] - forward(net, a).at(-1)[0]));

// ---------- the positions ----------
const data = [];
let games = 0;
for (const id of ids.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line), at = new Map(rec.dec.map(d => [d.i, d]));
  const hold = games++ % 5 === 0;
  let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 });
  rec.moves.forEach(([seat, move], i) => {
    const d = at.get(i), s = G.state;
    if (d && d.pick >= 0 && !s.stack.length && !s.pending && Number.isFinite(d.list[d.pick][2])) {
      const me = d.seat, search = d.list[d.pick][2], won = rec.winner === me ? 1 : rec.winner < 0 ? 0.5 : 0;
      const a = Float64Array.from(features(rules.restore(JSON.parse(JSON.stringify(s))), me));
      data.push({ a, b: swap(a), y: blend * search + (1 - blend) * won, search, won, lib: s.lib.length, hold });
    }
    const r = applyMove(rules, G, seat, move, 0);
    if (r.error) throw new Error(`game ${rec.seed} move ${i}: ${r.error}`);
    G = r.G;
  });
}
const train = data.filter(r => !r.hold), test = data.filter(r => r.hold);
console.log(`games ${games}, positions ${data.length} (${train.length} to learn from, ${test.length} held out), blend ${blend}`);

// ---------- scores on the held-out games, by library ----------
const BUCKETS = [["all", 0, 80], ["lib 41-80", 41, 80], ["lib 21-40", 21, 40], ["lib 9-20", 9, 20], ["lib 0-8", 0, 8]];
function report(net, tag) {
  const p = test.map(r => chance(net, r.a, r.b));
  const parts = BUCKETS.map(([name, lo, hi]) => {
    const ix = test.map((r, i) => i).filter(i => test[i].lib >= lo && test[i].lib <= hi);
    if (!ix.length) return `${name} -`;
    const m = f => ix.reduce((s, i) => s + f(i), 0) / ix.length;
    return `${name} n${ix.length} vs search ${m(i => (p[i] - test[i].search) ** 2).toFixed(4)} vs result ${m(i => (p[i] - test[i].won) ** 2).toFixed(4)}`;
  });
  console.log(`${tag.padEnd(12)} ${parts.join(" | ")}`);
}
report(NET0, "judge now");

// ---------- training: cross-entropy on the blended label, Adam, a pull towards the present weights ----------
const zero = () => NET.map(L => ({ W: new Float64Array(L.W.length), b: new Float64Array(L.b.length) }));
const m1 = zero(), m2 = zero();
let t = 0, best = { loss: Infinity, net: null, epoch: 0 };
const lossOf = rows => rows.reduce((s, r) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, chance(NET, r.a, r.b))); return s - (r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); }, 0) / rows.length;
let rnd = 12345;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) >>> 0) / 2 ** 32);
for (let e = 1; e <= epochs; e++) {
  const order = train.map((_, i) => i).sort(() => rand() - 0.5);
  for (let k = 0; k < order.length; k += 64) {
    const G = zero(), batch = order.slice(k, k + 64);
    for (const i of batch) {
      const r = train[i], A = forward(NET, r.a), B = forward(NET, r.b), p = 1 / (1 + Math.exp(B.at(-1)[0] - A.at(-1)[0]));
      backward(NET, A, (p - r.y) / batch.length, G); backward(NET, B, -(p - r.y) / batch.length, G);
    }
    t++;
    NET.forEach((L, l) => {
      for (const key of ["W", "b"]) {
        const w = L[key], g = G[l][key], w0 = NET0[l][key], M = m1[l][key], V = m2[l][key];
        for (let i = 0; i < w.length; i++) {
          const gi = g[i] + pull * (w[i] - w0[i]);
          M[i] = 0.9 * M[i] + 0.1 * gi; V[i] = 0.999 * V[i] + 0.001 * gi * gi;
          w[i] -= (lr * (M[i] / (1 - 0.9 ** t))) / (Math.sqrt(V[i] / (1 - 0.999 ** t)) + 1e-8);
        }
      }
    });
  }
  const held = lossOf(test);
  if (held < best.loss) best = { loss: held, epoch: e, net: NET.map(L => ({ ...L, W: Float64Array.from(L.W), b: Float64Array.from(L.b) })) };
  if (e % 10 === 0) console.log(`epoch ${e}: held-out loss ${held.toFixed(4)} (learnt ${lossOf(train).toFixed(4)})`);
}
console.log(`best epoch ${best.epoch}, held-out loss ${best.loss.toFixed(4)}`);
const layers = best.net.map((L, l) => quant(L, l === best.net.length - 1));
report(best.net, "judge new");
report(layers.map(dequant), "as rounded");
fs.writeFileSync(out, JSON.stringify({ ids, blend, epoch: best.epoch, layers }) + "\n");
