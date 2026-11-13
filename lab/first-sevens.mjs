// Opening hands as dealt, against the result (13 Nov 2026, Fable: measure the keep instead of trusting the net). Over self-play
// games, each seat's first seven, before any mulligan, by seat (play, draw), lands (2 to 5, others apart) and good spells
// (Medium's six: 0, 1, 2, 3+): games, the share kept, and the real win rate of the kept ones. Beside it, the real win rate after
// throwing the first seven back (the first mulligan is free), by seat; then the hand types whose kept win rate sits below
// that redraw by more than two standard errors, with their share of all first sevens. Read-only: lab-read.yml.
// usage: node lab/first-sevens.mjs <self-play job ids or ranges (spb01-446), comma-separated> [most games, all]
import { labStore } from "./lib.mjs";
import { isLandId } from "../dandan-core.js";
import { DECK } from "../dandan-cards.js";
import { rules } from "../dandan-rules.js";
import { newRecord } from "../seats.js";

const [ids, most = Infinity] = process.argv.slice(2);
const expand = t => { const m = t.match(/^([a-z]+)(\d+)-(\d+)$/); if (!m) return [t]; const out = []; for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(m[1] + String(n).padStart(m[2].length, "0")); return out; };
const GOOD = new Set(["Memory Lapse", "Dandân", "Piracy Charm", "Mind Bend", "Brainstorm", "Predict"]);
const cells = new Map(), redraw = new Map();
const bump = (m, k, kept, won) => { const c = m.get(k) || { n: 0, kept: 0, won: 0 }; c.n++; if (kept) { c.kept++; c.won += won; } m.set(k, c); };
let games = 0;
const store = await labStore();
outer: for (const id of ids.split(",").flatMap(expand)) {
  for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line) continue;
      if (games >= Number(most)) break outer;
      const g = JSON.parse(line);
      if (!(g.winner >= 0) || !g.moves?.length) continue;
      const st = newRecord(rules, { seats: 2, seed: g.seed, now: 0 }).state;
      games++;
      for (const seat of [0, 1]) {
        const h = st.hand[seat], lands = h.filter(isLandId).length, good = h.filter(id => !isLandId(id) && GOOD.has(DECK[id])).length;
        const first = g.moves.find(([who]) => who === seat)?.[1], kept = first?.t === "keep", won = g.winner === seat ? 1 : 0;
        const role = seat === st.first ? "play" : "draw", L = lands >= 2 && lands <= 5 ? String(lands) : lands < 2 ? "0-1" : "6+", S = good >= 3 ? "3+" : String(good);
        bump(cells, `${role}|${L} lands|${S} good`, kept, won);
        // the redraw: games where this seat threw its first seven back, split by whether that seven was short (a free show)
        if (!kept) { const r = redraw.get(role) || { n: 0, won: 0 }; r.n++; r.won += won; redraw.set(role, r); }
      }
    }
  }
}
const se = (p, n) => Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);
console.log(JSON.stringify({ ids, games, hands: 2 * games }));
for (const [role, r] of redraw) console.log(`redraw ${role}: ${r.n} hands thrown back, won ${(r.won / r.n).toFixed(3)} ± ${se(r.won / r.n, r.n).toFixed(3)}`);
console.log("cell".padEnd(28), "hands".padStart(7), "share".padStart(6), "kept".padStart(6), "won kept".padStart(9), "±se".padStart(6), "vs redraw".padStart(10));
const below = [];
for (const [k, c] of [...cells].sort(([a], [b]) => a.localeCompare(b))) {
  const role = k.split("|")[0], r = redraw.get(role), rw = r ? r.won / r.n : null, total = 2 * games;
  const w = c.kept ? c.won / c.kept : null, e = c.kept ? se(w, c.kept) : null, d = w != null && rw != null ? w - rw : null;
  const flag = d != null && c.kept >= 30 && d < -2 * Math.hypot(e, se(rw, r.n));
  if (flag) below.push({ cell: k, share: c.n / total, kept: c.kept / c.n, won: w, redraw: rw });
  console.log(k.padEnd(28), String(c.n).padStart(7), (c.n / total * 100).toFixed(1).padStart(5) + "%", (c.kept / c.n).toFixed(2).padStart(6), (w == null ? "—" : w.toFixed(3)).padStart(9), (e == null ? "" : e.toFixed(3)).padStart(6), (d == null ? "" : (d >= 0 ? "+" : "") + d.toFixed(3)).padStart(10), flag ? " BELOW" : "");
}
console.log("\nBelow the redraw by more than 2 standard errors (kept hands only, 30 or more):");
for (const b of below) console.log(`  ${b.cell}: ${(b.share * 100).toFixed(1)}% of first sevens, kept ${(b.kept * 100).toFixed(0)}% of the time, won ${b.won.toFixed(3)} against ${b.redraw.toFixed(3)} after a redraw`);
console.log(`  together ${(below.reduce((a, b) => a + b.share * b.kept, 0) * 100).toFixed(1)}% of first sevens are kept below the redraw`);
