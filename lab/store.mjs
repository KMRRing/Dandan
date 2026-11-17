// The lab's store (16 Nov 2026, the move off Google's bucket: its request fees were eating the last of the credit). One interface,
// three backends:
//   folder   LAB_DIR, a folder that works like a bucket (local tests)
//   google   the Google bucket LAB_BUCKET, as the machine's service account or the key at LAB_KEY (lab/lib.mjs googleToken)
//   s3       any S3-compatible store; the lab's is Backblaze B2 (bucket ML-queue), path-style, signed with AWS Signature V4
// and the lab's routing: the small control files under fleet/ (open.json, filler.json, finished.json, sources.json, summary.json,
// ops.json…) stay on Google, where the ops chat can read and write them; everything else (jobs/, claims/, results/, workers/,
// retired/…) lives on B2 once STORE_CONFIG names it. Without that file, everything is on Google, as before.
// STORE_CONFIG holds the B2 key, so it is on the Google bucket at a path nothing lists or copies out (16 Nov 2026, Fable: under
// fleet/ the status snapshot would have put it on the public fleet-status branch), read only from Google, never through routing.
//
// The interface: list(prefix) → [{ name, generation, t (ms, last written) }]; get(name) → text or null; getG(name) → { text,
// generation } or null; put(name, body, { ifAbsent, ifGeneration }) → whether it was written; create(name, text) = put ifAbsent;
// del(name). On Google the conditions are atomic. B2 has no conditional writes, so there they are advisory: the condition is
// checked first, the write made, and the object read back; true only if it holds what was written. Two writers in the same
// instant can both see true: for a shard claim that means a shard played twice, which is harmless (a shard's output is fixed by
// its job, shard and seed). Nothing that must be atomic (fleet/open.json) is on B2.
//
// B2 answers "too busy" with 503 when one prefix gets hot (claims/ at full fleet): every call is retried on 429 and 5xx, and on
// network errors, with exponential backoff and full jitter (a random wait up to 0.5 s × 2^try, at most 30 s; nine tries).
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = n => sleep(Math.random() * Math.min(30000, 500 * 2 ** n));
const TRIES = 9;
/** The counts of requests made, by kind (the worker reports them): list, write, read. */
export const REQ = { list: 0, write: 0, read: 0 };

// ---------- a folder ----------
export function folderStore(root) {
  const file = n => path.join(root, n), gen = f => String(fs.statSync(f).mtimeMs);
  return {
    kind: "folder",
    async list(prefix) {
      REQ.list++;
      const out = [];
      const walk = d => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push({ name: path.relative(root, f).split(path.sep).join("/"), generation: gen(f), t: fs.statSync(f).mtimeMs }); } };
      walk(root);
      return out.filter(o => o.name.startsWith(prefix)).sort((a, b) => (a.name < b.name ? -1 : 1));
    },
    async get(name) { REQ.read++; return fs.existsSync(file(name)) ? fs.readFileSync(file(name), "utf8") : null; },
    async getG(name) { REQ.read++; return fs.existsSync(file(name)) ? { text: fs.readFileSync(file(name), "utf8"), generation: gen(file(name)) } : null; },
    async put(name, body, { ifAbsent, ifGeneration } = {}) {
      REQ.write++;
      const f = file(name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      if (ifAbsent) { try { fs.writeFileSync(f, body, { flag: "wx" }); return true; } catch (e) { if (e.code === "EEXIST") return false; throw e; } }
      if (ifGeneration && (!fs.existsSync(f) || gen(f) !== ifGeneration)) return false;
      fs.writeFileSync(f, body); return true;
    },
    async create(name, text) { return this.put(name, text, { ifAbsent: true }); },
    async del(name) { REQ.write++; fs.rmSync(file(name), { force: true }); },
  };
}

