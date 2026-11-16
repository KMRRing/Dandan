// Zero 2's training rows (16 Nov 2026; lab/zero/zero2.mjs says what Zero 2 is): Zero's games replayed exactly (as
// replay-pack.mjs), with Scry 1.2 kept up to date for both seats, packed for the trainers.
//   <dir>/a  every searched decision and every question's answer together (lab/fetch-ex.mjs's format, for lab/policy_np.py
//            --marks 256): x = zero2.mjs input2 (the rules facts and the extended view with Scry 1.2's counts), each option's
//            marks by marks2 (moves and answers in one encoding, every target in full), its searched value q
//   <dir>/v  value rows face up over the extended view alone (EXT_N a seat, lab/zero/value_np.py): won.f32 the game's result
//            blended with the search's value at that position (VBLEND, default 0.5, where the position was searched), aux.f32
//            whether that seat lost by drawing from an empty library (value_np.py --aux)
// HANDS (env): the belief's dealt hands a decision (1,024 as in play; the training workflow packs at 256, Fable 20:45Z)
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
const VBLEND = Number(process.env.VBLEND ?? 0.5), HANDS = Number(process.env.HANDS || 1024), net = JSON.parse(fs.readFileSync(sfile, "utf8").split("\n")[0]);
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random, key = m => JSON.stringify(m), other = x => 1 - x;
function sink(sub, names) {
  fs.mkdirSync(`${dir}/${sub}`, { recursive: true });
  const fd = Object.fromEntries(names.map(n => [n, fs.openSync(`${dir}/${sub}/${n}`, "w")]));
  return { put: (n, a) => fs.writeSync(fd[n], Buffer.from(a.buffer, a.byteOffset, a.byteLength)), close: () => Object.values(fd).forEach(f => fs.closeSync(f)) };
}
const A = sink("a", ["x.f32", "cand.i32", "pick.i16", "med.i16", "flags.u8", "q.f32", "mark.i32", "marks.u8"]), PC = { D: 0, C: 0, K: 0, Q: 0 };
const V = sink("v", ["mine.f32", "theirs.f32", "won.f32", "aux.f32", "hold.u8"]);
let nv = 0, games = 0, broken = 0, unmatched = 0, skipped = 0, old = 0, pickOff = 0, moved = 0, twins = 0;

// a decision line's options are its moves (Fable's review, item 8: zero-play stores each, mv), checked against zeroOptions.
// A line from before (no moves): each option matched to a move by its old marks; twins (alike in those marks) can't be told
// apart, so the played move takes its twin group's slot and the group shares one mean (the pick, then, is the move played);
// such a line is flagged hard (the trainer learns its pick alone: its q mix the two looks) and its value is the pick's q.
function options(s, d, played, explored) {
  if (d.c.every(c => c.mv)) {
    const offered = new Set(zeroOptions(s, d.seat).map(key));
    return d.c.every(c => offered.has(key(c.mv))) ? { ms: d.c.map(c => c.mv), groups: null } : null;
  }
  const ms = zeroOptions(s, d.seat), mk = s.pending ? qMarksOf : marksOf, by = new Map();
  ms.forEach(m => { const k = key(mk(s, d.seat, m)); if (!by.has(k)) by.set(k, []); by.get(k).push(m); });
  const target = explored ? null : key(mk(s, d.seat, played)), out = [], groups = new Map();
  // the played move first into its group's first slot, the group's other moves after
  if (target && by.has(target)) by.set(target, [played, ...by.get(target).filter(m => key(m) !== key(played))]);
  for (const [j, c] of d.c.entries()) {
    const k = key(c.m), q = by.get(k);
    if (!q?.length) return null;
    out.push(q.shift());
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j);
  }
  return { ms: out, groups: [...groups.values()] };
}
/** The pick is the move the game played (item 8), but at the one decision explore3 played at random: there the search's own. */
function pickOf(d, ms, played, explored) {
  if (explored) return d.pick;
  const p = ms.findIndex(m => key(m) === key(played));
  if (p < 0) pickOff++;
  else if (p !== d.pick) moved++;
  return p >= 0 ? p : d.pick;
}
function putDecision(s, d, o, x, p) {
  const ms = o.ms, hard = !!o.groups;
  A.put("x.f32", x); A.put("cand.i32", Int32Array.of(PC.C)); A.put("pick.i16", Int16Array.of(p)); A.put("med.i16", Int16Array.of(0));
  A.put("flags.u8", Uint8Array.of((d.hold ? 1 : 0) | (d.deep ? 2 : 0) | 4 | (hard ? 16 : 0)));
  // twins get their group's mean: on a new line, the options the net reads alike (the same marks2), as it can't tell them apart;
  // on an old line, the options alike in the old marks, as the line can't tell which q was whose
  const mk = ms.map(m => marks2(s, d.seat, m)), grp = new Map();
  if (hard) o.groups.forEach((js, k) => grp.set(k, js));
  else mk.forEach((k, j) => { const g = key(k); if (!grp.has(g)) grp.set(g, []); grp.get(g).push(j); });
  const q = new Float32Array(ms.length), mark = new Int32Array(ms.length), marks = [];
  for (const js of grp.values()) { const m = js.reduce((a, j) => a + d.c[j].q, 0) / js.length; for (const j of js) q[j] = m; if (js.length > 1) twins += js.length; }
  ms.forEach((m, j) => { mark[j] = PC.K + marks.length; marks.push(...mk[j]); });
  A.put("q.f32", q); A.put("mark.i32", mark); A.put("marks.u8", Uint8Array.from(marks));
  PC.D++; PC.C += ms.length; PC.K += marks.length; if (s.pending) PC.Q++;
}

