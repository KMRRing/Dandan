// A luck-adjusted score for a game (23 Nov 2026, Fable 09:00Z, step 1): for every draw of a card nobody knew, the value just
// after it less its expectation over the cards that could have come (each unknown library card equally likely); the sum over
// the game is the luck, and the result less the luck is the adjusted score. Each term has expectation zero whatever the value
// function, so the mean stays unbiased and the variance falls by what the draws explain. The value function is fixed: zl23's
// value net on the true hands (generalJudge). Read-only.
// Also, per turn band (1-3, 4-7, 8-12, 13+), the play part: the value's change over the band's moves less the luck in them
// (the last band takes the result less the last value), so the bands add up to the adjusted score less the opening value.
// usage: node lab/luck.mjs <batch> [part 0] [parts 1] [nets zl23]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { DECK, knOf } from "../dandan-core.js";
import { generalJudge } from "./zero/general.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";

const [batch, part = "0", parts = "1", nets = "zl23"] = process.argv.slice(2), real = Math.random;
const V = generalJudge(JSON.parse(fs.readFileSync(new URL(`./zero/nets/${nets}-gvalue.json`, import.meta.url), "utf8").split("\n")[0]));
const J = x => JSON.parse(JSON.stringify(x)), band = t => (t <= 3 ? 0 : t <= 7 ? 1 : t <= 12 ? 2 : 3), BANDS = ["1-3", "4-7", "8-12", "13+"];
const local = batch.startsWith("file:"), store = local ? { get: async n => fs.readFileSync(n, "utf8") } : await (await import("./lib.mjs")).labStore();
const names = local ? [batch.slice(5)] : (await store.list(`results/${batch}/`)).filter(n => /part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % Number(parts) === Number(part));
const rows = [];   // per game: y, adjusted, luck, v0, by band
for (const n of names) {
  let t = "";
  try { t = (await store.get(n)) || ""; } catch { continue; }
  for (const l of t.split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l);
    if ((!g.vs && !local) || g.branch || g.winner == null) continue;
    const me = g.vs ? 1 - g.vs.seat : 0, y = g.winner === me ? 1 : g.winner < 0 ? 0.5 : 0;
    let G = recordOf(rules, g), luck = 0, v = V(G.state, me);
    const v0 = v, play = [0, 0, 0, 0];
    let lastBand = 0;
    for (let i = 0; i < g.moves.length; i++) {
      const [who, m] = g.moves[i], s = G.state, before = J(s);
      Math.random = seeded(rngSeedOf(g, i));
      const r = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (r.error) break;
      G = r.G;
      const a = G.state, va = a.over ? (a.winner === me ? 1 : a.winner < 0 ? 0.5 : 0) : V(a, me);
      // the draws in this move: cards that left the library for a hand, unknown to both seats before
      let term = 0;
      if (!a.over) for (const seat of [0, 1]) for (const id of a.hand[seat]) {
        if (before.hand[seat].includes(id) || !before.lib.includes(id) || knOf(before, id)) continue;
        const pool = before.lib.filter(x => x !== id && !knOf(before, x) && a.lib.includes(x));   // what could have come instead
        if (!pool.length) continue;
        const byName = new Map();
        for (const x of pool) byName.set(DECK[x], (byName.get(DECK[x]) || []).concat(x));
        let ev = 0, tot = 0;
        for (const [nm, ids] of byName) {
          const alt = ids[0], c = rules.restore(J(a));
          c.hand[seat] = c.hand[seat].map(x => (x === id ? alt : x));
          c.lib = c.lib.map(x => (x === alt ? id : x));
          const w = ids.length + (nm === DECK[id] ? 1 : 0);   // the drawn card itself is one of the possibilities
          ev += w * (nm === DECK[id] ? va : V(c, me)); tot += w;
        }
        if (!byName.has(DECK[id])) { ev += va; tot += 1; }
        term += va - ev / tot;
      }
      luck += term;
      const b = band(s.turn);
      play[b] += va - v - term; v = va; lastBand = b;
    }
    play[lastBand] += y - v;
    rows.push({ y, adj: y - luck, luck, v0, play });
  }
}
const st = xs => { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1)); return { n, m, sd, se: sd / Math.sqrt(Math.max(1, n)) }; };
const f = s => `${(100 * s.m).toFixed(1)} ± ${(100 * s.se).toFixed(1)} (sd a game ${s.sd.toFixed(3)})`;
console.log(`${batch} part ${part} of ${parts}: ${rows.length} games, nets' seat, value ${nets}`);
console.log(`  result ${f(st(rows.map(r => r.y)))}; luck-adjusted ${f(st(rows.map(r => r.adj)))}; luck ${f(st(rows.map(r => r.luck)))}`);
BANDS.forEach((b, k) => console.log(`  play in turns ${b}: ${f(st(rows.map(r => r.play[k])))}`));
console.log(`ROWS ${rows.map(r => [r.y, r.adj.toFixed(4), r.luck.toFixed(4), r.v0.toFixed(4), ...r.play.map(x => x.toFixed(4))].join(":")).join(",")}`);
