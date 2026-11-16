// Zero 2's training rows (16 Nov 2026; lab/zero/zero2.mjs says what Zero 2 is): Zero's games replayed exactly (as
// replay-pack.mjs), with Scry 1.2 kept up to date for both seats, packed for the trainers.
//   <dir>/a  every searched decision and every question's answer together (lab/fetch-ex.mjs's format, for lab/policy_np.py
//            --marks 256): x = zero2.mjs input2 (the rules facts and the extended view with Scry 1.2's counts), each option's
//            marks by marks2 (moves and answers in one encoding, every target in full), its searched value q
//   <dir>/v  value rows face up over the extended view alone (EXT_N a seat, lab/zero/value_np.py): won.f32 the game's result
//            blended with the search's value at that position (VBLEND, default 0.5, where the position was searched), aux.f32
//            whether that seat lost by drawing from an empty library (value_np.py --aux)
// usage: node lab/zero/replay-pack2.mjs <dir> <zero-play job ids, comma-separated | file:<local output>> <Scry 1.2 file> [shard shards]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { marksOf } from "../../dandan-netpolicy.js";
import { zeroOptions, qMarksOf } from "../../dandan-zero.js";
import { ext, handCounts, EXT_N } from "./zero-view.mjs";
import { Scry12 } from "./scry12.mjs";
import { input2, marks2, X2, MARK_N } from "./zero2.mjs";

const [dir, ids, sfile] = process.argv.slice(2), SH = Number(process.argv[5] || 0), SHS = Number(process.argv[6] || 1);
const VBLEND = Number(process.env.VBLEND ?? 0.5), net = JSON.parse(fs.readFileSync(sfile, "utf8").split("\n")[0]);
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random, key = m => JSON.stringify(m), other = x => 1 - x;
function sink(sub, names) {
  fs.mkdirSync(`${dir}/${sub}`, { recursive: true });
  const fd = Object.fromEntries(names.map(n => [n, fs.openSync(`${dir}/${sub}/${n}`, "w")]));
  return { put: (n, a) => fs.writeSync(fd[n], Buffer.from(a.buffer, a.byteOffset, a.byteLength)), close: () => Object.values(fd).forEach(f => fs.closeSync(f)) };
}
const A = sink("a", ["x.f32", "cand.i32", "pick.i16", "med.i16", "flags.u8", "q.f32", "mark.i32", "marks.u8"]), PC = { D: 0, C: 0, K: 0, Q: 0 };
const V = sink("v", ["mine.f32", "theirs.f32", "won.f32", "aux.f32", "hold.u8"]);
let nv = 0, games = 0, broken = 0, unmatched = 0, skipped = 0;

// a decision line's options (its c, in the search's list order, which is sorted) matched to zeroOptions' moves by the marks the
// line carries: each entry takes the first unused move with the same marks (moves alike in marks score alike); a line with an
// entry no move matches is left out rather than mislabelled
function options(s, d) {
  const ms = zeroOptions(s, d.seat), mk = s.pending ? qMarksOf : marksOf, by = new Map();
  ms.forEach(m => { const k = key(mk(s, d.seat, m)); if (!by.has(k)) by.set(k, []); by.get(k).push(m); });
  const out = [];
  for (const c of d.c) { const q = by.get(key(c.m)); if (!q?.length) return null; out.push(q.shift()); }
  return out;
}
function putDecision(s, d, ms, x) {
  const p = d.pick != null && d.pick >= 0 && d.pick < d.c.length ? d.pick : d.c.reduce((b, cc, j) => (cc.q > d.c[b].q ? j : b), 0);
  A.put("x.f32", x); A.put("cand.i32", Int32Array.of(PC.C)); A.put("pick.i16", Int16Array.of(p)); A.put("med.i16", Int16Array.of(0));
  A.put("flags.u8", Uint8Array.of((d.hold ? 1 : 0) | (d.deep ? 2 : 0) | 4));
  const q = new Float32Array(ms.length), mark = new Int32Array(ms.length), marks = [];
  ms.forEach((m, j) => { q[j] = d.c[j].q; mark[j] = PC.K + marks.length; marks.push(...marks2(s, d.seat, m)); });
  A.put("q.f32", q); A.put("mark.i32", mark); A.put("marks.u8", Uint8Array.from(marks));
  PC.D++; PC.C += ms.length; PC.K += marks.length; if (s.pending) PC.Q++;
}

