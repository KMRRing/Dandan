// Three checks on departure mining (lab/departures.mjs), 13 November 2026, the planning chat (Fable 00:20Z). Each writes a line
// a case, as departures.mjs does (src, i, seat, turn, lib, kind, pick, alt, est, real, realSe, plays, a, b; the horizon
// check adds ha, hb), so lab/departures-sum.mjs tables them too.
//   control <self-play job> <cases in all>: the same 8 + 8 play-outs for picks that are ON the shortlist but are not Medium's
//     move, against Medium's move, from the same sources (the kept games and the self-play job), one decision in five by the
//     seed. If est exceeds real by as much here, the over-rating is the selection of the best of many noisy values, not the
//     move list. At most 40% of the cases from kept games.
//   horizon <mined job> <its parts, comma-separated>: every case of those parts again, each play-out replayed (the same salts,
//     so the same games) to where the look-ahead stops (turn + 2, or past the library's end) and the judge's value there for
//     both branches (ha, hb: each play-out's value at the horizon). est above the horizon value is the look-ahead's error;
//     the horizon value above the result is the judge's.
//   flagged <match jobs, comma-separated>: every move dandan-flaws.js flags in those matches' kept games, from the position
//     before it: 8 + 8 play-outs of the flagged move against the best other move of the same search (the side's own: every
//     legal move for side A, the shortlist for side B).
// usage: node lab/mine-checks.mjs <shard> <shards> <out> <mode> <arg> [arg 2] [judge s4d.json] [play-outs 8] [deals 128] [search deals 1024]
import fs from "node:fs";
import { labStore, J } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { think, candidates, endOfLibrary } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { moves as legal } from "../dandan-engine.js";
import { flawAt } from "../dandan-flaws.js";
import { kindOf, playOn, keptGames, selfPlayGame, recordAt, gameBySrc } from "./mine-lib.mjs";

