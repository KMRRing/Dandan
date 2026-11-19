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
const extra = { prior: 1, deeper: { gap: num("deeper") || 0.03, ...(num("deepmax") ? { max: num("deepmax") } : {}) } };
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
      if (taken < 3 && i > 10 && !s.pending && pick(g, i) && zeroOptions(s, who).length > 1) {
        Math.random = seeded(g.seed + i);
        const r = brain.think(J(s), who, Number(deals), extra);
        Math.random = real;
        if (r.priorK != null) {
          taken++;
          const search = [...r.list].sort((a, b) => b.mean - a.mean)[0], prior = r.list[0], differ = search !== prior;
          const gap = search.mean - prior.mean, se = prior.gapSe ?? search.gapSe ?? r.priorK;
          rows.push({ differ, gap, z: differ && se ? gap / se : 0, k: r.priorK, pS: search.prior, pP: prior.prior, s: name(search.move), p: name(prior.move), mean: search.mean });
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
const d = rows.filter(x => x.differ), pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1);
const band = (lo, hi) => d.filter(x => x.z >= lo && x.z < hi).length;
console.log(`${rows.length} decisions from ${batch} (part ${part} of ${parts}), nets ${nets}, ${deals} deals, ${flags}, prior=1`);
console.log(`  the prior changed the pick: ${d.length} (${pc(d.length, rows.length)}%)`);
console.log(`  how far the search's own pick was ahead, in standard errors: under 1 ${band(0, 1)}, 1-2 ${band(1, 2)}, 2-3 ${band(2, 3)}, 3+ ${band(3, 1e9)}`);
console.log(`  mean gap given up ${d.length ? (100 * d.reduce((a, x) => a + x.gap, 0) / d.length).toFixed(2) : "-"} points; mean k ${(rows.reduce((a, x) => a + x.k, 0) / Math.max(1, rows.length)).toFixed(4)}`);
for (const x of d) console.log(`  ${x.s} (policy ${(100 * x.pS).toFixed(0)}%) -> ${x.p} (policy ${(100 * x.pP).toFixed(0)}%): ${(100 * x.gap).toFixed(2)} points, ${x.z.toFixed(1)} SE, at ${(100 * x.mean).toFixed(0)}%`);
console.log("JSON " + JSON.stringify({ batch, part, parts, n: rows.length, differ: d.length, rows }));
