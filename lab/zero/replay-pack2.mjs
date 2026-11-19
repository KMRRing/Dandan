// Zero 2's training rows (16 Nov 2026; lab/zero/zero2.mjs says what Zero 2 is): Zero's games replayed exactly (as
// replay-pack.mjs), with Scry 1.2 kept up to date for both seats, packed for the trainers.
//   <dir>/a  every searched decision and every question's answer together (lab/fetch-ex.mjs's format, for lab/policy_np.py
//            --marks 256): x = zero2.mjs input2 (the rules facts and the extended view with Scry 1.2's counts), each option's
//            marks by marks2 (moves and answers in one encoding, every target in full), its searched value q
//   <dir>/v  value rows face up over the extended view alone (EXT_N a seat, lab/zero/value_np.py): won.f32 the game's result
//            blended with the search's value at that position (VBLEND, default 0.5, where the position was searched), aux.f32
//            whether that seat lost by drawing from an empty library (value_np.py --aux), fut.f32 (19 Nov 2026, value_np.py
//            --fut) three a row: the seat's lead in cards in hand and in lands at the start of its next turn (or the game's end),
//            each /7, and the share of the game left ((last turn - this turn) / 40, at most 1)
// ENC (env, 17 Nov 2026, stage 3 step 3): "general" packs dandan-general.js's view, value view and marks (every input from the card
// files, nothing named by hand) in place of Zero 2's; the same games, the same picks and values.
// HANDS (env): the belief's dealt hands a decision (1,024 as in play; the training workflow packs at 256, Fable 20:45Z)
// usage: node lab/zero/replay-pack2.mjs <dir> <zero-play job ids, comma-separated | file:<local output>> <Scry 1.2 file> [shard shards]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { lands } from "../../dandan-core.js";
import { determinize } from "../../dandan-think.js";
import { recordOf, redeal, rngSeedOf } from "./branch-lib.mjs";
import { generalJudge } from "./general.mjs";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { marksOf } from "../../dandan-netpolicy.js";
import { zeroOptions, qMarksOf } from "../../dandan-zero.js";
import { ext, handCounts, EXT_N } from "./zero-view.mjs";
import { Scry12 } from "./scry12.mjs";
import { ScryG } from "./scryg.mjs";
import { input2, marks2, X2, MARK_N } from "./zero2.mjs";
import { generalView, valueView, generalMarks, onPool, viewSize, POOL } from "../../dandan-general.js";

const GEN = process.env.ENC === "general";
// the general view is ~1,260 numbers: stored as 16-bit floats (half the room; the trainers read them in place, a memory map)
// and, with KEEP / VKEEP (env), a share of the decisions and of the value rows kept, chosen by the game's seed (17 Nov 2026)
const KEEP = Number(process.env.KEEP || 1), VKEEP = Number(process.env.VKEEP || 1);
// HOLD_ONLY=1 (18 Nov 2026, the nets' scorecard, lab/zero/scorecard): the held-out games alone (every fifth seed, never trained on)
const HOLD_ONLY = process.env.HOLD_ONLY === "1";
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
function half(v) {   // a float32 as IEEE 754 binary16, rounded to nearest
  F32[0] = v; const x = U32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; const mm = (m | 0x800000) >> (1 - e); return sign | ((mm + 0x1000) >> 13); }
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | ((m + 0x1000) >> 13);
}
const halves = a => { const o = new Uint16Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] ? half(a[i]) : 0; return o; };
const XN = GEN ? viewSize() : X2, MN = GEN ? POOL.MARK_N : MARK_N, VN = GEN ? viewSize() : EXT_N;
// the belief file: Scry 1.2's, or the general dealer's (17 Nov 2026: { scryg: 1 }, its counts on the pool already)
const inputOf = GEN ? (s, who, counts, any, ans) => (net.scryg ? generalView(s, who, counts, any, POOL, undefined, ans ?? null) : generalView(s, who, onPool(counts), onPool(any))) : input2;
// LEGACY=1 (18 Nov 2026, the scorecard of a net from before view version 3): its block marks and belief as it was trained
const LEGACY = process.env.LEGACY === "1";
const marksAt = GEN ? (s, seat, m) => generalMarks(s, seat, m, POOL, LEGACY) : marks2;
const valueOf = GEN ? (s, me) => valueView(s, me) : (s, me) => ext(s, me, handCounts(s, 1 - me));

