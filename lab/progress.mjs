// How far lab jobs have got: "<id> <done>/<shards>" for each job whose id starts with one of the prefixes given.
// usage: node lab/progress.mjs <prefix…> [--args] (--args: each job's arguments and code version too)
import { labStore } from "./lib.mjs";
const store = await labStore(), wide = process.argv.includes("--args"), pre = process.argv.slice(2).filter(a => a !== "--args");
for (const name of await store.list("jobs/")) {
  const id = name.slice(5, -5);
  if (!pre.some(p => id.startsWith(p))) continue;
  const spec = JSON.parse(await store.get(name)), done = (await store.list(`results/${id}/`)).filter(n => /\/done-\d+$/.test(n)).length;
  console.log(`${id} ${done}/${spec.shards}${wide ? `  ${spec.args}  ${String(spec.ref).slice(0, 7)}` : ""}`);
}
