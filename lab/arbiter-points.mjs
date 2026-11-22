// The play-out arbiter's decisions (22 Nov 2026, Fable's acceptance test b): close calls the nets made in a stored batch where
// the search's top two were within 2 points and the policy's favourite was not the search's. Each becomes a point to play out
// both ways (lab/zero/zero-play.mjs arb=): the search's top move and the policy's, about 20 games each, so which of the two was
// right is settled by results rather than by either judge. Read-only: prints the points as one JSON line (ARB ...) for
// lab/arbiter/points.json, and how they spread over the win-chance bands.
// usage: node lab/arbiter-points.mjs <batch | file:<zero-play output>> <nets> [most 300] [part 0] [parts 1] [gap 0.02]
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { DECK } from "../dandan-core.js";
import { zeroOptions } from "../dandan-zero.js";
import { generalBrain } from "./zero/zero-lib.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";

const [batch, nets, most = "300", part = "0", parts = "1", gapS = "0.02"] = process.argv.slice(2);
const GAP = Number(gapS), J = x => JSON.parse(JSON.stringify(x)), real = Math.random, key = m => JSON.stringify(m);
const name = m => `${m.t}${m.card != null ? " " + DECK[m.card] : ""}`;
export const bandOf = v => (v < 0.2 ? "0-20" : v < 0.4 ? "20-40" : v < 0.6 ? "40-60" : v < 0.8 ? "60-80" : "80-100");
const local = batch.startsWith("file:"), store = local ? { get: async n => (await import("node:fs")).readFileSync(n, "utf8") } : await (await import("./lib.mjs")).labStore();
const brain = await generalBrain(nets), points = [], perBand = Math.ceil(Number(most) / 5), inBand = {};
const names = local ? [batch.slice(5)] : (await store.list(`results/${batch}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)).sort();
outer: for (const n of names.filter((_, k) => k % Number(parts) === Number(part))) {
  let text = "";
  try { text = (await store.get(n)) || ""; } catch { continue; }
  const games = [], dec = new Map();
  for (const l of text.split("\n")) {
    if (l.startsWith('{"game"')) games.push(JSON.parse(l));
    else if (l.startsWith('{"g"')) { const d = JSON.parse(l); delete d.x; dec.set(`${d.g}:${d.i}`, d); }
  }
  for (const g of games) {
    if (g.branch) continue;
    const mine = g.vs ? 1 - g.vs.seat : -1;   // against a rival: the nets' own seat; self-play: both
    brain.reset();
    let G = recordOf(rules, g), taken = 0;   // at most two a game and a fifth of the points a band, so they spread
    for (let i = 0; i < g.moves.length; i++) {
      const [who, m] = g.moves[i], s = rules.restore(J(G.state)), d = dec.get(`${g.game ?? g.seed}:${i}`) || dec.get(`${g.seed}:${i}`);
      if (taken < 2 && (mine < 0 || who === mine) && d && !d.qd && (inBand[bandOf(d.v)] || 0) < perBand && d.c?.length >= 2 && d.v != null) {
        const val = c => c.d ?? c.q, byVal = [...d.c].sort((a, b) => val(b) - val(a)), gap = val(byVal[0]) - val(byVal[1]);
        if (gap <= GAP) {
          const ms = zeroOptions(s, who);
          brain.root(s, who);
          const p = brain.player.probs(s, who, ms), at = new Map(ms.map((x, k) => [key(x), k]));
          const pTop = ms[p.indexOf(Math.max(...p))], sTop = byVal[0].mv;
          if (at.has(key(sTop)) && key(pTop) !== key(sTop)) {
            const pc = d.c.find(c => key(c.mv) === key(pTop));
            points.push({ src: g.seed, at: i, seat: who, v: d.v, band: bandOf(d.v), gap, search: sTop, policy: pTop,
              pSearch: p[at.get(key(sTop))], pPolicy: p[at.get(key(pTop))], vPolicy: pc ? val(pc) : null, played: key(m) === key(sTop) ? "search" : key(m) === key(pTop) ? "policy" : "other", moves: g.moves.slice(0, i + 1) });   // to the decision and the move played there
            taken++; inBand[bandOf(d.v)] = (inBand[bandOf(d.v)] || 0) + 1;
            if (points.length >= Number(most)) break outer;
          }
        }
      }
      Math.random = seeded(rngSeedOf(g, i));
      const a = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (a.error) break;
      brain.seen(s, who, m, a.G.state);
      G = a.G;
    }
  }
}
const by = {};
for (const x of points) by[x.band] = (by[x.band] || 0) + 1;
console.log(`${points.length} close calls (top two within ${100 * GAP} points, policy's favourite not the search's) from ${batch}, part ${part} of ${parts}, nets ${nets}`);
console.log(`  by win chance: ${Object.entries(by).sort().map(([b, n]) => `${b}% ${n}`).join(", ")}`);
console.log(`  as played: ${["search", "policy", "other"].map(k => `${k} ${points.filter(x => x.played === k).length}`).join(", ")}`);
for (const x of points.slice(0, 15)) console.log(`  ${x.src}:${x.at} at ${(100 * x.v).toFixed(0)}%: search ${name(x.search)} vs policy ${name(x.policy)} (${(100 * x.pPolicy).toFixed(0)}% vs ${(100 * x.pSearch).toFixed(0)}%), gap ${(100 * x.gap).toFixed(2)}`);
console.log("ARB " + JSON.stringify(points));   // lab/arbiter/points.json, for zero-play arb=
