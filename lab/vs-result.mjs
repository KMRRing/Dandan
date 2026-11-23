// A match's result against its rival (23 Nov 2026, Fable 05:37Z), beside a reference match on the same seeds: the nets' score
// (win 1, draw 0.5) with its standard error, the reference's on the same seeds, the paired difference, and the seeds the reference
// has that this match lacks (with the reference's score on them). Read-only.
// usage: node lab/vs-result.mjs <batch> [reference batch] [first seed] [games]
import { labStore } from "./lib.mjs";

const [batch, ref, first, games] = process.argv.slice(2), store = await labStore();
async function scores(id) {
  const out = new Map();
  for (const n of (await store.list(`results/${id}/`)).filter(n => /part-\d+\.jsonl$/.test(n))) {
    let t = "";
    try { t = (await store.get(n)) || ""; } catch { continue; }
    for (const l of t.split("\n")) {
      if (!l.startsWith('{"game"')) continue;
      const g = JSON.parse(l);
      if (!g.vs || g.branch) continue;
      const me = 1 - g.vs.seat;
      out.set(g.seed, g.winner === me ? 1 : g.winner == null || g.winner < 0 ? 0.5 : 0);
    }
  }
  return out;
}
const stat = xs => { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1)); return { n, m, se: sd / Math.sqrt(Math.max(1, n)) }; };
const pc = s => `${(100 * s.m).toFixed(1)}% ± ${(100 * s.se).toFixed(1)} (${s.n} games)`;
const A = await scores(batch);
console.log(`${batch}: ${pc(stat([...A.values()]))}`);
if (ref) {
  const B = await scores(ref), both = [...A.keys()].filter(s => B.has(s));
  console.log(`${ref} on the same seeds: ${pc(stat(both.map(s => B.get(s))))}; ${batch} on them: ${pc(stat(both.map(s => A.get(s))))}`);
  // agreement (Fable 08:50Z): how often the two matches end with the same result on the same seed, and the results' correlation
  const same = both.filter(s => A.get(s) === B.get(s)).length, xa = both.map(s => A.get(s)), xb = both.map(s => B.get(s));
  const ma = xa.reduce((a, b) => a + b, 0) / both.length, mb = xb.reduce((a, b) => a + b, 0) / both.length;
  const cov = both.reduce((a, s) => a + (A.get(s) - ma) * (B.get(s) - mb), 0), va = xa.reduce((a, x) => a + (x - ma) ** 2, 0), vb = xb.reduce((a, x) => a + (x - mb) ** 2, 0);
  console.log(`same result on the same seed: ${same} of ${both.length} (${(100 * same / both.length).toFixed(1)}%); correlation of the results ${(cov / Math.sqrt(va * vb)).toFixed(3)}; agreement if independent ${(100 * (ma * mb + (1 - ma) * (1 - mb))).toFixed(1)}%`);
  console.log(`paired difference (${batch} less ${ref}): ${pc(stat(both.map(s => A.get(s) - B.get(s)))).replace("%", " points")}`);
  if (first && games) {
    const want = [...Array(Number(games))].map((_, k) => Number(first) + k), missing = want.filter(s => !A.has(s));
    console.log(`seeds of the first ${games} missing from ${batch}: ${missing.length}${missing.length ? ` (${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ", ..." : ""}); ${ref} on them: ${pc(stat(missing.filter(s => B.has(s)).map(s => B.get(s))))}` : ""}`);
  }
}