/** An old line's value target: its pick's q, the played move's twin group's mean (the pick, at the explore3 decision). */
function valueOld(s, d, played, explored) {
  const o = options(s, d, played, explored);
  if (!o) return null;
  const at = explored ? -1 : o.ms.findIndex(m => key(m) === key(played)), p = at >= 0 ? at : d.pick, js = o.groups.find(g => g.includes(p)) || [p];   // the line's pick when the move played isn't among them (Fable 20:10Z)
  return js.reduce((a, j) => a + d.c[j].q, 0) / js.length;
}
function replay(game, decisions) {
  const seed = game.seed, x3 = game.explore3 ? game.explore3.i : null, hold = seed % 5 === 0;
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), lastTurn = -1;
  const F = [new Scry12(0, net, { hands: HANDS }), new Scry12(1, net, { hands: HANDS })], vrows = [];
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = rules.restore(J(G.state)), ds = decisions.get(i) || [];
    // the value rows: every turn's start and one position with priority in three besides (as replay-pack.mjs), after any
    // random move only; the search's value where this position was searched
    const turnStart = s.turn !== lastTurn && !s.pending;
    if (turnStart) lastTurn = s.turn;
    if (!s.pending && (turnStart || seeded(mix(seed, 4242 + i))() < 1 / 3)) {
      if (x3 != null && i <= x3) skipped += 2;
      else {
        // the value target: the picked option's final mean (item 9; an old line: the played move's q, its group's on a twin),
        // not the best of the first look's
        const d = ds.find(x => x.c?.length), vs = !d ? null : d.v != null ? d.v : valueOld(s, d, m, x3 === i);
        for (const me of [0, 1]) vrows.push({ me, f: ext(s, me, handCounts(s, other(me))), g: ext(s, other(me), handCounts(s, me)), v: vs == null ? null : me === d.seat ? vs : 1 - vs });
      }
    }
    for (const d of ds) {
      if (d.seat !== who || !(d.qd || d.every)) continue;
      const o = options(s, d, m, x3 === i);
      if (!o) { unmatched++; continue; }
      if (o.groups) old++;
      const b = F[who].belief(s);
      putDecision(s, d, o, input2(s, who, b.counts, b.any), pickOf(d, o.ms, m, x3 === i));
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
console.log(`replay-pack2: ${games} games (${broken} not the same); decisions ${PC.D} (questions ${PC.Q}, ${unmatched} unmatched, ${old} from before moves were stored (learnt as hard picks), ${pickOff} picks not among the options, ${moved} where the move played was not the line's pick, ${twins} options in twin groups); value rows ${nv} (${skipped} before a random move skipped)`);
