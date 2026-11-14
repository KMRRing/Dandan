// Stage 1's gate G1 (monte-plan.md 3.5, 11 November 2026): the trained model (Medium plus a learned correction,
// dandan-netpolicy.js makePlus) against Medium, no search on either side, every deal twice with the seats swapped.
// A side is "medium" or "plus@<policy-train job>" (or plus@policy/<file>.json, a model kept in lab/policy/). Rows { pair, a, games } as lab/hard-match.mjs.
// usage: node lab/plus-match.mjs <shard> <shards> <out> <side A> <side B> [pairs 20000] [first seed 300000]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { makePlus } from "../dandan-netpolicy.js";

const [shard, shards, out, specA, specB] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6]];
const pairs = Number(process.argv[7] ?? 20000), first = Number(process.argv[8] ?? 300000);
async function side(spec) {
  if (spec === "medium") return (s, seat, rng) => policyMove(s, seat, { rng });
  // "zero@<policy net>" (14 Nov 2026): Zero's policy alone (lab/zero/nets/<name>.json), questions at random, no Medium anywhere
  if (spec.startsWith("zero@")) {
    const Z = await import("./zero/zero-lib.mjs"), brain = Z.zeroBrain(spec.slice(5), "-");
    return Object.assign((s, seat, rng) => { brain.root(s, seat); return brain.player.rollout(s, seat, rng); }, { reset: () => brain.reset(), seen: (...a) => brain.seen(...a) });
  }
  // "plusfree@<job>": the model decides passing and lands too (no Medium guard), for a model trained with act=1
  // the model from a policy-train job's results, or (13 Nov) a file in lab/policy/ (a training on GitHub)
  const free = spec.startsWith("plusfree@"), job = spec.replace(/^plus(free)?@/, "");
  const line = job.startsWith("policy/") ? fs.readFileSync(new URL(`./${job}`, import.meta.url), "utf8").split("\n")[0] : (await readParts(job)).flatMap(x => x.split("\n").filter(Boolean))[0];
  return makePlus(JSON.parse(line), { free }).move;
}
const A = await side(specA), B = await side(specB), J = x => JSON.parse(JSON.stringify(x));
// each side's milliseconds and decisions over a pair (13 Nov, Fable No. 4: time per move beside Medium's), as hard-match writes them
let ms = [0, 0], n = [0, 0];
function game(seed, aSeat) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  A.reset?.(); B.reset?.();
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    const t0 = performance.now(), k = who === aSeat ? 0 : 1, m = (k === 0 ? A : B)(s, who, seeded(mix(seed, i + 1)));
    ms[k] += performance.now() - t0; n[k]++;
    const r = applyMove(rules, G, who, m, 0);
    if (r.error) throw new Error(`deal ${seed} move ${i}: ${r.error}`);
    A.seen?.(s, who, m, r.G.state); B.seen?.(s, who, m, r.G.state);
    G = r.G;
  }
  const w = G.state.winner;
  return w === aSeat ? 1 : w == null || w < 0 ? 0.5 : 0;
}
const rows = [];
for (let p = shard; p < pairs; p += shards) {
  ms = [0, 0]; n = [0, 0];
  const g = [game(first + p, 0), game(first + p, 1)];
  rows.push(JSON.stringify({ pair: p, a: (g[0] + g[1]) / 2, games: g, ms: ms.map(v => Math.round(v)), n }));
  if (rows.length >= 200) { fs.appendFileSync(out, rows.join("\n") + "\n"); rows.length = 0; }
}
if (rows.length) fs.appendFileSync(out, rows.join("\n") + "\n");
