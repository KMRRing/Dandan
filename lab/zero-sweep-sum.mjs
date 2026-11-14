// The Scry 2d hand-count sweep read (14 Nov 2026, Korbi 16:34): by hand count, the loss a card (nats) of the filter against the
// pool's odds and Scry 1 on the same cards, the two-or-more-lands Brier, and the filters' time (a game, and a decision of the
// other player). Rows as lab/zero/scry-sweep.mjs writes them.
// usage: node lab/zero-sweep-sum.mjs <job id>[,<job id>…]
import { labStore, readParts } from "./lib.mjs";
for (const id of process.argv[2].split(",")) {
  const rows = (await readParts(id)).flatMap(t => t.split("\n").filter(Boolean)).map(l => JSON.parse(l)), by = new Map();
  for (const r of rows) { const a = by.get(r.n) || { n: r.n, games: 0, cards: 0, loss: 0, pool: 0, scry1: 0, lands: 0, landsPool: 0, landN: 0, ms: 0, updates: 0 }; for (const k of ["cards", "loss", "pool", "scry1", "lands", "landsPool", "landN", "ms", "updates"]) a[k] += r[k]; a.games++; by.set(r.n, a); }
  console.log(`${id}: ${rows.length} rows`);
  console.log("hands | games | cards | loss a card | pool | Scry 1 | better than pool | 2+ lands Brier (pool) | s a game | ms a decision");
  for (const a of [...by.values()].sort((x, y) => x.n - y.n)) console.log(`${a.n} | ${a.games} | ${a.cards} | ${(a.loss / a.cards).toFixed(3)} | ${(a.pool / a.cards).toFixed(3)} | ${(a.scry1 / a.cards).toFixed(3)} | ${(100 * (1 - a.loss / a.pool)).toFixed(1)}% | ${(a.lands / a.landN).toFixed(3)} (${(a.landsPool / a.landN).toFixed(3)}) | ${(a.ms / a.games / 1000).toFixed(1)} | ${(a.ms / a.updates).toFixed(1)}`);
}
