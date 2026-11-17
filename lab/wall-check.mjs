// The particle wall's belief against Scry 1.2's on Zero's games (17 Nov 2026, Korbi: "performance is measured by seeing whether
// the result actually managed to determine what the opponent's hand is"): at the seat's decisions, the average −log chance each
// gives the true hidden cards of the other hand, card by card (nats; lower is better), and how often the wall had worlds.
// usage: node lab/wall-check.mjs <zero-play output> <general nets> [seat 0] [worlds 32] [every 3]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { generalBrain } from "./zero/zero-lib.mjs";

const [file, nets, seatArg, nArg, everyArg, ...more] = process.argv.slice(2), me = Number(seatArg || 0), every = Number(everyArg || 3);
// more: the wall's settings as key=value (beta=1 refresh=8 mode=poe …)
const W = Object.fromEntries(more.map(kv => kv.split("=")).map(([k, v]) => [k, Number.isNaN(Number(v)) ? v : Number(v)]));
const games = fs.readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l)).filter(o => o.game != null);
let wallLoss = 0, scryLoss = 0, cards = 0, asked = 0, withWorlds = 0, ms = 0;
for (const g of games) {
  const brain = await generalBrain(nets, { wall: { n: Number(nArg || 1024), ...W } });
  let G = newRecord(rules, { seats: 2, seed: g.seed, now: 0 }), k = 0;
  for (const [who, m] of g.moves) {
    const s = G.state;
    if (who === me && !s.pending && k++ % every === 0) {
      const t0 = Date.now(); brain.root(s, me); ms += Date.now() - t0;
      const wall = brain.walls()[me], scry = brain.filters()[me], v = wall.view;
      const known = new Set(v.hand[1 - me].filter(id => id >= 0)), truth = s.hand[1 - me].filter(id => !known.has(id));
      asked++;
      const c = wall.counts(), tot = [...c.values()].reduce((a, b) => a + b, 0);
      if (truth.length && tot > 0) {
        withWorlds++;
        const sc = scry.score(s, truth);
        for (const id of truth) { const p = (c.get(wall.E.nameOf(id)) || 0) / tot; wallLoss -= Math.log(0.98 * p + 0.02 / 25); }
        scryLoss += sc.each; cards += truth.length;
      }
    }
    const r = applyMove(rules, G, who, m, 0);
    brain.seen(s, who, m, r.G.state);
    G = r.G;
  }
  const w = brain.walls()[me];
  console.error(`game ${g.seed}: ${JSON.stringify(w.stats)}`);
}
console.log(JSON.stringify({ games: games.length, decisions: asked, withWorlds, cards, wall: +(wallLoss / cards).toFixed(3), scry: +(scryLoss / cards).toFixed(3), msPerRoot: Math.round(ms / asked), ...W }));
