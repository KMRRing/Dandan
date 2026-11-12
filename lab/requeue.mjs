// Shards a stopped machine marked done without results (12 November 2026: AWS machines from before 623044f, stopped at their
// 48-hour cap, marked the shards they were running done with code "SIGTERM"; 59 of a Deep gate's 600 pairs were lost so).
// A running worker remembers a job whose shards are all done and never looks at it again, so taking a done-<n> away isn't
// enough. Instead each job named gets a twin, <id>-r: the same spec, with a done-<n> ("code": "kept") already in place for every
// shard that has its results, so the workers play only the lost ones. The twin's rows carry the same pair numbers: read the
// two jobs together. Shards still running (claimed in the last 15 minutes, no done) are left to finish.
// usage (a lab job, one shard): node lab/requeue.mjs <shard> <shards> <out> <job id>[,<job id>…]
import { googleToken } from "./lib.mjs";

const ids = process.argv[5].split(",");
const bucket = process.env.LAB_BUCKET, api = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`, up = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o`;
const auth = async () => ({ authorization: "Bearer " + (await googleToken()) });
async function list(prefix) {
  const out = []; let page = "";
  do {
    const r = await (await fetch(`${api}?prefix=${encodeURIComponent(prefix)}&fields=items(name,updated),nextPageToken${page ? "&pageToken=" + page : ""}`, { headers: await auth() })).json();
    out.push(...(r.items ?? [])); page = r.nextPageToken ?? "";
  } while (page);
  return out;
}
const get = async name => { const r = await fetch(`${api}/${encodeURIComponent(name)}?alt=media`, { headers: await auth() }); return r.ok ? r.text() : null; };
const put = async (name, body) => { const r = await fetch(`${up}?uploadType=media&name=${encodeURIComponent(name)}`, { method: "POST", headers: { ...(await auth()), "content-type": "application/json" }, body }); if (!r.ok) throw new Error(`${name}: ${r.status}`); };
for (const id of ids) {
  const spec = JSON.parse(await get(`jobs/${id}.json`));
  const names = new Set((await list(`results/${id}/`)).map(o => o.name));
  const live = new Set((await list(`claims/${id}/`)).filter(o => Date.now() - Date.parse(o.updated) < 15 * 60000).map(o => Number(o.name.split("/").pop())));
  const lost = [];
  for (let s = 0; s < spec.shards; s++) {
    if (names.has(`results/${id}/part-${s}.jsonl`)) continue;
    if (!names.has(`results/${id}/done-${s}`) && live.has(s)) continue;   // still being played
    if (names.has(`results/${id}/done-${s}`) && [0, "kept"].includes(JSON.parse((await get(`results/${id}/done-${s}`)) || "{}").code)) continue;   // ended well, or kept from the job this twins
    lost.push(s);
  }
  if (!lost.length) { console.log(JSON.stringify({ id, lost })); continue; }
  const twin = `${id}-r`, keep = new Set(lost);
  for (let s = 0; s < spec.shards; s++) if (!keep.has(s)) await put(`results/${twin}/done-${s}`, JSON.stringify({ code: "kept", in: id }));
  await put(`jobs/${twin}.json`, JSON.stringify({ ...spec, id: twin, purpose: `the shards of ${id} lost to stopped machines (${lost.length}), played again; read with ${id}`, made: new Date().toISOString().slice(0, 10) }));
  console.log(JSON.stringify({ id, twin, lost }));
}
