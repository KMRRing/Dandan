// Schafkopf self-play, generation 0 (Fable, 24 Nov 2026 20:38Z, job 3): the bare search (sk-monte.js) in all four seats, the deal
// seeds as sk-match.mjs makes them (so job 1's deals), every seat's searched decisions kept (each option's mean and deals) with the
// payoff per seat: the training data. No Codex player sits here, so these rows may train (Codex's games train nothing).
// usage: node lab/schafkopf/sk-selfplay.mjs <shard> <shards> <out> <deals per decision> <deals per shard> <first seed> [close=<gap>:<mult>] [only=<shard,...>]
import fs from "node:fs";
import { schafkopf as G, dealsLine } from "./sk-rules.js";
import { bareThink } from "./sk-monte.js";
import { mix, seeded } from "../../seats.js";

const [shard0, , out, deals, per, seed0] = process.argv.slice(2).map((x, i) => (i === 2 ? x : Number(x)));
// only=<n,...> (a re-run of failed shards): shard k plays the original shard ONLY[k], its deals and seeds exactly
const ONLY = (process.argv.find(a => a.startsWith("only=")) || "").slice(5).split(",").filter(Boolean).map(Number), shard = ONLY.length ? ONLY[shard0] : shard0;
const cl = (process.argv.find(a => a.startsWith("close=")) || "").slice(6).split(":").map(Number), close = cl[0] ? { gap: cl[0], mult: cl[1] || 4 } : null;
const key = m => JSON.stringify(m), lines = [];
for (let j = 0; j < per; j++) {
  const seed = mix(seed0, shard * per + j), s = G.deal({ rng: seeded(seed) }), dec = [], clock = [0, 0, 0, 0];
  for (let i = 0; !G.over(s); i++) {
    const w = G.toMove(s), ops = G.options(s, w), t0 = Date.now();
    let m = ops[0];
    if (ops.length > 1) {
      const r = bareThink(s, w, { deals, close });
      m = r.best;
      dec.push({ i, seat: w, opts: r.list.map(c => [key(c.move), Number.isNaN(c.mean) ? null : +c.mean.toFixed(5), c.n]), ...(r.deeper ? { close: 1 } : {}) });
    }
    clock[w] += Date.now() - t0;
    if (typeof G.act(s, w, m, seeded(mix(seed, 0x51))) === "string") throw new Error(`deal ${seed}: ${key(m)} refused`);
  }
  lines.push({ seed, dealer: s.dealer, payoff: G.payoff(s), contract: s.contract ? { type: s.contract.type, declarer: s.contract.declarer, ...(s.contract.type === "sau" ? { partner: s.contract.partner } : {}) } : null, thrown: !!s.thrown, log: s.log, dec, clock });
  fs.writeFileSync(out, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
}
console.log(`sk-selfplay: ${lines.length} deals; ${dealsLine()}`);