// ---------- Google Cloud Storage ----------
export function googleStore(bucket, token) {
  const call = async (url, init = {}) => {
    for (let tries = 0; ; tries++) {
      try {
        const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await token()}` } });
        if ((r.status === 429 || r.status >= 500) && tries < TRIES) { await backoff(tries); continue; }
        return r;
      } catch (e) { if (tries >= TRIES) throw e; await backoff(tries); }
    }
  };
  const api = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`, up = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o`;
  const read = async name => {
    // the body read retried too (12 Nov: three trainings died on a connection dropped mid-read)
    for (let tries = 0; ; tries++) {
      try {
        REQ.read++;
        const r = await call(`${api}/${encodeURIComponent(name)}?alt=media`);
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`get ${name}: ${r.status}`);
        return { text: await r.text(), generation: r.headers.get("x-goog-generation") };
      } catch (e) { if (tries >= 5) throw e; await backoff(tries); }
    }
  };
  return {
    kind: "google",
    async list(prefix) {
      const out = []; let page;
      do {
        REQ.list++;
        const q = new URLSearchParams({ prefix, maxResults: "1000", fields: "items(name,generation,updated),nextPageToken" }); if (page) q.set("pageToken", page);
        const r = await call(`${api}?${q}`); if (!r.ok) throw new Error(`list ${prefix}: ${r.status} ${await r.text()}`);
        const j = await r.json(); out.push(...(j.items || []).map(o => ({ name: o.name, generation: o.generation, t: Date.parse(o.updated) }))); page = j.nextPageToken;
      } while (page);
      return out;
    },
    async get(name) { return (await read(name))?.text ?? null; },
    getG: read,
    async put(name, body, { ifAbsent, ifGeneration } = {}) {
      REQ.write++;
      const q = new URLSearchParams({ uploadType: "media", name }); if (ifAbsent) q.set("ifGenerationMatch", "0"); else if (ifGeneration) q.set("ifGenerationMatch", ifGeneration);
      const r = await call(`${up}?${q}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
      if (r.status === 412) return false;
      if (!r.ok) throw new Error(`put ${name}: ${r.status} ${await r.text()}`); return true;
    },
    async create(name, text) { return this.put(name, text, { ifAbsent: true }); },
    async del(name) {
      REQ.write++;
      const r = await call(`${api}/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw new Error(`delete ${name}: ${r.status}`);
    },
  };
}

// ---------- S3 (Backblaze B2) ----------
const sha256 = x => createHash("sha256").update(x).digest("hex");
const hmac = (k, x) => createHmac("sha256", k).update(x).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
/** AWS Signature V4 headers for a request (path-style: `/<bucket>/<key>`; tests/store.mjs checks it against AWS's own example). */
export function sigV4({ method, host, path: p, query = {}, body = "", region, keyId, key, now = new Date(), headers = {} }) {
  const amz = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""), day = amz.slice(0, 8);
  const hash = sha256(body);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host, "x-amz-content-sha256": hash, "x-amz-date": amz };
  const names = Object.keys(all).sort(), signed = names.join(";");
  const cq = Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k])}`).join("&");
  const creq = [method, p.split("/").map(enc).join("/"), cq, names.map(n => `${n}:${all[n]}\n`).join(""), signed, hash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`, sts = ["AWS4-HMAC-SHA256", amz, scope, sha256(creq)].join("\n");
  const kSig = hmac(hmac(hmac(hmac("AWS4" + key, day), region), "s3"), "aws4_request");
  const sig = createHmac("sha256", kSig).update(sts).digest("hex");
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signed}, Signature=${sig}` };
}
const unxml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? unxml(m[1]) : null; };
/** B2's reason for a refusal, from its error body: the code and its message (a cap reached reads as AccessDenied too). */
const why = x => [tag(x, "Code"), tag(x, "Message")].filter(Boolean).join(": ");

/** { endpoint: "https://s3.<region>.backblazeb2.com", bucket, keyId, key, region? } */
export function s3Store({ endpoint, bucket, keyId, key, region }) {
  const base = new URL(endpoint.startsWith("http") ? endpoint : `https://${endpoint}`), host = base.host;
  region ||= host.match(/^s3\.([^.]+)\./)?.[1] || "us-east-1";
  const call = async (method, name, { query = {}, body = "", headers = {} } = {}) => {
    const p = `/${bucket}${name == null ? "" : "/" + name}`;
    for (let tries = 0; ; tries++) {
      try {
        const h = sigV4({ method, host, path: p, query, body, region, keyId, key, headers });
        delete h.host;
        const qs = Object.keys(query).length ? "?" + Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k])}`).join("&") : "";
        const r = await fetch(`${base.protocol}//${host}${p.split("/").map(enc).join("/")}${qs}`, { method, headers: h, body: method === "PUT" ? body : undefined });
        if ((r.status === 429 || r.status >= 500) && tries < TRIES) { await r.arrayBuffer().catch(() => {}); await backoff(tries); continue; }
        return r;
      } catch (e) { if (tries >= TRIES) throw e; await backoff(tries); }
    }
  };
  const read = async name => {
    for (let tries = 0; ; tries++) {
      try {
        REQ.read++;
        const r = await call("GET", name);
        if (r.status === 404) { await r.arrayBuffer().catch(() => {}); return null; }
        if (!r.ok) throw new Error(`get ${name}: ${r.status} ${why(await r.text())}`);
        return { text: await r.text(), generation: r.headers.get("etag") };
      } catch (e) { if (tries >= 5) throw e; await backoff(tries); }
    }
  };
  const head = async name => { REQ.read++; const r = await call("HEAD", name); return r.status === 404 ? null : r.ok ? r.headers.get("etag") : (() => { throw new Error(`head ${name}: ${r.status}`); })(); };
  const write = async (name, body) => {
    REQ.write++;
    const b = typeof body === "string" ? body : Buffer.from(body);
    const r = await call("PUT", name, { body: b, headers: { "content-type": "application/octet-stream" } });
    if (!r.ok) throw new Error(`put ${name}: ${r.status} ${why(await r.text())}`);
    await r.arrayBuffer().catch(() => {});
  };
  return {
    kind: "s3",
    async list(prefix) {
      const out = []; let token = null;
      do {
        REQ.list++;
        const query = { "list-type": "2", prefix, "max-keys": "1000", ...(token ? { "continuation-token": token } : {}) };
        const r = await call("GET", null, { query }), x = await r.text();
        if (!r.ok) throw new Error(`list ${prefix}: ${r.status} ${why(x)}`);
        for (const c of x.match(/<Contents>[\s\S]*?<\/Contents>/g) || []) out.push({ name: tag(c, "Key"), generation: tag(c, "ETag"), t: Date.parse(tag(c, "LastModified")) });
        token = tag(x, "IsTruncated") === "true" ? tag(x, "NextContinuationToken") : null;
      } while (token);
      return out;
    },
    async get(name) { return (await read(name))?.text ?? null; },
    getG: read,
    // advisory conditions (see the top): checked, written, read back
    async put(name, body, { ifAbsent, ifGeneration } = {}) {
      if (ifAbsent || ifGeneration) {
        const now = await head(name);
        if (ifAbsent ? now != null : now !== ifGeneration) return false;
        await write(name, body);
        const back = await read(name);
        return back != null && back.text === (typeof body === "string" ? body : Buffer.from(body).toString("utf8"));
      }
      await write(name, body); return true;
    },
    async create(name, text) { return this.put(name, text, { ifAbsent: true }); },
    async del(name) { REQ.write++; const r = await call("DELETE", name); await r.arrayBuffer().catch(() => {}); if (!r.ok && r.status !== 404) throw new Error(`delete ${name}: ${r.status}`); },
  };
}

