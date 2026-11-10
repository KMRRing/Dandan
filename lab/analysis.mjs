// The analysis judge (10 November 2026, Korbi: "build an analysis judge that uses the hard + deepest assessment and has all the
// information, then check whether the fluctuations persist or whether it predicts the outcome better"). Every kept game
// (games/*.json of the game-records branch) played again; at the first decision of each turn with more than one move worth
// weighing and nothing on the stack, the position valued for the human (seat 0) twice:
//   judge  the game's judge (dandan-eval.js), the number the search ends on two turns ahead;
//   deep   Hard's look-ahead at `deals` (2,048 = Deepest) for the seat to move, with the other hand known (only the library's
//          order dealt): the mean of the move it would play.
// One row a position: { file, turn, active, lib, judge, deep, won, left }. lab/analysis-sum.mjs sums them: how far each
// zigzags from one turn to the next, and how well each predicts the result.
// usage: node lab/analysis.mjs <shard> <shards> <out.jsonl> [deals 2048] [games folder: fetched from the game-records branch]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";
import { winChance } from "../dandan-eval.js";

const [shard, shards, out, deals = 2048] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 2048)];
let dir = process.argv[6];
if (!dir) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
  execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${dir}`, { stdio: "inherit" });
  dir = path.join(dir, "games");
}
const J = x => JSON.parse(JSON.stringify(x));
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
for (let k = shard; k < files.length; k += shards) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[k]), "utf8")), g = rec.game;
  let moves;
  try { moves = JSON.parse(g.moves); } catch { continue; }
  if (!moves?.length || moves.length !== g.n || rec.result?.drawn) continue;
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  const rows = [];
  let doneTurn = -1, ok = true;
  for (let i = 0; i < moves.length; i++) {
    const st = G.state, who = moves[i][0];
    if (st.turn !== doneTurn && who === st.active && !st.stack.length && !st.pending && st.step !== "mull") {
      const s = shownRules.restore(J(st)), r = think(s, who, { deals, ms: 1e9, open: true });
      if (!r.only) {
        doneTurn = st.turn;
        const forHuman = p => (who === 0 ? p : 1 - p);
        rows.push({ file: files[k], turn: st.turn, active: who, lib: st.lib.length, judge: +winChance(s, 0).toFixed(4), deep: +forHuman(r.list[0].mean).toFixed(4) });
      }
    }
    const r = applyMove(shownRules, G, who, moves[i][1], g.started);
    if (r.error) { ok = false; break; }
    G = r.G;
  }
  if (!ok || !shownRules.over(G.state)) continue;
  const won = G.state.winner === 0 ? 1 : 0, turns = G.state.turn;
  for (const row of rows) fs.appendFileSync(out, JSON.stringify({ ...row, won, left: turns - row.turn }) + "\n");
}
