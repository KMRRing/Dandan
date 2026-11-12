// Narset's Reversal on a spell cast with flashback (Korbi, 12 November 2026): "If the flashback cost was paid, exile this card
// instead of putting it anywhere else any time it would leave the stack." The copy is made as usual; the original goes to exile,
// not back to its owner's hand, and the log says so.
import { pushItem } from "../dandan-core.js";
import { scene, islandsOf, go, names, cast, answer } from "./dandan-scene.js";
import { toMove } from "../dandan-engine.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };

let s = scene({ active: 0, step: "main1", prio: 1, turn: 9, hand: [[], ["Narset's Reversal"]], yard: ["Mystic Retrieval", "Brainstorm"], bf: [...islandsOf(0, 4), ...islandsOf(1, 4)] });
const retrieval = s.yard.find(i => names([i])[0] === "Mystic Retrieval"), storm = s.yard.find(i => names([i])[0] === "Brainstorm");
s.yard = s.yard.filter(i => i !== retrieval);
const fb = pushItem(s, { kind: "spell", name: "Mystic Retrieval", card: retrieval, ctl: 0, targets: [{ k: "g", id: storm }], eol: true, from: "yard" });
s = cast(s, 1, "Narset's Reversal", [{ k: "s", sid: fb.sid }]);
for (let i = 0; i < 20 && !s.over && (s.stack.length || s.pending); i++) s = s.pending ? answer(s, { t: s.pending.t }) : go(s, toMove(s), { t: "pass" });
check(s.exile.includes(retrieval), "the flashback Mystic Retrieval is exiled");
check(!s.hand[0].includes(retrieval) && !s.yard.includes(retrieval), "…not returned to its owner's hand, nor left in the graveyard");
check(s.log.some(e => /Mystic Retrieval is copied, and the original is exiled/.test(e.t)), "the log says it is exiled, not returned");
if (bad) process.exit(1);
console.log("reversal-flashback: a flashback spell bounced by Narset's Reversal is exiled");
