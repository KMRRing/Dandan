// The computer's spell is seen on the stack (engine showStop): a spell it casts that the player can't answer used to
// resolve inside the move that cast it, straight to the graveyard (Korbi, 29 October 2026). With `show` the game stops
// with the spell on the stack and the player to pass; the page lets it resolve after two seconds.
import { act, moves, toMove, restore, deal } from "../dandan-engine.js";
import { botMove } from "../dandan-bot.js";
import { DECK } from "../dandan-cards.js";
import { seeded } from "../seats.js";
import { scene, islandsOf, J, idIn, names, stackNames } from "./dandan-scene.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const test = (what, fn) => {
  try { const r = fn(); check(r !== false && typeof r !== "string", typeof r === "string" ? `${what} — ${r}` : what); }
  catch (e) { console.log(`FAIL ${what}: ${e.message}`); bad++; }
};
/** A move made on a copy of the game, as the runner makes it (with show, as the page asks it for the computer). */
const go = (s, seat, m, o = {}) => {
  const r = act(J(s), seat, m, { rng: seeded(5), ...o });
  if (typeof r === "string") throw new Error(`${JSON.stringify(m)} refused: ${r}`);
  return restore(J(r));
};
const charm = s => moves(s, 1).find(m => m.t === "cast" && DECK[m.card] === "Piracy Charm" && m.mode === 2);
/** Seat 1's turn, a Piracy Charm in its hand and Islands to cast it; seat 0 holds whatever the test gives it. */
const theirTurn = (hand0 = [], bf0 = []) => scene({ active: 1, step: "main1", prio: 1, turn: 6, hand: [hand0, ["Piracy Charm"]], bf: [...islandsOf(1, 2), ...bf0] });

test("a spell of the computer's that you can't answer stays on the stack, you to pass", () => {
  const s = theirTurn(), m = charm(s);
  if (!m) return "no Piracy Charm move";
  const r = go(s, 1, m, { show: true });
  if (!(r.stack.length === 1 && stackNames(r)[0] === "Piracy Charm")) return `stack ${stackNames(r)}`;
  if (!(toMove(r) === 0 && r.shown === r.stack[0].sid)) return `asked ${toMove(r)}, shown ${r.shown}`;
  return true;
});
test("…and your pass lets it resolve: it goes to the graveyard, the computer has priority again", () => {
  const r = go(go(theirTurn(), 1, charm(theirTurn()), { show: true }), 0, { t: "pass" });
  return (!r.stack.length && names(r.yard).includes("Piracy Charm") && toMove(r) === 1) || `stack ${stackNames(r)}, yard ${names(r.yard)}, asked ${toMove(r)}`;
});
test("without show it resolves in the move, as before (and in the computer's head, whatever is asked)", () => {
  const s = theirTurn(), m = charm(s);
  const plain = go(s, 1, m), quiet = go(s, 1, m, { show: true, quiet: true });
  return (!plain.stack.length && !quiet.stack.length && names(plain.yard).includes("Piracy Charm") && !plain.shown && !quiet.shown) || "it stopped";
});
test("a seat with something to answer it with is asked as always: no extra stop", () => {
  const s = scene({ active: 1, step: "main1", prio: 1, turn: 6, hand: [["Memory Lapse"], ["Piracy Charm"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 2)] });
  const r = go(s, 1, charm(s), { show: true });
  return (r.stack.length === 1 && toMove(r) === 0 && !r.shown) || `stack ${stackNames(r)}, asked ${toMove(r)}, shown ${r.shown}`;
});
test("a counterspell of the computer's on your spell is shown too", () => {
  let s = scene({ active: 0, step: "main1", prio: 0, turn: 6, hand: [["Predict"], ["Memory Lapse"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 2)] });
  const predict = moves(s, 0).find(m => m.t === "cast" && DECK[m.card] === "Predict");
  s = go(s, 0, predict);
  const lapse = moves(s, 1).find(m => m.t === "cast" && DECK[m.card] === "Memory Lapse");
  if (!lapse) return "the computer can't cast Memory Lapse";
  s = go(s, 1, lapse, { show: true });
  return (stackNames(s).join() === "Predict,Memory Lapse" && toMove(s) === 0 && s.shown === s.stack[1].sid) || `stack ${stackNames(s)}, asked ${toMove(s)}`;
});
test("a spell of yours isn't shown: the computer's pass resolves it as before", () => {
  let s = scene({ active: 0, step: "main1", prio: 0, turn: 6, hand: [["Piracy Charm"], []], bf: islandsOf(0, 2) });
  s = go(s, 0, moves(s, 0).find(m => m.t === "cast" && DECK[m.card] === "Piracy Charm" && m.mode === 2), { show: false });
  return (!s.stack.length && !s.shown) || `stack ${stackNames(s)}: held for the computer`;
});
test("whole games with the computer's spells shown reach their end", () => {
  for (const seed of [3, 4, 5]) {
    let c = restore(J(deal({ rng: seeded(seed) })));
    let steps = 0, seen = 0;
    while (!c.over && steps++ < 4000) {
      const who = toMove(c);
      const before = c.shown;
      c = go(c, who, botMove(c, who, { rng: seeded(steps) }), { show: who === 1 });
      if (c.shown !== before) seen++;
    }
    if (!c.over) return `seed ${seed}: no end in ${steps} moves`;
    console.log(`     seed ${seed}: over in ${steps} moves, ${seen} spells shown`);
  }
  return true;
});
console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
