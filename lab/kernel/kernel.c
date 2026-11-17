// The nets' hot path in WebAssembly with SIMD (17 Nov 2026, Korbi: "do all 3"; step 3, the compiled kernel): the general
// policy's forward pass (form head2) and the value net's, with the first layer carried between calls as in
// dandan-netpolicy.js firstLayer. Four numbers an instruction (f32x4); no libc. Built by lab/kernel/build.sh into
// dandan-kernel.js (the module as base64, loaded synchronously); dandan-netpolicy.js and lab/zero/general.mjs use it when present
// and fall back to their JavaScript otherwise. Same numbers as the JavaScript to float rounding (tests/kernel.mjs).
#include <wasm_simd128.h>

extern unsigned char __heap_base;
static unsigned long top = 0;

__attribute__((export_name("alloc"))) void *alloc(int bytes) {
  if (!top) top = (unsigned long)&__heap_base;
  top = (top + 15) & ~15ul;
  void *p = (void *)top;
  top += (unsigned long)bytes;
  unsigned long have = __builtin_wasm_memory_size(0) * 65536ul;
  if (top > have) __builtin_wasm_memory_grow(0, (top - have + 65535) / 65536);
  float *f = (float *)p;
  for (int i = 0; i < bytes / 4; i++) f[i] = 0;
  return p;
}

#define SLOTS 2
#define REFRESH 64
typedef struct {
  int XN, XP, H; float *W, *c;
  float *xs[SLOTS], *a[SLOTS]; int n[SLOTS], used[SLOTS];
  int clock, fresh, carried;
} L1;

static inline int count(v128_t m) { return __builtin_popcount(wasm_i32x4_bitmask(m)); }

// x·W + c for an input padded to XP (a multiple of 4, the tail zero): the sums of the slot nearest x carried by the inputs
// that changed, or from scratch when that is cheaper, every REFRESH updates, or for a slot never used
__attribute__((export_name("l1_new"))) L1 *l1_new(int XN, int H, float *W, float *c) {
  L1 *L = alloc(sizeof(L1));
  L->XN = XN; L->XP = (XN + 3) & ~3; L->H = H; L->W = W; L->c = c;
  for (int k = 0; k < SLOTS; k++) { L->xs[k] = alloc(L->XP * 4); L->a[k] = alloc(H * 4); L->n[k] = -1; }
  return L;
}
static void l1_eval(L1 *L, const float *x, float *out) {
  const int XP = L->XP, H = L->H;
  int nz = 0, d[SLOTS] = {0};
  for (int i = 0; i < XP; i += 4) {
    v128_t v = wasm_v128_load(x + i);
    nz += count(wasm_f32x4_ne(v, wasm_f32x4_splat(0)));
    for (int k = 0; k < SLOTS; k++) d[k] += count(wasm_f32x4_ne(v, wasm_v128_load(L->xs[k] + i)));
  }
  int b = 0;
  for (int k = 1; k < SLOTS; k++) if (d[k] < d[b]) b = k;
  int fresh = L->n[b] < 0 || L->n[b] >= REFRESH || d[b] >= nz;
  if (fresh && (L->n[b] < 0 || d[b] >= nz)) { int lru = 0; for (int k = 1; k < SLOTS; k++) if (L->used[k] < L->used[lru]) lru = k; b = lru; }
  float *a = L->a[b], *xs = L->xs[b];
  if (fresh) {
    for (int o = 0; o < H; o += 4) wasm_v128_store(a + o, wasm_v128_load(L->c + o));
    for (int i = 0; i < XP; i++) {
      float v = x[i]; xs[i] = v;
      if (v == 0) continue;
      const float *r = L->W + i * H; v128_t vv = wasm_f32x4_splat(v);
      for (int o = 0; o < H; o += 4) wasm_v128_store(a + o, wasm_f32x4_add(wasm_v128_load(a + o), wasm_f32x4_mul(vv, wasm_v128_load(r + o))));
    }
    L->n[b] = 0; L->fresh++;
  } else {
    for (int i0 = 0; i0 < XP; i0 += 4) {
      int m = wasm_i32x4_bitmask(wasm_f32x4_ne(wasm_v128_load(x + i0), wasm_v128_load(xs + i0)));
      while (m) {
        int i = i0 + __builtin_ctz(m); m &= m - 1;
        float dv = x[i] - xs[i]; xs[i] = x[i];
        const float *r = L->W + i * H; v128_t vv = wasm_f32x4_splat(dv);
        for (int o = 0; o < H; o += 4) wasm_v128_store(a + o, wasm_f32x4_add(wasm_v128_load(a + o), wasm_f32x4_mul(vv, wasm_v128_load(r + o))));
      }
    }
    L->n[b]++; L->carried++;
  }
  L->used[b] = ++L->clock;
  for (int o = 0; o < H; o += 4) wasm_v128_store(out + o, wasm_v128_load(a + o));
}
__attribute__((export_name("l1_eval"))) void l1_eval_x(L1 *L, const float *x, float *out) { l1_eval(L, x, out); }
__attribute__((export_name("l1_fresh"))) int l1_fresh(L1 *L) { return L->fresh; }
__attribute__((export_name("l1_carried"))) int l1_carried(L1 *L) { return L->carried; }

