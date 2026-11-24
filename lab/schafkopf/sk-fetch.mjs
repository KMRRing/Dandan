// A job's result files from the lab store into a folder, for packing (sk-pack.mjs). Read-only.
// usage: node lab/schafkopf/sk-fetch.mjs <dir> <job id>[,<job id>...]
import fs from "node:fs";
import path from "node:path";
import { labStore } from "../lib.mjs";

const [dir, ids] = process.argv.slice(2), store = await labStore();
fs.mkdirSync(dir, { recursive: true });
for (const id of ids.split(",")) {
  const names = (await store.list(`results/${id}/`)).filter(n => /part-\d+\.jsonl$/.test(n));
  let n = 0;
  for (let i = 0; i < names.length; i += 32) await Promise.all(names.slice(i, i + 32).map(async k => {
    const t = await store.get(k).catch(() => null);
    if (t) { fs.writeFileSync(path.join(dir, `${id}-${path.basename(k)}`), t); n++; }
  }));
  console.log(`sk-fetch: ${id}: ${n} of ${names.length} parts`);
}
