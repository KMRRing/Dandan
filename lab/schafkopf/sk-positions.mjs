// The father's probe on M1's own games (Korbi 27 Nov 2026: "do it played by M1"): every lead position in the given games where
// the engine broke rule A or B (sk-probe.js), that is, led a card the rule forbids, as a list for sk-dad.mjs from=<file>, which
// finishes each twice from the true hands (M1's lead, and the rule's pick). Read-only on the games.
// usage: node lab/schafkopf/sk-positions.mjs <folder of part-*.jsonl (sk-fetch.mjs)> <out.jsonl> <A|B|AB> [max per rule]
//   One line per position: { seed, rule, log: the actions before it, lead: the engine's (sk-view.js actions) }. Over `max`, a rule's
//   positions are thinned evenly in deal order, so the list is the same on every run.
import fs from "node:fs";
import path from "node:path";
import { schafkopf as G } from "./sk-rules.js";
import { probeFilter } from "./sk-probe.js";
import { actionOf } from "./sk-view.js";
import { seeded, mix } from "../../seats.js";

const [dir, out, rules = "AB", maxArg] = process.argv.slice(2), MAX = Number(maxArg) || Infinity;
const games = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort()) for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) if (l.startsWith("{")) {
  const x = JSON.parse(l), log = x.log || x.ref?.log;   // a self-play game, or a match line's four-engine reference table
  if (log) games.push({ seed: x.seed, log });
}
games.sort((a, b) => a.seed - b.seed);
const found = { A: [], B: [] }, k = m => JSON.stringify(m);
let bad = 0;
for (const g of games) {
  const s = G.deal({ rng: seeded(g.seed) }), acts = [];
  try {
    for (const [w, m] of g.log) {
      if (G.toMove(s) !== w) throw new Error("out of turn");
      for (const r of ["A", "B"]) if (rules.includes(r)) {
        const keep = probeFilter(s, w, G.options(s, w), r);
        if (keep && !keep.some(o => k(o) === k(m))) found[r].push({ seed: g.seed, rule: r, log: acts.slice(), lead: actionOf(m) });
      }
      acts.push(actionOf(m));
      if (typeof G.act(s, w, m, seeded(mix(g.seed, 0x51))) === "string") throw new Error("refused");
    }
  } catch { bad++; }
}
const thin = xs => (xs.length <= MAX ? xs : Array.from({ length: MAX }, (_, i) => xs[Math.floor(i * xs.length / MAX)]));
const list = [...thin(found.A), ...thin(found.B)];
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, list.map(x => JSON.stringify(x)).join("\n") + "\n");
console.log(`sk-positions: ${games.length} games${bad ? ` (${bad} didn't replay)` : ""}; M1 broke rule A at ${found.A.length}, rule B at ${found.B.length}; written ${list.length} (${out})`);
