// Plan item 7 (12 November 2026): machines started before the stage-0 patch still queue jt<n> value-net trainings after their
// spb batches, and none can finish any more (11 of them ran 2.5 hours on average and wrote nothing). An old worker writes a jt
// spec only if none is there, so this puts an empty one (no shards: every worker counts it finished at once) at each jt<n> in
// the range that has no done-0, overwriting the stuck ones and filling the numbers not yet used.
// usage (a lab job, one shard): node lab/noop-jt.mjs <shard> <shards> <out> <first n> <last n>
import { googleToken } from "./lib.mjs";

const [first, last] = [Number(process.argv[5]), Number(process.argv[6])];
const bucket = process.env.LAB_BUCKET, api = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`, up = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o`;
const auth = async () => ({ authorization: "Bearer " + (await googleToken()) });
let wrote = 0, kept = 0;
for (let n = first; n <= last; n++) {
  const done = await fetch(`${api}/${encodeURIComponent(`results/jt${n}/done-0`)}`, { headers: await auth() });
  if (done.ok) { kept++; continue; }
  const spec = { id: `jt${n}`, script: "judge-train.mjs", args: "", shards: 0, timeoutMin: 1, made: "2026-11-12",
    purpose: "no-op (plan item 7): the old filler machines queue jt trainings that can no longer finish; this empty spec stands in so they skip it" };
  const r = await fetch(`${up}?uploadType=media&name=${encodeURIComponent(`jobs/jt${n}.json`)}`, { method: "POST", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(spec) });
  if (!r.ok) throw new Error(`jt${n}: ${r.status} ${await r.text()}`);
  wrote++;
}
console.log(JSON.stringify({ first, last, wrote, kept }));
