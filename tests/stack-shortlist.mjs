// With something on the stack Hard weighs every move there is (up to twelve at the root), not only those Medium rates above
// −0.8: an audit of 1,277 decisions with two or more spells on the stack, every legal move valued, found the best one outside
// the shortlist in 6.5% of them (by two points of win chance or more in 2.7%), and the search can't weigh a move it is never given.
// One of those, rebuilt: the computer's Commit is aimed at his Dandân, he answers with a Repulse on the same Dandân (saving it
// to his hand, a card drawn), and the computer holds Memory Lapses. A Lapse on the Repulse lets the Commit through.
import { moves, toMove } from "../dandan-engine.js";
import { DECK } from "../dandan-cards.js";
import { Player } from "../dandan-policy.js";
import { candidates } from "../dandan-think.js";
import { scene, islandsOf, cast, onBf, sidOf, stackNames } from "./dandan-scene.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const key = m => JSON.stringify(m);

let s = scene({ active: 1, step: "upkeep", prio: 0, turn: 21, drawn: [0, 1], hand: [["Memory Lapse", "Memory Lapse", "Memory Lapse", "Commit // Memory"], ["Repulse"]],
  bf: [...islandsOf(0, 7), ...islandsOf(1, 6), [1, "Dandân"]] });
s = cast(s, 0, "Commit // Memory", [{ k: "c", id: onBf(s, 1, "Dandân") }]);
s = cast(s, 1, "Repulse", [{ k: "c", id: onBf(s, 1, "Dandân") }]);
console.log("   stack:", stackNames(s).join(" < "), "| to move", toMove(s));

const lapseOnRepulse = moves(s, 0).find(m => m.t === "cast" && DECK[m.card] === "Memory Lapse" && m.targets[0].k === "s" && m.targets[0].sid === sidOf(s, "Repulse"));
check(!!lapseOnRepulse && toMove(s) === 0, "(the position is as built: we may Lapse his Repulse)");
const legal = moves(s, 0).length + 1;
const root = candidates(s, 0), tree = candidates(s, 0, { wide: 4 });
check(root.some(m => key(m) === key(lapseOnRepulse)), `at the root the Lapse on the Repulse is weighed (${root.length} of ${legal} moves)`);
check(root.length === Math.min(legal, 12), "…and so is every other move there is, up to twelve");
check(tree.length <= 4, `inside the tree the shortlist stays at four (${tree.length})`);
// with the stack empty nothing is different: the cut-off at −0.8 and seven moves
{
  const e = scene({ active: 0, step: "main1", prio: 0, turn: 21, hand: [["Memory Lapse", "Brainstorm", "Island", "Predict", "Quicken", "Take Inventory", "Chart a Course", "Lórien Revealed", "Mind Bend"], ["Island"]],
    bf: [...islandsOf(0, 7), ...islandsOf(1, 3)] });
  check(candidates(e, 0).length <= 7, `with the stack empty the shortlist is as it was (${candidates(e, 0).length} of at most seven)`);
}
process.exit(bad ? 1 : (console.log("stack-shortlist: with a spell on the stack the search is given every move there is"), 0));
