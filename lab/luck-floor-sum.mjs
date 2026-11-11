// lab/luck-floor.mjs summed: the luck floor and, for each value net, its Brier score split into the floor and its own error.
// With n play-outs a position, p̂ (the share won) is p plus noise of variance p(1 − p)/n, so both parts are corrected for it:
//   floor = mean p̂(1 − p̂) · n/(n − 1),   own error = mean (prediction − p̂)² − mean p̂(1 − p̂)/(n − 1)
// and floor + own error should come out close to the Brier score against the actual results (a check on the whole method).
// usage: node lab/luck-floor-sum.mjs <job id or results file>…
import fs from "node:fs";
import { readParts } from "./lib.mjs";

const rows = [];
for (const a of process.argv.slice(2)) {
  const texts = fs.existsSync(a) ? [fs.readFileSync(a, "utf8")] : await readParts(a);
  for (const t of texts) for (const l of t.split("\n")) if (l.trim()) rows.push(JSON.parse(l));
}
if (!rows.length) { console.log("no positions yet"); process.exit(0); }
const mean = f => rows.reduce((s, r) => s + f(r), 0) / rows.length;
const p = r => r.wins / r.n, varOf = r => (p(r) * (1 - p(r))) / (r.n - 1);
const se = f => { const m = mean(f); return Math.sqrt(rows.reduce((s, r) => s + (f(r) - m) ** 2, 0) / rows.length / (rows.length - 1)); };
const floorOf = r => p(r) * (1 - p(r)) * (r.n / (r.n - 1));
const out = { positions: rows.length, games: new Set(rows.map(r => r.game)).size, playOuts: rows[0].n, floor: +mean(floorOf).toFixed(4), floorSE: +se(floorOf).toFixed(4),
  brierOfTruth: +mean(r => (p(r) - r.won) ** 2).toFixed(4), nets: {} };
for (const name of Object.keys(rows[0].preds)) {
  const own = r => (r.preds[name] - p(r)) ** 2 - varOf(r), brier = r => (r.preds[name] - r.won) ** 2;
  out.nets[name] = { brier: +mean(brier).toFixed(4), ownError: +mean(own).toFixed(4), ownErrorSE: +se(own).toFixed(4), floorPlusOwn: +(mean(floorOf) + mean(own)).toFixed(4) };
}
console.log(JSON.stringify(out, null, 1));
