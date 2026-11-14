// A filler batch's health in one look (14 Nov 2026, Fable No. 7 point 4): its finished shards' exit codes, the shards whose done
// mark has no part (or an empty one), the games in the parts, and how many games carry each exploration mark (explore, explore2,
// explore3), with the explore3 moves' share. Read-only.
// usage: node lab/batch-check.mjs <batch id> [most parts to read 200]
import { labStore } from "./lib.mjs";

const [id, most = "200"] = process.argv.slice(2);
const store = await labStore(), names = await store.list(`results/${id}/`);
const done = names.filter(n => /\/done-\d+$/.test(n)), parts = new Set(names.filter(n => /\/part-\d+\.jsonl$/.test(n)).map(n => n.match(/part-(\d+)/)[1]));
const codes = {};
for (let i = 0; i < done.length; i += 50) for (const t of await Promise.all(done.slice(i, i + 50).map(n => store.get(n)))) { const c = JSON.parse(t || "{}").code; codes[c] = (codes[c] || 0) + 1; }
const noPart = done.map(n => n.match(/done-(\d+)/)[1]).filter(k => !parts.has(k));
let games = 0, x1 = 0, x2 = 0, x3 = 0, decs = 0, empty = 0;
const read = [...parts].slice(0, Number(most));
for (let i = 0; i < read.length; i += 25) for (const t of await Promise.all(read.slice(i, i + 25).map(k => store.get(`results/${id}/part-${k}.jsonl`)))) {
  const ls = (t || "").split("\n").filter(Boolean);
  if (!ls.length) empty++;
  for (const l of ls) { const g = JSON.parse(l); games++; decs += (g.dec || []).length; if (g.explore) x1++; if (g.explore2) x2++; if (g.explore3) x3++; }
}
console.log(`${id}: ${done.length} done (codes ${JSON.stringify(codes)}), ${noPart.length} without a part; ${read.length} parts read: ${games} games, ${empty} empty, ${(decs / Math.max(1, games)).toFixed(0)} weighed decisions a game; marks: explore ${x1}, explore2 ${x2}, explore3 ${x3} (${(100 * x3 / Math.max(1, games)).toFixed(1)}% of games)`);
