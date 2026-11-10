// An economy Hard for the lab's own games (Korbi, 11 November 2026: harder cutting lost nothing on average, so the games
// that train things can be played far cheaper). At every `every`-th decision of Hard's games, the reference (256 deals,
// first look at 128, as the self-play batches are played) against cheaper settings: fewer deals, cut from 8 deals at
// `z` standard errors, passing kept. For each: how often it chooses as the reference, what its choice is worth by the
// reference's own values (lost), and the deals it spent against the reference's. One row a decision.
// usage: node lab/economy.mjs <shard> <shards> <out> <self-play job ids> [budgets 16,32,64,128] [every 24] [z 2]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";

const [shard, shards, out, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const budgets = (process.argv[6] ?? "16,32,64,128").split(",").map(Number), every = Number(process.argv[7] ?? 24), z = Number(process.argv[8] ?? 2);
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
        for (const deals of budgets) {
          const e = think(s(), seat, { deals, first: 8, z, hold: true, ms: 1e9 });
          const same = keyOf(e.best) === keyOf(ref.best);
          row.by[deals] = { same, lost: same ? 0 : +(best - value(e.best)).toFixed(4), work: work(e) };
        }
        fs.appendFileSync(out, JSON.stringify(row) + "\n");
      }
    }
    const r = applyMove(rules, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
