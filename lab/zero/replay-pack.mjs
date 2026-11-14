// Zero's games read again on the extended view (14 Nov 2026, Korbi 10:04): every game of the given zero-play jobs replayed
// from its seed and moves (the play sets Math.random the same way, so each position comes back exactly), the Tracker kept
// up to date as in play, and packed for the trainers.
//   scry  <dir>/b: the Scry's rows (lab/zero/scry_np.py): a position's x.f32 (BX), its unseen pool (u.f32, NN),
//           hold.u8; and every unknown card of the other hand: its history (sf.f32, SLOT_N), what it really was (sy.i16, a
//           name) and its position's row (srow.i32); one position in EVERY, both seats.
//   train   (with a Scry) <dir>/p and <dir>/q: the searched decisions (priority, every legal move weighed) and the
//           questions in lab/fetch-ex.mjs's format with x = viewOf + ext(the Scry's counts), for lab/policy_np.py; <dir>/v:
//           value rows face up (lab/zero/fetch-values.mjs's format, FEATURES + EXT_N a seat), after any random move only.
// usage: node lab/zero/replay-pack.mjs <dir> <zero-play job ids, comma-separated> <scry|train> [Scry file|-] [shard shards]
// (shard/shards: only the parts whose place in the list is shard mod shards, so several can run side by side, each to its own <dir>)
import fs from "node:fs";
import { labStore } from "../lib.mjs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { features, FEATURES } from "../../dandan-eval.js";
import { viewOf } from "../../dandan-netpolicy.js";
import { NN, Tracker, scryInput, scryOf, seenBy, ext, handCounts, extValueRow, BX, SLOT_N, unknownSlots } from "./zero-view.mjs";
import { DECK, NAMES } from "../../dandan-cards.js";

const [dir, ids, mode, bfile] = process.argv.slice(2), EVERY = 6, N = FEATURES.length, SH = Number(process.argv[6] || 0), SHS = Number(process.argv[7] || 1);
const scry = mode === "train" ? scryOf(bfile && bfile !== "-" ? JSON.parse(fs.readFileSync(bfile, "utf8").split("\n")[0]) : null) : null;
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random;
function sink(sub, names) {
  fs.mkdirSync(`${dir}/${sub}`, { recursive: true });
  const fd = Object.fromEntries(names.map(n => [n, fs.openSync(`${dir}/${sub}/${n}`, "w")]));
  return { put: (n, a) => fs.writeSync(fd[n], Buffer.from(a.buffer, a.byteOffset, a.byteLength)), close: () => Object.values(fd).forEach(f => fs.closeSync(f)) };
}
const B = mode === "scry" ? sink("b", ["x.f32", "u.f32", "hold.u8", "sf.f32", "sy.i16", "srow.i32"]) : null, NAME_AT = new Map(NAMES.map((n, k) => [n, k]));
let ns = 0;
const EX = ["x.f32", "cand.i32", "pick.i16", "med.i16", "flags.u8", "q.f32", "mark.i32", "marks.u8"];
const P = mode === "train" ? { p: sink("p", EX), q: sink("q", EX) } : null, PC = { p: { D: 0, C: 0, K: 0, XN: 0 }, q: { D: 0, C: 0, K: 0, XN: 0 } };
const V = mode === "train" ? sink("v", ["mine.f32", "theirs.f32", "won.f32", "hold.u8"]) : null;
let nb = 0, nv = 0, skipped = 0, games = 0, broken = 0, VN = 0;

function putDecision(which, d, x) {
  const S = P[which], c = PC[which];
  c.XN ||= x.length;
  const p = d.pick != null && d.pick >= 0 && d.pick < d.c.length ? d.pick : d.c.reduce((b, cc, j) => (cc.q > d.c[b].q ? j : b), 0);
  S.put("x.f32", Float32Array.from(x)); S.put("cand.i32", Int32Array.of(c.C)); S.put("pick.i16", Int16Array.of(p)); S.put("med.i16", Int16Array.of(0));
  S.put("flags.u8", Uint8Array.of((d.hold ? 1 : 0) | (d.deep ? 2 : 0) | (d.every ? 4 : 0)));
  const q = new Float32Array(d.c.length), mark = new Int32Array(d.c.length), marks = [];
  d.c.forEach((cc, j) => { q[j] = cc.q; mark[j] = c.K + marks.length; marks.push(...cc.m); });
  S.put("q.f32", q); S.put("mark.i32", mark); S.put("marks.u8", Uint8Array.from(marks));
  c.D++; c.C += d.c.length; c.K += marks.length;
}

