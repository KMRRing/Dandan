// The value nets side by side on the same positions (18 Nov 2026, Korbi: "the current generation underperforms because the guiding
// derived inputs were removed"): the old line's value net (g12r-C, dandan-eval.js featuresRace + the extended view: the hand-built
// inputs) against the general ones, face up, on every turn's start of the held-out games (seed % 5 = 0, trained on by none),
// scored against each game's result: log loss, Brier, how often the favourite won, by game phase. Read-only.
// usage: node lab/value-compare.mjs <zero-play job ids> <net>... (a net: g12r-C, or a general line's name such as zl17)
import fs from "node:fs";
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { valueJudge } from "../dandan-zero.js";
import { generalJudge } from "./zero/general.mjs";

const [ids, ...names] = process.argv.slice(2);
const load = f => JSON.parse(fs.readFileSync(new URL(`./zero/nets/${f}`, import.meta.url), "utf8").split("\n")[0]);
const judges = names.map(n => [n, fs.existsSync(new URL(`./zero/nets/${n}-gvalue.json`, import.meta.url)) ? generalJudge(load(`${n}-gvalue.json`)) : valueJudge(load(`${n}-value.json`))]);
const tot = Object.fromEntries(names.map(n => [n, { all: [0, 0, 0, 0], ph: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }]));
const add = (a, p, y) => { a[0] += -(y * Math.log(p + 1e-9) + (1 - y) * Math.log(1 - p + 1e-9)); a[1] += (p - y) ** 2; a[2] += (p > 0.5) === (y > 0.5) ? 1 : 0; a[3]++; };
const local = ids.startsWith("file:"), store = local ? null : await labStore(), real = Math.random;
let games = 0;
const parts = local ? [[ids, ids.slice(5)]] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).map(n => [n, null]);
for (const [name, file] of parts) {
  for (const line of (file ? fs.readFileSync(file, "utf8") : (await store.get(name)) || "").split("\n")) {
    if (!line.startsWith('{"game"')) continue;
    const g = JSON.parse(line);
    if ((!local && g.seed % 5 !== 0) || g.winner == null || g.winner < 0) continue;
    let G = newRecord(rules, { seats: 2, seed: g.seed, now: 0 }), last = -1;
    const rows = [];
    for (let i = 0; i < g.moves.length; i++) {
      const s = G.state;
      if (s.turn !== last && !s.pending && !s.over && s.turn > 0) { last = s.turn; rows.push(JSON.parse(JSON.stringify(s))); }
      Math.random = seeded(mix(g.seed, i + 1)); const r = applyMove(rules, G, g.moves[i][0], g.moves[i][1], 0); Math.random = real;
      if (r.error) break;
      G = r.G;
    }
    rows.forEach((s, k) => {
      const ph = Math.min(2, Math.floor(3 * k / rows.length));
      for (const me of [0, 1]) { const y = g.winner === me ? 1 : 0; for (const [n, j] of judges) { const p = j(rules.restore(JSON.parse(JSON.stringify(s))), me); add(tot[n].all, p, y); add(tot[n].ph[ph], p, y); } }
    });
    games++;
  }
}
const f = a => `log loss ${(a[0] / a[3]).toFixed(4)}  Brier ${(a[1] / a[3]).toFixed(4)}  favourite won ${(100 * a[2] / a[3]).toFixed(1)}%  (${a[3]} positions)`;
console.log(`${games} held-out games of ${ids}; every turn's start, both seats, face up; a coin: log loss 0.6931, Brier 0.25`);
for (const n of names) { console.log(`${n.padEnd(8)} ${f(tot[n].all)}`); ["early", "middle", "late"].forEach((p, i) => console.log(`   ${p.padEnd(7)} ${f(tot[n].ph[i])}`)); }
