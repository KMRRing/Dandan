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
  const { access_token } = await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } })).json();
  const H = { authorization: "Bearer " + access_token };
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
