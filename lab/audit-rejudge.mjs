// The self-audit's tendency table (lab/audit-sum.mjs) read again by other judges (Korbi, 11 November 2026: how does the new
// judge feel about it?): for each of the human's disagreements with Hard in an audit job, the position is played again from
// the kept game and judged by each judge given; by kind, the judges' average chance for the human beside how often they won.
// usage: node lab/audit-rejudge.mjs <audit job> <judge jobs, comma-separated; job:variant for lab/judge-variants.mjs>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { readParts } from "./lib.mjs";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { makeJudge, winChance } from "../dandan-eval.js";

const [audit, judgeIds] = [process.argv[2], process.argv[3] ?? ""];
const judges = [["today", winChance]];
for (const spec of judgeIds.split(",").filter(Boolean)) {
  const [id, pick] = spec.split(":");
  const lines = (await readParts(id)).flatMap(t => t.split("\n").filter(Boolean)).map(l => JSON.parse(l));
  judges.push([spec, makeJudge((pick == null ? lines[0] : lines.find(l => l.variant === Number(pick))).layers)]);
}
const rows = (await readParts(audit)).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
/** The kind of a disagreement: what the human did against what Hard would have. */
const kind = r => {
  const p = r.played, b = r.best, idle = /^(pass|let it resolve)$/.test(p);
  if (/sacrifice Flood Plain/.test(b)) return "Hard: sacrifice Flood Plain";
  if (idle && /(Quicken|Brainstorm|cycle|Clue|Predict|Chart|Lórien|Take Inventory)/.test(b)) return "held mana; Hard would draw/cycle";
  if (idle && /(Memory Lapse|Narset|Metamorphose|Commit|Piracy|Mind Bend|Repulse|Deem|Gone Missing)/.test(b)) return "let it resolve; Hard would answer";
  if (idle && /Dandân/.test(b)) return "held a Dandân; Hard would cast it";
  if (/(Memory Lapse|Narset|Commit)/.test(p)) return "counter choices";
  if (/Dandân/.test(p) && !/Dandân/.test(b)) return "cast a Dandân; Hard would not";
  if (/block|attack/.test(p)) return "combat";
  if (/^(play|fetch) /.test(p)) return "land choice";
  if (/(Quicken|Brainstorm|cycle|Clue|Predict|Chart|Lórien|Take Inventory|Retrieval)/.test(p)) return "drew/dug differently";
  if (/(Mind Bend|Piracy|Metamorphose|Repulse|Deem|Gone Missing)/.test(p)) return "answer choice";
  return "other";
};

const weighed = rows.filter(r => r.seat === 0 && r.gap != null && r.jBefore > 0.15 && r.jBefore < 0.85);
let dir = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${dir}`, { stdio: "inherit" });
dir = path.join(dir, "games");
const J = x => JSON.parse(JSON.stringify(x));
const byFile = new Map();
for (const r of weighed) (byFile.get(r.file) ?? byFile.set(r.file, []).get(r.file)).push(r);
for (const [file, rs] of byFile) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).game, moves = JSON.parse(g.moves), want = new Map(rs.map(r => [r.i, r]));
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  for (let i = 0; i < moves.length && want.size; i++) {
    const r = want.get(i);
    if (r) { const s = shownRules.restore(J(G.state)); r.j = judges.map(([, f]) => f(s, 0)); want.delete(i); }
    const x = applyMove(shownRules, G, moves[i][0], moves[i][1], g.started);
    if (x.error) break;
    G = x.G;
  }
}
const pct = x => (x == null ? "  -" : `${(100 * x).toFixed(0).padStart(3)}%`);
const avg = (a, f) => { const v = a.map(f).filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
console.log(`${"".padEnd(36)}    n games  ${judges.map(([n]) => n.padStart(10)).join(" ")}    won`);
const line = (name, a) => console.log(`${name.padEnd(36)} ${String(a.length).padStart(4)} ${String(new Set(a.map(r => r.file)).size).padStart(5)}  ${judges.map((_, k) => pct(avg(a, r => r.j?.[k])).padStart(10)).join(" ")}   ${pct(avg(a, r => r.won ? 1 : 0))}`);
line("all weighed decisions (baseline)", weighed);
const by = {};
for (const r of weighed.filter(r => r.gap >= 0.02)) (by[kind(r)] ??= []).push(r);
for (const [k, a] of Object.entries(by).sort((x, y) => y[1].length - x[1].length)) line(k, a);
