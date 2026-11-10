// The learned policy against Medium, on games it never saw: Medium plays both sides, and at every decision with priority
// and more than one choice the network chooses too. Prints how often they agree (and how often Medium passes, the bar
// to beat), and how long each takes a decision, the network with its list of moves and Medium with its own.
// usage: node lab/policy-check.mjs <weights.json> [games 40] [first seed 90000]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { makePolicy, choices } from "../dandan-netpolicy.js";
import { hr } from "./lib.mjs";

const net = makePolicy(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
const games = Number(process.argv[3] ?? 40), first = Number(process.argv[4] ?? 90000);
const J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random, key = m => JSON.stringify(m);
let n = 0, same = 0, passes = 0, tNet = 0, tMed = 0;
const byKind = {};
for (let g = 0; g < games; g++) {
  const seed = first + g;
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), counted = !G.state.pending && choices(G.state, who).length > 1;
    Math.random = seeded(mix(seed, i + 1));
    const s0 = rules.restore(J(G.state));
    let t = hr();
    const m = policyMove(s0, who, { rng: Math.random });
    if (counted) tMed += hr() - t;
    Math.random = realRandom;
    if (counted) {
      const s = rules.restore(J(G.state));
      t = hr();
      const p = net.move(s, who);
      tNet += hr() - t;
      n++; if (key(p) === key(m)) same++; if (m.t === "pass") passes++;
      const k = m.t === "cast" ? "cast" : m.t; (byKind[k] ||= [0, 0]); byKind[k][1]++; if (key(p) === key(m)) byKind[k][0]++;
    }
    G = applyMove(rules, G, who, m, 0).G;
  }
}
console.log(JSON.stringify({
  decisions: n, agreement: +(same / n).toFixed(4), mediumPasses: +(passes / n).toFixed(4),
  byMediumsMove: Object.fromEntries(Object.entries(byKind).map(([k, [a, b]]) => [k, `${a}/${b}`])),
  msPerDecision: { network: +(tNet / n).toFixed(3), medium: +(tMed / n).toFixed(3) },
}));