const [shard, shards, out, mode, arg, arg2] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6], process.argv[7]];
const judgeFile = process.argv[8] || "s4d.json", plays = Number(process.argv[9] || 8), deals = Number(process.argv[10] || 128), searchDeals = Number(process.argv[11] || 1024);
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${judgeFile}`, import.meta.url), "utf8")).layers);
const key = m => JSON.stringify(m), realRandom = Math.random, store = await labStore();
fs.writeFileSync(out, "");

/** 8 + 8 play-outs of `m` and `alt` by `who` from record G (the same salts for both), written as a case line. */
function compare(game, G, i, who, m, alt, est, extra = {}, to = null) {
  const a = [], b = [], ha = [], hb = [];
  for (let k = 0; k < plays; k++) {
    const salt = mix(game.opts.seed, 1000 * i + k + 1);
    const x = playOn(game.R, G, who, m, salt, { deals, judge, to }), y = playOn(game.R, G, who, alt, salt, { deals, judge, to });
    a.push(x.result); b.push(y.result); ha.push(x.horizon); hb.push(y.horizon);
  }
  const ok = a.map((x, k) => (x == null || b[k] == null ? null : x - b[k])).filter(x => x != null);
  const mean = ok.length ? ok.reduce((x, y) => x + y, 0) / ok.length : null;
  const sd = ok.length > 1 ? Math.sqrt(ok.reduce((x, y) => x + (y - mean) ** 2, 0) / (ok.length - 1)) : null;
  const st = G.state;
  fs.appendFileSync(out, JSON.stringify({ src: game.src, i, seat: who, turn: st.turn, lib: st.lib.length, kind: kindOf(st, who, m), pick: m, alt,
    est: +est.toFixed(4), real: mean == null ? null : +mean.toFixed(4), realSe: sd == null ? null : +(sd / Math.sqrt(ok.length)).toFixed(4), plays: ok.length, a, b,
    ...(to != null && { ha, hb }), ...extra, state: st }) + "\n");
}

let cases = 0;
if (mode === "control") {
  // the sources as departures.mjs reads them: this shard's share of the kept games, then of the self-play job's parts
  const cap = Math.ceil(Number(arg2 || 300) / shards), capKept = Math.round(0.4 * cap);
  const games = keptGames().filter(g => g.at % shards === shard);
  const parts = (await store.list(`results/${arg}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)).sort();
  for (let k = shard; k < parts.length; k += shards) for (const l of ((await store.get(parts[k])) || "").split("\n").filter(Boolean)) { try { games.push(selfPlayGame(arg, JSON.parse(l))); } catch {} }
  let kept = 0, searched = 0;
  for (const game of games) {
    if (cases >= cap) break;
    if (game.kept && kept >= capKept) continue;
    let G = newRecord(game.R, game.opts);
    for (let i = 0; i < game.moves.length && cases < cap && !(game.kept && kept >= capKept); i++) {
      const [who, move] = game.moves[i], st = G.state;
      const pick = !st.pending && seeded(mix(game.opts.seed, 7000001 + i))() < 0.2 && legal(st, who, true).length
        && candidates(game.R.restore(J(st)), who, { all: true }).length > candidates(game.R.restore(J(st)), who, { all: false }).length;
      if (pick) {
        Math.random = seeded(mix(game.opts.seed, 9000001 + i));
        const r = think(game.R.restore(J(st)), who, { deals: searchDeals, ms: 1e9, all: true, offCheck: true, judge });
        Math.random = realRandom;
        if (!r.only) {
          searched++;
          const med = r.list.find(c => c.i === 0), best = r.list[0];
          if (!r.off && med && key(r.best) !== key(med.move)) { cases++; if (game.kept) kept++; compare(game, G, i, who, r.best, med.move, best.mean - med.mean); }
        }
      }
      const res = applyMove(game.R, G, who, move, game.now);
      if (res.error) break;
      G = res.G;
    }
  }
  console.log(JSON.stringify({ shard, mode, games: games.length, searched, cases, kept }));
} else if (mode === "horizon") {
  // this shard's part of the mined job: shard n takes the n-th part listed
  const part = arg2.split(",")[shard];
  const kept = keptGames(), specs = new Map();
  const rows = ((await store.get(`results/${arg}/part-${part}.jsonl`)) || "").split("\n").filter(l => l.startsWith("{")).map(l => JSON.parse(l));
  let missing = 0;
  for (const c of rows) {
    const game = await gameBySrc(store, c.src, kept, specs);
    if (!game) { missing++; continue; }
    const G = recordAt(game, c.i), to = c.state.turn + Math.max(2, endOfLibrary(c.state));
    const ha = [], hb = [];
    for (let k = 0; k < c.plays && k < plays; k++) {
      const salt = mix(game.opts.seed, 1000 * c.i + k + 1);
      ha.push(playOn(game.R, G, c.seat, c.pick, salt, { deals, judge, to, stop: true }).horizon);
      hb.push(playOn(game.R, G, c.seat, c.short, salt, { deals, judge, to, stop: true }).horizon);
    }
    // the first case of each shard also played to its end once, against the mined result: the same salts must give the same game
    const same = cases === 0 ? playOn(game.R, G, c.seat, c.pick, mix(game.opts.seed, 1000 * c.i + 1), { deals, judge }).result === c.a[0] : undefined;
    const gaps = ha.map((x, k) => (x == null || hb[k] == null ? null : x - hb[k])).filter(x => x != null);
    const horizon = gaps.length ? gaps.reduce((x, y) => x + y, 0) / gaps.length : null;
    cases++;
    fs.appendFileSync(out, JSON.stringify({ ...c, state: undefined, ha, hb, horizon: horizon == null ? null : +horizon.toFixed(4), same }) + "\n");
  }
  console.log(JSON.stringify({ shard, mode, part, cases, missing }));
} else if (mode === "flagged") {
  // every flagged move of the matches' kept games, in a fixed order; this shard takes every shards-th
  const found = [];
  for (const job of arg.split(",")) {
    const specA = JSON.parse((await store.get(`jobs/${job}.json`)) || (await store.get(`retired/${job}.json`))).args.split(/\s+/)[3];
    const names = (await store.list(`results/${job}/`)).filter(n => /\/stdout-\d+\.txt$/.test(n)).sort(), seen = new Set();
    for (const n of names) for (const l of ((await store.get(n)) || "").split("\n")) {
      if (!l.startsWith('{"pair"')) continue;
      const g = JSON.parse(l);
      if (seen.has(`${g.seed}:${g.aSeat}`)) continue;
      seen.add(`${g.seed}:${g.aSeat}`);
      let G = newRecord(rules, { seats: 2, seed: g.seed, now: 0 });
      for (const [i, [seat, move]] of g.moves.entries()) {
        const f = flawAt(rules.restore(J(G.state)), seat, move);
        if (f) found.push({ job, specA, g, i, seat, move, side: seat === g.aSeat ? "A" : "B", flaw: f.kind });
        const r = applyMove(rules, G, seat, move, 0);
        if (r.error) break;
        G = r.G;
      }
    }
  }
  for (let k = shard; k < found.length; k += shards) {
    const f = found[k], game = { src: `${f.job}:${f.g.seed}:${f.g.aSeat}`, R: rules, opts: { seats: 2, seed: f.g.seed, now: 0 }, moves: f.g.moves, now: 0 };
    const G = recordAt(game, f.i);
    Math.random = seeded(mix(f.g.seed, 9000001 + f.i));
    const r = think(rules.restore(J(G.state)), f.seat, { deals: searchDeals, ms: 1e9, all: f.side === "A" && !/short/.test(f.specA), judge });
    Math.random = realRandom;
    const flagged = r.list.find(c => key(c.move) === key(f.move)), alt = r.list.find(c => key(c.move) !== key(f.move));
    if (!alt) continue;
    cases++;
    compare(game, G, f.i, f.seat, f.move, alt.move, flagged ? flagged.mean - alt.mean : NaN, { side: f.side, job: f.job, flaw: f.flaw });
  }
  console.log(JSON.stringify({ shard, mode, flagged: found.length, cases }));
} else throw new Error(`no mode ${mode}`);
