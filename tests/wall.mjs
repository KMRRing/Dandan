// The particle wall (lab/zero/wall.mjs): a game played at random, the wall following it for seat 0 with a random player's
// likelihood. The true deal, played again from the start through every move, must survive (the wall never kills the truth);
// the wall's worlds must show exactly what the seat sees; its dealer must deal the cards the seat can't see; it has worlds at
// least half the time (a world the seat's view rules out dies, and a wall of random worlds can empty: reported, not tested).
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { zeroOptions } from "../dandan-zero.js";
import { observe } from "../dandan-view.js";
import { Wall } from "../lab/zero/wall.mjs";
import { dandanEngine } from "../lab/zero/general.mjs";

let pass = 0, fail = 0;
const had = [];   // how often the wall had worlds (a world the seat's view rules out dies; an empty wall leaves the search to Scry)
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL", msg); } };
const t0 = Date.now();
for (const seed of [11, 12]) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  const s0 = JSON.parse(JSON.stringify(G.state)), wall = new Wall(0, dandanEngine(), { n: 8, seed, rngOf: i => seeded(mix(seed, i + 1)) });
  let checks = 0, withWorlds = 0;
  const played = [];
  for (let i = 0; i < 160 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = G.state, ms = zeroOptions(s, who), rng = seeded(mix(seed, i));
    const m = ms[Math.floor(rng() * ms.length)];
    const r = applyMove(rules, G, who, m, 0);
    if (r.error) break;
    wall.seen(s, who, m, r.G.state); played.push(m);
    G = r.G;
    if (i % 40 === 39) {
      wall.ensure();
      const key = wall.key(observe(G.state, 0));
      withWorlds += wall.parts.some(p => p.alive) ? 1 : 0;
      ok(wall.parts.every(p => !p.alive || wall.key(observe(p.s, 0)) === key), `seed ${seed} move ${i}: every world shows what seat 0 sees`);
      const d = wall.deal(), pool = wall.heldNowAll();
      ok(!d || d(pool, 0, Math.random) !== null, `seed ${seed} move ${i}: the dealer deals the unseen cards`);
      checks++;
    }
  }
  // the true deal through every move
  const at = [];
  const flat = st => [...st.hand[0], ...st.hand[1], ...st.lib, ...st.yard, ...st.exile, ...st.bf.map(p => p.id), ...st.stack.filter(x => typeof x.card === "number").map(x => x.card)];
  const truth = flat(s0), ids = wall.hidden0.map(j => truth[j]);
  const tp = wall.replay(ids, null, played);
  ok(tp !== null, `seed ${seed}: the true deal survives ${wall.events.length} moves (${tp ? "" : wall.why})`);
  ok(checks > 0, `seed ${seed}: checked`);
  had.push(`${withWorlds}/${checks}`);
}
console.log(`${fail ? "FAIL" : "ok  "} the particle wall follows the game, keeps the truth (${pass} of ${pass + fail}; worlds at ${had.join(", ")} checks; ${Date.now() - t0} ms)`);
if (fail) process.exit(1);
