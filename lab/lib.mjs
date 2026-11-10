// The bot lab: tools to measure Dandan's computer player without touching the page. Imports the page's own modules.
export const J = x => JSON.parse(JSON.stringify(x));
export const hr = () => Number(process.hrtime.bigint()) / 1e6;     // ms

/**
 * The lab's queue store, read-only, for the scripts that read results: from LAB_DIR (a folder queue) or the bucket LAB_BUCKET
 * (on a Google machine, as its service account). list(prefix) → names, get(name) → text or null.
 */
export async function labStore() {
  const { default: fs } = await import("node:fs"), { default: path } = await import("node:path");
  if (process.env.LAB_DIR) {
    const root = process.env.LAB_DIR;
    const walk = d => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
    return {
      list: async prefix => walk(path.join(root, path.dirname(prefix + "x"))).map(f => path.relative(root, f)).filter(n => n.startsWith(prefix)).sort(),
      get: async name => (fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), "utf8") : null),
    };
  }
  const api = `https://storage.googleapis.com/storage/v1/b/${process.env.LAB_BUCKET}/o`;
  const H = { authorization: "Bearer " + (await googleToken()) };
  return {
    async list(prefix) {
      const names = [];
      let pageToken = "";
      do {
        const r = await (await fetch(`${api}?prefix=${encodeURIComponent(prefix)}${pageToken ? "&pageToken=" + pageToken : ""}`, { headers: H })).json();
        names.push(...(r.items ?? []).map(o => o.name)); pageToken = r.nextPageToken ?? "";
      } while (pageToken);
      return names;
    },
    async get(name) { const r = await fetch(`${api}/${encodeURIComponent(name)}?alt=media`, { headers: H }); return r.ok ? r.text() : null; },
  };
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
    const r = await fetch(key.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
    if (!r.ok) throw new Error("no access token for the key: " + r.status + " " + (await r.text()));
    j = await r.json();
  } else {
    const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    if (!r.ok) throw new Error("no access token from the metadata server: " + r.status);
    j = await r.json();
  }
  tokenCache = { tok: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return tokenCache.tok;
}