const [dir, ids, sfile] = process.argv.slice(2), SH = Number(process.argv[5] || 0), SHS = Number(process.argv[6] || 1);
const VBLEND = Number(process.env.VBLEND ?? 0.5), HANDS = Number(process.env.HANDS || 1024), net = JSON.parse(fs.readFileSync(sfile, "utf8").split("\n")[0]);
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random, key = m => JSON.stringify(m), other = x => 1 - x;
function sink(sub, names) {
  fs.mkdirSync(`${dir}/${sub}`, { recursive: true });
  const fd = Object.fromEntries(names.map(n => [n, fs.openSync(`${dir}/${sub}/${n}`, "w")]));
  return { put: (n, a) => fs.writeSync(fd[n], Buffer.from(a.buffer, a.byteOffset, a.byteLength)), close: () => Object.values(fd).forEach(f => fs.closeSync(f)) };
}
// res.f32 and resp.i8 (18 Nov 2026, the policy's training-only outputs): each decision's game result for its seat, and the other
// seat's response to the move played while it was on the stack: 0 let it resolve, 1 a spell aimed at it, 2 another play; −1 not a
// cast, or the seat played again first; rc.f32, three a candidate: the search's replies to that candidate over its deals (a cast,
// dandan-think.js: let it resolve, aimed at, another play), as shares, −1 each where the decision line has none
const XF = GEN ? "x.f16" : "x.f32", A = sink("a", [XF, "cand.i32", "pick.i16", "med.i16", "flags.u8", "q.f32", "mark.i32", "marks.u8", ...(GEN ? ["res.f32", "resp.i8", "rc.f32"] : [])]), PC = { D: 0, C: 0, K: 0, Q: 0 };
const MF = GEN ? "mine.f16" : "mine.f32", TF = GEN ? "theirs.f16" : "theirs.f32", V = sink("v", [MF, TF, "won.f32", "aux.f32", "fut.f32", "hold.u8", "rf.u8", "lib.u8", ...(process.env.DEALT ? ["pt.f32", "pd.f32"] : [])]);
// DEALT=<n> with VNET=<file> (19 Nov 2026, Fable: "the value net is scored on true hands and used on dealt hands"): each value row
// also gets the net's chance on the true position (pt.f32) and its mean over n worlds dealt from the seat's own belief (pd.f32),
// as the search uses it; lab/zero/value-dealt.py reads both against the result
// REAN=<reanalysis job ids> (19 Nov 2026, lab/zero/reanalyse.mjs): the deep search's values of the positions it reanalysed; with
// REAN_USE=1 they replace the quick search's value in the value targets; with REAN_ONLY=1 only those positions give value rows
// (the A/B: the same rows with REAN_USE=1 and 0)
const REAN = new Map(), REAN_USE = process.env.REAN_USE === "1", REAN_ONLY = process.env.REAN_ONLY === "1";
if (process.env.REAN?.startsWith("file:")) { for (const l of fs.readFileSync(process.env.REAN.slice(5), "utf8").split("\n")) if (l) { const o = JSON.parse(l); REAN.set(`${o.g}:${o.i}`, o); } }
else if (process.env.REAN) {
  const st = await (await import("../lib.mjs")).labStore();
  for (const id of process.env.REAN.split(","))
    for (const n of (await st.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)))
      for (const l of ((await st.get(n)) || "").split("\n")) if (l) { const o = JSON.parse(l); REAN.set(`${o.g}:${o.i}`, o); }
  console.error(`reanalysed positions read: ${REAN.size}`);
}
// REFINE=<batch ids> (19 Nov 2026, Korbi: deep games as a refinement after the main training): decisions from those batches carry
// flag 32, value rows rf.u8 = 1, so the trainers' --refine_only stage learns from them alone
const REFINE = new Set((process.env.REFINE || "").split(",").filter(Boolean));
let refineNow = false;
const DEALT = Number(process.env.DEALT || 0), VJ = DEALT ? generalJudge(JSON.parse(fs.readFileSync(process.env.VNET, "utf8").split("\n")[0])) : null;
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
  A.put(XF, GEN ? halves(x) : x); A.put("cand.i32", Int32Array.of(PC.C)); A.put("pick.i16", Int16Array.of(p)); A.put("med.i16", Int16Array.of(0));
  A.put("flags.u8", Uint8Array.of((d.hold ? 1 : 0) | (d.deep ? 2 : 0) | 4 | (hard ? 16 : 0) | (refineNow ? 32 : 0)));
  // twins get their group's mean: on a new line, the options the net reads alike (the same marks2), as it can't tell them apart;
  // on an old line, the options alike in the old marks, as the line can't tell which q was whose
  const mk = ms.map(m => marksAt(s, d.seat, m)), grp = new Map();
  if (hard) o.groups.forEach((js, k) => grp.set(k, js));
  else mk.forEach((k, j) => { const g = key(k); if (!grp.has(g)) grp.set(g, []); grp.get(g).push(j); });
  const q = new Float32Array(ms.length), mark = new Int32Array(ms.length), marks = [];
  for (const js of grp.values()) { const m = js.reduce((a, j) => a + d.c[j].q, 0) / js.length; for (const j of js) q[j] = m; if (js.length > 1) twins += js.length; }
  ms.forEach((m, j) => { mark[j] = PC.K + marks.length; marks.push(...mk[j]); });
  A.put("q.f32", q); A.put("mark.i32", mark); A.put("marks.u8", Uint8Array.from(marks));
  if (GEN) { const rc = new Float32Array(3 * ms.length).fill(-1); ms.forEach((_, j) => { const r = d.c[j]?.r, n = r ? r[0] + r[1] + r[2] : 0; if (n) for (let k = 0; k < 3; k++) rc[3 * j + k] = r[k] / n; }); A.put("rc.f32", rc); }
  PC.D++; PC.C += ms.length; PC.K += marks.length; if (s.pending) PC.Q++;
}

