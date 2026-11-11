// The sha256 of each line of a lab job's results (a check that a copy made by hand is exact). usage: node lab/part-sha.mjs <job>
import crypto from "node:crypto";
import { readParts } from "./lib.mjs";
for (const l of (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean))) {
  const j = JSON.parse(l), layers = JSON.stringify({ layers: j.layers });
  console.log(j.variant, crypto.createHash("sha256").update(layers).digest("hex"));
}
