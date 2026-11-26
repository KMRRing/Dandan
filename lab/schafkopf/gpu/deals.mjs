// The JS jobs' deals for the GPU's matches (sk_play_t.py match): the deal each sk-match.mjs shard plays, from its seed, as
// { seed, hands (Codex ids), dealer }, so GPU matches pair deal for deal with the JS references (skm-ref, ska-base).
// usage: node lab/schafkopf/gpu/deals.mjs <shards> <per> <seed0> > deals.jsonl
import { schafkopf as G } from "../sk-rules.js";
import { seeded, mix } from "../../../seats.js";

const [shards, per, seed0] = process.argv.slice(2).map(Number);
for (let shard = 0; shard < shards; shard++) for (let j = 0; j < per; j++) {
  const seed = mix(seed0, shard * per + j), s = G.deal({ rng: seeded(seed) });
  process.stdout.write(JSON.stringify({ seed, hands: s.hands, dealer: s.dealer }) + "\n");
}
