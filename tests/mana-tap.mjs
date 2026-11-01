// Tapping a land for mana on its own (Korbi, 1 November 2026: "when clicking an untapped land, the player should also get a
// choice to tap it to float mana, which will then be used by later spells if eligible"): a mana ability, so the seat keeps
// priority and nothing goes on the stack; the mana floats in the pool, is spent before any land, and goes at the end of
// the step. Never among the moves the computer weighs.
import { act, moves, toMove } from "../dandan-engine.js";
import { DECK } from "../dandan-cards.js";
import { poolOf, manaAlts } from "../dandan-core.js";
import { scene, islandsOf, go, J, onBf, idIn } from "./dandan-scene.js";
import { seeded } from "../seats.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const tapped = (s, seat) => s.bf.filter(p => p.ctl === seat && p.tapped).length;
const refusal = (s, seat, m) => { const r = act(J(s), seat, m, { rng: seeded(5) }); return typeof r === "string" ? r : null; };
const base = () => scene({ active: 0, step: "main1", prio: 0, turn: 6, hand: [["Brainstorm", "Memory Lapse"], ["Island"]], bf: [...islandsOf(0, 3), [0, "Izzet Boilerworks"], [0, "Thundering Falls"], [1, "Island"]] });

// one tap: the land is tapped, its mana floats, the seat still has priority and the stack is as it was
{
  const s = base(), isle = onBf(s, 0, "Island");
  const t = go(s, 0, { t: "mana", id: isle });
  check(t.bf.find(p => p.id === isle).tapped && tapped(t, 0) === 1, "the land is tapped");
  check(poolOf(t, 0) === "U" && poolOf(t, 1) === "", "its blue floats in the tapper's pool alone");
  check(toMove(t) === 0 && t.prio === 0 && !t.stack.length && t.passes === s.passes && t.step === "main1", "the seat still holds priority: nothing on the stack, no pass made, the step as it was");
  check(t.log.some(e => /taps Island for U/.test(e.t)), "the log says so");
  check(!moves(s, 0).some(m => m.t === "mana"), "it is not among the moves the computer weighs");
  // the next spell is paid from the pool first, and no other land is tapped for a one-mana spell
  const c = go(t, 0, { t: "cast", card: idIn(t, 0, "Brainstorm"), from: "hand", targets: [] });
  check(c.stack.length === 1 && tapped(c, 0) === 1 && poolOf(c, 0) === "", "a Brainstorm is paid from the floating blue: no second land tapped");
  // a two-mana spell uses the float and one more land
  const two = scene({ active: 0, step: "main1", prio: 0, turn: 6, hand: [["Chart a Course"], ["Island"]], bf: [...islandsOf(0, 3), [1, "Island"]] });
  const u = go(two, 0, { t: "mana", id: onBf(two, 0, "Island") });
  const ch = go(u, 0, { t: "cast", card: idIn(u, 0, "Chart a Course"), from: "hand", targets: [] });
  check(ch.stack.length === 1 && tapped(ch, 0) === 2 && poolOf(ch, 0) === "", "a Chart a Course ({1}{U}) is paid from the float and one more land, not two");
}
// mana made and unused floats on: a Thundering Falls makes two, a spell of one leaves one
{
  const s = base(), falls = onBf(s, 0, "Thundering Falls");
  check(manaAlts(s.bf.find(p => p.id === falls)).length >= 1, "(the Falls taps for something)");
  const t = go(s, 0, { t: "mana", id: falls });
  check(poolOf(t, 0).length === manaAlts(s.bf.find(p => p.id === falls))[0].length, "a land that makes two puts both in the pool");
}
// a land with two ways to tap: the move says which
{
  const s = base(), boil = onBf(s, 0, "Izzet Boilerworks"), alts = manaAlts(s.bf.find(p => p.id === boil));
  const t = go(s, 0, { t: "mana", id: boil, alt: alts.length - 1 });
  check(poolOf(t, 0) === alts[alts.length - 1].join(""), `the chosen way is the one made (${poolOf(t, 0)})`);
  check(refusal(s, 0, { t: "mana", id: boil, alt: alts.length }) !== null, "a way the land hasn't is refused");
}
// the pool goes when the step ends
{
  let t = go(base(), 0, { t: "mana", id: onBf(base(), 0, "Island") });
  const was = t.step;
  for (let i = 0; i < 12 && t.step === was && !t.over; i++) t = go(t, toMove(t), { t: "pass" });
  check(t.step !== was && poolOf(t, 0) === "", "the floating mana is gone when the step ends");
}
// what can't be tapped
{
  const s = base(), isle = onBf(s, 0, "Island"), theirs = onBf(s, 1, "Island");
  check(refusal(s, 0, { t: "mana", id: theirs }) !== null, "the other seat's land is refused");
  check(refusal(s, 1, { t: "mana", id: isle }) !== null, "a seat without priority is refused");
  const t = go(s, 0, { t: "mana", id: isle });
  check(refusal(t, 0, { t: "mana", id: isle }) !== null, "a land already tapped is refused");
  check(refusal(s, 0, { t: "mana", id: 9999 }) !== null, "a thing that isn't on the table is refused");
  const hand = idIn(s, 0, "Brainstorm");
  check(refusal(s, 0, { t: "mana", id: hand }) !== null, "a card in hand is refused");
  const asked = J(s); asked.pending = { t: "retarget", seat: 0 };
  check(refusal(asked, 0, { t: "mana", id: isle }) !== null, "with a question to answer, it waits");
}
// it works with a spell on the stack too (to pay for an answer), and keeps priority there
{
  let s = scene({ active: 1, step: "main1", prio: 1, turn: 7, hand: [["Memory Lapse", "Brainstorm"], ["Brainstorm"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 2)] });
  s = go(s, 1, { t: "cast", card: idIn(s, 1, "Brainstorm"), from: "hand", targets: [] });
  check(s.stack.length === 1 && toMove(s) === 0, "(the computer's Brainstorm is on the stack and we may answer)");
  const t = go(s, 0, { t: "mana", id: onBf(s, 0, "Island") });
  check(t.stack.length === 1 && toMove(t) === 0 && poolOf(t, 0) === "U", "tapping in answer leaves the stack alone and priority with us");
  const lapse = moves(t, 0).find(m => m.t === "cast" && DECK[m.card] === "Memory Lapse");
  const c = lapse && go(t, 0, { ...lapse, hold: true });   // a third Island and a Brainstorm left make it a priority worth holding, so the stack stays to be looked at
  check(!!c && c.stack.length === 2 && tapped(c, 0) === 2 && poolOf(c, 0) === "", "a Memory Lapse then costs the float and one more land (the third Island is still untapped)");
}

process.exit(bad ? 1 : (console.log("mana-tap: a land tapped for mana floats it, keeps priority, pays the next spell first and goes at the step's end"), 0));
