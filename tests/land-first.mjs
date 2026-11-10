// The Island first, then the spell (Korbi, 10 November 2026: Monte cast a Dandân and then played its Island, so the Island's
// mana wasn't open while the Dandân was on the stack, for a Memory Lapse to fight over it). A spell that draws or looks
// may still go first: what it finds can change which land to play.
import { scene, islandsOf, idIn } from "./dandan-scene.js";
import { landFirst, policyMove } from "../dandan-policy.js";
import { candidates } from "../dandan-think.js";
import { DECK } from "../dandan-cards.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const at = (hand, extra = {}) => scene({ active: 1, step: "main1", prio: 1, turn: 6, hand: [["Memory Lapse", "Island"], hand], bf: [...islandsOf(0, 3), ...islandsOf(1, 3)], ...extra });

let s = at(["Dandân", "Island", "Memory Lapse"]);
const dandan = { t: "cast", card: idIn(s, 1, "Dandân"), from: "hand", targets: [] };
check(landFirst(s, 1, dandan)?.t === "land" && DECK[landFirst(s, 1, dandan).card] === "Island", "a Dandân with an Island still to play: the Island first");
const c = candidates(s, 1);
check(!c.some(m => m.t === "cast" && DECK[m.card] === "Dandân"), "Hard doesn't weigh the Dandân before the Island");
const m = policyMove(s, 1, { rng: () => 0.5 });
check(!(m.t === "cast" && DECK[m.card] === "Dandân"), "nor does Medium cast it first");
s = at(["Predict", "Island"]);
check(landFirst(s, 1, { t: "cast", card: idIn(s, 1, "Predict"), from: "hand", targets: [] }) == null, "a spell that looks at cards may go first");
s = at(["Dandân", "Island"]); s.played = 1;
check(landFirst(s, 1, dandan) == null, "after the land for the turn, nothing to wait for");
if (bad) process.exit(1);
console.log("land-first: the Island goes down before a spell that doesn't look at cards");
