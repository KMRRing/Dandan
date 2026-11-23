// Rival games pooled over self-play batches (23 Nov 2026, Fable 08:20Z: is the loop still learning?): for each pair (the net
// playing, the older net it met as a rival), games and score with its error. The playing net is read from each batch's job spec.
// usage: node lab/rival-table.mjs <batch> [batch…]
import { labStore } from "./lib.mjs";
const store = await labStore(), by = new Map();
for (const id of process.argv.slice(2)) {
  let spec = null;
  try { spec = JSON.parse((await store.get(`jobs/${id}.json`)) || "null"); } catch {}
  const nets = spec ? spec.args.split(/\s+/)[7] : "?";
  for (const n of (await store.list(`results/${id}/`)).filter(n => /part-\d+\.jsonl$/.test(n))) {
    let t = "";
    try { t = (await store.get(n)) || ""; } catch { continue; }
    for (const l of t.split("\n")) {
      if (!l.startsWith('{"game"')) continue;
      const g = JSON.parse(l);
      if (!g.vs || g.branch || g.winner == null) continue;
      const k = `${nets} vs ${g.vs.nets}`, a = by.get(k) || by.set(k, { n: 0, s: 0, batches: new Set() }).get(k);
      a.n++; a.s += g.winner === 1 - g.vs.seat ? 1 : g.winner < 0 ? 0.5 : 0; a.batches.add(id);
    }
  }
}
for (const [k, a] of [...by].sort()) { const m = a.s / a.n; console.log(`PAIR ${k}: ${a.n} games, ${(100 * m).toFixed(1)}% ± ${(100 * Math.sqrt(m * (1 - m) / a.n)).toFixed(1)} (${[...a.batches].sort().join(" ")})`); }
