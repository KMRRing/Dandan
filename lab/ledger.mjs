// The lab's ledger (10 November 2026, Korbi: everything run kept and findable, whether it led anywhere or not): every job ever
// queued in the bucket, with why it was run, how it was set, how far it got (shards done, failed) and, where one was written
// into its spec, what came of it, printed as a table. The findings are also written up in lab/LEDGER.md, the lasting record.
// usage: node lab/ledger.mjs          (LAB_BUCKET on a Google machine, or LAB_DIR)
import { labStore } from "./lib.mjs";
const store = await labStore();
const rows = [];
// jobs/ are live (the workers take their shards); retired/ are jobs stopped before their end, kept for the record
for (const name of [...(await store.list("jobs/")), ...(await store.list("retired/"))]) {
  const spec = JSON.parse(await store.get(name)), id = spec.id + (name.startsWith("retired/") ? " (stopped)" : "");
  const res = await store.list(`results/${spec.id}/`), dones = res.filter(n => /\/done-\d+$/.test(n));
  let failed = 0, secs = 0;
  for (const d of dones) { const r = JSON.parse((await store.get(d)) || "{}"); if (r.code !== 0) failed++; secs += r.seconds || 0; }
  const claimed = (await store.list(`claims/${spec.id}/`)).length;
  rows.push({ id, script: spec.script, args: spec.args.replace("{shard} {shards} {out} ", ""), ref: spec.ref, shards: spec.shards, done: dones.length, failed, running: claimed - dones.length, cpuHours: (secs / 3600).toFixed(1), made: spec.made?.at?.slice(0, 16) ?? "", purpose: spec.purpose ?? "", outcome: spec.outcome ?? "" });
}
console.log("| job | script | args | ref | done/shards | failed | running | cpu h | made | purpose | outcome |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.id} | ${r.script} | ${r.args} | ${r.ref} | ${r.done}/${r.shards} | ${r.failed} | ${r.running} | ${r.cpuHours} | ${r.made} | ${r.purpose} | ${r.outcome} |`);
