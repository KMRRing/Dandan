// The teacher pilot's target noise (24 Nov 2026, Fable 07:45Z): at each decision a re-search job holds (lab/blunder-ref.mjs lines:
// pos "<seed>:<i>", opts [[move key, mean]]), how far the reference's best option is above the move the game played, in points
// (100 × the means' difference); the decisions where they differ split by that gap (under 1, 1 to 2, 2 to 5, 5 or more), with counts
// and shares of all. Read-only.
// usage: node lab/teach-gap.mjs <re-search job zprt001> <game batches zps036,zps037,...>
const [job = "zprt001", batches = "zps036,zps037,zps038,zps039"] = process.argv.slice(2);
const store = await (await import("./lib.mjs")).labStore(), key = m => JSON.stringify(m);
const parts = async id => (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n));
const ref = new Map();
for (const n of await parts(job))
  for (const l of ((await store.get(n)) || "").split("\n")) if (l.startsWith('{"pos"')) { const o = JSON.parse(l); if (o.opts?.length) ref.set(o.pos, new Map(o.opts)); }
let n = 0, same = 0, miss = 0;
const bins = [[0.01, "under 1 point"], [0.02, "1 to 2"], [0.05, "2 to 5"], [Infinity, "5 or more"]].map(([hi, name]) => ({ hi, name, k: 0 }));
const gaps = [];
for (const id of batches.split(","))
  for (const nm of await parts(id))
    for (const l of ((await store.get(nm)) || "").split("\n")) {
      if (!l.startsWith("{") || l.startsWith('{"v":1')) continue;
      const g = JSON.parse(l);
      if (g.game == null || !g.moves) continue;
      for (let i = 0; i < g.moves.length; i++) {
        const opts = ref.get(`${g.seed}:${i}`);
        if (!opts) continue;
        const played = opts.get(key(g.moves[i][1]));
        if (played == null) { miss++; continue; }
        const best = Math.max(...opts.values()), gap = best - played;
        n++; gaps.push(gap);
        if (gap <= 1e-9) { same++; continue; }
        bins.find(b => gap < b.hi).k++;
      }
    }
const pct = k => (n ? (100 * k / n).toFixed(1) : "-");
const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
console.log(`${job} against the moves played in ${batches}: ${n} decisions (${miss} where the move played is not among the reference's options, ${ref.size} re-searched)`);
console.log(`  the reference's best is the move played: ${same} (${pct(same)}%); it differs: ${n - same} (${pct(n - same)}%)`);
for (const b of bins) console.log(`  differs by ${b.name}: ${b.k} (${pct(b.k)}% of all)`);
console.log(`  mean points given up by the move played: ${(100 * mean).toFixed(2)}`);
