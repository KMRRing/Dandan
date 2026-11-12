// The value nets' report card on Korbi's own games (12 November 2026, the planning chat's item 2): for each judge named, over
// the kept games (games/*.json of the game-records branch), played again under the shown rules:
//   1. residuals: at the start of each turn (nothing on the stack, library 15+), the judge's chance for the player to move
//      against whether that player won: Brier, and won − judge by land lead and by card lead (as lab/residuals.mjs), each
//      also split by whose lead it is (12 Nov, the planning chat: Monte wins most of these games, so "more lands won 71%" may
//      mostly mean that player was Monte), and Monte's seat by the library's size (over 40, 21 to 40, 20 or fewer);
//   2. hand flaws by card: at each first main phase, each card in each hand taken out (to the bottom of the library) and the
//      holder's chance compared; how often a card's going helps by more than a point (as lab/judge-hand.mjs). Mind Bend named;
//   3. Monte's casts the base judge (the first named, v14) disliked: Monte (seat 1) casting a card whose going the base judge
//      rates more than a point better than holding it; with the game and move, and what Hard (at the given deals) plays there
//      with each judge.
// A judge is a file in judges/ (ag-v14.json), "@<job>[#variant]" (a lab job's line), or several joined by "+" (their mean).
// usage (a lab job, one shard): node lab/report-card.mjs <shard> <shards> <out> <name=judge,name=judge,…> [Hard's deals 256]
//        env PARTS=residuals (or flaws, casts, comma-separated) for some parts only
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { readParts } from "./lib.mjs";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { makeJudge } from "../dandan-eval.js";
import { thinkMove } from "../dandan-think.js";
import { isLand } from "../dandan-core.js";
import { DECK } from "../dandan-cards.js";

const out = process.argv[4], deals = Number(process.argv[6]) || 256, R = shownRules, J = x => JSON.parse(JSON.stringify(x));
const PARTS = new Set((process.env.PARTS || "residuals,flaws,casts").split(","));
async function judgeOf(spec) {
  const parts = spec.split("+");
  if (parts.length > 1) { const js = await Promise.all(parts.map(judgeOf)); return (s, me) => js.reduce((a, j) => a + j(s, me), 0) / js.length; }
  if (spec.endsWith(".json")) return makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${spec}`, import.meta.url), "utf8")).layers);
  const [job, v] = spec.replace(/^@/, "").split("#"), ls = (await readParts(job)).flatMap(x => x.split("\n").filter(Boolean)).map(l => JSON.parse(l));
  return makeJudge((v == null ? ls[0] : ls.find(l => l.variant === Number(v))).layers);
}
const named = await Promise.all(process.argv[5].split(",").map(async kv => { const [name, spec] = kv.split("="); return { name, spec, judge: await judgeOf(spec) }; }));
const base = named[0];

// ---------- the kept games ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${tmp}`, { stdio: "inherit" });
const dir = path.join(tmp, "games"), games = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), g = rec.game;
  let moves; try { moves = JSON.parse(g.moves); } catch { continue; }
  if (moves?.length && moves.length === g.n) games.push({ file: f, opts: { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } }, moves, now: g.started });
}

if (process.env.LIMIT) games.splice(Number(process.env.LIMIT));   // for a quick local try
const turns = named.map(() => []), flaws = named.map(() => new Map()), casts = [];
for (const game of games) {
  let G = newRecord(R, game.opts), last = -1, lastMain = -1, ok = true;
  const here = named.map(() => []);
  for (let i = 0; i < game.moves.length; i++) {
    const [seat, move] = game.moves[i], s = G.state;
    if (s.turn !== last && !s.stack.length && !s.pending && s.step !== "mull") {
      last = s.turn;
      const me = s.active, foe = 1 - me, lands = x => s.bf.filter(p => p.ctl === x && p.id < 80 && isLand(p)).length;
      named.forEach((n, k) => here[k].push({ me, p: n.judge(R.restore(J(s)), me), land: lands(me) - lands(foe), hand: s.hand[me].length - s.hand[foe].length, lib: s.lib.length }));
    }
    if (PARTS.has("flaws") && s.turn !== lastMain && s.step === "main1" && !s.stack.length && !s.pending) {
      lastMain = s.turn;
      named.forEach((n, k) => {
        for (const who of [0, 1]) {
          const b = n.judge(R.restore(J(s)), who);
          s.hand[who].forEach((id, c) => {
            const t = R.restore(J(s)); t.hand[who].splice(c, 1); t.lib.push(id);
            const d = n.judge(t, who) - b, name = DECK[id] ?? "Clue", e = flaws[k].get(name) || flaws[k].set(name, { n: 0, bad: 0, sum: 0 }).get(name);
            e.n++; if (d > 0.01) { e.bad++; e.sum += d; }
          });
        }
      });
    }
    // Monte (seat 1) casting a card the base judge would rather not hold
    if (PARTS.has("casts") && seat === 1 && move?.t === "cast" && !s.pending) {
      const k = s.hand[1].indexOf(move.card);
      if (k >= 0) {
        const b = base.judge(R.restore(J(s)), 1), t = R.restore(J(s)); t.hand[1].splice(k, 1); t.lib.push(move.card);
        const d = base.judge(t, 1) - b;
        if (d > 0.01) casts.push({ game: game.file, move: i, turn: s.turn, card: DECK[move.card], without: +d.toFixed(3), state: J(s) });
      }
    }
    const r = applyMove(R, G, seat, move, game.now);
    if (r.error) { ok = false; break; }
    G = r.G;
  }
  if (!ok || !R.over(G.state) || G.state.winner < 0) continue;
  here.forEach((h, k) => h.forEach(x => turns[k].push({ ...x, won: G.state.winner === x.me ? 1 : 0 })));
}

