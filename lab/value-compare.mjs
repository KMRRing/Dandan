// Live Monte's value net against ours on the same positions (20 Nov 2026, Korbi: every difference between live Monte and the zl
// series): games neither net trained on, each position from both seats, the true hands; the result's log loss and Brier overall
// and with 10 or fewer cards left in the library. If live Monte's value net predicts these games better, the value net is the gap;
// if not, the gap is elsewhere (the policy, the search, the dealer in play).
// usage: node lab/value-compare.mjs <batch | file:<zero-play output>> [every 3] [most 300 games]
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { valueJudge } from "../dandan-zero.js";
import { generalJudge } from "./zero/general.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";
import { labStore } from "./lib.mjs";
import fs from "node:fs";

const [batch, every = "3", most = "300"] = process.argv.slice(2);
const read = f => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8").split("\n")[0]);
const judges = {
  "g12r-C (live Monte)": valueJudge(read("../judges/zero-g12r-C-value.json")),
  zl21: generalJudge(read("./zero/nets/zl21-gvalue.json")),
  zl20: generalJudge(read("./zero/nets/zl20-gvalue.json")),
  zs06: generalJudge(read("./zero/nets/zs06-gvalue.json")),
};
const acc = Object.fromEntries(Object.keys(judges).map(k => [k, { n: 0, ll: 0, br: 0, ln: 0, lll: 0 }]));
const local = batch.startsWith("file:"), store = local ? null : await labStore(), real = Math.random;
let games = 0;
const names = local ? [batch.slice(5)] : (await store.list(`results/${batch}/`)).filter(n => /part-\d+\.jsonl$/.test(n)).sort();
outer: for (const n of names) {
  for (const l of ((local ? fs.readFileSync(n, "utf8") : await store.get(n)) || "").split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l);
    if (g.winner == null || g.winner < 0 || g.branch) continue;
    let G = recordOf(rules, g);
    for (let i = 0; i < g.moves.length; i++) {
      const s = G.state;
      if (i % Number(every) === 0 && !s.over) for (const me of [0, 1]) {
        const y = g.winner === me ? 1 : 0, late = s.lib.length <= 10;
        for (const [k, j] of Object.entries(judges)) {
          const p = Math.min(1 - 1e-6, Math.max(1e-6, j(s, me))), a = acc[k], ll = -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
          a.n++; a.ll += ll; a.br += (p - y) ** 2; if (late) { a.ln++; a.lll += ll; }
        }
      }
      const [who, m] = g.moves[i];
      Math.random = seeded(rngSeedOf(g, i));
      const r = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (r.error) break;
      G = r.G;
    }
    if (++games >= Number(most)) break outer;
  }
}
console.log(`${games} games from ${batch}, every ${every}th position from both seats, true hands (lower is better)`);
for (const [k, a] of Object.entries(acc)) console.log(`${k.padEnd(20)} positions ${a.n}: log loss ${(a.ll / a.n).toFixed(4)}, Brier ${(a.br / a.n).toFixed(4)}; library <= 10: ${a.ln} positions, log loss ${(a.lll / Math.max(1, a.ln)).toFixed(4)}`);
