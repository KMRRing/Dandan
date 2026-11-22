// The honesty test (22 Nov 2026, Fable: on the final engine): at a decision, the engine must choose the same whatever the cards it
// cannot see. Each position is thought about twice with the same random numbers: as it is, and with the other seat's hand and
// the library's cards nobody has seen dealt afresh among themselves (the same number in the hand; known cards, the stack and
// everything public untouched). The policy's scores and the search's pick and means must come out identical; any difference
// means hidden cards leaked into the engine.
// usage: node lab/honesty.mjs <nets zl23> [deals 128] [game file lab/speed-game.json] [every 6]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { zeroOptions } from "../dandan-zero.js";
import { knOf } from "../dandan-core.js";
import { generalBrain } from "./zero/zero-lib.mjs";
import { generalView, generalMarks, viewSize, POOL } from "../dandan-general.js";
const none = new Float32Array(POOL.V);
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";

const [nets = "zl23", deals = "128", file = new URL("./speed-game.json", import.meta.url).pathname, every = "6"] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(file, "utf8")), J = x => JSON.parse(JSON.stringify(x)), real = Math.random;
const brain = await generalBrain(nets);
/** The position with the cards `seat` cannot see dealt afresh: the other hand and the library places no player knows. */
function rehide(s, seat, rng) {
  const t = rules.restore(J(s)), o = 1 - seat, bit = 1 << seat;
  const libKnown = id => (knOf(t, id) & bit) !== 0, handKnown = id => ((t.kh || []).find(e => e[0] === id)?.[1] & bit) !== 0;
  const libAt = t.lib.map((id, i) => i).filter(i => !libKnown(t.lib[i]));
  const handAt = t.hand[o].map((id, i) => i).filter(i => !handKnown(t.hand[o][i]));
  const pool = [...handAt.map(i => t.hand[o][i]), ...libAt.map(i => t.lib[i])];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  // what each player knows stays with the place, not the card (the other seat may know a place this seat does not: a card it put
  // back on top), so the masks are read off the places before the cards move and written back onto the new cards
  const libMask = libAt.map(i => knOf(t, t.lib[i])), handMask = handAt.map(i => (t.kh || []).find(e => e[0] === t.hand[o][i])?.[1] || 0);
  const moved = new Set(pool);
  t.kn = t.kn.filter(e => !moved.has(e[0])); if (t.kh) t.kh = t.kh.filter(e => !moved.has(e[0]));
  let k = 0;
  handAt.forEach((i, j) => { t.hand[o][i] = pool[k++]; if (handMask[j]) (t.kh ||= []).push([t.hand[o][i], handMask[j]]); });
  libAt.forEach((i, j) => { t.lib[i] = pool[k++]; if (libMask[j]) t.kn.push([t.lib[i], libMask[j]]); });
  return t;
}
let n = 0, samePolicy = 0, samePick = 0, sameMeans = 0, changed = 0;
let G = recordOf(rules, g);
for (let i = 0; i < g.moves.length; i++) {
  const [who, m] = g.moves[i], s = G.state;
  if (i % Number(every) === 0 && !s.pending && zeroOptions(s, who).length > 1) {
    const t = rehide(s, who, seeded(7000 + i));
    if (JSON.stringify(t.hand[1 - who]) !== JSON.stringify(s.hand[1 - who]) || JSON.stringify(t.lib) !== JSON.stringify(s.lib)) changed++;
    const ms = zeroOptions(s, who), p1 = brain.player.probs(J(s), who, ms), p2 = brain.player.probs(J(t), who, ms);
    Math.random = seeded(5000 + i); const r1 = brain.think(J(s), who, Number(deals), {});
    Math.random = seeded(5000 + i); const r2 = brain.think(J(t), who, Number(deals), {});
    Math.random = real;
    n++;
    if (p1.every((x, k) => x === p2[k])) samePolicy++;
    else if (process.env.WHY) {
      const v1 = generalView(s, who, none, null, POOL, new Float32Array(viewSize(POOL))), v2 = generalView(t, who, none, null, POOL, new Float32Array(viewSize(POOL)));
      const cols = []; for (let c = 0; c < v1.length; c++) if (v1[c] !== v2[c]) cols.push(c);
      const mk = ms.map(mv => JSON.stringify(generalMarks(s, who, mv, POOL)) === JSON.stringify(generalMarks(t, who, mv, POOL)));
      console.log(`  move ${i}: the policy differs; view columns differing ${cols.join(",") || "none"}; move marks differing ${mk.filter(x => !x).length} of ${ms.length}`);
    }
    if (JSON.stringify(r1.best) === JSON.stringify(r2.best)) samePick++;
    if (r1.list.every((c, k) => c.mean === r2.list[k]?.mean)) sameMeans++;
  }
  Math.random = seeded(rngSeedOf(g, i));
  const r = applyMove(rules, G, who, m, 0);
  Math.random = real;
  if (r.error) break;
  brain.seen(s, who, m, r.G.state);
  G = r.G;
}
console.log(`${nets}, ${deals} deals: ${n} decisions, hidden cards changed in ${changed}; the same policy scores ${samePolicy}, the same pick ${samePick}, the same means ${sameMeans} (honest: all ${n})`);
