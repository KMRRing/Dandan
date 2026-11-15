// The shape of the games (15 Nov 2026, Korbi 10:45: "more deck-outs? average length?"; and why the games got slower): for each
// self-play job, from up to K shards: games, how they ended (life, library…), turns and moves a game (median and mean), and
// the seconds a game and a move (from the shards' done files).
// usage: node lab/zero-shape.mjs <job ids, comma-separated> [K shards a job, 120]
import { labStore } from "./lib.mjs";
const store = await labStore(), K = Number(process.argv[3] || 120);
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }, mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log("job | games | ends (share) | turns median / mean | moves median / mean | s a game | ms a move");
for (const id of process.argv[2].split(",")) {
  const names = (await store.list(`results/${id}/`)), parts = names.filter(n => /\/part-\d+\.jsonl$/.test(n)).slice(0, K);
  const turns = [], moves = [], why = {}; let secs = 0, gamesTimed = 0, movesTimed = 0;
  for (const name of parts) {
    const shard = name.match(/part-(\d+)/)[1], lines = ((await store.get(name)) || "").split("\n").filter(l => l.startsWith('{"game"')).map(l => JSON.parse(l));
    for (const g of lines) { turns.push(g.turns); const n = (g.moves || []).length; moves.push(n); why[g.why || "?"] = (why[g.why || "?"] || 0) + 1; }
    const done = await store.get(`results/${id}/done-${shard}`).catch(() => null);
    if (done) { const d = JSON.parse(done); if (d.seconds) { secs += d.seconds; gamesTimed += lines.length; movesTimed += lines.reduce((a, g) => a + (g.moves || []).length, 0); } }
  }
  const n = turns.length, ends = Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join(", ");
  console.log(`${id} | ${n} | ${ends} | ${med(turns)} / ${mean(turns).toFixed(1)} | ${med(moves)} / ${mean(moves).toFixed(0)} | ${(secs / Math.max(1, gamesTimed)).toFixed(0)} | ${(1000 * secs / Math.max(1, movesTimed)).toFixed(0)}`);
}
