// One Hard against another (11 November 2026): every deal twice, seats swapped, the same deals per depth. A side is
// "<search>[*deals]:<judge>[:<tempo judge>:<squeeze judge>]" (deals: this side's own, else the match's): search hard (dandan-think.js think), hard+<job> (Hard with the stage-1 model
// of a lab/policy-train.mjs job playing its look-aheads past the tree) or paths (thinkPaths, four plan
// pairings, maximin); a judge is a file in judges/ (ag-v14.json), "@<job>" (the first line of a lab job's results, e.g. a
// lab/judge-variants.mjs run) or "-" (the game's own); "@<job>#<variant>" picks a variant's line. The two plan judges, for paths, score its tempo-tempo and squeeze-squeeze
// lines (the mixed ones take the main judge). Rows { pair, a, games } as lab/judge-match.mjs (lab/medium-match-sum.mjs sums them).
// Each game is also printed as a line { pair, seed, aSeat, winner, moves }: nothing reads it yet, but a match game is then kept.
// "hard-short" weighs Medium's shortlist only (`all: false`, also at Deep), "hard-margin" every legal move but a move off the shortlist
// only if it leads the best shortlist move by 3 standard errors plus 2 points (12 November 2026, the planning chat: aa-i1, aa-i3);
// each row also counts, per side, the decisions whose move was off the shortlist (`off`, of `n`; only a side weighing every move).
// usage: node lab/hard-match.mjs <shard> <shards> <out> <side A> <side B> [deals 64] [pairs 200] [first seed 150000] [first pair 0]
//   first pair (13 Nov, Fable: pairs 300-599 of a 300-pair set, for its 600 look): the shards play pairs from it to `pairs`, numbered
//   as the set's own, so the two jobs read together with gate-sum's "+" (aa-i1+ac-i1-600)
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { thinkMoveOff, thinkPathsMove, think } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { makePlus } from "../dandan-netpolicy.js";
import { policyMove } from "../dandan-policy.js";
const [shard, shards, out, specA, specB] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6]];
let focusOf = null;   // a focus arm's picker (Fable No. 17): its tallies of options a tree decision go into the rows
const deals = Number(process.argv[7] ?? 64), pairs = Number(process.argv[8] ?? 200), first = Number(process.argv[9] ?? 150000), from = Number(process.argv[10] ?? 0);
async function judgeOf(t) {
  if (!t || t === "-") return undefined;
  // "avg(<judge>,<judge>…)" (12 November 2026, plan item 5): the mean of several nets' chances, e.g. avg(@jt130,@aa-g8-s3-c#19)
  const avg = t.match(/^avg\((.+)\)$/);
  if (avg) { const js = await Promise.all(avg[1].split(",").map(judgeOf)); return (s, me) => js.reduce((a, j) => a + j(s, me), 0) / js.length; }
  if (t.startsWith("@")) {
    const [job, v] = t.slice(1).split("#"), ls = (await readParts(job)).flatMap(x => x.split("\n").filter(Boolean)).map(l => JSON.parse(l));
    return makeJudge((v == null ? ls[0] : ls.find(l => l.variant === Number(v))).layers);
  }
  // a net's redraw table (dandan-keep.js) comes with it, for "-keep" sides
  const file = JSON.parse(fs.readFileSync(new URL(`../judges/${t}`, import.meta.url), "utf8")), judge = makeJudge(file.layers);
  if (file.mull) judge.mull = file.mull;
  return judge;
}
/** A stage-1 model: lab/policy/<name>.json when the repository holds one (19:05Z, Fable No. 1: mpD), else a policy-train job's first line. */
async function modelOf(name) {
  const file = new URL(`./policy/${name}.json`, import.meta.url);
  if (/^[A-Za-z0-9_-]+$/.test(name) && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  return JSON.parse((await readParts(name)).flatMap(x => x.split("\n").filter(Boolean))[0]);
}
async function side(spec) {
  // "zero~<value net>~<policy net|->" (14 Nov 2026, Zero, Fable No. 12's yardstick): Zero's engine, no Medium anywhere: every
  // option weighed by the search with Zero's nets (lab/zero/nets/<name>.json), at the match's deals. "~open" at the end (14 Nov
  // 2026, Korbi 10:04, the oracle): the other hand dealt as it really is (determinize open), only the library's order guessed:
  // the most any read of the hand can buy the search
  if (spec.startsWith("zero~")) {
    // a fourth part: "open" (the oracle), or "scry=<net>" (the swap matches: that Scry deals the hidden cards, whatever the policy)
    const [, v, pol, flag] = spec.split("~"), open = flag === "open", Z = await import("./zero/zero-lib.mjs"), brain = Z.zeroBrain(pol, v, flag?.startsWith("scry=") ? flag.slice(5) : null);
    const f = (s, seat) => {
      const ms = Z.zeroOptions(s, seat);
      if (ms.length <= 1) return { move: ms[0] ?? Z.PASS, off: false };
      return { move: brain.think(s, seat, deals, { open }).best, off: false };
    };
    return Object.assign(f, { reset: () => brain.reset(), seen: (...a) => brain.seen(...a) });
  }
  // "plus@<policy-train job>" or "medium": no search at all, the stage-1 model or Medium alone (to see where the model stands)
  if (spec === "medium") return (s, seat) => ({ move: policyMove(s, seat, { rng: Math.random }), off: false });
  if (/^plus(free)?@/.test(spec)) { const free = spec.startsWith("plusfree@"), mv = makePlus(JSON.parse((await readParts(spec.replace(/^plus(free)?@/, ""))).flatMap(x => x.split("\n").filter(Boolean))[0]), { free }).move; return (s, seat) => ({ move: mv(s, seat, Math.random), off: false }); }
  const [head, j, jt, js] = spec.split(":"), judge = await judgeOf(j), tj = await judgeOf(jt), sj = await judgeOf(js);
  const [search0, own] = head.split("*"), budget = { deals: own ? Number(own) : deals, ms: 1e9, offCheck: true, ...(judge ? { judge } : {}) };
  // "hard+<policy-train job>": Hard whose look-aheads are played past the tree by the stage-1 model instead of Medium (gate G2)
  // "hard^<policy-train job>": Hard whose shortlist the stage-1 model orders (plan 3.5's fallback after G2), Medium playing on
  const [search1, ranker] = search0.split("^");
  // "hard…^~<model>" (14 Nov 2026, Fable No. 13 point 6): the model ranks the tree's options inside the look-aheads only (think's
  // treeRank); the root's candidates and the questions stay as they are
  if (ranker?.startsWith("~")) budget.treeRank = makePlus(await modelOf(ranker.slice(1))).rank;
  // "hard…^%<model>" (14 Nov 2026, Fable No. 17): the model's focus picks the tree's options with priority (the fewest top moves
  // holding 90% of its probability, 1 to 6, all open); the root and the questions as they are
  else if (ranker?.startsWith("%")) { budget.focus = makePlus(await modelOf(ranker.slice(1))).focus; focusOf = budget.focus; }
  else if (ranker) budget.rank = makePlus(await modelOf(ranker)).rank;
  const [search2, model] = search1.split("+");
  // "hard-t<n>" (12 November 2026, plan item 8): the look-ahead plays n turns ahead instead of 2
  const [, search, tn, arm] = search2.match(/^([a-z]+)(?:-t(\d+))?(?:-(short|margin|keep|knet|knetkeep))?$/) || [, search2];
  if (tn != null) budget.turns = Number(tn);
  if (arm === "short") budget.all = false;
  if (arm === "margin") Object.assign(budget, { all: true, margin: { se: 3, pts: 0.02 } });
  // "hard-keep" (13 Nov 2026): the keep and the bottoms by the value net and its redraw table (dandan-keep.js), not Medium's count
  if (arm === "keep" || arm === "knetkeep") { if (!judge?.mull) throw new Error(`${spec}: the net has no redraw table (lab/keep-table.mjs)`); budget.keep = true; }
  // "hard-knet" (13 Nov 2026, Fable): the first seven by the keep net (judges/keep-net.json), every later keep and bottom Medium's;
  // "hard-knetkeep": the keep net on the first seven, the value net's table after it
  if (arm === "knet" || arm === "knetkeep") budget.knet = JSON.parse(fs.readFileSync(new URL("../judges/keep-net.json", import.meta.url), "utf8"));
  // "hard+free~<job>": the model unguarded (it decides passing and lands too)
  if (model) { const free = model.startsWith("free~"); budget.rollout = makePlus(await modelOf(model.replace(/^free~/, "")), { free }).move; }
  if (search === "paths") {
    const judges = { ...(tj ? { "tempo-tempo": tj } : {}), ...(sj ? { "squeeze-squeeze": sj } : {}) };
    return (s, seat) => ({ move: thinkPathsMove(s, seat, { ...budget, judges }), off: false });
  }
  return (s, seat) => thinkMoveOff(s, seat, budget);
}
const A = await side(specA), B = await side(specB), J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random;
// milliseconds each side spends a decision (plan item 8: what a shorter look-ahead saves), summed over the pair's two games
let clock = [[0, 0], [0, 0]], offs = [0, 0];
function game(seed, aSeat) {
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  A.reset?.(); B.reset?.();
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const t0 = performance.now(), { move: m, off } = (who === aSeat ? A : B)(s, who), side = who === aSeat ? 0 : 1;
    clock[side][0] += performance.now() - t0; clock[side][1]++; if (off) offs[side]++;
    Math.random = realRandom;
    const r = applyMove(rules, G, who, m, 0);
    if (r.error) throw new Error(`deal ${seed} move ${i}: ${r.error}`);
    A.seen?.(s, who, m, r.G.state); B.seen?.(s, who, m, r.G.state);
    G = r.G;
  }
  const w = G.state.winner;
  // the game itself goes to stdout (the worker keeps it as stdout-<shard>.txt), so a match game plays again from its seed
  // and moves as a self-play game does; the rows in <out> stay as they were (the Fleet page reads those)
  console.log(JSON.stringify({ pair: seed - first, seed, aSeat, winner: w, moves: G.moves }));
  return w === aSeat ? 1 : w == null || w < 0 ? 0.5 : 0;
}
for (let p = from + shard; p < pairs; p += shards) {
  clock = [[0, 0], [0, 0]]; offs = [0, 0];
  const seed = first + p, g = [game(seed, 0), game(seed, 1)];
  const ms = clock.map(([t, n]) => (n ? Math.round(t / n) : 0)), n = clock.map(([, k]) => k);
  fs.appendFileSync(out, JSON.stringify({ pair: p, a: (g[0] + g[1]) / 2, games: g, ms, n, off: offs, ...(focusOf ? { opts: { ...focusOf.counts } } : {}) }) + "\n");
}
