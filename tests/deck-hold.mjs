// A short shared library: Hard's search may hold priority on a spell that moves the library, and answer it itself (6 November 2026,
// Korbi: Take Inventory on an empty library holding priority, then Memory Lapse on one's own spell, flips who draws last).
import { moves, toMove } from "../dandan-engine.js";
import { candidates } from "../dandan-think.js";
import { scene, islandsOf, go, idIn } from "./dandan-scene.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const at = (lib, bare = true) => scene({ active: 0, step: "main1", turn: 9, prio: 0, lib: [...Array(Math.min(lib, 10)).fill("Dandân"), ...Array(Math.max(0, lib - 10)).fill("Island")], bare, hand: [["Take Inventory", "Memory Lapse"], ["Island"]], bf: [...islandsOf(0, 6), ...islandsOf(1, 3)] });

// the mechanism: hold, then Lapse one's own spell: the library gains the spell instead of losing the draw
{
  const s = at(0), ti = idIn(s, 0, "Take Inventory"), ml = idIn(s, 0, "Memory Lapse");
  const held = go(s, 0, { t: "cast", card: ti, from: "hand", targets: [], hold: true });
  check(toMove(held) === 0 && held.stack.length === 1, "casting Take Inventory holding priority leaves the caster to move with the spell on the stack");
  const lapse = moves(held, 0).find(m => m.t === "cast" && m.card === ml && m.targets[0]?.k === "s");
  check(!!lapse, "and Memory Lapse on its own spell is a move");
  const after = lapse && go(held, 0, lapse);
  check(!!after && !after.over && after.hand[1].includes(ti), "countered, the spell goes on top of the library, the caster has not lost, and the other seat's draw takes it");
  const plain = go(s, 0, { t: "cast", card: ti, from: "hand", targets: [] });
  check(plain.over && plain.winner === 1, "(cast without holding, the draw from the empty library loses the game)");
}
// the search is offered the held casts only when the library is short
{
  const holds = (lib, bare) => candidates(at(lib, bare), 0, { wide: 7 }).filter(m => m.hold);
  check(holds(0, true).some(m => m.t === "cast"), "with the library empty the shortlist has a held cast");
  check(holds(12, true).length > 0 && holds(12, true).length <= 4, "with 12 cards left it has some, not more than four");
  check(at(0, false).lib.length > 30 && holds(0, false).length === 0, "with a full library it has none (the search is as it was)");
}
if (bad) process.exit(1);
console.log("deck-hold: a held cast is a move of the short-library search, and answering one's own spell works");
