// One recorded position searched by Zero with and without the lab's search flags, and with the mover's hand in both orders
// (17 Nov 2026, Fable 09:40Z, acceptance before az-qf2: on Korbi's position pass must lead the cast whichever card is first in
// hand). The game from the game-records branch, replayed to before move <index>; the mover's options, mean and se, for each set.
// usage: node lab/position-check.mjs <game key> <move index> [deals 256] [nets g9x-C] [flags "twins~qtree~qall"]
import fs from "node:fs";
import { execSync } from "node:child_process";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { DECK } from "../dandan-core.js";
import { zeroBrain } from "./zero/zero-lib.mjs";
const deeperOf = f => ({ gap: Number(f) });

const [key, at, deals = "256", nets = "g9x-C", flags = "twins~qtree~qall"] = process.argv.slice(2);
const text = execSync(`git fetch -q origin game-records && git show FETCH_HEAD:games/${key}.json`, { encoding: "utf8", maxBuffer: 1 << 28 });
const rec = JSON.parse(text), g = rec.game, moves = JSON.parse(g.moves);
let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
const brain = zeroBrain(`${nets}-policy`, `${nets}-value`);
for (let i = 0; i < Number(at); i++) {
  const st = G.state, [who, m] = moves[i];
  const r = applyMove(shownRules, G, who, m, g.started);
  if (r.error) throw new Error(`move ${i}: ${r.error}`);
  brain.seen(st, who, m, r.G.state);
  G = r.G;
}
const s = shownRules.restore(JSON.parse(JSON.stringify(G.state))), who = moves[Number(at)][0];
console.log(`${key} before move ${at} (played: ${JSON.stringify(moves[Number(at)][1])}): turn ${s.turn} ${s.step}, seat ${who}, hand ${s.hand[who].map(x => DECK[x]).join(", ")}`);
const name = m => `${m.t}${m.card != null ? " " + DECK[m.card] : ""}${m.cards ? " " + m.cards.map(x => DECK[x]).join("+") : ""}`;
const fl = flags.split("~").filter(Boolean), extra = f => ({ deeper: deeperOf("0.03"), ...(f.includes("twins") ? { twins: true } : {}), ...(f.includes("qtree") ? { qtree: true } : {}), ...(f.includes("qall") ? { qall: true } : {}) });
for (const order of ["as dealt", "reversed"]) {
  const c = JSON.parse(JSON.stringify(s));
  if (order === "reversed") c.hand[who].reverse();
  for (const f of [[], fl]) {
    const t0 = Date.now(), r = brain.think(c, who, Number(deals), extra(f));
    console.log(`  hand ${order}, ${f.join("+") || "no flags"} (${((Date.now() - t0) / 1000).toFixed(0)} s): ` + r.list.slice(0, 5).map(o => `${name(o.move)} ${(100 * o.mean).toFixed(1)}±${(100 * o.se).toFixed(1)}`).join(", "));
  }
}
