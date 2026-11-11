// The luck floor (Korbi, 11 November 2026): how much of a value net's Brier score no network could remove. Positions are taken
// from games a value net never trained on (every fifth game of the jobs, as lab/judge-variants.mjs holds them out), each
// played on many times from where it stands, the library shuffled afresh each time (the hands stay: the value net sees both),
// by the engine whose games they are. The share of those play-outs the player to move wins is the position's true chance p
// for those players, to within the play-outs' noise. Then, exactly:
//   Brier (against the game's actual result) = the luck floor, mean p(1 − p)  +  the net's own error, mean (prediction − p)²
// One JSON line a position: { game, i, me, won, wins, n, preds: { <net>: chance } } (lab/luck-floor-sum.mjs sums them).
// usage: node lab/luck-floor.mjs <shard> <shards> <out> <games job ids, comma-separated> <engine> <value nets, comma-separated>
//        [positions a game 8] [play-outs a position 100] [held-out games to use 50]
//   engine: medium[:<plan>] (Medium of that plan for both seats, tempo unless named) or hard*<deals>[:<value net>] (Hard, far slower)
//   value net: - (the game's original, built in), a file in judges/ (ag-v14.json), or @<job>[#variant] (a lab/judge-variants.mjs run)
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { act as engineAct, passPoints, moves as legal } from "../dandan-engine.js";
import { makeJudge, winChance } from "../dandan-eval.js";
import { policyMove, PASS } from "../dandan-policy.js";
import { think } from "../dandan-think.js";
import { labStore, readParts, J } from "./lib.mjs";

const [shard, shards, out, ids, engineSpec, netList] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6] || "medium", process.argv[7] || "-"];
const perGame = Number(process.argv[8]) || 8, plays = Number(process.argv[9]) || 100, heldGames = Number(process.argv[10]) || 50;

async function netFrom(t) {
  if (!t || t === "-") return winChance;
  if (t.startsWith("@")) {
    const [job, v] = t.slice(1).split("#"), ls = (await readParts(job)).flatMap(x => x.split("\n").filter(Boolean)).map(l => JSON.parse(l));
    return makeJudge((v == null ? ls[0] : ls.find(l => l.variant === Number(v))).layers);
  }
  return makeJudge(JSON.parse(fs.readFileSync(new URL(`../judges/${t}`, import.meta.url), "utf8")).layers);
}
const names = netList.split(","), nets = await Promise.all(names.map(netFrom));
const [kind, rest] = engineSpec.split(/[:*](.*)/s), hardDeals = kind === "hard" ? Number(rest.split(":")[0]) || 64 : 0;
const hardNet = kind === "hard" && rest.includes(":") ? await netFrom(rest.split(":").slice(1).join(":")) : undefined;
const plan = kind === "medium" ? rest || "tempo" : null;

// replaying the record: the engine's own act, without the notes kept only for live play (as lab/judge-variants.mjs)
const lean = { ...rules, act: (s, seat, m, ctx) => { const r = engineAct(s, seat, m, ctx); passPoints.length = 0; return r; } };
// one play-out to the end: the library in a fresh order, then the engine for both seats; 1 if `me` wins, ½ a draw
const realRandom = Math.random;
function playOut(s0, me, seed) {
  const s = rules.restore(J(s0)), rng = seeded(seed);
  for (let i = s.lib.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [s.lib[i], s.lib[k]] = [s.lib[k], s.lib[i]]; }
  for (let step = 0; step < 4000 && !s.over; step++) {
    const who = s.pending ? s.pending.seat : s.prio;
    Math.random = seeded(mix(seed, step + 1));
    let m;
    if (plan || (s.pending && ["mull", "bottom", "name"].includes(s.pending.t))) m = policyMove(s, who, plan ? { style: plan } : {});
    else if (!s.pending && !legal(s, who, true).length) m = PASS;
    else m = think(s, who, { deals: hardDeals, ms: 1e9, ...(hardNet ? { judge: hardNet } : {}) }).best;
    const r = engineAct(s, who, m, { rng: Math.random, quiet: true });
    passPoints.length = 0;
    if (typeof r === "string") break;
  }
  Math.random = realRandom;
  return !s.over ? 0.5 : s.winner === me ? 1 : s.winner < 0 ? 0.5 : 0;
}

const store = await labStore();
let games = 0, held = 0;
outer: for (const id of ids.split(",")) for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n))) for (const line of ((await store.get(name)) || "").split("\n")) {
  if (!line) continue;
  if (games++ % 5) continue;                           // the held-out games only
  if (held >= heldGames) break outer;
  if (held++ % shards !== shard) continue;              // this shard's share
  const rec = JSON.parse(line), marks = Array.from({ length: perGame }, (_, j) => Math.floor(((j + 0.5) * rec.moves.length) / perGame));
  let G = newRecord(lean, { seats: 2, seed: rec.seed, now: 0 }), next = 0;
  for (let i = 0; i < rec.moves.length && next < marks.length; i++) {
    const [seat, move] = rec.moves[i], s = G.state;
    if (i >= marks[next] && !s.stack.length && !s.pending && !s.over) {
      while (next < marks.length && marks[next] <= i) next++;
      const me = seat, won = rec.winner === me ? 1 : rec.winner < 0 ? 0.5 : 0;
      let wins = 0;
      for (let k = 0; k < plays; k++) wins += playOut(s, me, mix(rec.seed * 7919 + i, k + 1));
      const st = rules.restore(J(s)), preds = {};
      names.forEach((nm, j) => { preds[nm] = +nets[j](st, me).toFixed(5); });
      fs.appendFileSync(out, JSON.stringify({ game: rec.game ?? rec.seed, i, me, lib: s.lib.length, won, wins, n: plays, preds }) + "\n");
    }
    const r = applyMove(lean, G, seat, move, 0);
    if (r.error) break;
    G = r.G;
  }
}
