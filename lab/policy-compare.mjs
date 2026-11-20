// Live Monte's policy against ours on the same decisions (20 Nov 2026, Korbi: "yep go for it"): the searched decisions of games
// neither net trained on, each policy's own pick (no search), its dealer kept up to date along the game as in play; scored by
// the search that game ran: points given up (the best searched option's mean less the mean of the option the policy picked) and
// how often it picked the search's choice. A policy's pick the search never weighed is counted apart. Positions: every searched
// decision, deep (1,024 deals) where the batch is deep.
// usage: node lab/policy-compare.mjs <batch | file:<zero-play output>> [most 300 games] [nets: live,zl21,zl20]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { zeroOptions } from "../dandan-zero.js";
import { zeroBrain, generalBrain } from "./zero/zero-lib.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";

const [batch, most = "300", which = "live,zl21,zl20"] = process.argv.slice(2);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b), real = Math.random;
// each contender: a brain kept up to date (seen) and its policy's pick at a position
const contenders = [];
for (const w of which.split(",")) {
  if (w === "live") {
    const b = zeroBrain("g12r-C-policy", "g12r-C-value");
    contenders.push({ name: "g12r-C (live Monte)", b, pick: (s, who) => { b.root(s, who); return b.player.rollout(s, who, Math.random); } });
  } else {
    const b = await generalBrain(w);
    contenders.push({ name: w, b, pick: (s, who) => { b.root?.(s, who); const ms = zeroOptions(s, who), pr = b.player.probs(s, who, ms); let k = 0; for (let j = 1; j < pr.length; j++) if (pr[j] > pr[k]) k = j; return ms[k]; } });
  }
}
// split by whose search scored the decision (a rival game's two seats search with different nets): each policy is judged by a
// search it was not built from where the batch has one
const fresh = () => ({ n: 0, lost: 0, agree: 0, unseen: 0, q: { n: 0, lost: 0, agree: 0 }, close: { n: 0, lost: 0, agree: 0 } });
const acc = contenders.map(() => ({}));
const local = batch.startsWith("file:"), store = local ? null : await (await import("./lib.mjs")).labStore();
const names = local ? [batch.slice(5)] : (await store.list(`results/${batch}/`)).filter(n => /part-\d+\.jsonl$/.test(n)).sort();
let games = 0;
outer: for (const n of names) {
  const lines = ((local ? fs.readFileSync(n, "utf8") : await store.get(n)) || "").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const decisions = new Map();
  for (const x of lines) if (x.c && x.g != null) decisions.set(`${x.g}:${x.i}`, x);
  for (const g of lines.filter(x => x.game != null && x.moves)) {
    if (g.branch) continue;
    for (const c of contenders) c.b.reset();
    let G = recordOf(rules, g);
    for (let i = 0; i < g.moves.length; i++) {
      const [who, m] = g.moves[i], s = G.state, d = decisions.get(`${g.seed}:${i}`);
      if (d && d.seat === who && d.c.length > 1) {
        const by = g.vs && g.vs.seat === who ? `searched by ${g.vs.nets}` : "searched by the batch's own nets";
        const val = c => c.d ?? c.q, best = Math.max(...d.c.map(val)), chosen = d.c[d.pick] ?? d.c.reduce((a, c) => (val(c) > val(a) ? c : a));
        const sorted = d.c.map(val).sort((a, b) => b - a), close = sorted[0] - sorted[1] < 0.03;
        contenders.forEach((c, k) => {
          const mv = c.pick(JSON.parse(JSON.stringify(s)), who), hit = d.c.find(o => same(o.mv, mv)), a = (acc[k][by] ||= fresh());
          if (!hit) { a.unseen++; return; }
          const lost = best - val(hit), ag = same(hit.mv, chosen.mv) ? 1 : 0;
          a.n++; a.lost += lost; a.agree += ag;
          if (s.pending) { a.q.n++; a.q.lost += lost; a.q.agree += ag; }
          if (close) { a.close.n++; a.close.lost += lost; a.close.agree += ag; }
        });
      }
      Math.random = seeded(rngSeedOf(g, i));
      const r = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (r.error) break;
      for (const c of contenders) c.b.seen(s, who, m, r.G.state);
      G = r.G;
    }
    if (++games >= Number(most)) break outer;
  }
}
const f = (x, n) => (n ? (100 * x / n).toFixed(2) : "-");
console.log(`${games} games from ${batch}: each policy's own pick at the searched decisions, scored by that game's search (points given up: lower is better)`);
for (const by of [...new Set(acc.flatMap(Object.keys))].sort()) {
  console.log(by);
  contenders.forEach((c, k) => {
  const a = acc[k][by] || fresh();
  console.log(`  ${c.name.padEnd(20)} decisions ${a.n}: gives up ${f(a.lost, a.n)} points a decision, picks the search's choice ${f(a.agree, a.n)}%; questions ${a.q.n}: ${f(a.q.lost, a.q.n)} points, ${f(a.q.agree, a.q.n)}%; close calls (top two within 3 points) ${a.close.n}: ${f(a.close.lost, a.close.n)} points, ${f(a.close.agree, a.close.n)}%; picks the search never weighed ${a.unseen}`);
  });
}
