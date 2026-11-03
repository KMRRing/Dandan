// Where Medium's habits give up the most, by kind of decision: positions from games of Medium against Medium (the games
// Hard plays out in its head), each searched with every candidate of Hard's shortlist valued in the same deals; the move
// Medium makes is set against the best of the others, the best chosen on one half of the deals and judged on the other
// (so the maximum of noisy figures isn't counted as a gain), both ways round. Regret is the win chance it gives up.
// The kinds are what Medium decided: a pending question by its kind (attack, block, discard...), a move with priority by
// the card it plays (land, cast <card>, cycle, pass).
// usage: node lab/regret.mjs sample <first seed> <games> <keep probability> <out.jsonl>      positions from games
//        node lab/regret.mjs value <in.jsonl> <shard> <shards> <deals> <out.jsonl>            their values
//        node lab/regret.mjs report <in.jsonl>...                                             regret by kind
import fs from "node:fs";
import { J } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { act, moves, toMove, restore } from "../dandan-engine.js";
import { policyMove } from "../dandan-policy.js";
import { candidates, determinize, fork, treePlay, seedOf, endOfLibrary } from "../dandan-think.js";
import { DECK } from "../dandan-cards.js";

const [mode, ...args] = process.argv.slice(2);
const key = m => JSON.stringify(m);
/** What kind of decision a move is, for the report. */
export function kindOf(s, m) {
  if (s.pending) return s.pending.t;
  if (m.t === "cast") return `cast ${DECK[m.card]}${m.from === "yard" ? " (yard)" : ""}`;
  if (m.t === "cycle") return `cycle ${DECK[m.card]}`;
  if (m.t === "ability") return "ability";
  return m.t;
}

if (mode === "sample") {
  const [from, games, keep, out] = [Number(args[0]), Number(args[1]), Number(args[2]), args[3]];
  let pick = from * 7919 + 13;
  const rnd = () => ((pick = (pick * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // Medium against Medium, without the reads of the passes (quicker; the positions are what matters)
  const quick = { ...rules, act: (s, seat, move, ctx) => act(s, seat, move, ctx) };
  for (let g = 0; g < games; g++) {
    let G = newRecord(quick, { seats: 2, seed: from + g, now: 0 });
    for (let i = 0; i < 4000 && !quick.over(G.state); i++) {
      const who = quick.toMove(G.state), s = quick.restore(J(G.state));
      Math.random = seeded(mix(from + g, i + 1));
      const m = policyMove(s, who, { rng: Math.random });
      let n = 1;
      if (!["mull", "bottom", "name"].includes(s.pending?.t) && s.turn >= 1) { try { n = candidates(s, who).length; } catch { n = 1; } }
      if (n >= 2 && rnd() < keep) fs.appendFileSync(out, JSON.stringify({ id: `${from + g}:${i}`, who, mine: m, st: J(s) }) + "\n");
      G = applyMove(quick, G, who, m, 0).G;
    }
  }
} else if (mode === "value") {
  const [file, shard, shards, deals, out] = [args[0], Number(args[1]), Number(args[2]), Number(args[3]), args[4]];
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l)).filter((_, i) => i % shards === shard);
  const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).id) : []);
  for (const r of rows) {
    if (done.has(r.id)) continue;
    const s = restore(J(r.st)), seat = r.who;
    const cands = candidates(s, seat, { wide: 7 });
    if (!cands.some(m => key(m) === key(r.mine))) cands.push(r.mine);
    const to = s.turn + Math.max(2, endOfLibrary(s)), seed = seedOf(s, seat);
    const roots = cands.map(() => ({ n: 0, kids: new Map() })), vals = cands.map(() => []);
    for (let d = 0; d < deals; d++) {
      const rng = seeded(mix(seed, d + 1)), base = determinize(s, seat, rng), runSeed = mix(seed ^ 0x5eed, d + 7);
      cands.forEach((m, i) => {
        const c = fork(base), q = seeded(runSeed);
        const res = act(c, seat, m, { rng: q, quiet: true });
        vals[i].push(typeof res === "string" ? -1 : treePlay(c, seat, roots[i], to, q));
      });
    }
    const mineAt = cands.findIndex(m => key(m) === key(r.mine));
    fs.appendFileSync(out, JSON.stringify({ id: r.id, who: seat, turn: s.turn, kind: kindOf(s, r.mine), n: cands.length, mine: mineAt, cands: cands.map(m => key(m)), vals: vals.map(v => v.map(x => +x.toFixed(4))) }) + "\n");
  }
} else if (mode === "report") {
  const rows = args.flatMap(f => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const byKind = new Map();
  for (const r of rows) {
    const D = r.vals[0].length, half = [[0, 1], [1, 0]];
    let reg = 0;
    for (const [a, b] of half) {
      const part = (i, h) => mean(r.vals[i].filter((_, d) => d % 2 === h));
      // the best on half a, judged on half b
      let best = 0;
      r.vals.forEach((_, i) => { if (part(i, a) > part(best, a)) best = i; });
      reg += part(best, b) - part(r.mine, b);
    }
    reg /= 2;
    const k = byKind.get(r.kind) || { n: 0, regret: [], moved: 0 };
    k.n++; k.regret.push(reg);
    byKind.set(r.kind, k);
  }
  const all = [...byKind].sort((x, y) => mean(y[1].regret) * y[1].n - mean(x[1].regret) * x[1].n);
  const tot = rows.length;
  console.log(`${tot} decisions; mean regret ${(100 * mean(all.flatMap(([, k]) => k.regret))).toFixed(2)} points`);
  console.log("kind".padEnd(34), "n".padStart(5), "mean pts".padStart(9), "sum pts".padStart(9), "share of regret");
  const sum = all.reduce((t, [, k]) => t + k.regret.reduce((a, b) => a + b, 0), 0);
  for (const [name, k] of all) {
    const s = k.regret.reduce((a, b) => a + b, 0);
    const sd = Math.sqrt(mean(k.regret.map(x => (x - mean(k.regret)) ** 2)) / k.n);
    console.log(name.padEnd(34), String(k.n).padStart(5), `${(100 * mean(k.regret)).toFixed(2)}±${(100 * sd).toFixed(2)}`.padStart(11), (100 * s).toFixed(1).padStart(9), `${(100 * s / sum).toFixed(0)}%`);
  }
}
