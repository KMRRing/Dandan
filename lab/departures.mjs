// Departure mining (12 November 2026, the planning chat, aa-i2): the live search at Deep weighs every legal move, and so plays moves
// Medium's shortlist never offers, moves no training game contains. Which of them are blunders? Over decisions of finished
// self-play games (a job's parts) and Korbi's kept games (the game-records branch): one Deep search with every legal move and
// the given judge, at priority decisions where leaving the shortlist is possible (more legal moves than Medium's shortlist);
// where its pick is off the shortlist, the real game is played on to its end `plays` times after that move and as many after
// the move the shortlist rule picks from the same values (its protections included: think's shortPick), from the real
// position (real hands, real library, nothing dealt again), the play-outs differing only in the engines' seeds, the same for
// both moves; both seats Hard at `deals` with the same judge, the shortlist only (Fable, 12 Nov 16:30Z). A line a case: the kind of move, the search's estimated gain over the best
// shortlist move, the gain the play-outs realised, and the position (for training). lab/departures-sum.mjs tables them.
// usage: node lab/departures.mjs <shard> <shards> <out> <self-play job> <decisions in all> [judge s4d.json] [cases cap 1000]
//        [play-outs 8] [deals 128] [search deals 1024]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { labStore, J } from "./lib.mjs";
import { rules, shownRules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { think, thinkMove, candidates } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { policyMove } from "../dandan-policy.js";
import { moves as legal } from "../dandan-engine.js";
import { perm } from "../dandan-core.js";
import { DECK } from "../dandan-cards.js";

const [shard, shards, out, job] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const want = Math.ceil(Number(process.argv[6] || 20000) / shards), judgeFile = process.argv[7] || "s4d.json";
const cap = Math.ceil(Number(process.argv[8] || 1000) / shards), plays = Number(process.argv[9] || 8), deals = Number(process.argv[10] || 128), searchDeals = Number(process.argv[11] || 1024);
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${judgeFile}`, import.meta.url), "utf8")).layers);
const key = m => JSON.stringify(m), realRandom = Math.random;
fs.writeFileSync(out, "");

// ---------- the games: this shard's share of the kept games first (where Korbi saw the misplays: every eligible decision is
// searched), then of the self-play parts, which fill the shard's quota (Fable, 16:45Z) ----------
const games = [];
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
  execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${tmp}`, { stdio: "ignore" });
  const files = fs.readdirSync(path.join(tmp, "games")).filter(f => f.endsWith(".json")).sort();
  for (let k = shard; k < files.length; k += shards) {
    const rec = JSON.parse(fs.readFileSync(path.join(tmp, "games", files[k]), "utf8")), g = rec.game;
    let moves; try { moves = JSON.parse(g.moves); } catch { continue; }
    if (moves?.length === g.n) games.push({ kept: true, src: `kept:${files[k]}`, R: shownRules, opts: { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } }, moves, now: g.started });
  }
} catch { /* no game-records: self-play only */ }

// ---------- the kind of a move: card, mode, whose target ----------
function kindOf(s, seat, m) {
  const t = m.targets?.[0], p = t?.id != null ? perm(s, t.id) : null;
  return { t: m.t, card: m.card != null ? DECK[m.card] ?? "token" : null, mode: m.mode ?? null, target: !t ? null : t.k === "p" ? (t.seat === seat ? "own player" : "their player") : t.sid != null ? "spell" : p ? (p.ctl === seat ? "own" : "theirs") : t.k };
}
// (restored 12 Nov 19:10Z: cf4d293 dropped these two, and every shard of aa-i2c stopped at its first case)
/** The real game played on from record `G` (before its next move) after `m` by `seat`, the engines salted by `salt`: 1 if `seat` won, 0 lost, ½ both. */
function playOn(R, G, seat, m, salt) {
  let r = applyMove(R, G, seat, m, 0);
  if (r.error) return null;
  G = r.G;
  for (let i = 0; i < 4000 && !R.over(G.state); i++) {
    const who = R.toMove(G.state), x = R.restore(J(G.state));
    Math.random = seeded(mix(salt, i + 1));
    const mv = thinkMove(x, who, { deals, ms: 1e9, judge, all: false, salt });
    Math.random = realRandom;
    r = applyMove(R, G, who, mv, 0);
    if (r.error) return null;
    G = r.G;
  }
  const w = G.state.winner;
  return w === seat ? 1 : w == null || w < 0 ? 0.5 : 0;
}
const store = await labStore();
const parts = (await store.list(`results/${job}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)).sort();
for (let k = shard; k < parts.length; k += shards) {
  for (const l of ((await store.get(parts[k])) || "").split("\n").filter(Boolean)) {
    try { const g = JSON.parse(l); games.push({ src: `${job}:${g.game}`, R: rules, opts: { seats: 2, seed: g.seed, now: 0 }, moves: g.moves, now: 0 }); } catch {}
  }
}

// ---------- the decisions: priority decisions that can leave the shortlist; every one in a kept game, one in five by the seed in
// self-play, till the shard's share (the kept games are searched whole, whatever the share) ----------
let searched = 0, cases = 0, offs = 0;
for (const game of games) {
  if (!game.kept && (searched >= want || cases >= cap)) break;
  let G = newRecord(game.R, game.opts);
  for (let i = 0; i < game.moves.length && (game.kept || (searched < want && cases < cap)); i++) {
    const [who, move] = game.moves[i], st = G.state, p = st.pending;
    const pick = !p && (game.kept || seeded(mix(game.opts.seed, 7000001 + i))() < 0.2) && legal(st, who, true).length
      && candidates(game.R.restore(J(st)), who, { all: true }).length > candidates(game.R.restore(J(st)), who, { all: false }).length;
    if (pick) {
      const s = game.R.restore(J(st));
      Math.random = seeded(mix(game.opts.seed, 9000001 + i));
      const r = think(s, who, { deals: searchDeals, ms: 1e9, all: true, offCheck: true, judge });
      Math.random = realRandom;
      if (!r.only) {
        searched++;
        if (r.off) {
          offs++;
          const sp = r.shortPick, sb = sp && r.list.find(c => key(c.move) === key(sp));
          if (sb && key(sp) !== key(r.best)) {
            cases++;
            const a = [], b = [];
            for (let k = 0; k < plays; k++) { const salt = mix(game.opts.seed, 1000 * i + k + 1); a.push(playOn(game.R, G, who, r.best, salt)); b.push(playOn(game.R, G, who, sp, salt)); }
            const ok = a.map((x, k) => (x == null || b[k] == null ? null : x - b[k])).filter(x => x != null);
            const mean = ok.length ? ok.reduce((x, y) => x + y, 0) / ok.length : null;
            const sd = ok.length > 1 ? Math.sqrt(ok.reduce((x, y) => x + (y - mean) ** 2, 0) / (ok.length - 1)) : null;
            fs.appendFileSync(out, JSON.stringify({ src: game.src, i, seat: who, turn: st.turn, lib: st.lib.length, kind: kindOf(st, who, r.best),
              pick: r.best, short: sp, est: +(r.list[0].mean - sb.mean).toFixed(4), real: mean == null ? null : +mean.toFixed(4), realSe: sd == null ? null : +(sd / Math.sqrt(ok.length)).toFixed(4), plays: ok.length, a, b, state: st }) + "\n");
          }
        }
      }
    }
    const res = applyMove(game.R, G, who, move, game.now);
    if (res.error) break;
    G = res.G;
  }
}
console.log(JSON.stringify({ shard, games: games.length, searched, offShortlist: offs, cases }));
