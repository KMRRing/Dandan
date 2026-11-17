// How often a side casts Dandân while it controls no Island (so it is sacrificed at once), and how often a turn ends with a land
// in the active player's hand and none played (17 Nov 2026, Korbi: "Monte Zero playing Dandâns into no Islands"; Fable's count
// on Korbi's games: 21 of 195 Monte turns held a land). Zero's self-play games replayed exactly.
// usage: node lab/doomed-count.mjs <shard> <shards> <out> <zero-play jobs, comma-separated | file:<output>>
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { DECK } from "../dandan-core.js";

const [SH, SHS, OUT, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const real = Math.random, T = { games: 0, casts: 0, doomed: 0, doomedWithIslandInHand: 0, doomedLandUnplayed: 0, turns: 0, held: 0, heldIsland: 0 };
const isIsland = p => (p.tc ? p.tc.some(([, to]) => to === "Island") : DECK[p.id] === "Island");
function replay(game) {
  let G = newRecord(rules, { seats: 2, seed: game.seed, now: 0 });
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = G.state;
    if (m.t === "cast" && DECK[m.card] === "Dandân") {
      T.casts++;
      if (!s.bf.some(p => p.ctl === who && isIsland(p))) {
        T.doomed++;
        const islandInHand = s.hand[who].some(x => DECK[x] === "Island");
        if (islandInHand) T.doomedWithIslandInHand++;
        if (islandInHand && !s.played && s.active === who && /^main/.test(s.step)) T.doomedLandUnplayed++;
      }
    }
    Math.random = seeded(mix(game.seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = real;
    if (r.error) return;
    if (r.G.state.turn !== s.turn) {
      T.turns++;
      const a = s.active, lands = s.hand[a].filter(x => /Island|Sandbar|Isle|Falls|Boilerworks|Depths|Sanctuary|Flood Plain/.test(DECK[x] || ""));
      if (!s.played && lands.length) { T.held++; if (lands.some(x => DECK[x] === "Island")) T.heldIsland++; }
    }
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
const pc = (a, b) => `${a} of ${b} (${(100 * a / Math.max(1, b)).toFixed(1)}%)`;
console.log(`${T.games} games: Dandân cast with no Island of its own ${pc(T.doomed, T.casts)} of casts; of those, an Island in hand ${T.doomedWithIslandInHand}, and its land drop unused in its own main phase ${T.doomedLandUnplayed}. Turns ending with a land in hand and none played: ${pc(T.held, T.turns)} (an Island among them ${T.heldIsland})`);
if (OUT && OUT !== "-") fs.writeFileSync(OUT, JSON.stringify(T) + "\n");
