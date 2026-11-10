// lab/rollnet.mjs's rows summed up: how often Hard with the learned policy in its look-ahead chose as Hard does, what the
// other choices cost by today's Hard's own values, and the time each took. usage: node lab/rollnet-sum.mjs <job ids>
import { readParts } from "./lib.mjs";
for (const id of (process.argv[2] ?? "").split(",").filter(Boolean)) {
  const rows = (await readParts(id)).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
  const diff = rows.filter(r => !r.same), sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
  console.log(JSON.stringify({
    job: id, decisions: rows.length, same: +(1 - diff.length / rows.length).toFixed(4),
    lostPerDecision: +(sum(diff, r => r.gap) / rows.length).toFixed(5), over2points: diff.filter(r => r.gap > 0.02).length, over5points: diff.filter(r => r.gap > 0.05).length,
    time: { today: sum(rows, r => r.ms.today), net: sum(rows, r => r.ms.net) },
  }));
  for (const r of diff.sort((a, b) => b.gap - a.gap).slice(0, 8)) console.log(JSON.stringify({ seed: r.seed, i: r.i, step: r.step, n: r.n, today: r.today, net: r.net, gap: r.gap }));
}
