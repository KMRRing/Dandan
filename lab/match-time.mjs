// Each side's thinking time per decision in lab/hard-match.mjs jobs (13 Nov 2026, Fable No. 2: report it with every look),
// from the rows' ms (each side's milliseconds over the pair's two games) and n (its decisions).
// usage: node lab/match-time.mjs <job>[,<job>…]
import { readParts } from "./lib.mjs";

for (const job of process.argv[2].split(",")) {
  let ms = [0, 0], n = [0, 0], pairs = 0;
  for (const text of await readParts(job)) for (const line of text.split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (!r.ms || !r.n) continue;
    pairs++; for (const k of [0, 1]) { ms[k] += r.ms[k]; n[k] += r.n[k]; }
  }
  const per = k => (n[k] ? (ms[k] / n[k]).toFixed(0) : "—");
  console.log(`${job}: ${pairs} pairs; side A ${per(0)} ms a decision (${n[0]} decisions), side B ${per(1)} ms (${n[1]}); A/B ${n[0] && n[1] ? ((ms[0] / n[0]) / (ms[1] / n[1])).toFixed(2) : "—"}`);
}
