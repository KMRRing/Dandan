// Medium and the stack (Korbi, 11 November 2026: "they literally try to make their own memory lapse fizzle"). A counter at a
// spell already countered, or a removal at what our own spell below already takes, only wastes the card.
import { scene, islandsOf, idIn, go, J } from "./dandan-scene.js";
import { policyMove, stackFate } from "../dandan-policy.js";
import { toMove } from "../dandan-engine.js";
import { DECK } from "../dandan-cards.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
let s = scene({ active: 0, step: "main1", prio: 0, turn: 8, hand: [["Dandân", "Island", "Brainstorm", "Memory Lapse"], ["Memory Lapse", "Memory Lapse", "Island", "Predict"]], bf: [...islandsOf(0, 6), ...islandsOf(1, 6)] });
s = go(s, 0, { t: "cast", card: idIn(s, 0, "Dandân"), from: "hand", targets: [] });
const dandan = s.stack[0].sid;
s = go(s, 1, { t: "cast", card: idIn(s, 1, "Memory Lapse"), from: "hand", targets: [{ k: "s", sid: dandan }] });
const ours = s.stack[1].sid;
check(stackFate(s).gone.has(dandan), "their Dandân under our Lapse is gone");
const brainstorm = go(s, 0, { t: "cast", card: idIn(s, 0, "Brainstorm"), from: "hand", targets: [] });
for (const style of ["tempo", "squeeze"]) {
  const m = policyMove(J(brainstorm), toMove(brainstorm), { style, rng: () => 0.5 });
  check(!(m.t === "cast" && m.targets?.some(t => t.k === "s" && t.sid === dandan)), `${style}: no second Lapse at the Dandân our first is countering`);
}
const fight = go(s, 0, { t: "cast", card: idIn(s, 0, "Memory Lapse"), from: "hand", targets: [{ k: "s", sid: ours }] });
const f = stackFate(fight);
check(f.gone.has(ours) && !f.gone.has(dandan) && f.fizzle.size === 0, "their Lapse at ours: ours is gone, the Dandân resolves");
if (bad) process.exit(1);
console.log("stack-fate: no counter at a spell already countered, nor removal at what our own spell already takes");
