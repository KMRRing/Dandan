// The games a seat would have resigned and went on to win (18 Nov 2026, Korbi: "did these have anything in common? put them in
// the game history under sample games"): each such game line whole, with the decisions of the seat that would have resigned
// from that point on (searched value of the move played), one JSON per line. Read-only.
// usage: node lab/would-won.mjs <zero-play job ids, comma-separated>
import { labStore } from "./lib.mjs";

const [ids] = process.argv.slice(2), store = await labStore();
for (const id of ids.split(",")) for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
  const text = (await store.get(name)) || "";
  if (!text.includes('"would"')) continue;
  const lines = text.split("\n").filter(Boolean).map(l => JSON.parse(l));
  for (const g of lines) {
    if (g.game == null || !g.would || g.winner !== g.would.seat) continue;
    const dec = lines.filter(d => d.c && d.g === g.seed && d.seat === g.would.seat && d.i >= g.would.i - 6).map(d => ({ i: d.i, v: d.v }));
    console.log("WOULDWON " + JSON.stringify({ job: id, part: name, ...g, dec }));
  }
}
