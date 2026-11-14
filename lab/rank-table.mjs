// How well a move-picker orders the moves, not just its first choice (14 Nov 2026, Fable No. 16 point 3): on held-out Deep
// decisions of export jobs (lab/export.mjs, hold and deep), for Medium (its own scores, passing at its bar) and for each model
// (lab/policy/<name>.json, a Medium-free picker scored by freeScorer over every option the search weighed), how often the search's
// pick is the ranker's first choice, among its first two, three and four; the same split by the kind of the search's move; and
// the mean value the search gave to the ranker's second, third and fourth choices, in points behind the search's pick.
// Nothing is forced in: passing and Medium's move get no place of their own.
// usage: node lab/rank-table.mjs <export ids, comma-separated> <models, comma-separated> [most decisions 200000]
import fs from "node:fs";
import { labStore } from "./lib.mjs";
import { freeScorer } from "../dandan-netpolicy.js";

const [ids, models, most = "200000"] = process.argv.slice(2);
const store = await labStore(), KINDS = ["pass", "land", "cast", "cycle", "ability"];
const rankers = [["Medium", (d) => d.c.map(c => c.s)], ...models.split(",").map(n => {
  const sc = freeScorer(JSON.parse(fs.readFileSync(new URL(`./policy/${n}.json`, import.meta.url), "utf8").split("\n")[0]));
  return [n, d => sc(d.x, d.c.map(c => c.m))];
})];
const T = Object.fromEntries(rankers.map(([n]) => [n, { n: 0, top: [0, 0, 0, 0], behind: [0, 0, 0], bn: [0, 0, 0], kind: Object.fromEntries(KINDS.map(k => [k, { n: 0, top: [0, 0, 0, 0] }])) }]));
let seen = 0;
outer: for (const id of ids.split(",")) for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
  for (const line of ((await store.get(name)) || "").split("\n")) {
    if (!line) continue;
    const d = JSON.parse(line);
    if (!d.hold || !d.deep || d.c.length < 2 || d.pick == null || d.pick < 0) continue;
    if (++seen > Number(most)) break outer;
    const qp = d.c[d.pick].q, kind = KINDS[d.c[d.pick].m[0]] || "pass";
    for (const [n, f] of rankers) {
      const s = f(d), order = s.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(p => p[1]);
      const at = order.indexOf(d.pick), t = T[n];
      t.n++; t.kind[kind].n++;
      for (let r = 0; r < 4; r++) if (at <= r) { t.top[r]++; t.kind[kind].top[r]++; }
      for (let r = 1; r < 4 && r < order.length; r++) { t.behind[r - 1] += qp - d.c[order[r]].q; t.bn[r - 1]++; }
    }
  }
}
const p = (a, b) => (b ? (100 * a / b).toFixed(1) : "—").padStart(5);
console.log(`${seen - (seen > Number(most) ? 1 : 0)} held-out Deep decisions (${ids}); the search's pick among the ranker's first 1 / 2 / 3 / 4 (%), then points behind the pick of its 2nd / 3rd / 4th choice:`);
for (const [n] of rankers) { const t = T[n]; console.log(`  ${n.padEnd(10)} ${t.top.map(v => p(v, t.n)).join(" ")}   ${t.behind.map((v, r) => (100 * v / Math.max(1, t.bn[r])).toFixed(2).padStart(6)).join(" ")}`); }
console.log("by the kind of the search's move (first 1 / first 4, %):");
for (const k of KINDS) console.log(`  ${k.padEnd(8)} ${rankers.map(([n]) => `${n} ${p(T[n].kind[k].top[0], T[n].kind[k].n)} /${p(T[n].kind[k].top[3], T[n].kind[k].n)}`).join("   ")}   (${T.Medium.kind[k].n} decisions)`);
