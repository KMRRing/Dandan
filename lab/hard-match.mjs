// One Hard against another (11 November 2026): every deal twice, seats swapped, the same deals per depth. A side is
// "<search>[*deals]:<judge>[:<tempo judge>:<squeeze judge>]" (deals: this side's own, else the match's): search hard (dandan-think.js think) or paths (thinkPaths, four plan
// pairings, maximin); a judge is a file in judges/ (ag-v14.json), "@<job>" (the first line of a lab job's results, e.g. a
// lab/judge-variants.mjs run) or "-" (the game's own); "@<job>#<variant>" picks a variant's line. The two plan judges, for paths, score its tempo-tempo and squeeze-squeeze
// lines (the mixed ones take the main judge). Rows { pair, a, games } as lab/judge-match.mjs (lab/medium-match-sum.mjs sums them).
// Each game is also printed as a line { pair, seed, aSeat, winner, moves }: nothing reads it yet, but a match game is then kept.
// usage: node lab/hard-match.mjs <shard> <shards> <out> <side A> <side B> [deals 64] [pairs 200] [first seed 150000]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { thinkMove, thinkPathsMove } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
const [shard, shards, out, specA, specB] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6]];
const deals = Number(process.argv[7] ?? 64), pairs = Number(process.argv[8] ?? 200), first = Number(process.argv[9] ?? 150000);
async function judgeOf(t) {
  if (!t || t === "-") return undefined;
  if (t.startsWith("@")) {
    const [job, v] = t.slice(1).split("#"), ls = (await readParts(job)).flatMap(x => x.split("\n").filter(Boolean)).map(l => JSON.parse(l));
    return makeJudge((v == null ? ls[0] : ls.find(l => l.variant === Number(v))).layers);
  }
  return makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${t}`, import.meta.url), "utf8")).layers);
}
async function side(spec) {
  const [head, j, jt, js] = spec.split(":"), judge = await judgeOf(j), tj = await judgeOf(jt), sj = await judgeOf(js);
  const [search, own] = head.split("*"), budget = { deals: own ? Number(own) : deals, ms: 1e9, ...(judge ? { judge } : {}) };
  if (search === "paths") {
    const judges = { ...(tj ? { "tempo-tempo": tj } : {}), ...(sj ? { "squeeze-squeeze": sj } : {}) };
    return (s, seat) => thinkPathsMove(s, seat, { ...budget, judges });
  }
  return (s, seat) => thinkMove(s, seat, budget);
}
const A = await side(specA), B = await side(specB), J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random;
function game(seed, aSeat) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const m = (who === aSeat ? A : B)(s, who);
    Math.random = realRandom;
    const r = applyMove(rules, G, who, m, 0);
    if (r.error) throw new Error(`deal ${seed} move ${i}: ${r.error}`);
    G = r.G;
  }
  const w = G.state.winner;
  // the game itself goes to stdout (the worker keeps it as stdout-<shard>.txt), so a match game plays again from its seed
  // and moves as a self-play game does; the rows in <out> stay as they were (the Fleet page reads those)
  console.log(JSON.stringify({ pair: seed - first, seed, aSeat, winner: w, moves: G.moves }));
  return w === aSeat ? 1 : w == null || w < 0 ? 0.5 : 0;
}
for (let p = shard; p < pairs; p += shards) {
  const seed = first + p, g = [game(seed, 0), game(seed, 1)];
  fs.appendFileSync(out, JSON.stringify({ pair: p, a: (g[0] + g[1]) / 2, games: g }) + "\n");
}
