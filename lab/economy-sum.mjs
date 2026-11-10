// lab/economy.mjs summed: for each budget, agreement with the 256-deal reference, the value lost per decision and in the
// worst ones, and its deals as a share of the reference's. usage: node lab/economy-sum.mjs <job id>
import { readParts } from "./lib.mjs";
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
const ref = rows.reduce((a, r) => a + r.refWork, 0);
for (const b of Object.keys(rows[0]?.by ?? {})) {
  const xs = rows.map(r => r.by[b]), lost = xs.map(x => x.lost).filter(Number.isFinite);
  console.log(JSON.stringify({
    deals: Number(b), decisions: xs.length, same: +(xs.filter(x => x.same).length / xs.length).toFixed(4),
    lostPerDecision: +(lost.reduce((a, x) => a + x, 0) / xs.length).toFixed(5), over2points: lost.filter(x => x > 0.02).length, over5points: lost.filter(x => x > 0.05).length,
    workShare: +(xs.reduce((a, x) => a + x.work, 0) / ref).toFixed(3),
  }));
}