function replay(game, decisions) {
  const seed = game.seed, x3 = game.explore3 ? game.explore3.i : null, hold = seed % 5 === 0;
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), lastTurn = -1;
  const F = [new Scry12(0, net), new Scry12(1, net)], vrows = [];
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = rules.restore(J(G.state)), ds = decisions.get(i) || [];
    // the value rows: every turn's start and one position with priority in three besides (as replay-pack.mjs), after any
    // random move only; the search's value where this position was searched
    const turnStart = s.turn !== lastTurn && !s.pending;
    if (turnStart) lastTurn = s.turn;
    if (!s.pending && (turnStart || seeded(mix(seed, 4242 + i))() < 1 / 3)) {
      if (x3 != null && i <= x3) skipped += 2;
      else {
        const d = ds.find(x => x.c?.length), vs = d ? Math.max(...d.c.map(c => c.q)) : null;
        for (const me of [0, 1]) vrows.push({ me, f: ext(s, me, handCounts(s, other(me))), g: ext(s, other(me), handCounts(s, me)), v: vs == null ? null : me === d.seat ? vs : 1 - vs });
      }
    }
    for (const d of ds) {
      if (d.seat !== who || !(d.qd || d.every)) continue;
      const ms = options(s, d);
      if (!ms) { unmatched++; continue; }
      const b = F[who].belief(s);
      putDecision(s, d, ms, input2(s, who, b.counts, b.any));
    }
    Math.random = seeded(mix(seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = realRandom;
    if (r.error) { broken++; return; }
    for (const f of F) f.update(s, who, m, r.G.state);
    G = r.G;
  }
  const end = G.state, won = x => (end.winner === x ? 1 : end.winner == null || end.winner < 0 ? 0.5 : 0);
  for (const r of vrows) {
    const y = r.v == null ? won(r.me) : (1 - VBLEND) * won(r.me) + VBLEND * r.v;
    V.put("mine.f32", Float32Array.from(r.f)); V.put("theirs.f32", Float32Array.from(r.g)); V.put("won.f32", Float32Array.of(y));
    V.put("aux.f32", Float32Array.of(end.lost?.[r.me] ? 1 : 0)); V.put("hold.u8", Uint8Array.of(hold ? 1 : 0)); nv++;
  }
  games++;
}

const local = ids.startsWith("file:");
const store = local ? null : await (await import("../lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % SHS === SH);
for (const name of parts) {
  const decisions = new Map();
  for (const line of ((local ? fs.readFileSync(name, "utf8") : await store.get(name)) || "").split("\n")) {
    if (!line || line.startsWith('{"v":1')) continue;
    const o = JSON.parse(line);
    if (o.game != null) { replay(o, decisions.get(o.seed) || new Map()); decisions.delete(o.seed); continue; }
    const g = decisions.get(o.g) || new Map(); decisions.set(o.g, g);
    const at = g.get(o.i) || []; at.push(o); g.set(o.i, at);
  }
}
A.put("cand.i32", Int32Array.of(PC.C)); A.put("mark.i32", Int32Array.of(PC.K)); A.close(); V.close();
fs.writeFileSync(`${dir}/a/meta.json`, JSON.stringify({ XN: X2, decisions: PC.D, candidates: PC.C, marks: PC.K, markN: MARK_N, questions: PC.Q, exports: ids, every: true }));
fs.writeFileSync(`${dir}/v/meta.json`, JSON.stringify({ N: EXT_N, rows: nv, skipped, ids, aux: true }));
console.log(`replay-pack2: ${games} games (${broken} not the same); decisions ${PC.D} (questions ${PC.Q}, ${unmatched} unmatched); value rows ${nv} (${skipped} before a random move skipped)`);
