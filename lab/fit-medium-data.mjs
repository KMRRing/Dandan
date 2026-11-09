// The data for fitting Medium's constants to the search (9 November 2026): lab/selfplay.mjs's games replayed, and at each
// priority decision the search weighed, every candidate it valued is given Medium's own score for it (`Player.scored()`, with the
// constants of the build in hand), so the two can be set side by side. Written as one JSON file: an array of decisions
// { g, seat, step, stack, cands: [{ k: cast | land | cycle | ability | pass, n: the card (a cast by its half), v: Medium's score
// (a pass: what a move must beat, TUNE.pass), m: the search's mean win chance, se, nn: deals, out: dropped early }], medium: index
// of the move Medium plays (priority()), zero: index of the candidate lab/selfplay.mjs called Medium's (candidates()[0]), pick }.
// usage: node lab/fit-medium-data.mjs <folder of selfplay part-*.jsonl.gz> <out.json> [shard 0] [of 1]
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { Player, TUNE } from "../dandan-policy.js";
import { HALVES, DECK } from "../dandan-cards.js";
import { halfOf } from "../dandan-engine.js";
import { perm, nm } from "../dandan-core.js";
import { J } from "./lib.mjs";

const [dir, out, shard = 0, of = 1] = [process.argv[2], process.argv[3], Number(process.argv[4] || 0), Number(process.argv[5] || 1)];
const key = m => JSON.stringify(m);
const halfName = (m) => (m.from === "yard" ? halfOf(m.card, "yard") : (HALVES[DECK[m.card]] ? HALVES[DECK[m.card]][0] : DECK[m.card]));
const kindOf = (s, m) => (m.t === "cast" ? ["cast", halfName(m)] : m.t === "land" ? ["land", DECK[m.card]] : m.t === "cycle" ? ["cycle", DECK[m.card]] : m.t === "ability" ? ["ability", nm(perm(s, m.id)?.id)] : m.t === "pass" ? ["pass", ""] : [m.t, ""]);
const res = [];
let games = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".gz")).sort()) for (const line of zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString().trim().split("\n")) {
  const g = JSON.parse(line);
  if (g.game % of !== shard) continue;
  games++;
  const at = new Map(g.dec.map(d => [d.i, d]));
  let G = newRecord(rules, { seats: 2, seed: g.seed, now: 0 });
  for (let i = 0; i < g.moves.length; i++) {
    const [who, move] = g.moves[i], d = at.get(i);
    if (d && !rules.restore(J(G.state)).pending) {
      const s = rules.restore(J(G.state)), P = new Player(s, who), sc = P.scored(), vOf = new Map(sc.map(x => [key(x.m), x.v]));
      const cands = d.list.map(([name, mv, mean, se, nn, o]) => {
        const [k, n] = kindOf(s, mv);
        return { k, n, v: k === "pass" ? TUNE.pass : (vOf.has(key(mv)) ? vOf.get(key(mv)) : null), m: mean, se, nn, out: o, name };
      });
      if (cands.every(c => c.v !== null)) {
        let best = 0, top = TUNE.pass;                                       // priority(): the first with the best score beating TUNE.pass, else pass
        cands.forEach((c, j) => { if (c.k !== "pass" && c.v > top) { best = j; top = c.v; } });
        const pass = cands.findIndex(c => c.k === "pass");
        res.push({ g: g.game, seat: who, step: s.step, stack: s.stack.length > 0, turn: s.turn, lib: s.lib.length, cands, medium: top > TUNE.pass ? best : pass, zero: d.med, pick: d.pick });
      }
    }
    G = applyMove(rules, G, who, move, 0).G;
  }
}
fs.writeFileSync(out, JSON.stringify(res));
console.log(games, "games,", res.length, "decisions kept");
