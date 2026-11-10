// Hard's search settings against a reference, decision by decision over the same deals (Korbi, 11 November 2026: merge
// the tree where lines meet; stop when the leader has been clear for a while). At every `every`-th decision of Hard's
// games the reference (256 deals, first look 128) chooses, and so does each variant (named settings for think());
// one row a decision: { seed, i, n, refWork, by: { name: { same, lost (by the reference's values), work, ms } } }.
// usage: node lab/variants.mjs <shard> <shards> <out> <self-play job ids> <variants as JSON, e.g. {"m64":{"deals":64,"merge":true}}> [every 12]
import fs from "node:fs";
import { readParts, hr } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";

const [shard, shards, out, ids, spec] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6]];
const variants = JSON.parse(spec), every = Number(process.argv[7] ?? 12);
const J = x => JSON.parse(JSON.stringify(x)), keyOf = m => JSON.stringify(m), work = r => r.list.reduce((a, c) => a + (c.n || 0), 0);

let k = 0;
for (const id of ids.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line);
  let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 });
  for (let i = 0; i < rec.moves.length; i++) {
    const [seat, move] = rec.moves[i];
    if (k++ % (every * shards) === shard * every) {
      const s = () => rules.restore(J(G.state));
      const ref = think(s(), seat, { deals: 256, first: 128, hold: false, ms: 1e9 });
      if (!ref.only) {
        const value = m => ref.list.find(c => keyOf(c.move) === keyOf(m))?.mean ?? NaN, best = value(ref.best);
        const row = { seed: rec.seed, i, n: ref.list.length, refWork: work(ref), by: {} };
        for (const [name, opts] of Object.entries(variants)) {
          const t = hr(), e = think(s(), seat, { ms: 1e9, ...opts }), ms = Math.round(hr() - t);
          const same = keyOf(e.best) === keyOf(ref.best);
          row.by[name] = { same, lost: same ? 0 : +(best - value(e.best)).toFixed(4), work: work(e), ms };
        }
        fs.appendFileSync(out, JSON.stringify(row) + "\n");
      }
    }
    const r = applyMove(rules, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
