// The nets' hot path compiled (lab/kernel/kernel.c, 17 Nov 2026): kernel() is null where WebAssembly with SIMD can't load (an
// old browser, a page where compiling on the main thread is refused); callers keep their JavaScript then.
const WASM = "__WASM__";
let K;
export function kernel() {
  if (K !== undefined) return K;
  try {
    const bin = typeof Buffer !== "undefined" ? Buffer.from(WASM, "base64") : Uint8Array.from(atob(WASM), c => c.charCodeAt(0));
    const x = new WebAssembly.Instance(new WebAssembly.Module(bin), {}).exports;
    K = make(x);
  } catch { K = null; }
  return K;
}
const pad4 = n => (n + 3) & ~3;
function make(x) {
  const f32 = () => new Float32Array(x.memory.buffer), i32 = () => new Int32Array(x.memory.buffer);
  // a copy of numbers into the module's memory; rows × cols repacked to cols padded to 4 (the padding zero)
  const put = (a, rows = 1, cols = a.length, colsTo = cols) => {
    const p = x.alloc(rows * colsTo * 4 + 16), F = f32(), at = p >> 2;
    if (colsTo === cols) F.set(a, at);
    else for (let r = 0; r < rows; r++) F.set(a.subarray ? a.subarray(r * cols, (r + 1) * cols) : a.slice(r * cols, (r + 1) * cols), at + r * colsTo);
    return p;
  };
  const putInts = a => { const p = x.alloc(a.length * 4 + 16); i32().set(a, p >> 2); return p; };
  return {
    /** The general policy (form head2) as freeScorer's (x, marks) → scores, or null for another form or sizes not a multiple of 4. */
    head2(model) {
      const n = model.net, { XN, H1, H2, H3 } = n;
      if (model.form !== "head2" || H1 % 4 || H2 % 4 || H3 % 4) return null;
      const l1 = x.l1_new(XN, H1, put(n.W1), put(n.c1));
      const N = x.head2_new(l1, H1, H2, H3, put(n.W2), put(n.c2), put(n.W3), put(n.c3), put(n.E3), put(n.w4), put(n.eb));
      const xp = x.alloc(pad4(XN) * 4 + 16), mp = x.alloc(4096 * 4);
      let X = null, M = null;   // views of the memory, made again when it grows (another net loaded after this one)
      const score = (v, marks) => {
        if (!X || X.buffer !== x.memory.buffer) { X = f32().subarray(xp >> 2, (xp >> 2) + XN); M = i32(); }
        X.set(v.length === XN ? v : v.subarray(0, XN));
        x.head2_trunk(N, xp);
        return marks.map(ms => { M.set(ms, mp >> 2); return x.head2_move(N, mp, ms.length); });
      };
      score.stats = () => ({ fresh: x.l1_fresh(l1), carried: x.l1_carried(l1) });
      return score;
    },
    /** A plain net (layers [{ nIn, nOut, W, b }], ReLU between, one output) as x → its output; the first layer carried. */
    mlp(layers) {
      const sizes = [layers[0].nIn, ...layers.map(L => pad4(L.nOut))];
      const W = layers.map((L, k) => put(L.W, k === 0 ? L.nIn : sizes[k], L.nOut, sizes[k + 1]));
      // a later layer reads the padded outputs before it: its rows past the real inputs stay zero (put pads rows by allocating)
      const c = layers.map((L, k) => put(L.b, 1, L.nOut, sizes[k + 1]));
      const l1 = x.l1_new(layers[0].nIn, sizes[1], W[0], c[0]);
      const M = x.mlp_new(l1, layers.length, putInts(sizes), putInts(W), putInts(c));
      const N = layers[0].nIn, xp = x.alloc(pad4(N) * 4 + 16);
      let X = null;
      const ev = v => { if (!X || X.buffer !== x.memory.buffer) X = f32().subarray(xp >> 2, (xp >> 2) + N); X.set(v); return x.mlp_eval(M, xp); };
      ev.stats = () => ({ fresh: x.l1_fresh(l1), carried: x.l1_carried(l1) });
      return ev;
    },
  };
}
