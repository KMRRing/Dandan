// lab/judge-variants.mjs's screen, best first: each variant's Brier score against the result on held-out games (all, slow,
// late) and its held cards worth less than nothing, against today's judge on the same positions. usage: node lab/judge-variants-sum.mjs <job id>
import { readParts } from "./lib.mjs";
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean)).map(l => JSON.parse(l));
const today = rows[0]?.today;
console.log(JSON.stringify({ variants: rows.length, today }));
for (const r of rows.sort((a, b) => a.metrics.all - b.metrics.all))
  console.log(JSON.stringify({ variant: r.variant, spec: r.spec, epoch: r.epoch, ...r.metrics, gainAll: +(today.all - r.metrics.all).toFixed(4), gainSlow: +(today.slow - r.metrics.slow).toFixed(4) }));
