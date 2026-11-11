// Do the thinking depths agree (Korbi, 11 November 2026: "just checking whether they agree with each other in principle")?
// At every `every`-th decision of a self-play job's games, Hard v14 at each depth (as the live game sets them: dandan-think.js
// DEPTH, no time limit) chooses a move; a row has each depth's choice, its value by the deepest's own figures, and whether it
// is the deepest's choice. Read with lab/depth-agree-sum.mjs.
// usage: node lab/depth-agree.mjs <shard> <shards> <out> <self-play job ids> [depths quick,long,deep,deepest] [every 40] [judge ag-v14.json]
import fs from "node:fs";
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think, DEPTH } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { moveName } from "../dandan-words.js";

const [shard, shards, out, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const depths = (process.argv[6] ?? "quick,long,deep,deepest").split(","), every = Number(process.argv[7] ?? 40);
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${process.argv[8] ?? "ag-v14.json"}`, import.meta.url), "utf8")).layers);
const J = x => JSON.parse(JSON.stringify(x)), keyOf = m => JSON.stringify(m);

let k = 0;
for (const id of ids.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line);
  let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 });
  for (let i = 0; i < rec.moves.length; i++) {
    const [seat, move] = rec.moves[i];
    if (k++ % (every * shards) === shard * every && !G.state.pending) {
      const runs = depths.map(d => think(rules.restore(J(G.state)), seat, { ...DEPTH[d], ms: 1e9, judge }));
      if (!runs.at(-1).only) {
        const top = runs.at(-1), value = m => top.list.find(c => keyOf(c.move) === keyOf(m))?.mean ?? NaN;
        const row = { seed: rec.seed, i, n: top.list.length, turn: G.state.turn, by: {} };
        depths.forEach((d, j) => {
          const b = runs[j].best;
          row.by[d] = { move: moveName(b, G.state, seat) || "pass", same: keyOf(b) === keyOf(top.best), lost: +(value(top.best) - value(b)).toFixed(4), own: +(runs[j].list[0]?.mean ?? NaN).toFixed(4) };
        });
        fs.appendFileSync(out, JSON.stringify(row) + "\n");
      }
    }
    const r = applyMove(rules, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
