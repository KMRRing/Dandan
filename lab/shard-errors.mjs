// A job's failed shards (23 Nov 2026): each done mark whose code isn't 0, with the tail of its stdout. Read-only.
// usage: node lab/shard-errors.mjs <job id> [most 5]
const [id, most = "5"] = process.argv.slice(2), store = await (await import("./lib.mjs")).labStore();
const done = (await store.list(`results/${id}/`)).filter(o => /\/done-\d+$/.test(o.name || o));
let n = 0;
for (const o of done) {
  const name = o.name || o, d = JSON.parse((await store.get(name)) || "{}");
  if (d.code === 0) continue;
  const k = name.split("-").pop(), out = (await store.get(`results/${id}/stdout-${k}.txt`).catch(() => "")) || "";
  console.log(`shard ${k}: ${JSON.stringify(d)}\n  ${out.split("\n").slice(-8).join("\n  ")}`);
  if (++n >= Number(most)) break;
}
console.log(`${n} failed shown of ${done.length} done marks`);
