// One kept game walked through with the exact calculator (dandan-solve.js): at every decision from a library of `max` cards or
// fewer, the position as it was (both hands as the record has them: the referee's view) searched to the end of the game, every
// choice valued. A decision where the mover's value falls (its best choice was worth more than the one it made) is a move
// that threw the game away, if both sides then play their best. Korbi's deck-out game of 12 November 2026 is the first.
// usage: node lab/endgame-walk.mjs <games dir> <out.jsonl> <shard> <shards> <game key> [scope race] [ms 60000] [max library 12]
import fs from "node:fs";
import path from "node:path";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { toMove } from "../dandan-engine.js";
import { fork } from "../dandan-think.js";
import { makeJudge } from "../dandan-eval.js";
import { solve, choiceName, choices } from "../dandan-solve.js";

const [dir, out, shard, shards, key, scope = "race", ms = "60000", max = "12"] = process.argv.slice(2);
const judge = makeJudge(JSON.parse(fs.readFileSync(new URL("../judges/ag-v14.json", import.meta.url), "utf8")).layers);
const J = x => JSON.parse(JSON.stringify(x));
const g = JSON.parse(fs.readFileSync(path.join(dir, key + ".json"), "utf8")).game, list = JSON.parse(g.moves);
let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
let k = 0;
for (let i = 0; i < list.length; i++) {
  const [who, move] = list[i], s = shownRules.restore(J(G.state));
  if (!s.over && toMove(s) === who && s.lib.length <= Number(max) && k++ % Number(shards) === Number(shard)) {
    const r = solve(fork(s), { judge, scope, ms: Number(ms), nodes: 5e7, rootAll: true });
    const mine = v => (who === 0 ? v : 1 - v), made = r.list.find(x => JSON.stringify(x.move) === JSON.stringify(move) || (x.move.hold && JSON.stringify({ ...x.move, hold: undefined }) === JSON.stringify({ ...move, hold: undefined })));
    fs.appendFileSync(out, JSON.stringify({
      i, turn: s.turn, step: s.step, pending: s.pending?.t ?? null, stack: s.stack.map(x => x.name), lib: s.lib.length, who, hands: s.hand.map(h => h.length),
      played: choiceName(s, move), capped: r.capped, ms: r.ms, nodes: r.nodes, nChoices: choices(s, who, scope).length,
      best: r.list[0] ? { name: choiceName(s, r.list[0].move), v: mine(r.list[0].value) } : null, madeV: made ? mine(made.value) : null,
      all: r.list.slice(0, 12).map(x => [choiceName(s, x.move), +mine(x.value).toFixed(3)]),
    }) + "\n");
  }
  const r = applyMove(shownRules, G, who, move, g.started);
  if (r.error) break;
  G = r.G;
}
