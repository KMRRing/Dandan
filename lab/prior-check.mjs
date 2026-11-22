// The prior at depth (20 Nov 2026, Korbi 00:41 local: "is there a chance prior is making the engine weaker when thinking is
// deeper"): decisions sampled from deep games, each searched once by the general nets at the given deals and flags with prior=1.
// The prior leaves the searched means as they are (lab/zero/general.mjs withPrior), so one search gives both picks, paired: the
// search's own (the best mean) and the prior's (the best score). Counted: how often they differ, and how far the search's pick was
// ahead of the prior's when they do, in standard errors of that gap (gapSe) and in points; and the policy's chance of each.
// Read-only. Several runs split the sample: part/parts.
// usage: node lab/prior-check.mjs <batch | file:<zero-play output>> <nets> [positions 50] [part 0] [parts 1] [deals 1024] [flags deeper=0.03~deepmax=4]
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { DECK } from "../dandan-core.js";
import { zeroOptions } from "../dandan-zero.js";
import { generalBrain } from "./zero/zero-lib.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";
import fs from "node:fs";

const [batch, nets, most = "50", part = "0", parts = "1", deals = "1024", flags = "deeper=0.03~deepmax=4"] = process.argv.slice(2);
const fl = flags.split("~"), num = k => Number(fl.find(x => x.startsWith(`${k}=`))?.split("=")[1]);
const BR = fl.includes("bestreply") || fl.includes("commit"), ALT = fl.includes("commit") ? { commit: true } : { bestReply: true }, ALTNAME = fl.includes("commit") ? "explore-then-commit" : "best-reply scoring";
const extra = { prior: num("prior") || 1, deeper: { gap: num("deeper") || 0.03, ...(num("deepmax") ? { max: num("deepmax") } : {}) } };
const J = x => JSON.parse(JSON.stringify(x)), real = Math.random, name = m => `${m.t}${m.card != null ? " " + DECK[m.card] : ""}`;
// a decision in about 1 in 12, chosen by a hash of game and move, so the parts share nothing and a rerun picks the same ones
const pick = (g, i) => { let h = Math.imul(g.seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) % 12 === 0; };
const local = batch.startsWith("file:"), store = local ? null : await (await import("./lib.mjs")).labStore();
const brain = await generalBrain(nets), rows = [], read = async n => (local ? fs.readFileSync(n, "utf8") : await store.get(n)) || "";
const names = local ? [batch.slice(5)] : (await store.list(`results/${batch}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)).sort();
outer: for (const n of names.filter((_, k) => k % Number(parts) === Number(part))) {
  for (const l of (await read(n)).split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l);
    brain.reset();
    let G = recordOf(rules, g), taken = 0;   // at most 3 decisions a game, so a part's sample spreads over its games
    for (let i = 0; i < g.moves.length; i++) {
      const [who, m] = g.moves[i], s = rules.restore(J(G.state));
      if (taken < 3 && i > 10 && !s.pending && who !== g.vs?.seat && pick(g, i) && zeroOptions(s, who).length > 1) {   // the nets' own decisions, not the rival's
        Math.random = seeded(g.seed + i);
        const r = brain.think(J(s), who, Number(deals), extra);
        Math.random = real;
        if (r.priorK != null) {
          taken++;
          const row = { k: r.priorK, o: r.list.map(o => [o.mean, o.prior, o.groupLift || 0, name(o.move)]) };
          // bestreply in the flags (22 Nov 2026, Fable 19:08Z item 3): the same decision searched again with best-reply scoring;
          // the pick it makes, and what that pick gives up by the plain search's means
          if (BR) {
            Math.random = seeded(g.seed + i);
            const r1 = brain.think(J(s), who, Number(deals), { ...extra, ...ALT });
            Math.random = real;
            const mean0 = mv => r.list.find(o => JSON.stringify(o.move) === JSON.stringify(mv))?.mean;
            row.br = { pick0: name(r.best), pick1: name(r1.best), same: JSON.stringify(r.best) === JSON.stringify(r1.best), gap: (mean0(r.best) ?? 0) - (mean0(r1.best) ?? mean0(r.best) ?? 0), v: mean0(r.best) };
          }
          rows.push(row);
          if (rows.length >= Number(most)) break outer;
        }
      }
      Math.random = seeded(rngSeedOf(g, i));
      const a = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (a.error) break;
      brain.seen(s, who, m, a.G.state);
      G = a.G;
    }
  }
}
// every prior size and the group lift from the one search (22 Nov 2026, Fable: x1, x2, x4): the means and the policy's chances
// are the search's whatever c is, so a pick at c is argmax of mean - lift + c × k × ln p, k the search's at c = 1
const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1);
console.log(`${rows.length} decisions from ${batch} (part ${part} of ${parts}), nets ${nets}, ${deals} deals, ${flags}, full search`);
const out = {};
for (const c of [1, 2, 4]) for (const multi of [false, true]) {
  const d = [];
  for (const x of rows) {
    const sc = o => o[0] - (multi ? o[2] : 0) + c * x.k * Math.log(Math.max(o[1], 1e-4)), byMean = [...x.o].sort((a, b) => b[0] - a[0])[0];
    const pk = x.o.reduce((a, o) => (sc(o) > sc(a) ? o : a));
    if (pk !== byMean) d.push({ gap: byMean[0] - pk[0], z: x.k ? (byMean[0] - pk[0]) / x.k : 0, s: byMean[3], p: pk[3], mean: byMean[0] });
  }
  const pts = (lo, hi) => d.filter(x => 100 * x.gap >= lo && 100 * x.gap < hi).length, sez = (lo, hi) => d.filter(x => x.z >= lo && x.z < hi).length;
  const tag = `prior x${c}${multi ? " + group lift" : ""}`;
  out[tag] = { overridden: d.length, of: rows.length };
  console.log(`  ${tag}: overrides the search's pick in ${d.length} (${pc(d.length, rows.length)}%); gap given up, points: under 0.5 ${pts(0, 0.5)}, 0.5-1 ${pts(0.5, 1)}, 1-2 ${pts(1, 2)}, 2+ ${pts(2, 1e9)}; in standard errors: under 1 ${sez(0, 1)}, 1-2 ${sez(1, 2)}, 2+ ${sez(2, 1e9)}; mean ${d.length ? (100 * d.reduce((a, x) => a + x.gap, 0) / d.length).toFixed(2) : "-"} points`);
  if (c === 4 && !multi) for (const x of d.filter(x => x.gap >= 0.02)) console.log(`    ${x.s} -> ${x.p}: ${(100 * x.gap).toFixed(2)} points at ${(100 * x.mean).toFixed(0)}%`);
}
if (BR) {
  const ch = rows.filter(x => x.br && !x.br.same);
  console.log(`  ${ALTNAME} (prior x${num("prior") || 1}): changes the pick in ${ch.length} of ${rows.length} (${pc(ch.length, rows.length)}%); the plain search's means give up: under 0.5 ${ch.filter(x => 100 * x.br.gap < 0.5).length}, 0.5-1 ${ch.filter(x => 100 * x.br.gap >= 0.5 && 100 * x.br.gap < 1).length}, 1-2 ${ch.filter(x => 100 * x.br.gap >= 1 && 100 * x.br.gap < 2).length}, 2+ ${ch.filter(x => 100 * x.br.gap >= 2).length} points`);
  for (const x of ch) console.log(`    ${x.br.pick0} -> ${x.br.pick1}: ${(100 * x.br.gap).toFixed(2)} points at ${(100 * x.br.v).toFixed(0)}%`);
}
console.log(`  mean k ${(rows.reduce((a, x) => a + x.k, 0) / Math.max(1, rows.length)).toFixed(4)}`);
console.log("JSON " + JSON.stringify({ batch, part, parts, n: rows.length, out, rows }));
