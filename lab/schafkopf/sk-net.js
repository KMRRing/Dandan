// Schafkopf's nets in the search (Fable, 24 Nov 2026 22:52Z, generation 1): a net trained by sk_train.py (its JSON: the layers'
// weights, ReLU between, the last linear), read from the seat's view as sk-pack.mjs packed it. The policy's play-out: every seat,
// in place of a uniform move, samples from the policy's softmax over its legal moves, to the end of the deal.
import fs from "node:fs";
import { schafkopf as G } from "./sk-rules.js";
import { rawView, auxView, partnerView, RAW_SIZE, AUX_SIZE, PART_SIZE, ACTIONS, actionOf } from "./sk-view.js";

export function loadNet(file) {
  return prepare(JSON.parse(fs.readFileSync(file, "utf8")));
}
function prepare(j) {
  const layers = j.layers.map(l => ({ w: Float32Array.from(l.w.flat()), b: Float32Array.from(l.b), n: l.b.length, k: l.w[0].length }));
  // the first layer by input (its weights transposed): the view is mostly zeros, so it is summed over the inputs that aren't
  const f = layers[0], wt = new Float32Array(f.n * f.k);
  for (let o = 0; o < f.n; o++) for (let i = 0; i < f.k; i++) wt[i * f.n + o] = f.w[o * f.k + i];
  f.wt = wt;
  const beliefs = j.beliefs ? { own: prepare(j.beliefs.own), public: prepare(j.beliefs.public) } : null;
  return { ...j, layers, beliefs, aux: j.inputs === "raw+aux", part: j.inputs === "raw+part" };
}
/** The layers over an input vector: ReLU between, the last linear. */
function run(net, x) {
  net.layers.forEach((l, li) => {
    const y = new Float32Array(l.n), last = li === net.layers.length - 1;
    if (li === 0) {
      y.set(l.b);
      for (let i = 0; i < l.k; i++) { const xi = x[i]; if (xi) { const col = i * l.n; for (let o = 0; o < l.n; o++) y[o] += xi * l.wt[col + o]; } }
      if (!last) for (let o = 0; o < l.n; o++) if (y[o] < 0) y[o] = 0;
    } else for (let o = 0; o < l.n; o++) { let t = l.b[o]; const row = o * l.k; for (let i = 0; i < l.k; i++) t += l.w[row + i] * x[i]; y[o] = !last && t < 0 ? 0 : t; }
    x = y;
  });
  return x;
}
/** A belief net's probabilities over the four relative seats holding the called ace, masked by what is exact (zeros when the mask is
 *  empty: outside a Sauspiel's play). `raw` and `q` as packed; the public net sees no hand and no own mask (sk_train.py). */
function belief(net, raw, q, pub) {
  const x = new Float32Array(net.n_in);
  x.set(raw); x.set(q, RAW_SIZE);
  if (pub) { x.fill(0, 0, 32); x.fill(0, RAW_SIZE + 4, RAW_SIZE + 8); }
  const z = run(net, x), m = pub ? q.subarray(0, 4) : q.subarray(4, 8), out = new Float32Array(4);
  let top = -Infinity, t = 0;
  for (let r = 0; r < 4; r++) if (m[r] > 0 && z[r] > top) top = z[r];
  if (top === -Infinity) return out;
  for (let r = 0; r < 4; r++) if (m[r] > 0) { out[r] = Math.exp(z[r] - top); t += out[r]; }
  for (let r = 0; r < 4; r++) out[r] /= t;
  return out;
}
/** The net's outputs for a seat's view. Inputs scaled as packed: × 255 then rounded, ÷ 255 (so play matches training exactly). */
export function forward(net, v) {
  const x = new Float32Array(net.n_in);
  rawView(v, x.subarray(0, RAW_SIZE));
  if (net.aux) { const a = auxView(v); for (let k = 0; k < AUX_SIZE; k++) x[RAW_SIZE + k] = Math.round(255 * Math.min(1, a[k])) / 255; }
  if (net.part) {
    // M1 (Fable 25 Nov 16:20Z): the partner facts, then the own and the public belief over who holds the called ace
    const q = x.subarray(RAW_SIZE, RAW_SIZE + PART_SIZE), raw = x.subarray(0, RAW_SIZE);
    partnerView(v, q);
    for (let k = 0; k < PART_SIZE; k++) q[k] = Math.round(255 * q[k]) / 255;
    x.set(belief(net.beliefs.own, raw, q, false), RAW_SIZE + PART_SIZE);
    x.set(belief(net.beliefs.public, raw, q, true), RAW_SIZE + PART_SIZE + 4);
  }
  return run(net, x);
}
/** The policy's probabilities over the legal moves `ms` of the seat to move. */
export function policyProbs(net, s, seat, ms = G.options(s, seat)) {
  const z = forward(net, G.view(s, seat)), lg = ms.map(m => z[actionOf(m)]), top = Math.max(...lg);
  const p = lg.map(x => Math.exp(x - top)), t = p.reduce((a, b) => a + b, 0);
  return { ms, p: p.map(x => x / t) };
}
/** A play-out move drawn from the policy (the search's `rollout`), at temperature 1 (the net's logits as they are); greedy
 *  (Fable 01:36Z): the policy's top move instead, so the four seats play the net's choice and no part of a random one. */
export const policyRollout = (net, greedy = false) => (c, who, rng) => {
  const ms = G.options(c, who);
  if (ms.length === 1) return ms[0];
  const { p } = policyProbs(net, c, who, ms);
  if (greedy) return ms[p.indexOf(Math.max(...p))];
  let r = rng(), k = 0;
  for (; k < p.length - 1; k++) { r -= p[k]; if (r <= 0) break; }
  return ms[k];
};
export { ACTIONS };
/** A value net's predicted payoff for the seat, in tariffs, from its own view (the net's four relative seats, centred, × MAX_PAYOFF). */
export function valuePayoff(net, s, seat) {
  const z = forward(net, G.view(s, seat)), m = (z[0] + z[1] + z[2] + z[3]) / 4;
  return (z[0] - m) * net.maxPayoff;
}
