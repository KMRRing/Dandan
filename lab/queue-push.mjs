// Queue by commit (13 Nov 2026, Fable: queueing no longer depends on a chat's connection): every job spec in lab/queue/
// (<id>.json, its "id" the same) is copied to jobs/<id>.json in the bucket if no job or retired job of that id exists yet.
// Create-only: never overwrites, never deletes. A spec without a full 40-character ref gets the commit being pushed.
// lab/filler.json, the filler's spec the workers read at each refill, is the one file copied over its old self (fleet/filler.json).
// usage (queue.yml): LAB_KEY=<writer key file> LAB_BUCKET=… node lab/queue-push.mjs <commit sha>
import fs from "node:fs";
import path from "node:path";
import { labStore } from "./lib.mjs";

const sha = process.argv[2], dir = new URL("./queue/", import.meta.url), store = await labStore();
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
let queued = 0;
for (const f of files) {
  const id = path.basename(f, ".json"), spec = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
  if (spec.id !== id) { console.log(`${f}: its id is ${spec.id}, skipped`); continue; }
  if (!/^[0-9a-f]{40}$/.test(spec.ref || "")) spec.ref = sha;
  spec.repo ||= "https://github.com/KMRRing/Dandan.git";
  spec.made ||= new Date().toISOString().slice(0, 10);
  if ((await store.get(`jobs/${id}.json`)) || (await store.get(`retired/${id}.json`))) { console.log(`${id}: already in the bucket, left`); continue; }
  const ok = await store.create(`jobs/${id}.json`, JSON.stringify(spec));
  console.log(ok ? `${id}: queued (${spec.shards} shards, ref ${spec.ref.slice(0, 7)})` : `${id}: written meanwhile by someone else, left`);
  if (ok) queued++;
}
console.log(`${queued} queued of ${files.length} in lab/queue/`);
const filler = new URL("./filler.json", import.meta.url);
if (fs.existsSync(filler)) {
  const text = JSON.stringify(JSON.parse(fs.readFileSync(filler, "utf8")));
  if ((await store.get("fleet/filler.json")) !== text) { await store.put("fleet/filler.json", text); console.log("fleet/filler.json updated from lab/filler.json"); }
  else console.log("fleet/filler.json unchanged");
}
