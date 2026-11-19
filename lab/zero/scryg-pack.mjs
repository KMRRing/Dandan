// Scry G's rows (17 Nov 2026; lab/zero/scryg.mjs): Zero's games replayed exactly, each seat's record (RecordG) kept up to date,
// and at one move in EVERY for each seat with cards to guess, the position and the true cards. Written to <dir>:
//   ev_off.i64, ev_marks.u16   each event's marks (an event's are ev_marks[ev_off[i] .. ev_off[i+1]))
//   ev_ctx.u8                  each event's context (CTX_N numbers ×250)     ev_turn.i16  the turn it happened in
//   x_off.i64, x_idx.u16, x_val.f16   each position's input (posSize), sparse
//   u.u8 (V each)              its unseen copies       nh.u8, nl.u8  cards to guess in the hand, in the library
//   y_off.i64, y.u8            the true cards (pool slots: the hidden hand's, then the library places only they know)
//   rec.i64 (2 each)           its record's events [start, end) (global)      turn.i16  its turn     hold.u8  every fifth game
//   meta.json                  sizes and counts
// usage: node lab/zero/scryg-pack.mjs <dir> <zero-play job ids, comma-separated | file:<local zero-play output>> [shard shards] [games max]
import fs from "node:fs";
import { recordOf, redeal, rngSeedOf } from "./branch-lib.mjs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { POOL } from "../../dandan-general.js";
import { RecordG, targetsOf, posInput, evSize, posSize, CTX_N } from "./scryg.mjs";

const [dir, ids] = process.argv.slice(2), SH = Number(process.argv[4] || 0), SHS = Number(process.argv[5] || 1), MAX = Number(process.argv[6] || 1e9), EVERY = 6;
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random, P = POOL, X = posSize(P);
fs.mkdirSync(dir, { recursive: true });
const files = ["ev_off.i64", "ev_marks.u16", "ev_ctx.u8", "ev_turn.i16", "x_off.i64", "x_idx.u16", "x_val.f16", "u.u8", "nh.u8", "nl.u8", "y_off.i64", "y.u8", "rec.i64", "turn.i16", "hold.u8"];
const fd = Object.fromEntries(files.map(n => [n, fs.openSync(`${dir}/${n}`, "w")]));
const put = (n, a) => fs.writeSync(fd[n], Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const f16 = new Float32Array(1), u32 = new Uint32Array(f16.buffer);
const half = v => { f16[0] = v; const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff; if (e <= 0) return s; if (e >= 31) return s | 0x7c00; return s | (e << 10) | (m >>> 13); };
let nev = 0, nmarks = 0, rows = 0, nx = 0, ny = 0, games = 0, broken = 0;
put("ev_off.i64", BigInt64Array.of(0n)); put("x_off.i64", BigInt64Array.of(0n)); put("y_off.i64", BigInt64Array.of(0n));

function replay(game) {
  // a branch game (branch-lib.mjs): the source's moves with its randomness, the hidden cards re-dealt at the branch point; the
  // records follow the whole game (they hold only what each seat saw), positions are taken from the branch point on
  if (game.branch) return;   // the dealer never trains on branch games (Fable, 19 Nov): plenty of ordinary games, and none mixed in
  const seed = game.seed, B = game.branch || null, hold = (B ? B.src : seed) % 5 === 0;
  let G = recordOf(rules, game);
  const R = [new RecordG(0), new RecordG(1)], pend = [[], []];
  for (let i = 0; i < game.moves.length; i++) {
    if (B && i === B.at) G = { ...G, state: redeal(rules, G.state, B.seat, seed) };
    const [who, m] = game.moves[i], s = rules.restore(J(G.state));
    if (!(B && i < B.at) && seeded(mix(seed, 41337 + i))() < 1 / EVERY) for (const me of [0, 1]) {
      const t = targetsOf(s, me, P, true);
      if (!t.names.length || t.names.some(y => y == null)) continue;
      pend[me].push({ x: posInput(s, me, t, P), t, end: R[me].events.length, turn: s.turn || 0 });
    }
    Math.random = seeded(rngSeedOf(game, i));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = realRandom;
    if (r.error) { broken++; return; }
    for (const rec of R) rec.update(s, who, m, r.G.state);
    G = r.G;
  }
  for (const me of [0, 1]) {
    const base = nev;
    for (const e of R[me].events) {
      put("ev_marks.u16", Uint16Array.from(e.marks)); nmarks += e.marks.length; put("ev_off.i64", BigInt64Array.of(BigInt(nmarks)));
      put("ev_ctx.u8", Uint8Array.from(e.ctx, v => Math.max(0, Math.min(255, Math.round(v * 250))))); put("ev_turn.i16", Int16Array.of(e.turn));
    }
    nev += R[me].events.length;
    for (const p of pend[me]) {
      const idx = [], val = [];
      p.x.forEach((v, i) => { if (v) { idx.push(i); val.push(half(v)); } });
      put("x_idx.u16", Uint16Array.from(idx)); put("x_val.f16", Uint16Array.from(val)); nx += idx.length; put("x_off.i64", BigInt64Array.of(BigInt(nx)));
      put("u.u8", Uint8Array.from(p.t.u)); put("nh.u8", Uint8Array.of(p.t.handN)); put("nl.u8", Uint8Array.of(p.t.libN));
      put("y.u8", Uint8Array.from(p.t.names)); ny += p.t.names.length; put("y_off.i64", BigInt64Array.of(BigInt(ny)));
      put("rec.i64", BigInt64Array.of(BigInt(base), BigInt(base + p.end))); put("turn.i16", Int16Array.of(p.turn)); put("hold.u8", Uint8Array.of(hold ? 1 : 0));
      rows++;
    }
  }
  games++;
}

const local = ids.startsWith("file:");
const store = local ? null : await (await import("../lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(o => /\/part-\d+\.jsonl$/.test(o)).sort().filter((_, k) => k % SHS === SH);
outer: for (const name of parts) {
  const text = local ? fs.readFileSync(name, "utf8") : (await store.get(name)) || "";
  for (const line of text.split("\n")) if (line.startsWith('{"game"')) { replay(JSON.parse(line)); if (games >= MAX) break outer; }
}
for (const f of Object.values(fd)) fs.closeSync(f);
fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ V: P.V, MARK_N: P.MARK_N, CTX_N, EV: evSize(P), X, events: nev, marks: nmarks, rows, xnz: nx, targets: ny, games, broken }));
console.log(`scryg-pack: ${games} games (${broken} not the same), ${nev} events, ${rows} positions, ${ny} cards to guess`);