// out = c + Σ relu(in[i])·W[i,:] (nIn × nOut, nOut a multiple of 4)
static void dense(const float *in, int nIn, const float *W, const float *c, int nOut, float *out) {
  for (int o = 0; o < nOut; o += 4) wasm_v128_store(out + o, wasm_v128_load(c + o));
  for (int i = 0; i < nIn; i++) {
    float v = in[i];
    if (v <= 0) continue;
    const float *r = W + i * nOut; v128_t vv = wasm_f32x4_splat(v);
    for (int o = 0; o < nOut; o += 4) wasm_v128_store(out + o, wasm_f32x4_add(wasm_v128_load(out + o), wasm_f32x4_mul(vv, wasm_v128_load(r + o))));
  }
}

// the general policy, form head2: trunk(x) once a position, then move(marks) once a move
typedef struct { L1 *l1; int H1, H2, H3; float *W2, *c2, *W3, *c3, *E3, *w4, *eb, *a1, *z, *A3, *h; } Head2;
__attribute__((export_name("head2_new"))) Head2 *head2_new(L1 *l1, int H1, int H2, int H3, float *W2, float *c2, float *W3, float *c3, float *E3, float *w4, float *eb) {
  Head2 *N = alloc(sizeof(Head2));
  N->l1 = l1; N->H1 = H1; N->H2 = H2; N->H3 = H3; N->W2 = W2; N->c2 = c2; N->W3 = W3; N->c3 = c3; N->E3 = E3; N->w4 = w4; N->eb = eb;
  N->a1 = alloc(H1 * 4); N->z = alloc(H2 * 4); N->A3 = alloc(H3 * 4); N->h = alloc(H3 * 4);
  return N;
}
__attribute__((export_name("head2_trunk"))) void head2_trunk(Head2 *N, const float *x) {
  l1_eval(N->l1, x, N->a1);
  dense(N->a1, N->H1, N->W2, N->c2, N->H2, N->z);
  dense(N->z, N->H2, N->W3, N->c3, N->H3, N->A3);
}
__attribute__((export_name("head2_move"))) float head2_move(Head2 *N, const int *marks, int n) {
  const int H3 = N->H3; float *h = N->h, b = 0;
  for (int o = 0; o < H3; o += 4) wasm_v128_store(h + o, wasm_v128_load(N->A3 + o));
  for (int k = 0; k < n; k++) {
    int i = marks[k]; b += N->eb[i];
    const float *r = N->E3 + i * H3;
    for (int o = 0; o < H3; o += 4) wasm_v128_store(h + o, wasm_f32x4_add(wasm_v128_load(h + o), wasm_v128_load(r + o)));
  }
  v128_t acc = wasm_f32x4_splat(0);
  for (int o = 0; o < H3; o += 4) acc = wasm_f32x4_add(acc, wasm_f32x4_mul(wasm_f32x4_max(wasm_v128_load(h + o), wasm_f32x4_splat(0)), wasm_v128_load(N->w4 + o)));
  return b + wasm_f32x4_extract_lane(acc, 0) + wasm_f32x4_extract_lane(acc, 1) + wasm_f32x4_extract_lane(acc, 2) + wasm_f32x4_extract_lane(acc, 3);
}

// a plain net (the value net): the carried first layer, then dense layers with ReLU between, one output; layer k's sizes n[k],
// n[k+1] (padded to 4), weights W[k], biases c[k]
typedef struct { L1 *l1; int layers; int *n; float **W, **c, *buf0, *buf1; } MLP;
__attribute__((export_name("mlp_new"))) MLP *mlp_new(L1 *l1, int layers, int *n, float **W, float **c) {
  MLP *M = alloc(sizeof(MLP));
  M->l1 = l1; M->layers = layers; M->n = n; M->W = W; M->c = c;
  int most = 4; for (int k = 1; k <= layers; k++) if (n[k] > most) most = n[k];
  M->buf0 = alloc((most + 4) * 4); M->buf1 = alloc((most + 4) * 4);
  return M;
}
__attribute__((export_name("mlp_eval"))) float mlp_eval(MLP *M, const float *x) {
  float *a = M->buf0, *b = M->buf1;
  l1_eval(M->l1, x, a);
  for (int k = 1; k < M->layers; k++) { dense(a, M->n[k], M->W[k], M->c[k], M->n[k + 1], b); float *t = a; a = b; b = t; }
  return a[0];
}
