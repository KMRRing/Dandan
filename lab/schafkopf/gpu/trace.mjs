// Traces of Codex's own Schafkopf for the tensor rules' identity test (gpu/test_rules.py): deals played by random legal moves,
// each step's seat to move and legal actions, and the payoff. Bids lean to passing so thrown deals, every contract and
// every trump setup turn up. usage: node lab/schafkopf/gpu/trace.mjs <deals> <seed> [sau] [views] > trace.jsonl
import { schafkopf as G } from "../sk-rules.js";
import { actionOf, id0, rawView, partnerView } from "../sk-view.js";
import { seeded, mix } from "../../../seats.js";
import { loadNet, forward } from "../sk-net.js";
// NET=<net file from the repo root>: also the net's outputs for the seat to move
const NET = process.env.NET ? loadNet(new URL(`../../../${process.env.NET}`, import.meta.url)) : null;

const [n, seed0] = process.argv.slice(2).map(Number), SAU = process.argv.includes("sau"), VIEWS = process.argv.includes("views");   // "sau": Sauspiele first
for (let d = 0; d < n; d++) {
  const seed = mix(seed0, d), rng = seeded(seed), s = G.deal({ rng });
  const hands = s.hands.map(h => h.map(id0)), dealer = s.dealer, steps = [];
  while (!G.over(s)) {
    const w = G.toMove(s), ops = G.options(s, w);
    // bidding: pass 60% of the time, otherwise a random bid
    const pass = ops.find(m => m.t === "pass");
    const sau = SAU ? ops.filter(m => m.type === "sau") : [];
    const m = sau.length && rng() < 0.5 ? sau[Math.floor(rng() * sau.length)] : pass && rng() < 0.6 ? pass : ops[Math.floor(rng() * ops.length)];
    const st = { seat: w, legal: ops.map(actionOf).sort((a, b) => a - b), a: actionOf(m) };
    // "views": the seat to move's rawView (its nonzero entries) and partnerView, and the same for the seat after it
    if (VIEWS) st.views = [w, (w + 1) % 4].map(p => { const v = G.view(s, p), r = rawView(v); return { p, raw: [...r.keys()].filter(i => r[i]), part: [...partnerView(v)] }; });
    if (NET) st.out = [...forward(NET, G.view(s, w))].map(z => +z.toFixed(6));
    steps.push(st);
    G.act(s, w, m, seeded(mix(seed, 0x51)));
  }
  process.stdout.write(JSON.stringify({ hands, dealer, steps, payoff: G.payoff(s) }) + "\n");
}
