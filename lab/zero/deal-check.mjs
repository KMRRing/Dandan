// Do the dealt hands follow Scry's belief? (16 Nov 2026, Fable's review, item 1, and standing test 1.) Replays a zero-play game
// to a few positions, asks Scry 1 for the other hand's odds, deals the hand many times with the old dealer and the fixed one,
// and sets each name's share of the dealt cards beside Scry's expected share. The fixed dealer must match within a point.
// usage: node lab/zero/deal-check.mjs <zero-play output> [nets g9x-C] [deals 6000] [positions 3]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { DECK, NAMES } from "../../dandan-cards.js";
import { knOf } from "../../dandan-core.js";
import { NN, Tracker, scryOf, dealBy, unknownSlots } from "./zero-view.mjs";
import { netOf } from "./zero-lib.mjs";

const [file, nets = "g9x-C", N = "6000", P = "3"] = process.argv.slice(2), DEALS = Number(N), POS = Number(P);
const scry = scryOf(netOf(`${nets}-scry`)), J = x => JSON.parse(JSON.stringify(x)), real = Math.random, AT = new Map(NAMES.map((n, k) => [n, k]));
const game = fs.readFileSync(file, "utf8").split("\n").filter(l => l.startsWith('{"game"')).map(l => JSON.parse(l))[0];
let G = newRecord(rules, { seats: 2, seed: game.seed, now: 0 }); const T = new Tracker(), at = new Set();
for (let k = 1; k <= POS; k++) at.add(Math.floor((game.moves.length * k) / (POS + 1)));
let worst = [0, 0];
for (let i = 0; i < game.moves.length; i++) {
  const [who, m] = game.moves[i], s = rules.restore(J(G.state));
  if (at.has(i)) {
    const me = 0, opp = 1, ids = unknownSlots(s, me);
    if (ids.length) {
      const b = scry(s, me, T), expect = new Float32Array(NN);
      for (const p of b.slots) for (let k = 0; k < NN; k++) expect[k] += p[k] / ids.length;
      const pool = [...ids, ...s.lib.filter(id => !(knOf(s, id) & 1))].sort((x, y) => x - y);
      const out = [];
      for (const fix of [false, true]) {
        const got = new Float32Array(NN), deal = dealBy(b.slots, fix), rng = seeded(mix(game.seed, 99 + i));
        for (let d = 0; d < DEALS; d++) for (const id of deal(pool, ids.length, rng).slice(0, ids.length)) got[AT.get(DECK[id])] += 1 / (DEALS * ids.length);
        const gap = Math.max(...Array.from(got, (g, k) => Math.abs(g - expect[k])));
        worst[fix ? 1 : 0] = Math.max(worst[fix ? 1 : 0], gap);
        out.push({ fix, gap, got });
      }
      const top = Array.from(expect, (e, k) => [k, e]).sort((x, y) => y[1] - x[1]).slice(0, 4);
      console.log(`move ${i}, ${ids.length} unknown cards: ` + top.map(([k, e]) => `${NAMES[k]} Scry ${(100 * e).toFixed(1)}% old ${(100 * out[0].got[k]).toFixed(1)}% fixed ${(100 * out[1].got[k]).toFixed(1)}%`).join("; ") + ` | largest gap old ${(100 * out[0].gap).toFixed(1)}, fixed ${(100 * out[1].gap).toFixed(1)} points`);
    }
  }
  Math.random = seeded(mix(game.seed, i + 1)); const r = applyMove(rules, G, who, m, 0); Math.random = real;
  T.update(s, who, m, r.G.state); G = r.G;
}
console.log(`largest gap, any name, any position: old ${(100 * worst[0]).toFixed(1)} points, fixed ${(100 * worst[1]).toFixed(1)} points (bar: within 1)`);
