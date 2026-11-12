// Shards marked done that wrote nothing (12 November 2026: AWS machines from before 623044f, stopped at their 48-hour cap, marked
// the shards they were running as done with code "SIGTERM"; 59 of a Deep gate's 600 pairs were lost so, and its looks waited on
// them for ever). For each job named, every done-<n> whose code isn't 0 and that has no part-<n>.jsonl is taken away with its
// claim, so the next free worker plays it again. A shard that finished properly is never touched.
// usage (a lab job, one shard): node lab/requeue.mjs <shard> <shards> <out> <job id>[,<job id>…]
import { googleToken } from "./lib.mjs";

const ids = process.argv[5].split(",");
const bucket = process.env.LAB_BUCKET, api = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`;
const auth = async () => ({ authorization: "Bearer " + (await googleToken()) });
async function list(prefix) {
  const out = []; let page = "";
  do {
    const r = await (await fetch(`${api}?prefix=${encodeURIComponent(prefix)}${page ? "&pageToken=" + page : ""}`, { headers: await auth() })).json();
    out.push(...(r.items ?? []).map(o => o.name)); page = r.nextPageToken ?? "";
  } while (page);
  return out;
}
const del = async name => { const r = await fetch(`${api}/${encodeURIComponent(name)}`, { method: "DELETE", headers: await auth() }); if (!r.ok && r.status !== 404) throw new Error(`${name}: ${r.status}`); };
for (const id of ids) {
  const names = new Set(await list(`results/${id}/`)), requeued = [];
  for (const n of names) {
    const m = n.match(/\/done-(\d+)$/);
    if (!m || names.has(`results/${id}/part-${m[1]}.jsonl`)) continue;
    const done = await (await fetch(`${api}/${encodeURIComponent(n)}?alt=media`, { headers: await auth() })).json().catch(() => ({}));
    if (done.code === 0) continue;
    await del(n); await del(`claims/${id}/${m[1]}`); requeued.push(Number(m[1]));
  }
  console.log(JSON.stringify({ id, requeued: requeued.sort((a, b) => a - b) }));
}