// ---------- the card ----------
const lines = [];
const say = o => { lines.push(JSON.stringify(o)); console.log(JSON.stringify(o)); };
say({ games: games.length, judges: named.map(n => `${n.name}=${n.spec}`), deals });
const bucket = (rows, f, lo, hi) => { const b = rows.filter(r => f(r) >= lo && f(r) <= hi); return b.length ? { n: b.length, judge: +(b.reduce((a, r) => a + r.p, 0) / b.length).toFixed(3), won: +(b.reduce((a, r) => a + r.won, 0) / b.length).toFixed(3) } : null; };
const LAND_ROWS = [["3+ fewer", -99, -3], ["2 fewer", -2, -2], ["1 fewer", -1, -1], ["even", 0, 0], ["1 more", 1, 1], ["2 more", 2, 2], ["3+ more", 3, 99]];
const CARD_ROWS = [["3+ fewer", -99, -3], ["1-2 fewer", -2, -1], ["even", 0, 0], ["1-2 more", 1, 2], ["3+ more", 3, 99]];
const leads = rows => ({ landLead: Object.fromEntries(LAND_ROWS.map(([l, a, b]) => [l, bucket(rows, r => r.land, a, b)])), cardLead: Object.fromEntries(CARD_ROWS.map(([l, a, b]) => [l, bucket(rows, r => r.hand, a, b)])) });
const brierOf = rows => +(rows.reduce((a, r) => a + (r.p - r.won) ** 2, 0) / Math.max(1, rows.length)).toFixed(4);
named.forEach((n, k) => {
  const mid = turns[k].filter(r => r.lib >= 15);
  // whose lead: the rows from Monte's side (seat 1 to move: its lead, its chance, whether it won) and from the human's
  const monte = mid.filter(r => r.me === 1), human = mid.filter(r => r.me === 0);
  const lib = Object.fromEntries([["over 40", 41, 99], ["21 to 40", 21, 40], ["20 or fewer", 0, 20]].map(([l, a, b]) => { const rs = turns[k].filter(r => r.me === 1 && r.lib >= a && r.lib <= b); return [l, rs.length ? { ...bucket(rs, () => 0, 0, 0), brier: brierOf(rs) } : null]; }));
  if (PARTS.has("residuals")) say({ part: "residuals", judge: n.name, positions: mid.length, brier: brierOf(mid), ...leads(mid), monte: leads(monte), human: leads(human), monteByLibrary: lib });
  const all = [...flaws[k].values()].reduce((a, e) => ({ n: a.n + e.n, bad: a.bad + e.bad }), { n: 0, bad: 0 });
  const cards = [...flaws[k]].filter(([, e]) => e.bad).sort((a, b) => b[1].bad / b[1].n - a[1].bad / a[1].n).map(([c, e]) => ({ card: c, held: e.n, betterWithout: +(e.bad / e.n).toFixed(3), mean: +(e.sum / e.bad).toFixed(3) }));
  if (PARTS.has("flaws")) say({ part: "flaws", judge: n.name, cardsTried: all.n, betterWithout: +(all.bad / Math.max(1, all.n)).toFixed(4), mindBend: cards.find(c => c.card === "Mind Bend") || null, cards });
});
if (PARTS.has("casts")) say({ part: "casts", judge: base.name, count: casts.length });
for (const c of casts) {
  const plays = {};
  for (const n of named) {
    const m = thinkMove(R.restore(J(c.state)), 1, { deals, ms: 1e9, judge: n.judge });
    plays[n.name] = m.t === "cast" ? `cast ${DECK[m.card] ?? m.card}` : m.t === "land" ? `land ${DECK[m.card]}` : m.t;
  }
  say({ part: "cast", game: c.game, move: c.move, turn: c.turn, card: c.card, baseWithout: c.without, hardPlays: plays });
}
fs.writeFileSync(out, lines.join("\n") + "\n");
