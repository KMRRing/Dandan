// The father's probe (lab/schafkopf/sk-probe.js, Fable 27 Nov 2026 09:15Z): rule A removes exactly a Solo or Wenz defender's
// trumps when the declarer plays last, rule B exactly the Sauspiel declarer's called-suit cards while the called ace is out,
// neither ever removes every option or fires anywhere else, and the search at the root then picks only among what is left.
import { schafkopf as G } from "../lab/schafkopf/sk-rules.js";
import { probeFilter } from "../lab/schafkopf/sk-probe.js";
import { bareThink } from "../lab/schafkopf/sk-monte.js";
import { suitOf, rankOf, cid } from "../lab/schafkopf/codex/trumps-cards.js";
import { aceFell } from "../lab/schafkopf/sk-leads.js";
import { seeded, mix } from "../seats.js";

const trump = (c, id) => (c.type === "wenz" ? rankOf(id) === "J" : rankOf(id) === "Q" || rankOf(id) === "J" || suitOf(id) === c.trump);
let fail = 0, seen = { A: 0, B: 0 }, searched = 0;
const bad = (msg) => { fail++; if (fail < 6) console.error("schafkopf-probe:", msg); };
for (let d = 0; d < 1500 && fail < 6; d++) {
  const rng = seeded(mix(77, d)), s = G.deal({ rng });
  while (!G.over(s)) {
    const w = G.toMove(s), ops = G.options(s, w), c = s.contract;
    for (const r of ["A", "B"]) {
      const keep = probeFilter(s, w, ops, r);
      const lead = s.step === "play" && c && !s.trick.length && ops.length > 1;
      const isA = lead && r === "A" && (c.type === "solo" || c.type === "wenz") && w !== c.declarer && (w + 3) % 4 === c.declarer;
      const isB = lead && r === "B" && c.type === "sau" && w === c.declarer && !aceFell(s, cid(c.ace, "A"));
      const out = isA ? ops.filter(m => trump(c, m.card)) : isB ? ops.filter(m => suitOf(m.card) === c.ace && !trump(c, m.card)) : [];
      const want = out.length && out.length < ops.length ? ops.filter(m => !out.includes(m)) : null;
      if (JSON.stringify(keep) !== JSON.stringify(want)) bad(`deal ${d}, rule ${r}: kept ${JSON.stringify(keep?.map(m => m.card))}, expected ${JSON.stringify(want?.map(m => m.card))}`);
      if (keep) {
        seen[r]++;
        if (keep.length > 1 && searched < 3) { searched++; const b = bareThink(s, w, { deals: 4, rootOptions: keep }).best; if (!keep.includes(b)) bad(`deal ${d}: the search picked a removed card`); }
      }
    }
    // random bids always end in a Solo: every other deal bids the first Sauspiel it can, so both rules meet their positions
    const pick = s.step === "bid" && d % 2 ? ops.find(m => m.type === "sau") || ops[0] : ops[Math.floor(rng() * ops.length)];
    G.act(s, w, pick, rng);
  }
}
if (!seen.A || !seen.B) bad(`too few positions: A ${seen.A}, B ${seen.B}`);
if (fail) process.exit(1);
console.log(`schafkopf-probe: rules A (${seen.A} positions) and B (${seen.B}) remove exactly the father's cards; the search keeps to the rest`);
