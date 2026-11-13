// fleet/open.json (13 Nov 2026, the fleet director: idle polls listed the queue, about $0.005 a thousand requests; reading one
// small file costs about a twelfth of that). It names the jobs that may have a shard to take: { t, by, jobs: { <id>: 1 } }.
// Writers: a worker that queues a filler batch adds it, a worker that finds a job finished or fully claimed takes it out, a
// worker's full look at the queue writes all it found, queue-push adds new specs, and the fleet snapshot adds every job with an
// unclaimed shard or a lapsed claim (a backstop that only adds). A missing, unreadable or stale file sends the reader to a
// full look, so a lost update costs minutes, never a stalled fleet.
export const OPEN = "fleet/open.json", OPEN_STALE_MS = 5 * 60000;

/** { t, jobs, generation }, or null when missing; an unreadable file reads as empty and stale (t 0), so it gets rewritten. */
export async function readOpen(store) {
  const r = await store.getG(OPEN).catch(() => null);
  if (!r) return null;
  try { const j = JSON.parse(r.text); return { t: Number(j.t) || 0, jobs: j.jobs && typeof j.jobs === "object" ? j.jobs : {}, generation: r.generation }; } catch { return { t: 0, jobs: {}, generation: r.generation }; }
}

/**
 * Change the list: fn(jobs) edits the object in place and returns true to write. Written only if nobody wrote it since it was
 * read (generation match), else read again and fn run again, a few times. `touch` writes even when fn changed nothing, so
 * the file's time says a full look was made. Returns whether it wrote.
 */
export async function editOpen(store, fn, { by = "", touch = false } = {}) {
  for (let tries = 0; tries < 5; tries++) {
    const cur = await readOpen(store), jobs = { ...(cur?.jobs || {}) };
    if (!fn(jobs) && !touch) return false;
    const body = JSON.stringify({ t: Date.now(), by, jobs });
    if (await store.put(OPEN, body, cur?.generation ? { ifGeneration: cur.generation } : { ifAbsent: true })) return true;
    await new Promise(r => setTimeout(r, 200 + Math.random() * 1000 * (tries + 1)));
  }
  return false;
}
