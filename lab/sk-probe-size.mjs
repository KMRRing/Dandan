// The father's probe, sized before it is queued (Fable 27 Nov 2026 09:15Z): the reference tables of a match batch replayed,
// counting the lead positions where rule A or B (lab/schafkopf/sk-probe.js) removes an option, and those where the engine
// actually led a card the rule forbids: only those deals can play differently under the rule. Read-only.
// usage: node lab/sk-probe-size.mjs <batch[+re-run]> [--dir <local folder of part-*.jsonl, for a test>]
import fs from "node:fs";
import { schafkopf as G } from "./schafkopf/sk-rules.js";
import { probeFilter } from "./schafkopf/sk-probe.js";
import { seeded, mix } from "../seats.js";

const args = process.argv.slice(2), at = args.indexOf("--dir"), dir = at >= 0 ? args.splice(at, 2)[1] : null;
const by = new Map(), read = t => { for (const l of t.split("\n")) if (l.startsWith("{")) { const x = JSON.parse(l); if (x.ref) by.set(x.seed, x); } };
if (dir) for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".jsonl"))) read(fs.readFileSync(`${dir}/${f}`, "utf8"));
else {
  const { labStore } = await import("./lib.mjs"), store = await labStore();
  for (const id of args[0].split("+")) for (const n of (await store.list(`results/${id}/`)).filter(n => /part-\d+\.jsonl$/.test(n))) { try { read((await store.get(n)) || ""); } catch { /* a part being written */ } }
}
const k = m => JSON.stringify(m), c = { A: { pos: 0, deals: 0, broke: 0, brokeDeals: 0 }, B: { pos: 0, deals: 0, broke: 0, brokeDeals: 0 } };
let n = 0, bad = 0;
for (const x of by.values()) {
  const s = G.deal({ rng: seeded(x.seed) }), hit = { A: 0, B: 0 }, br = { A: 0, B: 0 };
  try {
    for (const [w, m] of x.ref.log) {
      if (G.toMove(s) === w) for (const r of ["A", "B"]) {
        const keep = probeFilter(s, w, G.options(s, w), r);
        if (keep) { c[r].pos++; hit[r] = 1; if (!keep.some(o => k(o) === k(m))) { c[r].broke++; br[r] = 1; } }
      }
      G.act(s, w, m, seeded(mix(x.seed, 0x51)));
    }
  } catch { bad++; continue; }
  n++;
  for (const r of ["A", "B"]) { c[r].deals += hit[r]; c[r].brokeDeals += br[r]; }
}
const p = v => (100 * v / Math.max(1, n)).toFixed(2);
console.log(`sk-probe-size: ${n} reference tables${bad ? ` (${bad} didn't replay)` : ""}`);
for (const r of ["A", "B"]) console.log(`  rule ${r}: fires at ${c[r].pos} lead positions (${p(c[r].pos)} per 100 deals, on ${p(c[r].deals)}% of deals); the engine led a forbidden card at ${c[r].broke} (${p(c[r].broke)} per 100 deals, on ${p(c[r].brokeDeals)}% of deals)`);