/** An old line's value target: its pick's q, the played move's twin group's mean (the pick, at the explore3 decision). */
function valueOld(s, d, played, explored) {
  const o = options(s, d, played, explored);
  if (!o) return null;
  const at = explored ? -1 : o.ms.findIndex(m => key(m) === key(played)), p = at >= 0 ? at : d.pick, js = o.groups.find(g => g.includes(p)) || [p];   // the line's pick when the move played isn't among them (Fable 20:10Z)
  return js.reduce((a, j) => a + d.c[j].q, 0) / js.length;
}
// cards in hand and lands, each seat (the value net's future outputs)
const matOf = s => ({ hand: [0, 1].map(x => s.hand[x].length), lands: [0, 1].map(x => lands(s, x).length) });
function replay(game, decisions) {
  // a branch game (branch-lib.mjs): its source's moves replayed with the source's randomness, the hidden cards re-dealt at the
  // branch point, lessons from there on only; held out as its source is
  if (game.branch && process.env.NOBRANCH === "1") return;   // the with/without check (Fable, 19 Nov): branch games left out
  const seed = game.seed, x3 = game.explore3 ? game.explore3.i : null, B = game.branch || null, hold = (B ? B.src : seed) % 5 === 0;
  if (HOLD_ONLY && !hold) return;
  let G = recordOf(rules, game), lastTurn = -1, watch = null;
  const gameDec = [];   // this game's decisions in order: { who, resp }, written once the game's result is known
  const F = net.scryg ? [new ScryG(0, net), new ScryG(1, net)] : [new Scry12(0, net, { hands: HANDS }), new Scry12(1, net, { hands: HANDS })], vrows = [];
  const snaps = new Map();   // turn → each seat's cards in hand and lands at that turn's start (the future outputs)
  if (LEGACY) for (const f of F) f.legacy = true;
  for (let i = 0; i < game.moves.length; i++) {
    if (B && i === B.at) G = { ...G, state: redeal(rules, G.state, B.seat, seed) };
    if (B && i < B.at) {   // the source's part: replayed for the beliefs, no lessons
      const [who, m] = game.moves[i], s = rules.restore(J(G.state));
      Math.random = seeded(rngSeedOf(game, i));
      const r = applyMove(rules, G, who, m, 0);
      Math.random = realRandom;
      if (r.error) { broken++; return; }
      for (const f of F) f.update(s, who, m, r.G.state);
      G = r.G; continue;
    }
    const [who, m] = game.moves[i], s = rules.restore(J(G.state)), ds = decisions.get(i) || [];
    // the value rows: every turn's start and one position with priority in three besides (as replay-pack.mjs), after any
    // random move only; the search's value where this position was searched
    const turnStart = s.turn !== lastTurn && !s.pending;
    if (turnStart) { lastTurn = s.turn; snaps.set(s.turn, matOf(s)); }
    if (!s.pending && (turnStart || seeded(mix(seed, 4242 + i))() < 1 / 3) && (VKEEP >= 1 || seeded(mix(seed, 5151 + i))() < VKEEP)) {
      if (x3 != null && i <= x3) skipped += 2;
      else {
        // the value target: the picked option's final mean (item 9; an old line: the played move's q, its group's on a twin),
        // not the best of the first look's
        const d = ds.find(x => x.c?.length), vs = !d ? null : d.v != null ? d.v : valueOld(s, d, m, x3 === i), rv = REAN.get(`${seed}:${i}`);
        if (!(REAN_ONLY && !rv)) for (const me of [0, 1]) {
          const quick = vs == null ? null : me === d.seat ? vs : 1 - vs;
          const row = { me, lib: s.lib.length, turn: s.turn, active: s.active, f: valueOf(s, me), g: valueOf(s, other(me)), v: REAN_USE && rv ? (me === rv.seat ? rv.v : 1 - rv.v) : quick };
          if (VJ) {
            const deal = F[me].deal(), rng = seeded(mix(seed, 9090 + 2 * i + me));
            let sum = 0;
            for (let k = 0; k < DEALT; k++) sum += VJ(determinize(s, me, rng, false, false, (pool, n, r) => deal(pool, n, r) || pool), me);
            row.pt = VJ(s, me); row.pd = sum / DEALT;
          }
          vrows.push(row);
        }
      }
    }
    // the response to a cast being watched: the other seat's first play while the spell is still on the stack
    if (watch && who !== watch.who && s.stack.some(x => x.sid === watch.sid)) {
      const r = m.t === "pass" ? 0 : m.t === "cast" && (m.targets || []).some(t => t.k === "s" && t.sid === watch.sid) ? 1 : 2;
      for (const k of watch.ks) gameDec[k].resp = r;
      watch = null;
    } else if (watch && who === watch.who && m.t !== "pass") watch = null;   // it played again first: no response to learn
    const ks = [];
    for (const d of ds) {
      if (d.seat !== who || !(d.qd || d.every)) continue;
      const o = options(s, d, m, x3 === i);
      if (!o) { unmatched++; continue; }
      if (o.groups) old++;
      if (KEEP < 1 && seeded(mix(seed, 6161 + i))() >= KEEP) continue;   // not kept (KEEP): matched and counted, not packed
      const b = F[who].belief(s);
      putDecision(s, d, o, inputOf(s, who, b.counts, b.any, b.ans), pickOf(d, o.ms, m, x3 === i));
      ks.push(gameDec.length); gameDec.push({ who, resp: -1 });
    }
    Math.random = seeded(rngSeedOf(game, i));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = realRandom;
    if (r.error) { broken++; if (GEN) for (const g of gameDec) { A.put("res.f32", Float32Array.of(0.5)); A.put("resp.i8", Int8Array.of(-1)); } return; }   // kept in step with the decisions written
    for (const f of F) f.update(s, who, m, r.G.state);
    G = r.G;
    if (watch && !G.state.stack.some(x => x.sid === watch.sid)) { for (const k of watch.ks) gameDec[k].resp = 0; watch = null; }
    if (m.t === "cast" && ks.length) { const top = G.state.stack[G.state.stack.length - 1]; if (top && top.ctl === who) watch = { who, ks, sid: top.sid }; }
  }
  // a resigned game (zero-play.mjs resign=, 18 Nov 2026) ends before the rules end it: its winner is the game line's
  const end = game.resign ? { ...G.state, winner: game.winner } : G.state, won = x => (end.winner === x ? 1 : end.winner == null || end.winner < 0 ? 0.5 : 0);
  if (GEN) for (const g of gameDec) { A.put("res.f32", Float32Array.of(won(g.who))); A.put("resp.i8", Int8Array.of(g.resp)); }
  const last = matOf(end), lastTurn_ = end.turn;
  // the seat's next turn's start: the turn after the next whose active seat is this one (turns alternate)
  const futOf = r => {
    const t = r.active === r.me ? r.turn + 2 : r.turn + 1, m = snaps.get(t) || last, o = other(r.me);
    return Float32Array.of((m.hand[r.me] - m.hand[o]) / 7, (m.lands[r.me] - m.lands[o]) / 7, Math.min(1, Math.max(0, (lastTurn_ - r.turn) / 40)));
  };
  for (const r of vrows) {
    V.put("fut.f32", futOf(r));
    if (VJ) { V.put("pt.f32", Float32Array.of(r.pt)); V.put("pd.f32", Float32Array.of(r.pd)); }
    const y = r.v == null ? won(r.me) : (1 - VBLEND) * won(r.me) + VBLEND * r.v;
    V.put(MF, GEN ? halves(r.f) : Float32Array.from(r.f)); V.put(TF, GEN ? halves(r.g) : Float32Array.from(r.g)); V.put("won.f32", Float32Array.of(y));
    V.put("aux.f32", Float32Array.of(end.lost?.[r.me] ? 1 : 0)); V.put("hold.u8", Uint8Array.of(hold ? 1 : 0)); V.put("rf.u8", Uint8Array.of(refineNow ? 1 : 0)); V.put("lib.u8", Uint8Array.of(Math.min(255, r.lib))); nv++;
  }
  games++;
}

const local = ids.startsWith("file:");
const store = local ? null : await (await import("../lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % SHS === SH);
for (const name of parts) {
  refineNow = REFINE.has(name.split("/").at(-2));
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
fs.writeFileSync(`${dir}/a/meta.json`, JSON.stringify({ XN, decisions: PC.D, candidates: PC.C, marks: PC.K, markN: MN, ...(GEN ? { enc: "general" } : {}), questions: PC.Q, exports: ids, every: true }));
fs.writeFileSync(`${dir}/v/meta.json`, JSON.stringify({ N: VN, rows: nv, ...(GEN ? { enc: "general" } : {}), skipped, ids, aux: true }));
console.log(`replay-pack2: ${games} games (${broken} not the same); decisions ${PC.D} (questions ${PC.Q}, ${unmatched} unmatched, ${old} from before moves were stored (learnt as hard picks), ${pickOff} picks not among the options, ${moved} where the move played was not the line's pick, ${twins} options in twin groups); value rows ${nv} (${skipped} before a random move skipped)`);
