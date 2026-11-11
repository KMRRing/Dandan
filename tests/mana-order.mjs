// Using the mana well (Korbi, 11 November 2026): the spell before Izzet Boilerworks (it returns a land; played first it returns an
// untapped one and its mana is lost), and no Brainstorm in our own upkeep (after the draw it sees four cards, before it three).
import { scene, islandsOf } from "./dandan-scene.js";
import { policyMove, izzetLast, ownPredraw } from "../dandan-policy.js";
import { candidates } from "../dandan-think.js";
import { DECK } from "../dandan-cards.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const isName = (m, n) => m.t !== "pass" && DECK[m.card] === n;
for (const n of [2, 3]) {
  const s = scene({ active: 0, step: "main1", prio: 0, turn: 7, hand: [["Izzet Boilerworks", "Dandân", "Brainstorm", "Predict"], ["Island", "Brainstorm", "Predict", "Quicken"]], bf: [...islandsOf(0, n), ...islandsOf(1, 3)] });
  const m = policyMove(s, 0, { rng: () => 0.5 });
  check(isName(m, "Dandân"), `${n} Islands, Boilerworks and a Dandân: Medium casts the Dandân first`);
}
{
  const s = scene({ active: 0, step: "main1", prio: 0, turn: 7, hand: [["Izzet Boilerworks", "Dandân"], ["Island"]], bf: [...islandsOf(0, 3).map(([a, b]) => [a, b, { tapped: true }]), ...islandsOf(1, 3)] });
  check(izzetLast(s, 0, { t: "land", card: s.hand[0][0] }) == null, "every land already tapped: the Boilerworks costs nothing, nothing to put first");
}
{
  const s = scene({ active: 0, step: "upkeep", prio: 0, turn: 7, hand: [["Brainstorm", "Island", "Dandân", "Memory Lapse"], ["Island", "Brainstorm"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 3)] });
  check(ownPredraw(s, 0) && !candidates(s, 0, { all: true }).some(m => isName(m, "Brainstorm")), "our own upkeep: Brainstorm is not weighed");
  const t = { ...s, active: 1 };
  check(!ownPredraw(t, 0), "their upkeep is another matter (we draw before them)");
}
if (bad) process.exit(1);
console.log("mana-order: the spell before Izzet Boilerworks, no Brainstorm before our own draw");
