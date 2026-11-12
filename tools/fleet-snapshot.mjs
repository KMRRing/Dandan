// The Fleet page's data, copied out of the lab bucket every 10 minutes by .github/workflows/fleet.yml onto the fleet-status
// branch, so the page (lab/fleet.html on GitHub Pages) reads plain files instead of asking Google through a connector with a
// per-minute quota (12 Nov 2026, Korbi: "Google Cloud is busy" left the page hours behind). Read-only: the key in LAB_KEY is the
// fleet-reader account (Storage Object Viewer, Compute Viewer).
//
// node tools/fleet-snapshot.mjs <folder> <cache> — <folder> holds the last snapshot, <cache> the match part files (both re-read
// only when changed; the workflow keeps <cache> between runs):
//   list.json   { at, bucket, objects: [[name, updated seconds], …] }: jobs/, workers/, claims/ and the results files the page uses
//   gce.txt     the lab's Compute Engine machines, one "name type status" a line (as `gcloud compute instances list` prints)
//   o/<name>    the objects the page reads: every job spec, fresh worker reports, each job's done-0, a non-self-play job's
//               stdout-0.txt (cut to its last 2 MB), and a match's part files joined into o/results/<id>/parts.jsonl (one
//               fetch for the page instead of hundreds); list.json's `joined` says which jobs have one
import fs from "node:fs";
import path from "node:path";
import { createSign } from "node:crypto";

const BUCKET = process.env.LAB_BUCKET || "dandan-lab-807207481983";
const PROJECT = process.env.LAB_PROJECT || "project-b753c78c-ef88-46f1-b37";
const out = path.resolve(process.argv[2] || "fleet-status"), cache = path.resolve(process.argv[3] || "fleet-cache");
const KEEP = /^(jobs\/[^/]+\.json|workers\/[^/]+\.json|claims\/[^/]+\/[^/]+|results\/[^/]+\/(done-\d+|part-\d+\.jsonl|stdout-0\.txt))$/;
const STDOUT_MAX = 2 << 20;

async function token() {
  const key = JSON.parse(fs.readFileSync(process.env.LAB_KEY, "utf8")), now = Math.floor(Date.now() / 1000);
  const b64 = x => Buffer.from(JSON.stringify(x)).toString("base64url");
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: key.client_email, scope: "https://www.googleapis.com/auth/cloud-platform.read-only", aud: key.token_uri, iat: now, exp: now + 3600 })}`;
  const jwt = `${body}.${createSign("RSA-SHA256").update(body).sign(key.private_key).toString("base64url")}`;
  const r = await fetch(key.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  if (!r.ok) throw new Error("no token: " + r.status + " " + (await r.text()));
  return (await r.json()).access_token;
}
const TOK = await token(), auth = { authorization: "Bearer " + TOK };
async function get(url, tries = 5) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { headers: auth }); if (r.ok || r.status === 404 || i >= tries) return r; } catch (e) { if (i >= tries) throw e; }
    await new Promise(res => setTimeout(res, 1000 * 2 ** i));
  }
}

/** Every object under a prefix: [name, updated seconds]. */
async function list(prefix) {
  const all = [];
  for (let page = ""; ;) {
    const r = await get(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}&maxResults=5000&fields=items(name,updated),nextPageToken${page ? "&pageToken=" + encodeURIComponent(page) : ""}`);
    if (!r.ok) throw new Error(`list ${prefix}: ${r.status} ${await r.text()}`);
    const j = await r.json();
    for (const o of j.items || []) if (KEEP.test(o.name)) all.push([o.name, Math.floor(Date.parse(o.updated) / 1000)]);
    if (!(page = j.nextPageToken)) return all;
  }
}

const at = Date.now();
const objects = (await Promise.all(["jobs/", "workers/", "claims/", "results/"].map(list))).flat().sort((a, b) => (a[0] < b[0] ? -1 : 1));

