// Many judges from Hard's own games at once (Korbi, 11 November 2026: "build 50 different SVNs from this data and have them
// fight"). Each shard trains one variant, by its number in VARIANTS: what it reads (the judge's 100 numbers, or those and the
// squeeze inputs, dandan-eval.js featuresPlus), its shape (today's 32·16 started from today's weights, or wider ones from
// scratch), what it learns (the game's result, or that blended with what Hard's search found the position worth) and whether
// a card in hand may lower its holder's chance (the floor rule, as lab/judge-train.mjs `hand`). Every fifth game is held out,
// and each variant is screened there against today's judge: Brier score against the result overall, in slow positions (no
// Dandân able to attack, the library over 20: the squeeze) and late ones (library 20 or less), and the share of held cards
// worth less than nothing to it. One JSON line: { variant, spec, epoch, metrics, today, layers } (layers as dandan-eval reads).
// usage: node lab/judge-variants.mjs <shard> <shards> <out> <self-play job ids, comma-separated> [variants: e.g. 14,15 (shard n trains
//        the n-th listed; else shard n trains variant n)] [warm start: a file in judges/ of the variant's width (else today's weights), or -]
//        [most games to read, else all] [positions a game, else all; or "turns": the first position of each turn] [learning rate]
//        [judges to screen alongside, e.g. ag-v14.json,s4d.json]
import fs from "node:fs";
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { act as engineAct, passPoints } from "../dandan-engine.js";
import { features, featuresPlus, featuresRace, FEATURES, PLUS, RACE } from "../dandan-eval.js";
import { creatures, needType, isLand, typesOf, other } from "../dandan-core.js";

