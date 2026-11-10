// Does Hard choose the same move when it drops clearly worse moves early? (Korbi, 10 November 2026: think smarter, not
// longer.) Hard weighs every candidate over the same deals and drops one only at a look (prune in dandan-think.js), first
// at 128 deals, so at Quick (64) it never drops any. Here, at every `every`-th decision of Hard's own games, it thinks
// twice over the very same deals: as it does (first look at 128) and looking from `first` (16, then 32, 64, …) with
// passing never dropped (`hold`). Since the deals are the same, the moves that survive have the same values; the only
// way to choose differently is to drop the best early. One row a decision:
//   { seed, i, n: candidates, full, half: the moves, same, gap: the full search's value of its move less that of the
//     halved one's (0 when the same), work: deals spent { full, half } }
// usage: node lab/halving.mjs <shard> <shards> <out> <self-play job ids> [deals 64] [first 16] [every 3]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";
import { moveName } from "../dandan-words.js";

const [shard, shards, out, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const deals = Number(process.argv[6] ?? 64), first = Number(process.argv[7] ?? 16), every = Number(process.argv[8] ?? 3);
const J = x => JSON.parse(JSON.stringify(x));
const keyOf = m => JSON.stringify(m);
const work = r => r.list.reduce((a, c) => a + (c.n || 0), 0);

let k = 0;
for (const id of ids.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line);
  let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 });
  for (let i = 0; i < rec.moves.length; i++) {
    const [seat, move] = rec.moves[i];
    if (k++ % (every * shards) === shard * every) {
      const s = () => rules.restore(J(G.state));
      const full = think(s(), seat, { deals, ms: 1e9 });
      if (!full.only) {
        const half = think(s(), seat, { deals, ms: 1e9, first, hold: true });
        const same = keyOf(full.best) === keyOf(half.best);
        const valueIn = (r, m) => r.list.find(c => keyOf(c.move) === keyOf(m))?.mean ?? NaN;
        fs.appendFileSync(out, JSON.stringify({
          seed: rec.seed, i, n: full.list.length, step: G.state.step, stack: G.state.stack.length,
          full: moveName(full.best, G.state, seat), half: moveName(half.best, G.state, seat), same,
          gap: same ? 0 : +(valueIn(full, full.best) - valueIn(full, half.best)).toFixed(4),
          work: { full: work(full), half: work(half) },
        }) + "\n");
      }
    }
    const r = applyMove(rules, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
