// The report card's lead rows on self-play (12 November 2026, the planning chat): on Korbi's games the player with more lands
// won far more than the value nets say, but Monte wins most of those games, so the rows mix skill with the lead. In Hard-against-
// Hard games there is no skill gap. So, on the games a value net was held out from (every fifth, counted as lab/judge-variants.mjs
// counts them), at the start of each turn from the second (nothing on the stack, no question): each judge's chance for the
// player to move against whether that player won, by land lead, by card lead and by the library's size, with Brier scores.
// usage (a lab job, one shard): node lab/lead-rows.mjs <shard> <shards> <out> <self-play ids, as judge-variants> <name=judge file,…> [most held-out games 4000]
import fs from "node:fs";
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { act as engineAct, passPoints } from "../dandan-engine.js";
import { makeJudge } from "../dandan-eval.js";
import { isLand } from "../dandan-core.js";

const [out, ids, specs] = [process.argv[4], process.argv[5], process.argv[6]], most = Number(process.argv[7]) || 4000;
const judges = specs.split(",").map(kv => { const [name, f] = kv.split("="); return { name, j: makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${f}`, import.meta.url), "utf8")).layers) }; });
const lean = { ...rules, act: (s, seat, m, ctx) => { const r = engineAct(s, seat, m, ctx); passPoints.length = 0; return r; } };
const expand = t => { const m = t.match(/^([a-z]+)(\d+)-(\d+)$/); if (!m) return [t]; const o = []; for (let n = Number(m[2]); n <= Number(m[3]); n++) o.push(m[1] + String(n).padStart(m[2].length, "0")); return o; };
const store = await labStore(), rows = judges.map(() => []);
let games = 0, held = 0;
outer: for (const id of ids.split(",").flatMap(expand)) for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) for (const line of ((await store.get(name)) || "").split("\n")) {
  if (!line) continue;
  if (games++ % 5 !== 0) continue;
  if (held++ >= most) break outer;
  const rec = JSON.parse(line);
  if (rec.winner == null || rec.winner < 0) continue;
  let G = newRecord(lean, { seats: 2, seed: rec.seed, now: 0 }), last = -1;
  for (let i = 0; i < rec.moves.length; i++) {
    const [seat, move] = rec.moves[i], s = G.state;
    if (s.turn !== last && s.turn >= 2 && !s.stack.length && !s.pending) {
      last = s.turn;
      const me = s.active, foe = 1 - me, lands = x => s.bf.filter(p => p.ctl === x && p.id < 80 && isLand(p)).length, st = rules.restore(JSON.parse(JSON.stringify(s)));
      judges.forEach((n, k) => rows[k].push({ p: n.j(st, me), won: rec.winner === me ? 1 : 0, land: lands(me) - lands(foe), hand: s.hand[me].length - s.hand[foe].length, lib: s.lib.length }));
    }
    const r = applyMove(lean, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
const bucket = (rs, f, lo, hi) => { const b = rs.filter(r => f(r) >= lo && f(r) <= hi); return b.length ? { n: b.length, judge: +(b.reduce((a, r) => a + r.p, 0) / b.length).toFixed(3), won: +(b.reduce((a, r) => a + r.won, 0) / b.length).toFixed(3), brier: +(b.reduce((a, r) => a + (r.p - r.won) ** 2, 0) / b.length).toFixed(4) } : null; };
const LAND = [["3+ fewer", -99, -3], ["2 fewer", -2, -2], ["1 fewer", -1, -1], ["even", 0, 0], ["1 more", 1, 1], ["2 more", 2, 2], ["3+ more", 3, 99]];
const CARD = [["3+ fewer", -99, -3], ["1-2 fewer", -2, -1], ["even", 0, 0], ["1-2 more", 1, 2], ["3+ more", 3, 99]];
const LIB = [["over 40", 41, 999], ["21 to 40", 21, 40], ["20 or fewer", 0, 20]];
const lines = [JSON.stringify({ games: held, of: games, judges: specs })];
judges.forEach((n, k) => {
  const rs = rows[k], mid = rs.filter(r => r.lib >= 15);
  lines.push(JSON.stringify({ judge: n.name, positions: rs.length, all: bucket(rs, () => 0, 0, 0),
    landLead: Object.fromEntries(LAND.map(([l, a, b]) => [l, bucket(mid, r => r.land, a, b)])),
    cardLead: Object.fromEntries(CARD.map(([l, a, b]) => [l, bucket(mid, r => r.hand, a, b)])),
    byLibrary: Object.fromEntries(LIB.map(([l, a, b]) => [l, bucket(rs, r => r.lib, a, b)])) }));
});
console.log(lines.join("\n"));
fs.writeFileSync(out, lines.join("\n") + "\n");
