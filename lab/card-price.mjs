// The price of a card in hand (22 Nov 2026, Fable 17:00Z): what each value net says one card still in the seat's hand is worth.
// On positions from games neither net trained on, take one card of a kind out of the seat's hand (the rest unchanged) and judge
// again; the drop in the seat's win chance is that card's price. One untapped land of the seat's taken off the battlefield is the
// yardstick. Same positions for both nets, true hands. If live Monte's net prices a held card clearly higher than ours, our search
// can't see why holding pays, which is what the suite's wasteful casts look like. Read-only.
// usage: node lab/card-price.mjs <batch | file:<zero-play output>> [every 3] [most 100 games] [nets zl23] [part 0] [parts 1]
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { DECK, isLand } from "../dandan-core.js";
import { valueJudge } from "../dandan-zero.js";
import { generalJudge } from "./zero/general.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";
import fs from "node:fs";

const [batch, every = "3", most = "100", nets = "zl23", part = "0", parts = "1"] = process.argv.slice(2);
const read = f => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8").split("\n")[0]);
const judges = { "g12r-C": valueJudge(read("../judges/zero-g12r-C-value.json")), [nets]: generalJudge(read(`./zero/nets/${nets}-gvalue.json`)) };
const J = x => JSON.parse(JSON.stringify(x)), real = Math.random;
const acc = {};   // what -> judge -> { n, s, s2 }
const add = (what, k, d) => { const a = ((acc[what] ||= {})[k] ||= { n: 0, s: 0, s2: 0 }); a.n++; a.s += d; a.s2 += d * d; };
const local = batch.startsWith("file:"), store = local ? null : await (await import("./lib.mjs")).labStore();
const names = local ? [batch.slice(5)] : (await store.list(`results/${batch}/`)).filter(n => /part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % Number(parts) === Number(part));
let games = 0, positions = 0;
outer: for (const n of names) {
  let text = "";
  try { text = (local ? fs.readFileSync(n, "utf8") : await store.get(n)) || ""; } catch { continue; }
  for (const l of text.split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l);
    if (g.winner == null || g.winner < 0 || g.branch) continue;
    let G = recordOf(rules, g);
    for (let i = 0; i < g.moves.length; i++) {
      const s = G.state;
      if (i % Number(every) === 0 && !s.over && !s.stack.length) for (const me of [0, 1]) {
        positions++;
        const base = Object.fromEntries(Object.entries(judges).map(([k, j]) => [k, j(s, me)]));
        const seen = new Set();
        for (const id of s.hand[me]) {
          const what = DECK[id];
          if (seen.has(what)) continue;
          seen.add(what);
          const t = rules.restore(J(s));
          t.hand[me] = t.hand[me].filter((x, k) => k !== t.hand[me].indexOf(id));
          const dd = Object.fromEntries(Object.entries(judges).map(([k, j]) => [k, base[k] - j(t, me)]));
          for (const k of Object.keys(judges)) add(`hand: ${what}`, k, dd[k]);
          add(`hand: ${what}`, "diff", dd[Object.keys(judges)[0]] - dd[Object.keys(judges)[1]]);   // paired, for the difference's se
        }
        const land = s.bf.find(p => p.ctl === me && !p.tapped && isLand(p));
        if (land) {
          const t = rules.restore(J(s));
          t.bf = t.bf.filter(p => p.id !== land.id);
          const dd = Object.fromEntries(Object.entries(judges).map(([k, j]) => [k, base[k] - j(t, me)]));
          for (const k of Object.keys(judges)) add("battlefield: an untapped land", k, dd[k]);
          add("battlefield: an untapped land", "diff", dd[Object.keys(judges)[0]] - dd[Object.keys(judges)[1]]);
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
const ks = Object.keys(judges), f = a => (a ? `${(100 * a.s / a.n).toFixed(2)} ± ${(100 * Math.sqrt(Math.max(0, a.s2 / a.n - (a.s / a.n) ** 2) / a.n)).toFixed(2)}` : "-");
console.log(`${games} games from ${batch}, ${positions} seat-positions (every ${every}th move, empty stack, both seats, true hands)`);
console.log(`the drop in the seat's win chance, points ± se, when one card is taken away: ${ks.join(" | ")} | difference (${ks[0]} less ${ks[1]}, paired)`);
for (const [what, by] of Object.entries(acc).sort((a, b) => (b[1][ks[1]]?.n || 0) - (a[1][ks[1]]?.n || 0))) {
  console.log(`  ${what.padEnd(32)} n ${String(by[ks[0]]?.n || 0).padStart(5)}: ${f(by[ks[0]])} | ${f(by[ks[1]])} | ${f(by.diff)}`);
}
