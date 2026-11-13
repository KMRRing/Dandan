// What lab/departures.mjs and lab/mine-checks.mjs share (13 Nov): the kind of a move, the real game played on after a move,
// and the games mined from (Korbi's kept games on the game-records branch, a self-play job's parts), each found again by its
// `src` as a mined case names it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { J } from "./lib.mjs";
import { rules, shownRules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { thinkMove } from "../dandan-think.js";
import { perm } from "../dandan-core.js";
import { DECK } from "../dandan-cards.js";

/** The kind of a move: card, mode, whose target. */
export function kindOf(s, seat, m) {
  const t = m.targets?.[0], p = t?.id != null ? perm(s, t.id) : null;
  return { t: m.t, card: m.card != null ? DECK[m.card] ?? "token" : null, mode: m.mode ?? null, target: !t ? null : t.k === "p" ? (t.seat === seat ? "own player" : "their player") : t.sid != null ? "spell" : p ? (p.ctl === seat ? "own" : "theirs") : t.k };
}

/**
 * The real game played on from record `G` (before its next move) after `m` by `seat`, both seats Hard at `deals` with `judge`,
 * the shortlist only, the engines salted by `salt`: `result` 1 if `seat` won, 0 lost, ½ both (null if a move failed). With
 * `to` (a turn), also `horizon`: the judge's value for `seat` where the look-ahead would have stopped (the first position at
 * turn `to` or later with nothing on the stack; the result if the game ended first), and with `stop` the game ends there.
 */
export function playOn(R, G, seat, m, salt, { deals, judge, to = null, stop = false }) {
  const realRandom = Math.random;
  let r = applyMove(R, G, seat, m, 0), horizon = null;
  if (r.error) return { result: null, horizon };
  G = r.G;
  for (let i = 0; i < 4000 && !R.over(G.state); i++) {
    if (to != null && horizon == null && G.state.turn >= to && !G.state.stack.length) {
      horizon = judge(R.restore(J(G.state)), seat);
      if (stop) return { result: null, horizon };
    }
    const who = R.toMove(G.state), x = R.restore(J(G.state));
    Math.random = seeded(mix(salt, i + 1));
    const mv = thinkMove(x, who, { deals, ms: 1e9, judge, all: false, salt });
    Math.random = realRandom;
    r = applyMove(R, G, who, mv, 0);
    if (r.error) return { result: null, horizon };
    G = r.G;
  }
  const w = G.state.winner, result = w === seat ? 1 : w == null || w < 0 ? 0.5 : 0;
  return { result, horizon: to != null && horizon == null ? result : horizon };
}

/** Korbi's kept games that replay, sorted by file (one fetch of the game-records branch), each ready to replay; [] if there are none. */
export function keptGames() {
  const games = [];
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
    execSync(`git fetch -q --depth=1 origin game-records && git archive FETCH_HEAD games | tar -x -C ${tmp}`, { stdio: "ignore" });
    // `at`: the file's place among all the game files, kept or not (lab/departures.mjs shares them out by it)
    for (const [at, f] of fs.readdirSync(path.join(tmp, "games")).filter(f => f.endsWith(".json")).sort().entries()) {
      const file = JSON.parse(fs.readFileSync(path.join(tmp, "games", f), "utf8")), g = file.game;
      // the person's seat (the players list holds only people), so Monte's is the other (13 Nov: the from-60 run)
      const human = Object.values(file.players || {})[0]?.seat ?? null;
      let moves; try { moves = JSON.parse(g.moves); } catch { continue; }
      if (moves?.length === g.n) games.push({ kept: true, at, file: f, src: `kept:${f}`, human, winner: file.result?.winner ?? g.state?.winner, R: shownRules, opts: { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } }, moves, now: g.started });
    }
  } catch { /* no game-records */ }
  return games;
}
/** A self-play game line (lab/selfplay.mjs) as a game to replay. */
export const selfPlayGame = (job, g) => ({ src: `${job}:${g.game}`, R: rules, opts: { seats: 2, seed: g.seed, now: 0 }, moves: g.moves, now: 0 });

/** The record of `game` before its move `i`. */
export function recordAt(game, i) {
  let G = newRecord(game.R, game.opts);
  for (let k = 0; k < i; k++) {
    const [who, move] = game.moves[k], r = applyMove(game.R, G, who, move, game.now);
    if (r.error) throw new Error(`${game.src} move ${k}: ${r.error}`);
    G = r.G;
  }
  return G;
}

/**
 * The game a mined case names by `src`: a kept game by its file, a self-play game by its job and number (lab/selfplay.mjs
 * gives each shard a run of numbers, so the part is found from the job's spec without reading the others). `kept` from keptGames().
 */
export async function gameBySrc(store, src, kept, specs = new Map()) {
  if (src.startsWith("kept:")) return kept.find(g => g.src === src) || null;
  const [job, num] = [src.slice(0, src.lastIndexOf(":")), Number(src.slice(src.lastIndexOf(":") + 1))];
  if (!specs.has(job)) specs.set(job, JSON.parse((await store.get(`jobs/${job}.json`)) || (await store.get(`retired/${job}.json`)) || "null"));
  const spec = specs.get(job), shards = spec.shards, games = Number(spec.args.split(/\s+/)[4]);
  const base = Math.floor(games / shards), extra = games % shards;
  // the shard whose run holds `num`: the first `extra` shards play base + 1 games
  const shard = num < extra * (base + 1) ? Math.floor(num / (base + 1)) : extra + Math.floor((num - extra * (base + 1)) / base);
  for (const l of ((await store.get(`results/${job}/part-${shard}.jsonl`)) || "").split("\n")) {
    if (!l.startsWith("{")) continue;
    const g = JSON.parse(l);
    if (g.game === num) return selfPlayGame(job, g);
  }
  return null;
}
