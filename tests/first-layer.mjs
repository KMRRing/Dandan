// The first layer carried between calls (dandan-netpolicy.js firstLayer, 17 Nov 2026): the same sums as from scratch, through
// runs of small changes, jumps, two interleaved positions (the two seats) and the periodic rebuild.
import { firstLayer } from "../dandan-netpolicy.js";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const XN = 600, H = 32, W = Float32Array.from({ length: XN * H }, () => rnd() * 2 - 1), c = Float32Array.from({ length: H }, () => rnd() - 0.5);
const scratch = x => { const a = new Float64Array(H); for (let o = 0; o < H; o++) a[o] = c[o]; for (let i = 0; i < XN; i++) if (x[i]) for (let o = 0; o < H; o++) a[o] += x[i] * W[i * H + o]; return a; };
const L = firstLayer(XN, H, W, c), out = new Float32Array(H);
const pos = [new Float32Array(XN), new Float32Array(XN)];
for (const x of pos) for (let k = 0; k < 80; k++) x[Math.floor(rnd() * XN)] = Math.round(rnd() * 4) / 4;
let worst = 0;
for (let step = 0; step < 3000; step++) {
  const x = pos[step % 2];
  if (step % 997 === 0) x.fill(0);   // a jump: a new deal
  for (let k = 0; k < 6; k++) { const i = Math.floor(rnd() * XN); x[i] = rnd() < 0.3 ? 0 : Math.round(rnd() * 8) / 4; }
  L(x, out);
  const want = scratch(x);
  for (let o = 0; o < H; o++) worst = Math.max(worst, Math.abs(out[o] - want[o]) / Math.max(1, Math.abs(want[o])));
}
check(worst < 1e-6, `the carried sums are the sums from scratch (worst relative error ${worst.toExponential(1)})`);
check(L.carried > 2000 && L.fresh > 0, `mostly carried (${L.carried} carried, ${L.fresh} from scratch)`);
process.exit(fails ? 1 : 0);
