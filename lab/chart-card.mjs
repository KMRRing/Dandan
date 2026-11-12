// The end-of-game chart's report card (12 November 2026, the planning chat): over Korbi's kept games (games/*.json of the
// game-records branch), at each turn's start (the active seat's first decision, nothing on the stack), the chance the
// chart could show for seat 0 against whether seat 0 won:
//   today   the chart as it is: the built-in old net plus the deck-out pull (dandan-advantage.js deckedChance)
//   net     the named net alone, one reading
//   la<d>   Hard's look-ahead with both hands open (`open: true`), the named net judging where the lines end, at each of
//           the given deals (256, 1024 = Deep); the library's order stays unknown
// with the seconds each look-ahead took. One line a position; lab/chart-card-sum.mjs (or the fleet's reader) sums them.
// usage (a lab job, a game a shard): node lab/chart-card.mjs <shard> <shards> <out> [net s4d.json] [deals 256,1024]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { shownRules as R } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { makeJudge } from "../dandan-eval.js";
import { think } from "../dandan-think.js";
import { deckedChance } from "../dandan-advantage.js";

const [shard, shards, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const netFile = process.argv[5] || "s4d.json", dealsList = (process.argv[6] || "256,1024").split(",").map(Number);
const J = x => JSON.parse(JSON.stringify(x));
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${netFile}`, import.meta.url), "utf8")).layers);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${tmp}`, { stdio: "inherit" });
const dir = path.join(tmp, "games"), files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
fs.writeFileSync(out, "");
for (let k = shard; k < files.length; k += shards) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[k]), "utf8")), g = rec.game;
  let moves;
  try { moves = JSON.parse(g.moves); } catch { continue; }
  if (!moves?.length || moves.length !== g.n || rec.result?.drawn) continue;
  let G = newRecord(R, { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  const rows = [];
  let doneTurn = -1, ok = true;
  for (let i = 0; i < moves.length; i++) {
    const st = G.state, who = moves[i][0];
    if (st.turn !== doneTurn && who === st.active && !st.stack.length && !st.pending && st.step !== "mull") {
      doneTurn = st.turn;
      const s = R.restore(J(st)), row = { file: files[k], turn: st.turn, active: who, lib: st.lib.length, today: +deckedChance(s, 0).toFixed(4), net: +judge(s, 0).toFixed(4) };
      for (const d of dealsList) {
        const t0 = Date.now(), r = think(R.restore(J(st)), who, { deals: d, ms: 1e9, open: true, judge });
        const p = r.only ? judge(s, who) : r.list[0].mean;
        row[`la${d}`] = +(who === 0 ? p : 1 - p).toFixed(4); row[`ms${d}`] = Date.now() - t0;
      }
      rows.push(row);
    }
    const r = applyMove(R, G, who, moves[i][1], g.started);
    if (r.error) { ok = false; break; }
    G = r.G;
  }
  if (!ok || !R.over(G.state) || G.state.winner < 0) continue;
  const won = G.state.winner === 0 ? 1 : 0;
  for (const row of rows) fs.appendFileSync(out, JSON.stringify({ ...row, won }) + "\n");
}
