// A trained value net from a lab job's results into judges/<name>.json (13 Nov 2026: S5 into the game lab as the benchmark's
// net): the line of the given variant (else the first) of a lab/judge-variants.mjs job, as dandan-eval.js reads it. Then
// lab/keep-table.mjs adds its redraw table. Read-only on the bucket.
// usage: node lab/judge-from-job.mjs <job> <variant or -> <name> [note]
import fs from "node:fs";
import { readParts } from "./lib.mjs";

const [job, variant, name, note = ""] = process.argv.slice(2);
const lines = (await readParts(job)).flatMap(x => x.split("\n").filter(Boolean)).map(l => JSON.parse(l)).filter(l => l.layers);
const line = variant && variant !== "-" ? lines.find(l => l.variant === Number(variant)) : lines[0];
if (!line) throw new Error(`${job}: no line${variant ? " of variant " + variant : ""}`);
const out = { source: `lab job ${job}${variant && variant !== "-" ? " variant " + variant : ""}`, note, metrics: line.metrics, layers: line.layers };
fs.writeFileSync(new URL(`../judges/${name}.json`, import.meta.url), JSON.stringify(out));
console.log(JSON.stringify({ job, variant: line.variant, name, epoch: line.epoch, metrics: line.metrics }));
