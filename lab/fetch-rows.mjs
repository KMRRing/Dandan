// The position cache's rows for a training, fetched into one folder for lab/train_np.py (13 Nov 2026): each batch's file as
// cache/rows/<batch>/<key> holds it, named by the batch, and batches.txt listing them in the training's order (ranges such as
// spb01-446 expanded as judge-variants.mjs does; a slice job/0-199 saved as job~0-199), and consts.json (the input counts from dandan-eval.js).
// usage: node lab/fetch-rows.mjs <folder> <batches, comma-separated> <key, e.g. m116-p32-v1>
import fs from "node:fs";
import path from "node:path";
import { labStore } from "./lib.mjs";
import { FEATURES, PLUS, RACE } from "../dandan-eval.js";

const [dir, ids, key] = process.argv.slice(2);
const expand = t => { const m = t.match(/^([a-z]+)(\d+)-(\d+)$/); if (!m) return [t]; const out = []; for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(m[1] + String(n).padStart(m[2].length, "0")); return out; };
const batches = ids.split(",").flatMap(expand), store = await labStore();
fs.mkdirSync(dir, { recursive: true });
let got = 0, missing = [];
for (let i = 0; i < batches.length; i += 16) await Promise.all(batches.slice(i, i + 16).map(async b => {
  const t = await store.get(`cache/rows/${b}/${key}`);
  if (t) { fs.writeFileSync(path.join(dir, b.replaceAll("/", "~")), t); got++; } else missing.push(b);
}));
fs.writeFileSync(path.join(dir, "batches.txt"), batches.join(","));
fs.writeFileSync(path.join(dir, "consts.json"), JSON.stringify({ N: FEATURES.length, PLUS, RACE }));
console.log(JSON.stringify({ batches: batches.length, got, missing: missing.length, firstMissing: missing.slice(0, 5) }));
