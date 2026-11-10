// The self-audit (10 November 2026, Korbi: "the medium bot's gaps are most easily found where its actions differ from the
// player's; have Hard assess each of the player's actions, especially in the long games the player won though the judge was
// against them, take the hundred it disagreed with most, and categorize them"). Every kept game played again; at each
// decision of the human (seat 0) with more than one move worth weighing, Hard weighs it as it would its own (its view of the
// game: the other hand dealt from what it has seen, `deals` deals), and for every decision of either seat the judge's chance
// for the human just before and just after it. One row a decision:
//   { file, turn, i (move number), seat, step, lib, life, hands, lands, played, best, gap (Hard's best less the move played,
//     from the human's side; null when Hard had no say), jBefore, jAfter, won, behind (the human was at 35% or less by the
//     judge with 5+ turns left in this game) }
// lab/audit-sum.mjs ranks them. usage: node lab/audit.mjs <shard> <shards> <out.jsonl> [deals 1024] [games folder]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";
import { winChance } from "../dandan-eval.js";
import { moveName } from "../dandan-words.js";
import { isLand } from "../dandan-core.js";

const [shard, shards, out, deals = 1024] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 1024)];
let dir = process.argv[6];
if (!dir) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
  execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${dir}`, { stdio: "inherit" });
  dir = path.join(dir, "games");
}
const J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m);
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
for (let k = shard; k < files.length; k += shards) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[k]), "utf8")), g = rec.game;
  let moves;
  try { moves = JSON.parse(g.moves); } catch { continue; }
  if (!moves?.length || moves.length !== g.n || rec.result?.drawn) continue;
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  const rows = [], curve = [];
  let ok = true;
  for (let i = 0; i < moves.length; i++) {
    const [seat, move] = moves[i], st = G.state, s = shownRules.restore(J(st));
    const jBefore = winChance(s, 0);
    if (!st.stack.length && !st.pending) curve.push({ turn: st.turn, p: jBefore });
    let best = null, gap = null;
    if (seat === 0 && move.t !== "keep" && move.t !== "mull") {
      const r = think(s, 0, { deals, ms: 1e9 });
      if (!r.only) {
        const mine = r.list.find(c => key(c.move) === key(move)), top = r.list[0];
        best = moveName(top.move, s, 0);
        gap = mine && Number.isFinite(mine.mean) ? +(top.mean - mine.mean).toFixed(4) : null;
      }
    }
    const lands = x => st.bf.filter(p => p.ctl === x && p.id < 80 && isLand(p)).length;
    const row = { file: files[k], turn: st.turn, i, seat, step: st.step, lib: st.lib.length, life: [...st.life], hands: [st.hand[0].length, st.hand[1].length], lands: [lands(0), lands(1)], played: moveName(move, s, seat), best, gap, jBefore: +jBefore.toFixed(4) };
    const r = applyMove(shownRules, G, seat, move, g.started);
    if (r.error) { ok = false; break; }
    G = r.G;
    row.jAfter = +winChance(shownRules.restore(J(G.state)), 0).toFixed(4);
    if (seat === 0 && best != null || Math.abs(row.jAfter - row.jBefore) >= 0.1) rows.push(row);
  }
  if (!ok || !shownRules.over(G.state)) continue;
  const won = G.state.winner === 0 ? 1 : 0, turns = G.state.turn;
  const behind = won === 1 && curve.some(c => c.p <= 0.35 && turns - c.turn >= 5);
  for (const row of rows) fs.appendFileSync(out, JSON.stringify({ ...row, won, behind }) + "\n");
}
