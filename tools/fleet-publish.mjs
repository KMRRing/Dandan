// fleet.yml's writes after each snapshot (13 Nov 2026): fleet/summary.json for the director's dashboard, and the jobs the
// summary found with a free or lapsed shard added to fleet/open.json (only added, never taken out: the workers take out).
// usage: LAB_KEY=<writer key> LAB_BUCKET=… node tools/fleet-publish.mjs <summary.json>
import fs from "node:fs";
import { labStore } from "../lab/lib.mjs";
import { editOpen } from "../lab/open-list.mjs";

const text = fs.readFileSync(process.argv[2], "utf8"), summary = JSON.parse(text), store = await labStore();
await store.put("fleet/summary.json", text);
const open = summary.open || [];
const wrote = await editOpen(store, jobs => { let changed = false; for (const id of open) if (!jobs[id]) { jobs[id] = 1; changed = true; } return changed; }, { by: "fleet.yml" });
console.log(`summary written; open list: ${open.length} jobs with free or lapsed shards${wrote ? ", missing ones added" : ", all already listed"}`);
