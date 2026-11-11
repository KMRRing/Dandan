// Deep and Deepest weigh every legal move, not only Medium's near-best (Korbi, 11 November 2026). The case that showed it:
// eight cards at the end of our turn and one Island open, Piracy Charm's discard on them, which Medium scores at −1 (it
// doesn't see that a card goes to the hand size anyway) and so the shortlist never held. Weighed, it wins.
import { scene, islandsOf } from "./dandan-scene.js";
import { candidates, think } from "../dandan-think.js";
import { DECK } from "../dandan-cards.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const tapped = (seat, n) => Array.from({ length: n }, () => [seat, "Island", { tapped: true }]);
const s = scene({ active: 1, step: "main2", prio: 1, turn: 8,
  hand: [["Island", "Memory Lapse", "Brainstorm", "Predict", "Dandân"], ["Piracy Charm", "Island", "Island", "Memory Lapse", "Dandân", "Predict", "Take Inventory", "Mind Bend"]],
  bf: [...islandsOf(0, 5), ...tapped(1, 4), [1, "Island"]] });
s.played = 1;
const isCharm = m => m.t === "cast" && DECK[m.card] === "Piracy Charm" && m.mode === 2 && m.targets?.[0]?.seat === 0;
check(!candidates(s, 1).some(isCharm), "the usual shortlist leaves the discard out (Medium scores it at −1)");
check(candidates(s, 1, { all: true }).some(isCharm), "weighing every move, it is in");
check(isCharm(think(JSON.parse(JSON.stringify(s)), 1, { deals: 1024, ms: 1e9 }).best), "Deep (1,024 deals) casts it: the card was going to the hand size anyway");
if (bad) process.exit(1);
console.log("weigh-all: Deep and Deepest weigh every legal move");
