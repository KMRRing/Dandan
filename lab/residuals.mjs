// Where the judge is wrong, by kind of position (10 November 2026, Korbi: "with the mana advantage a player draws cards and
// answers cheaply later, starving the other out of cards; away from death even a Dandân isn't scary; with 3+ more lands
// than the other no comeback works"). At the start of each turn (nothing on the stack) the judge's chance for the player
// to move, against whether that player won: the mean of (won - judge) in each bucket of land difference, hand difference,
// Dandâns and life. A judge that knew the game would be about 0 in every bucket; if a mana lead wins more often than it
// says, the land buckets climb from left to right.
// Games: self-play jobs in the bucket (job ids, comma-separated: spb01,spb02), a folder of kept games (games/*.json), or
// "kept": the kept games fetched from the game-records branch. judge: a lab/judge-train.mjs job whose network to use in place
// of the game's (to see whether a trained judge prices these positions better); the Brier score of the judge is printed too.
// usage: node lab/residuals.mjs <shard> <shards> <out> <job ids | folder | kept> [judge job]     (it runs whole)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { readParts } from "./lib.mjs";
import { shownRules, rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { winChance, makeJudge } from "../dandan-eval.js";
import { isLand } from "../dandan-core.js";
import { DECK } from "../dandan-cards.js";

let src = process.argv[5];
const judgeJob = process.argv[6];
const judge = judgeJob ? makeJudge(JSON.parse((await readParts(judgeJob))[0].split("\n")[0]).layers) : winChance;
if (src === "kept") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
  execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${tmp}`, { stdio: "inherit" });
  src = path.join(tmp, "games");
}
const games = []; // { start: newRecord options, moves: [[seat, move]], kind }
if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
  for (const f of fs.readdirSync(src).filter(f => f.endsWith(".json"))) {
    const rec = JSON.parse(fs.readFileSync(path.join(src, f), "utf8")), g = rec.game;
    let moves; try { moves = JSON.parse(g.moves); } catch { continue; }
    if (moves?.length && moves.length === g.n) games.push({ R: shownRules, opts: { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } }, moves, now: g.started });
  }
} else {
  for (const id of src.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    games.push({ R: rules, opts: { seats: 2, seed: r.seed, now: 0 }, moves: r.moves, now: 0 });
  }
}
const rows = [];
for (const { R, opts, moves, now } of games) {
  let G = newRecord(R, opts), last = -1, ok = true;
  const here = [];
  for (const [seat, move] of moves) {
    const s = G.state;
    if (s.turn !== last && !s.stack.length && !s.pending && s.step !== "mull") {
      last = s.turn;
      const me = s.active, foe = 1 - me, lands = x => s.bf.filter(p => p.ctl === x && p.id < 80 && isLand(p)).length;
      const dd = x => s.bf.filter(p => p.ctl === x && DECK[p.id] === "Dandân").length;
      here.push({ me, p: judge(R.restore(JSON.parse(JSON.stringify(s))), me), land: lands(me) - lands(foe), hand: s.hand[me].length - s.hand[foe].length, ddMine: dd(me), ddTheirs: dd(foe), life: s.life[me], lib: s.lib.length });
    }
    const r = applyMove(R, G, seat, move, now);
    if (r.error) { ok = false; break; }
    G = r.G;
  }
  if (!ok || !R.over(G.state) || G.state.winner < 0) continue;
  for (const h of here) rows.push({ ...h, won: G.state.winner === h.me ? 1 : 0 });
}
const line = (name, b) => {
  if (!b.length) return;
  const m = b.reduce((a, r) => a + r.won - r.p, 0) / b.length, sd = Math.sqrt(b.reduce((a, r) => a + (r.won - r.p - m) ** 2, 0) / Math.max(1, b.length - 1) / b.length);
  const pm = b.reduce((a, r) => a + r.p, 0) / b.length, wm = b.reduce((a, r) => a + r.won, 0) / b.length;
  console.log(`  ${name.padEnd(22)} ${String(b.length).padStart(5)} positions  judge ${(100 * pm).toFixed(0).padStart(3)}%  won ${(100 * wm).toFixed(0).padStart(3)}%  won - judge ${(m >= 0 ? "+" : "") + (100 * m).toFixed(1)} ± ${(100 * sd).toFixed(1)}`);
};
const all = rows.filter(r => r.lib >= 15), who = process.env.MOVER;   // MOVER=0 or 1: only positions with that seat to move
const mid = who === undefined ? all : all.filter(r => r.me === Number(who));
const brier = mid.reduce((a, r) => a + (r.p - r.won) ** 2, 0) / mid.length;
console.log(`games ${games.length}, positions ${rows.length} (library 15+: ${mid.length}); the player to move, start of the turn; judge ${judgeJob || "the game's"}, Brier ${brier.toFixed(4)}`);
console.log("by lands, theirs subtracted:");
for (const [n, lo, hi] of [["3+ fewer", -99, -3], ["2 fewer", -2, -2], ["1 fewer", -1, -1], ["even", 0, 0], ["1 more", 1, 1], ["2 more", 2, 2], ["3+ more", 3, 99]]) line(n, mid.filter(r => r.land >= lo && r.land <= hi));
console.log("by cards in hand, theirs subtracted:");
for (const [n, lo, hi] of [["3+ fewer", -99, -3], ["1-2 fewer", -2, -1], ["even", 0, 0], ["1-2 more", 1, 2], ["3+ more", 3, 99]]) line(n, mid.filter(r => r.hand >= lo && r.hand <= hi));
console.log("a Dandân of theirs on the table:");
line("life 13+", mid.filter(r => r.ddTheirs > 0 && r.life >= 13));
line("life 5-12", mid.filter(r => r.ddTheirs > 0 && r.life >= 5 && r.life <= 12));
line("life 4 or less", mid.filter(r => r.ddTheirs > 0 && r.life <= 4));
console.log("a land lead of 2+ and their Dandân on the table, life 9+:");
line("", mid.filter(r => r.land >= 2 && r.ddTheirs > 0 && r.life >= 9));
