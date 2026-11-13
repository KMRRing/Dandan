// Queue by commit (13 Nov 2026, Fable: queueing no longer depends on a chat's connection): every job spec in lab/queue/
// (<id>.json, its "id" the same) is copied to jobs/<id>.json in the bucket if no job or retired job of that id exists yet.
// Create-only: never overwrites, never deletes. A spec without a full 40-character ref gets the commit being pushed.
// lab/filler.json (the filler's spec the workers read at each refill) and lab/fleet-sources.json (the pools the Fleet page's
// cards show) are copied over their old selves in fleet/.
// usage (queue.yml): LAB_KEY=<writer key file> LAB_BUCKET=… node lab/queue-push.mjs <commit sha>
import fs from "node:fs";
import path from "node:path";
import { labStore } from "./lib.mjs";
import { editOpen } from "./open-list.mjs";

const sha = process.argv[2], dir = new URL("./queue/", import.meta.url), store = await labStore();
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
let queued = 0; const added = [];
for (const f of files) {
  const id = path.basename(f, ".json"), spec = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
  if (spec.id !== id) { console.log(`${f}: its id is ${spec.id}, skipped`); continue; }
  if (!/^[0-9a-f]{40}$/.test(spec.ref || "")) spec.ref = sha;
  spec.repo ||= "https://github.com/KMRRing/Dandan.git";
  spec.made ||= new Date().toISOString().slice(0, 10);
  if ((await store.get(`jobs/${id}.json`)) || (await store.get(`retired/${id}.json`))) { console.log(`${id}: already in the bucket, left`); continue; }
  const ok = await store.create(`jobs/${id}.json`, JSON.stringify(spec));
  console.log(ok ? `${id}: queued (${spec.shards} shards, ref ${spec.ref.slice(0, 7)})` : `${id}: written meanwhile by someone else, left`);
  if (ok) { queued++; added.push(id); }
}
// the workers' open list (fleet/open.json): new jobs go on it, or idle machines would find them only at their next full look
if (added.length) console.log((await editOpen(store, jobs => { for (const id of added) jobs[id] = 1; return true; }, { by: "queue-push" })) ? `open list: ${added.join(", ")} added` : "open list: not written (the workers' next full look finds them)");
console.log(`${queued} queued of ${files.length} in lab/queue/`);
// lab/queue/retire.txt (17:25Z, Fable's three-look rule: a match whose look has decided is retired, the rest never played):
// one job id a line; its spec moves from jobs/ to retired/ (kept, as lab/ledger.mjs lists retired jobs), and it leaves the
// open list. Shards already running finish; nobody takes another.
const retireFile = new URL("./queue/retire.txt", import.meta.url);
if (fs.existsSync(retireFile)) {
  const gone = [];
  for (const id of fs.readFileSync(retireFile, "utf8").split("\n").map(l => l.replace(/#.*/, "").trim()).filter(Boolean)) {
    const spec = await store.get(`jobs/${id}.json`);
    if (!spec) continue;
    await store.put(`retired/${id}.json`, spec); await store.del(`jobs/${id}.json`); gone.push(id);
    console.log(`${id}: retired`);
  }
  if (gone.length) await editOpen(store, jobs => { for (const id of gone) delete jobs[id]; return true; }, { by: "queue-push" });
}
// the fleet's own files, copied over their old selves: the filler's spec, and the sources the Fleet page's cards read (13 Nov)
for (const [local, remote] of [["./filler.json", "fleet/filler.json"], ["./fleet-sources.json", "fleet/sources.json"]]) {
  const f = new URL(local, import.meta.url);
  if (!fs.existsSync(f)) continue;
  const text = JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8")));
  if ((await store.get(remote)) !== text) { await store.put(remote, text); console.log(`${remote} updated from lab/${local.slice(2)}`); }
  else console.log(`${remote} unchanged`);
}
