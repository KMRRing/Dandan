// lab/halving.mjs's rows summed up: how often looking from 16 deals (passing kept) chose as the full search did, what
// the other choices cost by the full search's own values, and the deals saved; by the number of candidates.
// usage: node lab/halving-sum.mjs <job ids, comma-separated>   (prints; as a lab job its stdout is the result)
import { readParts } from "./lib.mjs";

for (const id of (process.argv[2] ?? "").split(",").filter(Boolean)) {
  const rows = (await readParts(id)).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
  const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
  const line = (name, rs) => {
    if (!rs.length) return;
    const diff = rs.filter(r => !r.same), F = sum(rs, r => r.work.full), H = sum(rs, r => r.work.half);
    const gaps = diff.map(r => r.gap).sort((a, b) => b - a);
    console.log(JSON.stringify({
      job: id, rows: name, decisions: rs.length, same: +(1 - diff.length / rs.length).toFixed(4), differ: diff.length,
      lostPerDecision: +(sum(diff, r => r.gap) / rs.length).toFixed(5), worstGaps: gaps.slice(0, 5), over2points: gaps.filter(g => g > 0.02).length,
      workSaved: +(1 - H / F).toFixed(3),
    }));
  };
  line("all", rows);
  for (const [a, b] of [[2, 2], [3, 4], [5, 7], [8, 99]]) line(`${a}-${b} candidates`, rows.filter(r => r.n >= a && r.n <= b));
  for (const r of rows.filter(r => !r.same).sort((p, q) => q.gap - p.gap).slice(0, 8)) console.log(JSON.stringify({ job: id, seed: r.seed, i: r.i, step: r.step, stack: r.stack, n: r.n, full: r.full, half: r.half, gap: r.gap }));
}
