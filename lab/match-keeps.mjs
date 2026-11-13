// Each side's first sevens kept and thrown back in a lab/hard-match.mjs job (13 Nov 2026, Fable 15:55: "report each side's
// share of first sevens thrown back"), from the games the shards printed (stdout-<n>.txt: { pair, seed, aSeat, winner, moves }).
// A seat's first decision on its opening seven is its first move of type keep or mull; side A is the seat aSeat names.
// usage: node lab/match-keeps.mjs <job>
import { labStore } from "./lib.mjs";

const job = process.argv[2], store = await labStore();
const names = (await store.list(`results/${job}/stdout-`)).filter(n => /stdout-\d+\.txt$/.test(n));
const side = { A: { kept: 0, back: 0, wonKept: 0, wonBack: 0 }, B: { kept: 0, back: 0, wonKept: 0, wonBack: 0 } };
let games = 0;
for (let i = 0; i < names.length; i += 20) {
  for (const text of await Promise.all(names.slice(i, i + 20).map(n => store.get(n)))) {
    for (const line of (text || "").split("\n")) {
      if (!line.startsWith("{")) continue;
      let g; try { g = JSON.parse(line); } catch { continue; }
      if (!Array.isArray(g.moves)) continue;
      games++;
      for (const seat of [0, 1]) {
        const first = g.moves.find(([s, m]) => s === seat && (m?.t === "keep" || m?.t === "mull"));
        if (!first) continue;
        const s = side[seat === g.aSeat ? "A" : "B"], won = g.winner === seat;
        if (first[1].t === "keep") { s.kept++; s.wonKept += won; } else { s.back++; s.wonBack += won; }
      }
    }
  }
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + "%" : "—");
console.log(`${job}: ${games} games from ${names.length} shards`);
for (const [k, s] of Object.entries(side)) console.log(`  side ${k}: first sevens thrown back ${pct(s.back, s.kept + s.back)} (${s.back} of ${s.kept + s.back}); won ${pct(s.wonKept, s.kept)} after keeping, ${pct(s.wonBack, s.back)} after throwing back`);
