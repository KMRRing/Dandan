// The bot lab: tools to measure Dandan's computer player without touching the page. Imports the page's own modules.
export const J = x => JSON.parse(JSON.stringify(x));
export const hr = () => Number(process.hrtime.bigint()) / 1e6;     // ms

/**
 * The lab's store for the scripts that read results and queue work (lab/store.mjs): LAB_DIR a folder, else the Google bucket
 * LAB_BUCKET for fleet/ and B2 for the rest once private/store.json names it (or LAB_B2_* in the environment). list(prefix) →
 * names, get(name) → text or null, put/create/del/getG as lab/store.mjs; listAll(prefix) → [{ name, generation, t }].
 */
export async function labStore() {
  const { openStore } = await import("./store.mjs"), s = await openStore();
  return { ...s, kind: s.kind, listAll: s.list, list: async prefix => (await s.list(prefix)).map(o => o.name).sort() };
}

/** The text of each part-<n>.jsonl a lab job wrote. */
export async function readParts(id) {
  const store = await labStore();
  const names = (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n));
  return Promise.all(names.map(n => store.get(n)));
}

/**
 * An access token for Google Cloud Storage: on a Google machine from its metadata server (its own service account); elsewhere
 * (10 November 2026: lab machines at other providers) from a service-account key, the JSON file at LAB_KEY, signed as a JWT
 * and exchanged at Google's token endpoint. Kept until two minutes before it runs out.
 */
let tokenCache = { tok: null, exp: 0 };
export async function googleToken() {
  if (tokenCache.tok && Date.now() < tokenCache.exp) return tokenCache.tok;
  let j;
  if (process.env.LAB_KEY) {
    const { default: fs } = await import("node:fs"), { createSign } = await import("node:crypto");
    const key = JSON.parse(fs.readFileSync(process.env.LAB_KEY, "utf8")), now = Math.floor(Date.now() / 1000);
    const b64 = x => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
    const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: key.client_email, scope: "https://www.googleapis.com/auth/devstorage.read_write", aud: key.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const jwt = `${body}.${createSign("RSA-SHA256").update(body).sign(key.private_key).toString("base64url")}`;
    const r = await retried(() => fetch(key.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) }));
    if (!r.ok) throw new Error("no access token for the key: " + r.status + " " + (await r.text()));
    j = await r.json();
  } else {
    const r = await retried(() => fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } }));
    if (!r.ok) throw new Error("no access token from the metadata server: " + r.status);
    j = await r.json();
  }
  tokenCache = { tok: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return tokenCache.tok;
}

/** f() again after a network error, up to five times, waiting 1, 2, 4, 8, 16 s. */
async function retried(f) {
  for (let tries = 0; ; tries++) {
    try { return await f(); } catch (e) { if (tries >= 5) throw e; await new Promise(res => setTimeout(res, 1000 * 2 ** tries)); }
  }
}
