// Hard with the learned policy playing its look-aheads past the tree (dandan-netpolicy.js) against Hard as it is (Medium
// there), at every `every`-th decision of Hard's own games, over the same deals: how often they choose the same move,
// what the other choice is worth by today's Hard's own values, and the time each took. Step two of the learning loop
// (Korbi, 11 November 2026): the network has to stand in for Medium before Hard's choices can train the next one.
// One row a decision: { seed, i, n, today, net, same, gap, ms: { today, net } }
// usage: node lab/rollnet.mjs <shard> <shards> <out> <self-play job ids> <weights path in the repo> [deals 64] [every 12]
import fs from "node:fs";
import { readParts, hr } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";
import { moveName } from "../dandan-words.js";
import { makePolicy } from "../dandan-netpolicy.js";

const [shard, shards, out, ids, weights] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6]];
const deals = Number(process.argv[7] ?? 64), every = Number(process.argv[8] ?? 12);
const net = makePolicy(JSON.parse(fs.readFileSync(new URL(`../${weights}`, import.meta.url), "utf8")));
const rollout = (c, who) => net.move(c, who);
const J = x => JSON.parse(JSON.stringify(x)), keyOf = m => JSON.stringify(m);

let k = 0;
for (const id of ids.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line);
  let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 });
  for (let i = 0; i < rec.moves.length; i++) {
    const [seat, move] = rec.moves[i];
    if (k++ % (every * shards) === shard * every) {
      const s = () => rules.restore(J(G.state));
      let t = hr();
      const today = think(s(), seat, { deals, ms: 1e9 });
      const tToday = hr() - t;
      if (!today.only) {
        t = hr();
        const mine = think(s(), seat, { deals, ms: 1e9, rollout });
        const tNet = hr() - t;
        const same = keyOf(today.best) === keyOf(mine.best);
        const valueIn = m => today.list.find(c => keyOf(c.move) === keyOf(m))?.mean ?? NaN;
        fs.appendFileSync(out, JSON.stringify({
          seed: rec.seed, i, n: today.list.length, step: G.state.step, stack: G.state.stack.length,
          today: moveName(today.best, G.state, seat), net: moveName(mine.best, G.state, seat), same,
          gap: same ? 0 : +(valueIn(today.best) - valueIn(mine.best)).toFixed(4), ms: { today: Math.round(tToday), net: Math.round(tNet) },
        }) + "\n");
      }
    }
    const r = applyMove(rules, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
