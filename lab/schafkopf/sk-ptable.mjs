// A policy-only table (Fable, 25 Nov 2026 03:12Z, order 1): no search, every seat plays its policy net's top move, bidding included.
// Each candidate net sits in one seat (the seat turning with the deal) against three of the reference net; its payoff a deal,
// mean ± SE, with the reference against itself as the control. Milliseconds a deal.
// usage: node lab/schafkopf/sk-ptable.mjs <folder of candidate nets (policy-*.json)> <reference net> <deals> [seed]
import fs from "node:fs";
import path from "node:path";
import { schafkopf as G } from "./sk-rules.js";
import { loadNet, policyProbs } from "./sk-net.js";
import { seeded, mix } from "../../seats.js";

const [dir, refFile, n = 20000, seed0 = 20261127] = process.argv.slice(2), N = Number(n);
const ref = loadNet(refFile), top = (net, s, w) => { const ms = G.options(s, w); if (ms.length === 1) return ms[0]; const { p } = policyProbs(net, s, w, ms); return ms[p.indexOf(Math.max(...p))]; };
const stat = xs => { const k = xs.length, m = xs.reduce((a, b) => a + b, 0) / k, sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (k - 1)); return `${m >= 0 ? "+" : ""}${m.toFixed(3)} ± ${(sd / Math.sqrt(k)).toFixed(3)}`; };
const cands = [["reference (control)", ref], ...fs.readdirSync(dir).filter(f => /^policy-.*\.json$/.test(f)).sort().map(f => [f, loadNet(path.join(dir, f))])];
for (const [name, net] of cands) {
  const t0 = Date.now(), pay = [];
  for (let k = 0; k < N; k++) {
    const sd = mix(Number(seed0), k), s = G.deal({ rng: seeded(sd) }), me = k % 4, rng = seeded(mix(sd, 0x51));
    while (!G.over(s)) { const w = G.toMove(s); G.act(s, w, top(w === me ? net : ref, s, w), rng); }
    pay.push(G.payoff(s)[me]);
  }
  console.log(`sk-ptable: ${name}: ${stat(pay)} tariffs a deal against three of the reference, ${N} deals, ${((Date.now() - t0) / N).toFixed(1)} ms a deal`);
}
