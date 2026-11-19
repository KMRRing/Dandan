// Null moves, a measure of the nets (17 Nov 2026, Korbi: "do not implement this rule. use this as a metric for model
// performance"): a move that, played with both players passing until the stack is empty, leaves the position as it was but for
// the card gone from the mover's hand and its mana spent. Pure loss whatever the cards: a Dandân cast with no Island of one's
// own is one (it is sacrificed at once). Nothing here plays or prunes anything: it only counts, in Zero's self-play games.
// Each move made with priority (not a pass, a land, an attack or a block) is tried on a copy of the position before it.
// usage: node lab/null-count.mjs <shard> <shards> <out> <zero-play jobs, comma-separated | file:<output>>
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { isNull } from "./null-move.mjs";
import { DECK } from "../dandan-core.js";
import { recordOf, redeal, rngSeedOf } from "./zero/branch-lib.mjs";

const [SH, SHS, OUT, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const real = Math.random;
const T = { games: 0, broken: 0, moves: 0, nulls: 0, byCard: {} };
function replay(game) {
  // a branch game (zero/branch-lib.mjs): replayed from its source, its moves counted from the branch point on
  const B = game.branch || null;
  let G = recordOf(rules, game);
  for (let i = 0; i < game.moves.length; i++) {
    if (B && i === B.at) G = { ...G, state: redeal(rules, G.state, B.seat, game.seed) };
    const [who, m] = game.moves[i], s = G.state;
    if (!(B && i < B.at) && !s.pending && !["pass", "land", "attack", "block", "keep", "mull"].includes(m.t)) {
      T.moves++;
      if (isNull(s, who, m, seeded(mix(game.seed, 999 + i)))) { T.nulls++; const n = m.card != null ? DECK[m.card] : m.t; T.byCard[n] = (T.byCard[n] || 0) + 1; }
    }
    Math.random = seeded(rngSeedOf(game, i));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = real;
    if (r.error) { T.broken++; return; }
    G = r.G;
  }
  T.games++;
}
const local = ids.startsWith("file:");
const store = local ? null : await (await import("./lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % SHS === SH);
for (const name of parts) for (const line of ((local ? fs.readFileSync(name, "utf8") : await store.get(name)) || "").split("\n")) {
  if (!line || line.startsWith('{"v":1')) continue;
  const o = JSON.parse(line);
  if (o.game != null && o.moves) replay(o);
}
console.log(`null moves: ${T.nulls} of ${T.moves} moves made with priority (${(1000 * T.nulls / Math.max(1, T.moves)).toFixed(2)} a thousand), ${(T.nulls / Math.max(1, T.games)).toFixed(3)} a game, over ${T.games} games (${T.broken} not the same); by card: ${Object.entries(T.byCard).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
if (OUT && OUT !== "-") fs.writeFileSync(OUT, JSON.stringify(T) + "\n");
