// The B2 store tried from a lab machine before the switch (17 Nov 2026, Korbi 17:33: "test the transfer with a vm … as long as
// you run into issues with b2 don't switch"). Run on a Rackspace machine by .github/workflows/store-vm-test.yml with the keys in
// the environment (never printed): everything under _check/vm-<time>/ on B2, removed after; the read-only fallback to Google
// (lab/store.mjs routedStore) on an old batch's results. Prints timings and ok/FAIL lines; exit 1 on any FAIL.
import { s3Store, googleStore, routedStore, REQ } from "./store.mjs";
import { googleToken } from "./lib.mjs";

const env = process.env;
for (const k of ["LAB_BUCKET", "LAB_KEY", "LAB_B2_KEY_ID", "LAB_B2_KEY", "LAB_B2_ENDPOINT"]) if (!env[k]) throw new Error(`${k} is not set`);
const b2 = s3Store({ endpoint: env.LAB_B2_ENDPOINT, bucket: env.LAB_B2_BUCKET || "ML-queue", keyId: env.LAB_B2_KEY_ID, key: env.LAB_B2_KEY });
const g = googleStore(env.LAB_BUCKET, googleToken), s = routedStore(g, b2), base = `_check/vm-${Date.now()}`;
let fails = 0;
const ok = (what, v) => { console.log(`${v ? "ok  " : "FAIL"} ${what}`); if (!v) fails++; };
const time = async (what, f) => { const t0 = Date.now(); const r = await f(); console.log(`     ${what}: ${Date.now() - t0} ms`); return r; };

// 1. the basics, one at a time
await time("50 writes then 50 reads, one at a time", async () => {
  let good = 0;
  for (let i = 0; i < 50; i++) await s.put(`${base}/seq/${i}`, `v${i}`);
  for (let i = 0; i < 50; i++) if ((await s.get(`${base}/seq/${i}`)) === `v${i}`) good++;
  ok(`one at a time: ${good} of 50 read back`, good === 50);
});
// 2. a worker's load: many at once (a part a shard, claims, done marks)
await time("400 writes at once, 64 in flight", async () => {
  const names = Array.from({ length: 400 }, (_, i) => `${base}/par/part-${i}.jsonl`);
  for (let i = 0; i < names.length; i += 64) await Promise.all(names.slice(i, i + 64).map(n => s.put(n, "x".repeat(2000))));
  const listed = await s.list(`${base}/par/`);
  ok(`400 at once: ${listed.length} listed`, listed.length === 400);
});
// 3. the conditions the queue relies on (advisory on B2)
ok("create only if absent", (await s.create(`${base}/claim`, "a")) !== false && (await s.create(`${base}/claim`, "b")) === false);
const G = await s.getG(`${base}/claim`);
ok("write only if unchanged", (await s.put(`${base}/claim`, "c", { ifGeneration: G.generation })) && !(await s.put(`${base}/claim`, "d", { ifGeneration: G.generation })));
// 4. fleet/ stays on Google
ok("fleet/ routed to Google", (await s.list("fleet/")).length === (await g.list("fleet/")).length);
// 5. the fallback: an old batch's results, on Google only or on both, read and listed through the routed store
for (const id of ["az-g11-c", "zps003"]) {
  const onG = (await g.list(`results/${id}/`)).filter(o => /part-\d+\.jsonl$/.test(o.name)), onB = await b2.list(`results/${id}/`), all = await s.list(`results/${id}/`);
  const one = onG[0]?.name, a = one ? await g.get(one) : null, b = one ? await s.get(one) : null;
  ok(`results/${id}: ${onG.length} parts on Google, ${onB.length} objects on B2, ${all.length} listed through the store; a part read the same`, onG.length > 0 && all.length >= onG.length && a !== null && a === b);
}
// 6. the cleanup
await time("cleanup", async () => { const names = (await b2.list(`${base}/`)).map(o => o.name); for (let i = 0; i < names.length; i += 64) await Promise.all(names.slice(i, i + 64).map(n => b2.del(n))); ok("cleaned up", (await b2.list(`${base}/`)).length === 0); });
console.log(`requests: ${REQ.list} lists, ${REQ.write} writes, ${REQ.read} reads`);
console.log(fails ? `STORE-VM-TEST: ${fails} failed` : "STORE-VM-TEST: passed");
process.exit(fails ? 1 : 0);
