// How large an end of the game the exact calculator (dandan-solve.js) can solve, with every possibility in (Fable's option 3,
// 12 November 2026: "at the largest library size where one position solves in about a second"). From the kept games it takes
// positions at a seat's decision and searches each to the end of the game, both sides at their best, for one deal of what the
// mover can't see (`dealt`) and with both hands as the record has them (`open`):
//   natural = a game's own late position (library 1 to 12, up to three a game), as it was;
//   cut L   = a position from turn 16 on with the shared library cut to its top L cards (1 to 8), the hands as they were.
// Each line: the position, the library, the hands, the time, the positions searched, whether the budget ran out (capped), the
// value (seat 0's chance: 1 a win, 0 a loss), the choices at the root and the best of them.
// scopes: "all" (every possibility) and/or "race" (every possibility where the library changes, Medium's choice elsewhere): with
// both, the complete one referees the race one (where both finish, do their best choices agree?). turns: a horizon, "-" none.
// usage: node lab/endgame-solve.mjs <games dir> <out.jsonl> [shard 0] [of 1] [ms cap 20000] [node cap 3000000] [lengths 1,2,3,4,5,6,8] [turns -] [scopes race]
import fs from "node:fs";
import path from "node:path";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded } from "../seats.js";
import { toMove } from "../dandan-engine.js";
import { determinize, fork } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { solve, choiceName, choices } from "../dandan-solve.js";

const [dir, out] = process.argv.slice(2, 4);
const shard = Number(process.argv[4] || 0), of = Number(process.argv[5] || 1), MS = Number(process.argv[6] || 2e4), NODES = Number(process.argv[7] || 3e6);
const LENGTHS = (process.argv[8] || "1,2,3,4,5,6,8").split(",").map(Number), TURNS = process.argv[9] && process.argv[9] !== "-" ? Number(process.argv[9]) : Infinity, SCOPES = (process.argv[10] || "race").split(",");
const J = x => JSON.parse(JSON.stringify(x));
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL("../judges/ag-v14.json", import.meta.url), "utf8")).layers);

const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().filter((_, i) => i % of === shard);
for (const f of files) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).game;
  let list;
  try { list = JSON.parse(g.moves || "[]"); } catch { continue; }
  if (!list.length || list.length !== g.n) continue;
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  const sampled = [];
  let late = 0, cut = 0;
  for (let i = 0; i < list.length; i++) {
    const [who, move] = list[i], s = shownRules.restore(J(G.state));
    if (!s.over && toMove(s) === who) {
      if (s.lib.length <= 12 && s.lib.length >= 1 && late < 3 && (s.pending || s.stack.length || i % 4 === 0)) { late++; sampled.push({ i, s, natural: true }); }
      else if (s.lib.length > 12 && s.turn >= 16 && !s.pending && !s.stack.length && s.step === "main1" && cut < 2 && i % 9 === 0) { cut++; sampled.push({ i, s, natural: false }); }
    }
    const r = applyMove(shownRules, G, who, move, g.started);
    if (r.error) break;
    G = r.G;
  }
  for (const { i, s, natural } of sampled) {
    for (const L of natural ? [s.lib.length] : LENGTHS) {
      const base = J(s);
      if (!natural) base.lib = base.lib.slice(0, L);
      const mover = toMove(base);
      for (const variant of ["dealt", "open"]) for (const scope of SCOPES) {
        const root = variant === "open" ? fork(base) : determinize(base, mover, seeded(1000 + i), false);
        const r = solve(root, { judge, ms: MS, nodes: NODES, rootAll: true, turns: TURNS, scope });
        fs.appendFileSync(out, JSON.stringify({
          game: f.replace(".json", ""), move: i, turn: s.turn, step: s.step, pending: s.pending?.t ?? null, stack: s.stack.length, natural, L, variant, mover,
          scope, hands: base.hand.map(h => h.length), rootChoices: choices(root, mover, scope).length, ms: r.ms, nodes: r.nodes, distinct: r.distinct, capped: r.capped,
          value: r.value, best: r.list[0] ? choiceName(root, r.list[0].move) : null, bests: r.list.filter(x => Math.abs(x.value - r.list[0].value) < 1e-9).map(x => choiceName(root, { ...x.move, taps: undefined, hold: undefined })), loops: r.loops, chance: r.chance, memory: r.memory, horizon: r.horizon, turns: TURNS, maxPly: r.maxPly,
        }) + "\n");
      }
    }
  }
}
