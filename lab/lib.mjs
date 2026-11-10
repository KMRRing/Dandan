// The bot lab: tools to measure Dandan's computer player without touching the page. Imports the page's own modules.
export const J = x => JSON.parse(JSON.stringify(x));
export const hr = () => Number(process.hrtime.bigint()) / 1e6;     // ms

/** The text of each part-<n>.jsonl a lab job wrote: from LAB_DIR (a folder queue) or the bucket LAB_BUCKET (on a Google machine). */
export async function readParts(id) {
  const { default: fs } = await import("node:fs"), { default: path } = await import("node:path");
  if (process.env.LAB_DIR) {
    const dir = path.join(process.env.LAB_DIR, "results", id);
    return fs.readdirSync(dir).filter(f => /^part-\d+\.jsonl$/.test(f)).map(f => fs.readFileSync(path.join(dir, f), "utf8"));
  }
  const api = `https://storage.googleapis.com/storage/v1/b/${process.env.LAB_BUCKET}/o`;
  const { access_token } = await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } })).json();
  const H = { authorization: "Bearer " + access_token }, names = [];
  let pageToken = "";
  do {
    const r = await (await fetch(`${api}?prefix=${encodeURIComponent(`results/${id}/part-`)}${pageToken ? "&pageToken=" + pageToken : ""}`, { headers: H })).json();
    names.push(...(r.items ?? []).map(o => o.name)); pageToken = r.nextPageToken ?? "";
  } while (pageToken);
  return Promise.all(names.map(async n => (await fetch(`${api}/${encodeURIComponent(n)}?alt=media`, { headers: H })).text()));
}
