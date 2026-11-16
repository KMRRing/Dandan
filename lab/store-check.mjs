// The B2 store's two one-off steps (.github/workflows/store-move.yml; lab/store.mjs). The key comes from the environment
// (LAB_B2_KEY_ID, LAB_B2_KEY, LAB_B2_ENDPOINT, LAB_B2_BUCKET) and is never printed.
//   node lab/store-check.mjs            a write, read, list and delete under _check/, then the bucket's objects by top folder
//   node lab/store-check.mjs --config   private/store.json written on the Google bucket (LAB_BUCKET, writer key at LAB_KEY), a path
//                                       nothing lists or copies out: from the workers' next look (10 minutes), everything but
//                                       fleet/ is read and written on B2
import { s3Store, googleStore, REQ, STORE_CONFIG } from "./store.mjs";
import { googleToken } from "./lib.mjs";

const env = process.env;
for (const k of ["LAB_B2_KEY_ID", "LAB_B2_KEY", "LAB_B2_ENDPOINT"]) if (!env[k]) throw new Error(`${k} is not set`);
const cfg = { kind: "s3", endpoint: env.LAB_B2_ENDPOINT, bucket: env.LAB_B2_BUCKET || "ML-queue", keyId: env.LAB_B2_KEY_ID, key: env.LAB_B2_KEY };

if (process.argv.includes("--config")) {
  const g = googleStore(env.LAB_BUCKET, googleToken);
  await g.put(STORE_CONFIG, JSON.stringify(cfg));
  const back = JSON.parse((await g.get(STORE_CONFIG)) || "{}");
  console.log(back.kind === "s3" && back.bucket === cfg.bucket && back.keyId === cfg.keyId ? `${STORE_CONFIG} written: the lab's store is ${cfg.bucket} at ${new URL(cfg.endpoint).host}` : `${STORE_CONFIG} did not read back`);
  process.exit(back.keyId === cfg.keyId ? 0 : 1);
}

const s = s3Store(cfg), name = `_check/${Date.now()}-${Math.random().toString(36).slice(2)}`, t0 = Date.now();
const ok = (what, v) => { console.log(`${v ? "ok  " : "FAIL"} ${what}`); if (!v) process.exitCode = 1; };
ok("write", await s.put(name, "hello B2"));
ok("read back", (await s.get(name)) === "hello B2");
ok("only if absent: refused when there", (await s.create(name, "again")) === false);
const g = await s.getG(name);
ok("only if unchanged: written when unchanged", await s.put(name, "changed", { ifGeneration: g.generation }));
ok("only if unchanged: refused when stale", (await s.put(name, "stale", { ifGeneration: g.generation })) === false);
ok("listed", (await s.list("_check/")).some(o => o.name === name && o.t > 0));
await s.del(name);
ok("deleted", (await s.get(name)) === null);
ok("a missing object reads as none", (await s.get("_check/none")) === null);
console.log(`(${Date.now() - t0} ms, ${REQ.list} lists, ${REQ.write} writes, ${REQ.read} reads)`);
const by = {};
for (const o of await s.list("")) { const k = o.name.split("/")[0]; by[k] = (by[k] || 0) + 1; }
console.log("objects on B2 by top folder:", JSON.stringify(by));
