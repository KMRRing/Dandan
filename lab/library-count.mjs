// How much of the training data is a library race (19 Nov 2026, Fable: resigned games stop early, so late library races may be
// thin, and both no-Island losses were lost on the library): per batch, of a sample of its games, the share of turn starts with
// the shared library at 10 cards or fewer, the games that reach it, how many resigned and how many ended by an empty library.
// Read-only.
// usage: node lab/library-count.mjs <batch ids, comma-separated> [games a batch 600]
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";

const [ids, most = "600"] = process.argv.slice(2), store = await labStore(), realRandom = Math.random;
for (const id of ids.split(",")) {
  const parts = (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n));
  let games = 0, starts = 0, low = 0, reach = 0, resigned = 0, decked = 0;
  for (const name of parts.sort(() => Math.random() - 0.5)) {
    if (games >= Number(most)) break;
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line.startsWith('{"game"') || games >= Number(most)) continue;
      const g = JSON.parse(line);
      if (g.branch) continue;   // branch games (branch-lib.mjs) replay from their source: not counted here
      let G = newRecord(rules, { seats: 2, seed: g.seed, now: 0 }), lastTurn = -1, reached = false;
      for (let i = 0; i < g.moves.length; i++) {
        const s = G.state;
        if (s.turn !== lastTurn && !s.pending) { lastTurn = s.turn; starts++; if (s.lib.length <= 10) { low++; reached = true; } }
        Math.random = seeded(mix(g.seed, i + 1));
        const r = applyMove(rules, G, g.moves[i][0], g.moves[i][1], 0);
        Math.random = realRandom;
        if (r.error) break;
        G = r.G;
      }
      games++; if (reached) reach++; if (g.resign) resigned++; if (/library|deck/i.test(g.why || "")) decked++;
    }
  }
  console.log(`${id}: ${games} games; turn starts ${starts}, with the library at 10 or fewer ${low} (${(100 * low / Math.max(1, starts)).toFixed(1)}%); games reaching it ${reach} (${(100 * reach / Math.max(1, games)).toFixed(1)}%); resigned ${resigned}; ended on an empty library ${decked}`);
}
