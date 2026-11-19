// The counter tell (19 Nov 2026, Fable: before building a "tell" input, measure it): in held-out games, the moments a player passed
// with the other player's spell on the stack while having two or more untapped mana (Izzet Boilerworks counts two). How often did
// they hold an answer (Memory Lapse, Commit // Memory, Narset's Reversal: the rules' own targeting probe) then, against how often a
// player holds one at any position with priority; and the dealer's chance of an answer held (the other seat's belief, `ans`) on
// the same moments. If the true rate at the tell is well below the base and the dealer's guess is not, a tell input is worth
// building. Read-only.
// usage: node lab/zero/tell-check.mjs <batches, comma-separated | file:<zero-play output>> <dealer nets name> [games 1500]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { applyMove, seeded } from "../../seats.js";
import { DECK } from "../../dandan-cards.js";
import { lands } from "../../dandan-core.js";
import { POOL, answers } from "../../dandan-general.js";
import { ScryG } from "./scryg.mjs";
import { netOf } from "./zero-lib.mjs";
import { recordOf, redeal, rngSeedOf } from "./branch-lib.mjs";

const [ids, name, most = "1500"] = process.argv.slice(2), net = netOf(`${name}-scryg`), J = x => JSON.parse(JSON.stringify(x)), real = Math.random;
const A = answers(POOL), ANS = new Set(POOL.vocab.filter((n, i) => A[i]));
const holds = (s, seat) => s.hand[seat].some(id => ANS.has(DECK[id]));
const mana = (s, seat) => lands(s, seat).filter(p => !p.tapped).reduce((a, p) => a + (DECK[p.id] === "Izzet Boilerworks" ? 2 : 1), 0);
const T = { tell: { n: 0, held: 0, guess: 0 }, base: { n: 0, held: 0, guess: 0 }, games: 0 };
function replay(g) {
  const B = g.branch || null, F = [new ScryG(0, net), new ScryG(1, net)];
  let G = recordOf(rules, g);
  for (let i = 0; i < g.moves.length; i++) {
    if (B && i === B.at) G = { ...G, state: redeal(rules, G.state, B.seat, g.seed) };
    const [who, m] = g.moves[i], s = rules.restore(J(G.state)), opp = 1 - who;
    if (!s.pending && i > 14) {
      const top = s.stack[s.stack.length - 1];
      const tell = m.t === "pass" && top && top.kind === "spell" && top.ctl === opp && mana(s, who) >= 2;
      const sample = tell || i % 6 === 0;
      if (sample) {
        const held = holds(s, who) ? 1 : 0, guess = F[opp].belief(s, 64).ans;
        for (const k of tell ? ["tell", "base"] : ["base"]) { T[k].n++; T[k].held += held; T[k].guess += guess; }
      }
    }
    Math.random = seeded(rngSeedOf(g, i));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = real;
    if (r.error) return;
    for (const f of F) f.update(s, who, m, r.G.state);
    G = r.G;
  }
  T.games++;
}
const local = ids.startsWith("file:"), store = local ? null : await (await import("../lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n));
outer: for (const n of parts) for (const l of ((local ? fs.readFileSync(n, "utf8") : await store.get(n)) || "").split("\n")) {
  if (!l.startsWith('{"game"')) continue;
  const g = JSON.parse(l);
  if (g.seed % 5 !== 0 || g.vs || g.branch) continue;   // held-out self-play games only
  replay(g);
  if (T.games >= Number(most)) break outer;
}
const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1);
console.log(`${T.games} held-out games, dealer ${name}`);
console.log(`  any position with priority (sample): ${T.base.n} positions, held an answer ${pc(T.base.held, T.base.n)}%, dealer's chance ${pc(T.base.guess, T.base.n)}%`);
console.log(`  passed with the other's spell on the stack and 2+ mana up: ${T.tell.n} moments, held an answer ${pc(T.tell.held, T.tell.n)}%, dealer's chance ${pc(T.tell.guess, T.tell.n)}%`);