function replay(game, decisions) {
  const seed = game.seed, x3 = game.explore3 ? game.explore3.i : null, hold = seed % 5 === 0;
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), lastTurn = -1;
  const T = new Tracker(), won = seat => (game.winner === seat ? 1 : game.winner == null || game.winner < 0 ? 0.5 : 0);
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = rules.restore(J(G.state));
    if (B && seeded(mix(seed, 31337 + i))() < 1 / EVERY) for (const me of [0, 1]) {
      const seen = seenBy(s, me);
      if (seen.unknown <= 0) continue;
      B.put("x.f32", Float32Array.from(scryInput(s, me, T, seen))); B.put("u.f32", seen.unseen); B.put("hold.u8", Uint8Array.of(hold ? 1 : 0));
      // every unknown card of the other hand: its history and what it really was
      for (const id of unknownSlots(s, me)) { B.put("sf.f32", T.slotOf(me, s, id, new Float32Array(SLOT_N))); B.put("sy.i16", Int16Array.of(NAME_AT.get(DECK[id]))); B.put("srow.i32", Int32Array.of(nb)); ns++; }
      nb++;
    }
    // value rows (14 Nov 11:40Z, the scorecard: the value net flat since generation 1): every turn's start as before, and now
    // also one position with priority in three besides, so a game gives several times the rows
    const turnStart = s.turn !== lastTurn && !s.pending;
    if (turnStart) lastTurn = s.turn;
    if (V && !s.pending && (turnStart || seeded(mix(seed, 4242 + i))() < 1 / 3)) {
      if (x3 != null && i <= x3) skipped += 2;
      else {
        const [r0, r1] = extValueRow(s, features, N);
        VN ||= r0.length;
        for (const me of [0, 1]) { V.put("mine.f32", Float32Array.from(me ? r1 : r0)); V.put("theirs.f32", Float32Array.from(me ? r0 : r1)); V.put("won.f32", Float32Array.of(won(me))); V.put("hold.u8", Uint8Array.of(hold ? 1 : 0)); nv++; }
      }
    }
    for (const d of decisions.get(i) || []) {
      if (d.seat !== who) continue;
      const b = scry(s, who, T), x = [...viewOf(s, who), ...ext(s, who, b.counts, undefined, null, b.any)];
      if (d.qd) putDecision("q", d, x); else if (d.every) putDecision("p", d, x);
    }
    Math.random = seeded(mix(seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = realRandom;
    if (r.error) { broken++; return; }
    T.update(s, who, m, r.G.state);
    G = r.G;
  }
  if (G.state.winner !== game.winner) broken++;
  games++;
}

// "file:<path>" reads a local zero-play output (a quick test)
const local = ids.startsWith("file:"), store = local ? { list: async () => [ids.slice(5)], get: async n => fs.readFileSync(n, "utf8") } : await labStore();
for (const id of local ? [ids] : ids.split(",")) {
  const parts = local ? [ids.slice(5)] : (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n));
  for (const [pi, name] of parts.entries()) {
    if (pi % SHS !== SH) continue;
    const decisions = new Map();   // seed → (i → lines)
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line || line.startsWith('{"v":1')) continue;
      const o = JSON.parse(line);
      if (o.game != null) { replay(o, decisions.get(o.seed) || new Map()); decisions.delete(o.seed); continue; }
      if (!P) continue;
      const g = decisions.get(o.g) || new Map(); decisions.set(o.g, g);
      const at = g.get(o.i) || []; at.push(o); g.set(o.i, at);
    }
  }
  console.log(`${id}: ${parts.length} parts; ${games} games replayed so far (${broken} not the same)`);
}
if (B) { B.close(); fs.writeFileSync(`${dir}/b/meta.json`, JSON.stringify({ BX, NN, SLOT_N, rows: nb, slots: ns, every: EVERY, ids })); }
if (P) for (const w of ["p", "q"]) {
  P[w].put("cand.i32", Int32Array.of(PC[w].C)); P[w].put("mark.i32", Int32Array.of(PC[w].K)); P[w].close();
  fs.writeFileSync(`${dir}/${w}/meta.json`, JSON.stringify({ XN: PC[w].XN, decisions: PC[w].D, candidates: PC[w].C, marks: PC[w].K, exports: ids, every: true }));
}
if (V) { V.close(); fs.writeFileSync(`${dir}/v/meta.json`, JSON.stringify({ N: VN, rows: nv, skipped, ids })); }
console.log(`replayed ${games} games (${broken} not the same); scry rows ${nb}; decisions ${PC.p.D}, questions ${PC.q.D}; value rows ${nv} (${skipped} before a random move skipped)`);
