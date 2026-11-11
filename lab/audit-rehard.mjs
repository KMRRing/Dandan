// Would Hard agree with the human more with another judge? (Korbi, 11 November 2026.) Every weighed decision of the human's
// in an audit job (contested positions) is searched again by Hard twice over the same deals, with today's judge and with
// the one given; for each: Hard's choice, and how far the human's move falls short of it by that search. One row a decision.
// lab/audit-rehard-sum.mjs gives, by tendency, how often each Hard picks the human's move and the average shortfall.
// usage: node lab/audit-rehard.mjs <shard> <shards> <out> <audit job> <judge job, or job:variant> [deals 256]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { readParts } from "./lib.mjs";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { think } from "../dandan-think.js";
import { makeJudge, winChance } from "../dandan-eval.js";
import { moveName } from "../dandan-words.js";

const [shard, shards, out, audit, spec] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6]];
const deals = Number(process.argv[7] ?? 256);
const [id, pick] = spec.split(":");
const lines = (await readParts(id)).flatMap(t => t.split("\n").filter(Boolean)).map(l => JSON.parse(l));
const judgeNew = makeJudge((pick == null ? lines[0] : lines.find(l => l.variant === Number(pick))).layers);
const rows = (await readParts(audit)).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
const weighed = rows.filter(r => r.seat === 0 && r.gap != null && r.jBefore > 0.15 && r.jBefore < 0.85);
const files = [...new Set(weighed.map(r => r.file))].sort();
let dir = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${dir}`, { stdio: "inherit" });
dir = path.join(dir, "games");
const J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m);
for (let f = shard; f < files.length; f += shards) {
  const file = files[f], want = new Map(weighed.filter(r => r.file === file).map(r => [r.i, r]));
  const g = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).game, moves = JSON.parse(g.moves);
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  for (let i = 0; i < moves.length && want.size; i++) {
    const r = want.get(i), [seat, move] = moves[i];
    if (r) {
      want.delete(i);
      const one = judge => {
        const t = think(shownRules.restore(J(G.state)), 0, { deals, ms: 1e9, judge });
        const mine = t.list.find(c => key(c.move) === key(move));
        return { best: moveName(t.best, G.state, 0), agrees: key(t.best) === key(move), short: mine && Number.isFinite(mine.mean) && Number.isFinite(t.list[0].mean) ? +(t.list[0].mean - mine.mean).toFixed(4) : null };
      };
      fs.appendFileSync(out, JSON.stringify({ file, i, played: r.played, best: r.best, gap: r.gap, won: r.won, today: one(winChance), next: one(judgeNew) }) + "\n");
    }
    const x = applyMove(shownRules, G, seat, move, g.started);
    if (x.error) break;
    G = x.G;
  }
}