// ---------- the lab's routing ----------
export const STORE_CONFIG = "private/store.json";
/** fleet/ on `control` (Google), the rest on `data`; `data` may be swapped later (set). `control` is the Google side itself. */
// Once the data store is B2, results/ and cache/ written before the move stay on Google, read-only (Korbi 17 Nov 15:15Z: only the
// live set and the loop's window are copied): a read there that B2 doesn't have is answered from Google, and a listing is both
// stores' (B2's copy wins). Everything else (jobs/, claims/, workers/, retired/) is B2's alone, so nothing removed there comes back.
const KEPT_ON_GOOGLE = /^(results|cache)\//;
const nameOf = o => (typeof o === "string" ? o : o.name);
export function routedStore(control, data) {
  let main = data || control;
  const on = name => (name.startsWith("fleet/") ? control : main);
  const old = name => main !== control && KEPT_ON_GOOGLE.test(name);
  return {
    control,
    get kind() { return main === control ? control.kind : `${control.kind}+${main.kind}`; },
    set(d) { main = d || control; },
    async list(prefix) {
      const a = await on(prefix).list(prefix);
      if (!old(prefix)) return a;
      const seen = new Set(a.map(nameOf));
      return [...a, ...(await control.list(prefix)).filter(o => !seen.has(nameOf(o)))];
    },
    async get(name) { const v = await on(name).get(name); return v == null && old(name) ? control.get(name) : v; },
    async getG(name) { const v = await on(name).getG(name); return v == null && old(name) ? control.getG(name) : v; },
    put: (name, body, o) => on(name).put(name, body, o),
    create: (name, text) => on(name).create(name, text),
    del: name => on(name).del(name),
  };
}
/** The data store STORE_CONFIG names ({ kind: "s3", endpoint, bucket, keyId, key }), or null; LAB_B2_* in the environment
 *  first (GitHub's runs have the secrets), so a run needs no read of the file. */
export async function dataStoreOf(control, env = process.env) {
  if (env.LAB_B2_KEY_ID && env.LAB_B2_KEY && env.LAB_B2_ENDPOINT) return s3Store({ endpoint: env.LAB_B2_ENDPOINT, bucket: env.LAB_B2_BUCKET || "ML-queue", keyId: env.LAB_B2_KEY_ID, key: env.LAB_B2_KEY });
  const t = await control.get(STORE_CONFIG).catch(() => null);
  if (!t) return null;
  const c = JSON.parse(t);
  return c.kind === "s3" ? s3Store(c) : null;
}
/** The lab's store as every script uses it: LAB_DIR a folder (fleet/ and the rest both in it; with LAB_B2_* too, the rest on that
 *  S3 store, for trying the move locally: tests/store.mjs), else Google with B2 behind it. */
export async function openStore(env = process.env) {
  if (env.LAB_DIR) { const f = folderStore(path.resolve(env.LAB_DIR)); return routedStore(f, env.LAB_B2_KEY_ID ? await dataStoreOf(f, env) : null); }
  if (!env.LAB_BUCKET) throw new Error("set LAB_BUCKET (or LAB_DIR to try it in a folder)");
  const { googleToken } = await import("./lib.mjs");
  const control = googleStore(env.LAB_BUCKET, googleToken);
  return routedStore(control, await dataStoreOf(control, env));
}
