// A kept game (games/<started>.json on the game-records branch) played again move by move, with the computer's decisions
// weighed again by the current look-ahead: at each decision of a seat (Monte, seat 1, by default) that had more than one
// move worth weighing, the move it made and what the look-ahead now makes of it and of the others, in the same deals.
// A move that came out clearly behind (by more than `gap` points over the deals they share) is printed with the turn, so a
// game that was lost can be read for where. The old decision was made by an older build at 2,048 deals; this is a second
// opinion at `deals`, not a verdict.
// usage: node lab/review.mjs <game.json> [deals 256] [seat 1] [gap 0.03]
import fs from "node:fs";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";
import { moveName } from "../dandan-words.js";
import { DECK } from "../dandan-cards.js";

const [file, deals = 256, seat = 1, gap = 0.03] = [process.argv[2], Number(process.argv[3] || 256), Number(process.argv[4] ?? 1), Number(process.argv[5] || 0.03)];
const g = JSON.parse(fs.readFileSync(file, "utf8")).game;
const moves = JSON.parse(g.moves);
let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
const key = m => JSON.stringify(m);
let n = 0, behind = 0;
for (let i = 0; i < moves.length; i++) {
  const [who, move] = moves[i], s = shownRules.restore(JSON.parse(JSON.stringify(G.state)));
  if (who === seat && ["mull", "bottom", "name"].includes(s.pending?.t) === false) {
    const res = think(s, seat, { deals, ms: 1e9 });
    if (!res.only) {
      n++;
      const mine = res.list.find(c => key(c.move) === key(move));
      const best = res.list[0];
      const line = c => `${moveName(c.move, s, seat)} ${(100 * c.mean).toFixed(1)}%${c.out ? "*" : ""}`;
      if (mine && best !== mine) {
        const k = Math.min(...[mine, best].map(c => c.n)), d = [];
        // the paired gap is not kept by think(); the means over the deals each had are what is compared
        const diff = best.mean - mine.mean;
        if (diff >= gap) {
          behind++;
          console.log(`move ${i} turn ${s.turn} ${s.step}${s.stack.length ? " (stack " + s.stack.map(x => x.name).join(",") + ")" : ""}: played ${line(mine)} (n ${mine.n}); best ${line(best)}; life ${s.life.join("/")}, hands ${s.hand.map(h => h.length).join("/")}, lib ${s.lib.length}`);
          console.log("    others: " + res.list.slice(0, 5).map(line).join("; "));
        }
      }
    }
  }
  const r = applyMove(shownRules, G, who, move, g.started);
  if (r.error) { console.log("replay stopped at", i, r.error); break; }
  G = r.G;
}
console.log(`${n} decisions weighed, ${behind} where the move played came out ${gap * 100}+ points behind the best`);