const [shard, , out, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const VARIANTS = [];
for (const plus of [false, true]) for (const shape of ["32x16 warm", "64x32", "128x64x32"]) for (const blend of [0, 0.5]) for (const floor of [0, 1])
  VARIANTS.push({ plus, shape, blend, floor });
// 24 (12 November 2026, Fable's item 2): S4 d's recipe (variant 23) with the race inputs too (dandan-eval.js featuresRace)
VARIANTS.push({ plus: true, race: true, shape: "128x64x32", blend: 0.5, floor: 1 });
const cap = Number(process.argv[8]) || Infinity;
// positions a game (11 Nov, Korbi: so long games and their decided endings don't outweigh the rest): this many, spread evenly from
// the first move to the last, each the first usable decision at or after its mark; 0 or absent, every usable one as before
// "turns" in its place: the first position of each turn (from the second on) and no other, whether a search was kept there or
// not. That is where Hard's look-ahead asks a value net (it plays to the start of a turn, nothing on the stack), which the quiet
// decisions of every step are not; a position with no search kept is labelled by the result alone.
const turnsOnly = process.argv[9] === "turns";
const perGame = turnsOnly ? 0 : Number(process.argv[9]) || 0;
const lrArg = Number(process.argv[10]) || 0; // learning rate, else 1e-3 (3e-4 started from a judge) // at most this many games read (11 Nov: replaying 30,000 Medium games alone takes over an hour)
const only = process.argv[6] && process.argv[6] !== "-" ? process.argv[6].split(",").map(Number) : null, fromFile = process.argv[7] && process.argv[7] !== "-" ? process.argv[7] : undefined;
const vNo = only ? only[shard] : shard, V = VARIANTS[vNo];
if (!V) { console.log(`no variant ${shard} (there are ${VARIANTS.length})`); process.exit(0); }
const N = FEATURES.length, HALF = (N - 3 - 17) / 2, M = V.race ? N + 2 * PLUS + 2 * RACE : V.plus ? N + 2 * PLUS : N;
// inputs kept as 32-bit floats: half the memory of 64-bit, and far finer than the judge's 8-bit weights (11 Nov: two runs on
// 30,000 Medium games were killed with no output on 16-slot workers sharing 16 GB)
const featuresOf = (s, me) => Float32Array.from(V.race ? featuresRace(s, me) : V.plus ? featuresPlus(s, me) : features(s, me));
const mb = () => Math.round(process.memoryUsage().rss / 1048576);
const say = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m} (memory ${mb()} MB)`);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { say(`stopped by ${sig}`); process.exit(143); });
const swap = a => {
  const t = new Float32Array(M);
  t.set(a.subarray(HALF, 2 * HALF), 0); t.set(a.subarray(0, HALF), HALF); t.set(a.subarray(2 * HALF, N), 2 * HALF); t[2 * HALF] = 1 - a[2 * HALF];
  if (M > N) { t.set(a.subarray(N + PLUS, N + 2 * PLUS), N); t.set(a.subarray(N, N + PLUS), N + PLUS); }
  if (V.race) { const r = N + 2 * PLUS; t.set(a.subarray(r + RACE, r + 2 * RACE), r); t.set(a.subarray(r, r + RACE), r + RACE); }
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
// The games are replayed without the reading of each pass for what it shows of the passer's hand, and without the turn-start
// review (dandan-rules.js act → notePasses, noteTurn): both only record notes for live play, and 80% of a replay went to them.
// Checked 11 Nov on 63 games: every position's inputs and every result identical, 4× faster on Medium games, 7× on Hard.
const lean = { ...rules, act: (s, seat, m, ctx) => { const r = engineAct(s, seat, m, ctx); passPoints.length = 0; return r; } };
// one result file at a time, so the raw text of every game is never held at once
const store = await labStore();
// "spb01-446" stands for spb01, spb02, … spb446 (digits padded to the first number's width; a batch with no results reads nothing)
const expand = t => { const m = t.match(/^([a-z]+)(\d+)-(\d+)$/); if (!m) return [t]; const out = []; for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(m[1] + String(n).padStart(m[2].length, "0")); return out; };
for (const id of ids.split(",").flatMap(expand)) for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) for (const line of ((await store.get(name)) || "").split("\n")) {
  if (!line || games >= cap) continue;
  const rec = JSON.parse(line), at = new Map((rec.dec || []).map(d => [d.i, d]));
  const hold = games++ % 5 === 0;
  let G = newRecord(lean, { seats: 2, seed: rec.seed, now: 0 });
  const marks = perGame ? Array.from({ length: perGame }, (_, j) => Math.floor(((j + 0.5) * rec.moves.length) / perGame)) : null;
  let next = 0, lastTurn = -1;
  for (let i = 0; i < rec.moves.length; i++) {
    const [seat, move] = rec.moves[i], s = G.state;
    // a game with no search kept (Medium against Medium, lab/selfplay.mjs medium:…): quiet decisions, labelled by the result
    // (every third, unless taken a fixed number a game)
    const newTurn = s.turn !== lastTurn;
    lastTurn = s.turn;
    const d = turnsOnly ? (newTurn && s.turn >= 2 ? at.get(i) || { seat } : null)
      : at.get(i) || (!at.size && (marks || i % 3 === 0) ? { seat, pick: 0, list: [[0, 0, -1]], medium: true } : null);
    const due = !marks || (next < marks.length && i >= marks[next]);
    // valued: the search's value of the move it made is there to learn from (a turn's first position may have none)
    const valued = !!d && d.pick >= 0 && Number.isFinite(d.list?.[d.pick]?.[2]);
    if (due && d && (valued || turnsOnly) && !s.stack.length && !s.pending) {
      if (marks) while (next < marks.length && marks[next] <= i) next++;
      const me = d.seat, won = rec.winner === me ? 1 : rec.winner < 0 ? 0.5 : 0, search = d.medium || !valued ? won : d.list[d.pick][2];
      const st = rules.restore(JSON.parse(JSON.stringify(s)));
      const row = { a: featuresOf(st, me), y: V.blend * search + (1 - V.blend) * won, won, lib: s.lib.length, slow: slowOf(s), hold, decked: rec.why === "library", game: games };
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
    const r = applyMove(lean, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
say(`read ${games} games: ${data.length} positions`);
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
  // the games that ended by a draw from the empty library: at each one's first position with a library of 12 or fewer, the
  // share where it gives the eventual winner more than half (Fable's item 2)
  const first = new Map();
  for (const r of test) if (r.decked && r.lib <= 12 && r.won !== 0.5 && !first.has(r.game)) first.set(r.game, r);
  const calls = [...first.values()], right = calls.filter(r => (p(r) > 0.5) === (r.won === 1)).length;
  return { all: brier(test), slow: brier(test.filter(r => r.slow)), late: brier(test.filter(r => r.lib <= 20)), flaws: n ? +(bad / n).toFixed(4) : null,
    decked12: calls.length ? +(right / calls.length).toFixed(4) : null, decked12n: calls.length };
}

// ---------- training ----------
const zero = () => NET.map(L => ({ W: new Float64Array(L.W.length), b: new Float64Array(L.b.length) }));
const m1 = zero(), m2 = zero(), lr = lrArg || (warm ? 3e-4 : 1e-3), pull = warm ? 1e-4 : 0, epochs = warm ? 4 : 10;
let t = 0, best = { loss: Infinity, net: null, epoch: 0 };
const heldLoss = () => test.reduce((s, r) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, chance(NET, r.a))); return s - (r.won * Math.log(p) + (1 - r.won) * Math.log(1 - p)); }, 0) / test.length;
for (let e = 1; e <= epochs; e++) {
  const order = train.map((_, i) => i).sort(() => rand() - 0.5);
  const quarter = Math.max(64, Math.ceil(order.length / 4 / 64) * 64);
  for (let k = 0; k < order.length; k += 64) {
    if (k && k % quarter === 0) check(e - 1 + k / order.length);
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
  check(e);
}
// the held-out loss, four times an epoch: the best point so far is the one kept (training from scratch overfits within an epoch or two)
function check(at) {
  const held = heldLoss();
  say(`epoch ${at.toFixed(2)}/${epochs}: held-out loss ${held.toFixed(4)}`);
  if (held < best.loss) best = { loss: held, epoch: +at.toFixed(2), net: NET.map(L => ({ ...L, W: Float64Array.from(L.W), b: Float64Array.from(L.b) })) };
}
const layers = best.net.map((L, l) => quant(L, l === best.net.length - 1)), rounded = layers.map(dequant);
const metrics = screen(r => chance(rounded, r.a));
// today's judge on the same positions: it reads the first N numbers
const NET_TODAY = LAYERS0.map(dequant), base = screen(r => chance0(NET_TODAY, r.a.subarray(0, N)));
function chance0(net, a) {
  const b = new Float32Array(N); b.set(a.subarray(HALF, 2 * HALF), 0); b.set(a.subarray(0, HALF), HALF); b.set(a.subarray(2 * HALF, N), 2 * HALF); b[2 * HALF] = 1 - a[2 * HALF];
  return 1 / (1 + Math.exp(forward(net, b).at(-1)[0] - forward(net, a).at(-1)[0]));
}
// other judges on the same positions (argument 10, or env COMPARE: files in judges/, comma-separated; each reads as many numbers as it has inputs,
// all three blocks swapped as each has them)
const swapW = (a, m) => {
  const t = new Float32Array(m);
  t.set(a.subarray(HALF, 2 * HALF), 0); t.set(a.subarray(0, HALF), HALF); t.set(a.subarray(2 * HALF, N), 2 * HALF); t[2 * HALF] = 1 - a[2 * HALF];
  if (m > N) { t.set(a.subarray(N + PLUS, N + 2 * PLUS), N); t.set(a.subarray(N, N + PLUS), N + PLUS); }
  if (m > N + 2 * PLUS) { const r = N + 2 * PLUS; t.set(a.subarray(r + RACE, r + 2 * RACE), r); t.set(a.subarray(r, r + RACE), r + RACE); }
  return t;
};
const others = {};
for (const f of (process.argv[11] || process.env.COMPARE || "").split(",").filter(Boolean)) {
  const net = JSON.parse(fs.readFileSync(new URL(`../judges/${f}`, import.meta.url), "utf8")).layers.map(dequant), m = net[0].nIn;
  if (m > M) { others[f] = `reads ${m} numbers, these rows ${M}`; continue; }
  others[f] = screen(r => { const a = r.a.subarray(0, m); return 1 / (1 + Math.exp(forward(net, swapW(a, m)).at(-1)[0] - forward(net, a).at(-1)[0])); });
}
const line = { variant: vNo, from: fromFile || "today", spec: V, perGame: turnsOnly ? "turns" : perGame, lr, games, positions: data.length, epoch: best.epoch, metrics, today: base, others, layers };
console.log(JSON.stringify({ ...line, layers: undefined }));
fs.writeFileSync(out, JSON.stringify(line) + "\n");
