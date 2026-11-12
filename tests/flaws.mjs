// dandan-flaws.js (Korbi, 12 November 2026): Mind Bend on your own Island is a flaw, except for red mana you need (a Retrieval to
// flash back) and, doubtfully, your last Island with their Dandâns about to kill you; at their land or a Dandân it isn't.
import { DECK } from "../dandan-cards.js";
import { flawAt } from "../dandan-flaws.js";
import { scene, islandsOf } from "./dandan-scene.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
function at({ mine = 3, theirs = [], yard = [], life = 20, target = "mine" } = {}) {
  const s = scene({ active: 1, step: "main1", prio: 1, turn: 9, drawn: [0, 1], yard, hand: [[], []],
    bf: [...islandsOf(0, 3), ...islandsOf(1, mine), ...theirs.map(n => [0, n])] });
  s.life[1] = life;
  const p = s.bf.find(q => DECK[q.id] === (target === "dandan" ? "Dandân" : "Island") && q.ctl === (target === "mine" ? 1 : 0));
  s.pending = { t: "bend", seat: 1, froms: ["Island"], target: p.id };
  return s;
}
const bend = to => ({ t: "bend", from: "Island", to });
check(flawAt(at(), 1, bend("Swamp"))?.kind === "flaw", "own Island to a Swamp: a flaw");
check(flawAt(at(), 1, bend("Mountain"))?.kind === "flaw", "own Island to a Mountain with no Retrieval to flash back: a flaw");
check(flawAt(at({ yard: ["Mystic Retrieval"] }), 1, bend("Mountain")) === null, "own Island to a Mountain, a Retrieval in the graveyard: fine");
check(flawAt(at({ target: "theirs" }), 1, bend("Swamp")) === null, "their Island: not flagged");
check(flawAt(at({ target: "dandan", theirs: ["Dandân"] }), 1, bend("Swamp")) === null, "their Dandân: not flagged");
check(flawAt(at({ mine: 1, theirs: ["Dandân", "Dandân"], life: 8 }), 1, bend("Swamp"))?.kind === "doubt", "last Island, two Dandâns, 8 life: doubtful");
check(flawAt(at({ mine: 2, theirs: ["Dandân", "Dandân"], life: 8 }), 1, bend("Swamp"))?.kind === "flaw", "not the last Island: a flaw");
check(flawAt(at(), 1, { t: "pass" }) === null, "any other move: nothing");
if (bad) { console.log(`${bad} failed`); process.exit(1); }
