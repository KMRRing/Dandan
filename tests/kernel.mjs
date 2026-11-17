// The compiled kernel (dandan-kernel.js from lab/kernel/kernel.c, 17 Nov 2026): the general policy's scores (form head2) and a plain
// net's output as the JavaScript gives them (freeScorer from scratch; the value net's layers), through runs of small changes, jumps
// and two interleaved positions, with two nets loaded in one module (its memory grows between them).
import { kernel } from "../dandan-kernel.js";
import { freeScorer } from "../dandan-netpolicy.js";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const K = kernel();
check(!!K, "the kernel loads (WebAssembly with SIMD)");
if (!K) process.exit(1);
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), arr = (n, s = 1) => Array.from({ length: n }, () => (rnd() * 2 - 1) * s);
const XN = 501, H1 = 32, H2 = 16, H3 = 12, MK = 40;
const model = { form: "head2", net: { XN, H1, H2, H3, W1: arr(XN * H1, 0.3), c1: arr(H1), W2: arr(H1 * H2, 0.3), c2: arr(H2), W3: arr(H2 * H3, 0.3), c3: arr(H3), E3: arr(MK * H3), w4: arr(H3), eb: arr(MK) } };
const js = freeScorer(model), wasm = K.head2(model);
// a plain net 501 → 20 → 6 → 1 (sizes not multiples of 4: padded inside)
const layers = [[XN, 20], [20, 6], [6, 1]].map(([nIn, nOut]) => ({ nIn, nOut, W: Float32Array.from(arr(nIn * nOut, 0.3)), b: Float32Array.from(arr(nOut)) }));
const mlpJs = x => { let a = x; layers.forEach((L, li) => { const y = Float32Array.from(L.b); for (let i = 0; i < L.nIn; i++) { const v = a[i]; if (!v) continue; for (let o = 0; o < L.nOut; o++) y[o] += v * L.W[i * L.nOut + o]; } if (li < layers.length - 1) for (let o = 0; o < L.nOut; o++) if (y[o] < 0) y[o] = 0; a = y; }); return a[0]; };
const mlp = K.mlp(layers);
const pos = [new Float32Array(XN), new Float32Array(XN)];
let worst = 0, worstV = 0;
for (let step = 0; step < 2000; step++) {
  const x = pos[step % 2];
  if (step % 499 === 0) x.fill(0);
  for (let k = 0; k < 5; k++) x[Math.floor(rnd() * XN)] = rnd() < 0.3 ? 0 : Math.round(rnd() * 8) / 4;
  const marks = [...Array(1 + (step % 5))].map(() => [...Array(1 + Math.floor(rnd() * 4))].map(() => Math.floor(rnd() * MK)));
  const a = js(x, marks), b = wasm(x, marks);
  a.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - b[k]) / Math.max(1, Math.abs(v))); });
  const va = mlpJs(x), vb = mlp(x);
  worstV = Math.max(worstV, Math.abs(va - vb) / Math.max(1, Math.abs(va)));
}
check(worst < 1e-4, `the policy's scores as the JavaScript's (worst relative error ${worst.toExponential(1)})`);
check(worstV < 1e-4, `the plain net's output as the JavaScript's (worst relative error ${worstV.toExponential(1)})`);
const st = wasm.stats();
check(st.carried > 1500, `the first layer mostly carried (${st.carried} carried, ${st.fresh} from scratch)`);
process.exit(fails ? 1 : 0);
