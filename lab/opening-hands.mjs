// The kept opening hand against the result (13 Nov 2026, Fable): does the value net read turn 1 right? Over self-play games,
// each seat's hand at the start of turn 1 (after both keeps and the bottoms), by lands (2 to 5, others apart) and good spells
// (Medium's six: 0, 1, 2+), on the play and on the draw: games, the actual win rate, and the net's mean rating of that same
// position (static, real hands). Read-only: lab-read.yml. Drawn games are left out.
// usage: node lab/opening-hands.mjs <self-play job ids, comma-separated> [judge file in judges/, s4d.json] [most games 6000]
import fs from "node:fs";
import { labStore, J } from "./lib.mjs";
import { makeJudge } from "../dandan-eval.js";
import { isLandId } from "../dandan-core.js";
import { DECK } from "../dandan-cards.js";
import { selfPlayGame } from "./mine-lib.mjs";
import { newRecord, applyMove } from "../seats.js";

const [ids, judgeFile = "s4d.json", most = 6000] = process.argv.slice(2);
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${judgeFile}`, import.meta.url), "utf8")).layers);
const GOOD = new Set(["Memory Lapse", "Dandân", "Piracy Charm", "Mind Bend", "Brainstorm", "Predict"]);
const cells = new Map(), each = Number(most) / ids.split(",").length;
const add = (k, won, v) => { const c = cells.get(k) || { games: 0, won: 0, rated: 0 }; c.games++; c.won += won; c.rated += v; cells.set(k, c); };
let games = 0, skipped = 0;
const store = await labStore();
for (const id of ids.split(",")) {
  const start = games;
  for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) {
    if (games - start >= each) break;
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line || games - start >= each) continue;
      const g = JSON.parse(line);
      if (!(g.winner >= 0)) continue;
      const game = selfPlayGame(id, g);
      let G = newRecord(game.R, game.opts), k = 0;
      // play the moves until both have kept and no bottom is pending: the start of turn 1
      while (k < game.moves.length && !(G.state.mull?.done?.every(Boolean) && !["mull", "bottom"].includes(G.state.pending?.t))) {
        const r = applyMove(game.R, G, game.moves[k][0], game.moves[k][1], game.now);
        if (r.error) break;
        G = r.G; k++;
      }
      const st = G.state;
      if (!st.mull?.done?.every(Boolean)) { skipped++; continue; }
      games++;
      for (const seat of [0, 1]) {
        const h = st.hand[seat], lands = h.filter(isLandId).length, good = h.filter(id => !isLandId(id) && GOOD.has(DECK[id])).length;
        const role = seat === st.first ? "play" : "draw", v = judge(game.R.restore(J(st)), seat), won = g.winner === seat ? 1 : 0;
        const L = lands >= 2 && lands <= 5 ? String(lands) : lands < 2 ? "0-1" : "6+", S = good >= 2 ? "2+" : String(good);
        add(`${role}|size ${h.length}|all`, won, v);
        add(`${role}|lands ${L}|good ${S}`, won, v);
        add(`all|lands ${L}|good ${S}`, won, v);
      }
    }
  }
}
const rows = [...cells].sort(([a], [b]) => a.localeCompare(b)).map(([k, c]) => {
  const p = c.won / c.games, se = Math.sqrt(p * (1 - p) / c.games);
  return { cell: k, games: c.games, won: +p.toFixed(3), se: +se.toFixed(3), rated: +(c.rated / c.games).toFixed(3), gap: +(c.rated / c.games - p).toFixed(3) };
});
console.log(JSON.stringify({ ids, judge: judgeFile, games, skipped }));
console.log("cell".padEnd(30), "games".padStart(6), "won".padStart(6), "±se".padStart(6), "rated".padStart(6), "gap".padStart(7));
for (const r of rows) console.log(r.cell.padEnd(30), String(r.games).padStart(6), r.won.toFixed(3).padStart(6), r.se.toFixed(3).padStart(6), r.rated.toFixed(3).padStart(6), (r.gap >= 0 ? "+" : "") + r.gap.toFixed(3));
