// Scry 2d's hand count: where the returns flatten and what tracking costs (14 Nov 2026, Korbi 16:34). One shard = one game ×
// one hand count. The game is either played by Zero's policy's top move for both seats ("policy": the filter's own model, its
// best case) or one of generation 4's held-out games replayed exactly ("real:<job>": played by the search, as in practice).
// Both seats' filters run through the whole game; every fourth position each unknown card is scored: its loss (nats) under the
// filter's share of names, under the pool's odds and under Scry 1; the two-or-more-lands Brier; and the time the filters took
// (all of it, and per decision of the other player).
// Out, one JSON line: { n, game, cards, loss, pool, scry1, lands, landsPool, ms, updates, msPerUpdate }.
// usage: node lab/zero/scry-sweep.mjs <shard> <shards> <out> <games> <hand counts, comma-separated> <policy|real:<job>> [policy net g5x-A-policy]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { DECK, NAMES } from "../../dandan-cards.js";
import { zeroBrain, zeroOptions } from "./zero-lib.mjs";
import { seenBy, unknownSlots, NN } from "./zero-view.mjs";
import LANDS from "./lands.json" with { type: "json" };
import { labStore } from "../lib.mjs";

const [shard, shards, out, games, ns, source, pol = "g5x-A-policy"] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5]), process.argv[6].split(",").map(Number), process.argv[7], process.argv[8]];
const J = x => JSON.parse(JSON.stringify(x)), AT = new Map(NAMES.map((n, i) => [n, i])), realRandom = Math.random;
fs.writeFileSync(out, "");

async function realGames(job, k) {
  const store = await labStore(), got = [];
  for (const name of (await store.list(`results/${job}/`)).filter(o => /\/part-\d+\.jsonl$/.test(o)).sort()) {
    for (const line of ((await store.get(name)) || "").split("\n")) if (line.startsWith('{"game"')) { const g = JSON.parse(line); if (g.seed % 5 === 0) got.push(g); }
    if (got.length >= k) break;
  }
  return got.slice(0, k);
}
const real = source.startsWith("real:") ? await realGames(source.slice(5), games) : null;

for (let t = shard; t < games * ns.length; t += shards) {
  const game = Math.floor(t / ns.length), n = ns[t % ns.length];
  const obs = zeroBrain(pol, "-", `pfd:n=${n}`), s1 = zeroBrain(pol, "-", null), player = real ? null : zeroBrain(pol, "-", "-");
  const seed = real ? real[game].seed : 6000 + game, moves = real ? real[game].moves : null;
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), r = { n, game, seed, cards: 0, loss: 0, pool: 0, scry1: 0, lands: 0, landsPool: 0, landN: 0, ms: 0, updates: 0 };
  for (let i = 0; i < (moves ? moves.length : 800) && !rules.over(G.state); i++) {
    const s = rules.restore(J(G.state)), rng = seeded(mix(seed, i + 1));
    let who, m;
    if (moves) [who, m] = moves[i]; else { who = rules.toMove(G.state); player.root(s, who); m = player.player.rollout(s, who, rng); }
    if (i % 4 === 0) for (const me of [0, 1]) {
      const sb = seenBy(s, me);
      if (sb.unknown <= 0) continue;
      const f = obs.filters()[me], { p, u } = f.marginals(s), T = sb.unseen.reduce((a, c) => a + c, 0), s1r = s1.scry(s, me, s1.tracker()), ids = unknownSlots(s, me);
      let lands = 0, poolLand = 0;
      ids.forEach((id, j) => {
        const y = AT.get(DECK[id]);
        r.cards++; r.loss -= Math.log(p[y] / (u || 1) + 1e-9); r.pool -= Math.log(sb.unseen[y] / T + 1e-9); r.scry1 -= Math.log(s1r.slots[j][y] + 1e-9);
        if (LANDS[y]) lands++;
      });
      for (let k = 0; k < NN; k++) if (LANDS[k]) poolLand += sb.unseen[k] / T;
      // the pool's chance of two or more lands among `unknown` cards (binomial, near enough)
      const q = poolLand, uu = sb.unknown, p01 = (1 - q) ** uu + uu * q * (1 - q) ** (uu - 1);
      r.lands += (f.landsAtLeast(2, LANDS, s) - (lands >= 2 ? 1 : 0)) ** 2; r.landsPool += ((1 - p01) - (lands >= 2 ? 1 : 0)) ** 2; r.landN++;
    }
    Math.random = rng;
    const a = applyMove(rules, G, who, m, 0);
    Math.random = realRandom;
    if (a.error) break;
    const t0 = performance.now();
    obs.seen(s, who, m, a.G.state);
    r.ms += performance.now() - t0; r.updates++;
    s1.seen(s, who, m, a.G.state); player?.seen(s, who, m, a.G.state);
    G = a.G;
  }
  fs.appendFileSync(out, JSON.stringify({ ...r, msPerUpdate: r.ms / Math.max(1, r.updates) }) + "\n");
}
