// Scry 1.2's rows (16 Nov 2026; lab/zero/scry12.mjs): Zero's games replayed exactly (as replay-pack.mjs), and for each seat
// `me` its record of events (Record12) kept up to date. Written to <dir>:
//   ev.u8      every event of every record, EV_N numbers each (×250, rounded): one block per game and seat, blocks one after another
//   x.f32      a sampled position's own input (BX12), one position in EVERY per seat as replay-pack.mjs's Scry rows
//   u.f32      its unseen pool (NN)       hold.u8  1 if held out (every fifth game, by seed)
//   win.i32    its windows, as global event indices: [block start, recent start, end)
//   sb.f32     every unknown card of the other hand: the hand's facts (SB_N)   sa.i32  where this turn's events begin (global)
//   sy.i16     what it really was (a name)   srow.i32  its position's row
//   meta.json  sizes and counts
// usage: node lab/zero/scry12-pack.mjs <dir> <zero-play job ids, comma-separated | file:<local zero-play output>> [shard shards]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { DECK, NAMES } from "../../dandan-cards.js";
import { NN, seenBy, unknownSlots } from "./zero-view.mjs";
import { Record12, input12, EV_N, BX12, SB_N } from "./scry12.mjs";

const [dir, ids] = process.argv.slice(2), SH = Number(process.argv[4] || 0), SHS = Number(process.argv[5] || 1), EVERY = 6;
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random, NAME_AT = new Map(NAMES.map((n, k) => [n, k]));
fs.mkdirSync(dir, { recursive: true });
const files = ["ev.u8", "x.f32", "u.f32", "hold.u8", "win.i32", "sb.f32", "sa.i32", "sy.i16", "srow.i32"];
const fd = Object.fromEntries(files.map(n => [n, fs.openSync(`${dir}/${n}`, "w")]));
const put = (n, a) => fs.writeSync(fd[n], Buffer.from(a.buffer, a.byteOffset, a.byteLength));
let nev = 0, rows = 0, slots = 0, games = 0, broken = 0;

function replay(game) {
  const seed = game.seed, hold = seed % 5 === 0;
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  const R = [new Record12(0), new Record12(1)], pend = [[], []];   // each seat's sampled positions, written once its block's start is known
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = rules.restore(J(G.state));
    if (seeded(mix(seed, 31337 + i))() < 1 / EVERY) for (const me of [0, 1]) {
      const seen = seenBy(s, me);
      if (seen.unknown <= 0) continue;
      const rec = R[me], sb = rec.slotFacts(s), a = rec.thisTurn(s), sl = unknownSlots(s, me).map(id => ({ sb, a, y: NAME_AT.get(DECK[id]) }));   // the hand as a set
      pend[me].push({ x: input12(s, me, seen), u: Float32Array.from(seen.unseen), recent: rec.recent(s), end: rec.events.length, sl });
    }
    Math.random = seeded(mix(seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = realRandom;
    if (r.error) { broken++; return; }
    for (const rec of R) rec.update(s, who, m, r.G.state);
    G = r.G;
  }
  for (const me of [0, 1]) {
    const base = nev, ev = R[me].events;
    for (const e of ev) put("ev.u8", Uint8Array.from(e, v => Math.max(0, Math.min(255, Math.round(v * 250)))));
    nev += ev.length;
    for (const p of pend[me]) {
      put("x.f32", p.x); put("u.f32", p.u); put("hold.u8", Uint8Array.of(hold ? 1 : 0)); put("win.i32", Int32Array.of(base, base + p.recent, base + p.end));
      for (const c of p.sl) { put("sb.f32", c.sb); put("sa.i32", Int32Array.of(base + Math.min(c.a, p.end))); put("sy.i16", Int16Array.of(c.y)); put("srow.i32", Int32Array.of(rows)); slots++; }
      rows++;
    }
  }
  games++;
}

const local = ids.startsWith("file:");
const store = local ? null : await (await import("../lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(o => /\/part-\d+\.jsonl$/.test(o)).sort().filter((_, k) => k % SHS === SH);
for (const name of parts) {
  const text = local ? fs.readFileSync(name, "utf8") : (await store.get(name)) || "";
  for (const line of text.split("\n")) if (line.startsWith('{"game"')) replay(JSON.parse(line));
}
for (const f of Object.values(fd)) fs.closeSync(f);
fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ EV_N, BX: BX12, SB_N, NN, events: nev, rows, slots, games, honest: true }));
console.log(`scry12-pack: ${games} games (${broken} not the same), ${nev} events, ${rows} positions, ${slots} unknown cards`);
