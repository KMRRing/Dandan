// Which worker is the scheduler (17 Nov 2026, Korbi 18:35; lab/worker.mjs schedule): of the fresh beats (workers/<name>.json) of
// workers that hold the GitHub token (sched), the one with the most cores, then the machine up longest (boot), then by name.
// Every worker reads the same beats, so they agree without talking.
export const FRESH_MS = 11 * 60000;
export const chosenScheduler = (beats, now = Date.now()) => beats
  .filter(b => b && b.sched && now - b.t < FRESH_MS)
  .sort((a, b) => (b.hw?.cpus || 0) - (a.hw?.cpus || 0) || (a.boot ?? a.started) - (b.boot ?? b.started) || (a.by < b.by ? -1 : 1))[0]?.by ?? null;
