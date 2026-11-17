// The lab's store (lab/store.mjs, 16 Nov 2026, the move to B2): the S3 signature against AWS's own published examples (Signature
// V4 for S3: GET Object, GET Bucket, PUT Object), and the routing: fleet/ on the control store, the rest on the data store, the
// data store swapped live when private/store.json changes (lab/worker.mjs followStore). Folders stand in for both stores.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sigV4, folderStore, routedStore, dataStoreOf } from "../lab/store.mjs";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const aws = { host: "examplebucket.s3.amazonaws.com", region: "us-east-1", keyId: "AKIAIOSFODNN7EXAMPLE", key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z") };
const sig = o => sigV4({ ...aws, ...o }).authorization.split("Signature=")[1];
check(sig({ method: "GET", path: "/test.txt", headers: { range: "bytes=0-9" } }) === "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41", "SigV4: AWS's GET Object example");
check(sig({ method: "GET", path: "/", query: { "max-keys": "2", prefix: "J" } }) === "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7", "SigV4: AWS's GET Bucket (list) example");
check(sig({ method: "PUT", path: "/test$file.text", body: "Welcome to Amazon S3.", headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" } }) === "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd", "SigV4: AWS's PUT Object example");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "store-")), ctl = folderStore(path.join(tmp, "google")), b2 = folderStore(path.join(tmp, "b2"));
const s = routedStore(ctl, null);
await s.put("fleet/open.json", "{}"); await s.put("claims/j/0", "a");
check(fs.existsSync(path.join(tmp, "google/claims/j/0")) && s.kind === "folder", "without private/store.json everything is on the control store");
s.set(b2);
await s.put("claims/j/1", "b"); await s.put("fleet/filler.json", "{}");
check(fs.existsSync(path.join(tmp, "b2/claims/j/1")) && fs.existsSync(path.join(tmp, "google/fleet/filler.json")) && !fs.existsSync(path.join(tmp, "b2/fleet")), "with a data store: fleet/ stays on the control store, the rest goes to the data store");
check((await s.list("claims/")).map(o => o.name).join() === "claims/j/1" && (await s.get("fleet/open.json")) === "{}", "reads follow the same routing (no fallback to the old store)");
// results/ and cache/ from before the move stay on Google, read-only: read and listed from there when B2 doesn't have them
await ctl.put("results/old/part-0.jsonl", "g0"); await ctl.put("results/live/part-0.jsonl", "stale"); await s.put("results/live/part-0.jsonl", "fresh"); await s.put("results/live/part-1.jsonl", "b1");
check((await s.get("results/old/part-0.jsonl")) === "g0" && (await s.get("results/live/part-0.jsonl")) === "fresh", "an old result is read from Google, a copied one from B2");
check((await s.list("results/")).map(o => o.name).sort().join() === "results/live/part-0.jsonl,results/live/part-1.jsonl,results/old/part-0.jsonl", "results/ lists both stores, B2's copy once");
await ctl.put("jobs/gone.json", "{}");
check((await s.get("jobs/gone.json")) === null && !(await s.list("jobs/")).length, "jobs/ (and claims/, workers/, retired/) are B2's alone: nothing removed there comes back");
check(await s.create("claims/j/1", "c") === false && (await s.get("claims/j/1")) === "b", "create is only if absent");
const none = await dataStoreOf({ get: async () => null }, {}), cfg = await dataStoreOf({ get: async () => JSON.stringify({ kind: "s3", endpoint: "https://s3.us-east-005.backblazeb2.com", bucket: "ML-queue", keyId: "k", key: "s" }) }, {});
check(none === null && cfg?.kind === "s3", "private/store.json names the data store (none without it)");
fs.rmSync(tmp, { recursive: true, force: true });
if (fails) process.exit(1);
