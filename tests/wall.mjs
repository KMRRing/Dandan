// The particle wall (lab/zero/wall.mjs): a game played at random, the wall following it for seat 0 (a random player's
// likelihood, random hands). Its worlds hold as many cards as the other hand hides, all among the cards the seat can't see; the
// cards the other player shows out of the hidden hand leave them; its dealer deals exactly the unseen cards; its belief
// (counts) adds up to the hidden hand.
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { zeroOptions } from "../dandan-zero.js";
import { observe } from "../dandan-view.js";
import { Wall } from "../lab/zero/wall.mjs";
import { dandanEngine } from "../lab/zero/general.mjs";

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL", msg); } };
const t0 = Date.now();
for (const seed of [11, 12]) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  const wall = new Wall(0, dandanEngine(), { n: 24, window: 12, seed });
  for (let i = 0; i < 160 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = G.state, ms = zeroOptions(s, who), rng = seeded(mix(seed, i));
    const m = ms[Math.floor(rng() * ms.length)], r = applyMove(rules, G, who, m, 0);
    if (r.error) break;
    wall.seen(s, who, m, r.G.state);
    G = r.G;
    if (i % 20 === 19) {
      wall.ensure();
      const v = observe(G.state, 0), k = wall.hiddenCount(v), pool = wall.unseen(v), names = pool.map(id => wall.E.nameOf(id));
      const fits = w => { const left = [...names]; return w.names.length === k && w.names.every(n => { const j = left.indexOf(n); if (j < 0) return false; left.splice(j, 1); return true; }); };
      ok(wall.worlds.length > 0 && wall.worlds.every(fits), `seed ${seed} move ${i}: ${wall.worlds.length} worlds, each ${k} unseen cards`);
      ok(wall.worlds.every(w => Number.isFinite(w.logw)), `seed ${seed} move ${i}: the weights are numbers`);
      const d = wall.deal(), out = d && d(pool, k, Math.random);
      ok(out && [...out].sort((a, b) => a - b).join() === [...pool].sort((a, b) => a - b).join(), `seed ${seed} move ${i}: a deal is the unseen cards`);
      const tot = [...wall.counts().values()].reduce((a, b) => a + b, 0);
      ok(Math.abs(tot - k) < 1e-6, `seed ${seed} move ${i}: the belief adds up to the ${k} hidden cards (${tot.toFixed(3)})`);
    }
  }
}
console.log(`${fail ? "FAIL" : "ok  "} the particle wall follows the game and deals the unseen cards (${pass} of ${pass + fail}, ${Date.now() - t0} ms)`);
if (fail) process.exit(1);
