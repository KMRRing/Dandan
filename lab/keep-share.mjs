// The keep by the value net against real results (13 Nov 2026, Fable 3b): over self-play games' first sevens as dealt, by seat
// and hand type (lands 2–5, good spells 0/1/2/3+), the share the value keep throws back (judges/<net> with its redraw table,
// 256 deals a hand), beside the real win rate of those hands when kept (first-sevens.mjs's yardstick, Medium keeping both
// sides). Expect the three weak types (2 lands + 2 good, 3–4 lands + 1 good) thrown back and the 3+ good types kept.
// usage: node lab/keep-share.mjs <self-play jobs or ranges, comma-separated> [net file s5.json] [games 3000] [deals 256]
import fs from "node:fs";
import { labStore } from "./lib.mjs";
import { isLandId } from "../dandan-core.js";
import { DECK } from "../dandan-cards.js";
import { rules } from "../dandan-rules.js";
import { newRecord } from "../seats.js";
import { makeJudge } from "../dandan-eval.js";
import { unplayable } from "../dandan-engine.js";
import { keepMove } from "../dandan-keep.js";

const [ids, file = "s5.json", most = 3000, deals = 256] = process.argv.slice(2);
const net = JSON.parse(fs.readFileSync(new URL(`../judges/${file}`, import.meta.url), "utf8"));
if (!net.mull) throw new Error(`${file} has no redraw table (lab/keep-table.mjs)`);
const judge = Object.assign(makeJudge(net.layers), { mull: net.mull });
const expand = t => { const m = t.match(/^([a-z]+)(\d+)-(\d+)$/); if (!m) return [t]; const out = []; for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(m[1] + String(n).padStart(m[2].length, "0")); return out; };
const GOOD = new Set(["Memory Lapse", "Dandân", "Piracy Charm", "Mind Bend", "Brainstorm", "Predict"]);
const cells = new Map(), t0 = Date.now();
let games = 0;
const store = await labStore(), list = ids.split(",").flatMap(expand);
// spread the sample over the batches: a few games from each part file in turn
outer: for (const id of list) {
  for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
    let taken = 0;
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line || taken >= Math.max(1, Math.ceil(Number(most) / (list.length * 4)))) continue;
      if (games >= Number(most)) break outer;
      const g = JSON.parse(line);
      if (!(g.winner >= 0) || !g.moves?.length) continue;
      games++; taken++;
      const st = newRecord(rules, { seats: 2, seed: g.seed, now: 0 }).state;
      for (const seat of [0, 1]) {
        const s = rules.restore(JSON.parse(JSON.stringify(st))), h = s.hand[seat];
        s.pending = { t: "mull", seat, free: unplayable(s, seat), first: true, taken: 0 };
        const lands = h.filter(isLandId).length, good = h.filter(id => !isLandId(id) && GOOD.has(DECK[id])).length;
        const role = seat === st.first ? "play" : "draw", L = lands >= 2 && lands <= 5 ? String(lands) : lands < 2 ? "0-1" : "6+", S = good >= 3 ? "3+" : String(good);
        const thrown = keepMove(s, seat, judge, { deals: Number(deals) }).move.t === "mull";
        const mediumKept = g.moves.find(([who]) => who === seat)?.[1]?.t === "keep", won = g.winner === seat ? 1 : 0;
        const k = `${role}|${L} lands|${S} good`, c = cells.get(k) || { n: 0, thrown: 0, kept: 0, won: 0 };
        c.n++; c.thrown += thrown; if (mediumKept) { c.kept++; c.won += won; }
        cells.set(k, c);
      }
    }
  }
}
console.log(JSON.stringify({ ids, net: file, deals: Number(deals), games, hands: 2 * games, seconds: Math.round((Date.now() - t0) / 1000) }));
console.log("cell".padEnd(28), "hands".padStart(6), "value keep throws back".padStart(23), "Medium kept".padStart(12), "won kept".padStart(9));
for (const [k, c] of [...cells].sort(([a], [b]) => a.localeCompare(b)))
  console.log(k.padEnd(28), String(c.n).padStart(6), `${(100 * c.thrown / c.n).toFixed(0)}%`.padStart(23), `${(100 * c.kept / c.n).toFixed(0)}%`.padStart(12), (c.kept ? (c.won / c.kept).toFixed(3) : "—").padStart(9));
for (const role of ["play", "draw"]) { const r = [...cells].filter(([k]) => k.startsWith(role)).reduce((a, [, c]) => ({ n: a.n + c.n, t: a.t + c.thrown, k: a.k + (c.n - c.kept) }), { n: 0, t: 0, k: 0 }); console.log(`${role}: value keep throws back ${(100 * r.t / r.n).toFixed(1)}% of first sevens, Medium ${(100 * r.k / r.n).toFixed(1)}%`); }
