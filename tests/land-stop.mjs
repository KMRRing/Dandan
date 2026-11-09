// A land its player plays, whose trigger goes on the stack, waits for them to pass (Korbi, 6 November 2026: Halimar Depths "should
// ask the player if they want to do anything before it resolves"), though they hold nothing to answer it with. (The page asks for
// the stop only while the hold-priority switch is on, Korbi, 9 November 2026; the engine keeps it for the move marked hold.)
import { toMove } from "../dandan-engine.js";
import { scene, islandsOf, go, idIn } from "./dandan-scene.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const play = (hold, hand = ["Halimar Depths"]) => { const s = scene({ active: 0, step: "main1", prio: 0, turn: 6, hand: [hand, ["Island"]], bf: [...islandsOf(0, 3), [1, "Island"]] }); return go(s, 0, { t: "land", card: idIn(s, 0, "Halimar Depths"), ...(hold ? { hold: true } : {}) }); };

let t = play(true);
check(t.stack.length === 1 && toMove(t) === 0, "a person's Halimar Depths waits with its trigger on the stack, and the move is theirs");
t = go(t, 0, { t: "pass" });
check(!t.stack.length && t.log.some(e => /Halimar Depths trigger resolves/.test(e.t)) || !!t.pending, "their pass lets it resolve");
t = play(false);
check(!t.stack.length || toMove(t) !== 0 || t.pending, "without the stop (the computer's land) it resolves as before");
if (bad) process.exit(1);
console.log("land-stop: a person's land trigger waits for their pass");
