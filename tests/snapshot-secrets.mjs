// Standing test (16 Nov 2026, Fable): the Fleet status snapshot (tools/fleet-snapshot.mjs), which goes to the public fleet-status
// branch, never holds a key. A folder lab is given the B2 key where it belongs (private/store.json), where it was first meant to
// go (fleet/store.json), in a fleet file the page doesn't read and in a worker's report; the snapshot runs on it, and no file it
// writes may hold the key, a key field or the store config, while the files the page needs are there. And (Fable, 19:17Z) worker
// reports and job output reach the branch too, and workflow logs are public: no lab script, tool or workflow prints its
// environment or the store config (a scan of their code).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snap-")), lab = path.join(tmp, "lab"), out = path.join(tmp, "out"), cache = path.join(tmp, "cache");
const SECRET = "K005fakeSecretValue1234567890abcdef", cfg = JSON.stringify({ kind: "s3", endpoint: "https://s3.us-east-005.backblazeb2.com", bucket: "ML-queue", keyId: "005fakekeyid", key: SECRET });
const put = (n, t) => { fs.mkdirSync(path.dirname(path.join(lab, n)), { recursive: true }); fs.writeFileSync(path.join(lab, n), t); };
put("private/store.json", cfg);
put("fleet/store.json", cfg);
put("fleet/other.json", JSON.stringify({ note: "not one the page reads", key: SECRET, applicationKey: SECRET, secret: SECRET }));
put("fleet/sources.json", JSON.stringify({ at: "now", rackspace: { pools: [] } }));
put("fleet/open.json", JSON.stringify({ t: Date.now(), jobs: { j1: 1 } }));
put("jobs/j1.json", JSON.stringify({ id: "j1", script: "hard-match.mjs", shards: 1, args: "" }));
put("results/j1/done-0", JSON.stringify({ code: 0 }));
put("results/j1/part-0.jsonl", JSON.stringify({ pair: 0, a: 1, key: "1793609040271" }) + "\n");
put(`workers/w1.json`, JSON.stringify({ by: "w1", t: Date.now(), busy: [], cfg: JSON.parse(cfg) }));
fs.mkdirSync(out, { recursive: true });
execFileSync(process.execPath, [new URL("../tools/fleet-snapshot.mjs", import.meta.url).pathname, out, cache], { env: { ...process.env, LAB_DIR: lab, LAB_B2_KEY_ID: "", LAB_KEY: "" }, stdio: ["ignore", "pipe", "inherit"] });
const walk = d => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
// the director's summary is made from the snapshot (tools/fleet-summary.mjs, as fleet.yml runs it) and goes to the bucket and the branch
fs.writeFileSync(path.join(tmp, "k8s.json"), "[]");
fs.writeFileSync(path.join(out, "summary.json"), execFileSync(process.execPath, [new URL("../tools/fleet-summary.mjs", import.meta.url).pathname, out, path.join(tmp, "k8s.json")], { encoding: "utf8" }));
const files = [...walk(out), ...walk(cache)], text = files.map(f => fs.readFileSync(f, "utf8")).join("\n"), rel = f => path.relative(out, f);
check(!text.includes(SECRET) && !text.includes("005fakekeyid"), `the key appears in none of the ${files.length} files the snapshot wrote`);
check(!/"(keyId|applicationKey|secret|secretAccessKey)"\s*:|"kind"\s*:\s*"s3"/.test(text), "nor a key field (keyId, applicationKey, secret) or the store config, the summary included");
check(files.some(f => rel(f) === "summary.json"), "the summary was made");
check(!files.some(f => /private|store\.json|other\.json/.test(f)), "private/store.json, fleet/store.json and an unlisted fleet file are not copied");
check(files.some(f => rel(f) === "o/fleet/sources.json") && files.some(f => rel(f) === "o/jobs/j1.json") && files.some(f => /parts\.jsonl$/.test(f)), "the files the page reads are there (fleet/sources.json, the job, a match's parts)");
check(!files.some(f => rel(f) === "o/workers/w1.json"), "a worker report naming the store config is left out");
fs.rmSync(tmp, { recursive: true, force: true });

const code = [], walkCode = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walkCode(f); else if (/\.(mjs|js|yml|sh|py)$/.test(f)) code.push(f); } };
for (const d of ["lab", "tools", ".github/workflows"]) walkCode(new URL(`../${d}`, import.meta.url).pathname);
const PRINTS = [
  /console\.(log|error|warn)\([^;]*\bprocess\.env\b(?![.[])/,   // the whole environment
  /JSON\.stringify\(\s*(process\.)?env\s*[,)]/, /\bprintenv\b/, /^\s*env\s*$/m, /\benv\s*\|/, /print\(\s*os\.environ\s*\)/,
  /\blog\([^;]*\b(storeCfg\b|cfg\.key(?![A-Za-z]))/,               // the store config or its key
];
const found = code.flatMap(f => PRINTS.filter(re => re.test(fs.readFileSync(f, "utf8"))).map(re => `${path.basename(f)} (${re.source.slice(0, 30)})`));
check(code.length > 100 && !found.length, `no script, tool or workflow prints its environment or the store config (${code.length} files${found.length ? ": " + found.join(", ") : ""})`);
if (fails) process.exit(1);