// which files to keep: the page cats job specs, done-0, a match's parts, a finished job's stdout, the fresh worker reports
const specs = {};
const want = new Map();
for (const [n, t] of objects) if (n.startsWith("jobs/")) want.set(n, t);
let prev = {};
try { prev = JSON.parse(fs.readFileSync(path.join(cache, "updated.json"), "utf8")); } catch {}
const fetchText = async n => { const r = await get(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(n)}?alt=media`); return r.ok ? r.text() : null; };
const isPart = n => /\/part-\d+\.jsonl$/.test(n);
const keep = async (n, t, cap) => {
  const f = path.join(isPart(n) ? cache : out, "o", n);
  if (prev[n] === t && fs.existsSync(f)) return;
  let txt = await fetchText(n);
  if (txt == null) return;
  if (cap && txt.length > cap) txt = txt.slice(-cap);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, txt);
};
const pool = async (items, n, f) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await f(x); } })); };

await pool([...want], 24, ([n, t]) => keep(n, t));
for (const [n] of want) { try { const j = JSON.parse(fs.readFileSync(path.join(out, "o", n), "utf8")); if (j.id) specs[j.id] = j; } catch {} }
const kind = j => (j.script === "selfplay.mjs" ? "selfplay" : /-match\.mjs$/.test(j.script) ? "match" : "other");
const files = [];
for (const [n, t] of objects) {
  const m = n.match(/^results\/([^/]+)\/(done-0|part-\d+\.jsonl|stdout-0\.txt)$/);
  if (m) {
    const j = specs[m[1]];
    if (m[2] === "done-0" || (j && m[2].startsWith("part-") && kind(j) === "match") || (j && m[2] === "stdout-0.txt" && kind(j) !== "selfplay")) files.push([n, t]);
  } else if (n.startsWith("workers/") && at / 1000 - t < 6 * 60) files.push([n, t]);
}
await pool(files, 24, ([n, t]) => keep(n, t, n.endsWith("stdout-0.txt") ? STDOUT_MAX : 0));

// a match's parts joined, in part order; files no longer wanted go (a worker that stopped, a job removed)
const joined = {}, byJob = new Map();
for (const [n, t] of files) if (isPart(n)) { const id = n.split("/")[1]; if (!byJob.has(id)) byJob.set(id, []); byJob.get(id).push([n, t]); }
for (const [id, parts] of byJob) {
  parts.sort((a, b) => Number(a[0].match(/(\d+)\.jsonl$/)[1]) - Number(b[0].match(/(\d+)\.jsonl$/)[1]));
  const f = path.join(out, "o", "results", id, "parts.jsonl");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, parts.map(([n]) => { try { return fs.readFileSync(path.join(cache, "o", n), "utf8"); } catch { return ""; } }).join("\n"));
  joined[id] = Math.max(...parts.map(x => x[1]));
}
const wanted = new Set([...want.keys(), ...files.map(x => x[0]), ...Object.keys(joined).map(id => `results/${id}/parts.jsonl`)]);
const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
for (const base of [out, cache]) for (const f of walk(path.join(base, "o"))) {
  const n = path.relative(path.join(base, "o"), f).split(path.sep).join("/");
  if (!wanted.has(n) || (base === out) === isPart(n)) fs.rmSync(f);   // parts live in the cache, the rest in the snapshot
}

// the machines on Compute Engine, as the page's `gcloud compute instances list --filter="name~^lab-"` prints them
let gce = "";
const r = await get(`https://compute.googleapis.com/compute/v1/projects/${PROJECT}/aggregated/instances?filter=${encodeURIComponent('name eq "lab-.*"')}&fields=items/*/instances(name,machineType,status)`);
if (r.ok) {
  const j = await r.json();
  for (const z of Object.values(j.items || {})) for (const i of z.instances || []) gce += `${i.name}\t${i.machineType.split("/").pop()}\t${i.status}\n`;
} else { gce = null; console.log("machine list:", r.status, (await r.text()).slice(0, 300)); }
if (gce != null) fs.writeFileSync(path.join(out, "gce.txt"), gce);

const updated = Object.fromEntries(files.concat([...want]).map(([n, t]) => [n, t]));
fs.mkdirSync(cache, { recursive: true });
fs.writeFileSync(path.join(cache, "updated.json"), JSON.stringify(updated));
fs.writeFileSync(path.join(out, "list.json"), JSON.stringify({ at, bucket: BUCKET, objects, joined }));
const bytes = walk(out).reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`${objects.length} objects listed, ${files.length + want.size} kept, ${(bytes / 1e6).toFixed(1)} MB in ${out}, ${((Date.now() - at) / 1000).toFixed(0)} s`);
