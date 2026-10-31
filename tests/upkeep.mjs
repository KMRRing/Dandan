// The upkeep stop (31 October 2026, Korbi: "before draw, if user can do anything, including cast predict or any instant
// speed action, they need to be able to chose to not do that"): from the second turn, an upkeep where a person could do
// anything is a stop, theirs or ours, whether the top card is known or not; passing there goes on to the draw.
// Run: node tests/upkeep.mjs
import { toMove } from "../dandan-engine.js";
import { botMove } from "../dandan-bot.js";
import { seeded } from "../seats.js";
import { scene, islandsOf, go, drive } from "./dandan-scene.js";

let bad = 0;
const test = (what, fn) => {
  try { const r = fn(); const ok = r !== false && typeof r !== "string"; console.log(`${ok ? "ok  " : "FAIL"} ${what}${typeof r === "string" ? " — " + r : ""}`); if (!ok) bad++; }
  catch (e) { console.log(`FAIL ${what}: ${e.message}`); bad++; }
};

/** Our end step, played on to the other player's turn 6 until someone is asked. */
const toTheirUpkeep = (mine, bf) => drive(scene({ active: 0, step: "end", prio: 0, passes: 1, hand: [mine, []], bf }), c => c.turn === 6, 40);
/** Their end step, played on to our turn 7 until someone is asked. */
const toMyUpkeep = (mine, bf) => drive(scene({ active: 1, step: "end", turn: 6, prio: 1, passes: 1, hand: [mine, []], bf }), c => c.turn === 7, 40);

test("our upkeep is a stop for Predict, Quicken or a cycling land, the top card unknown; passing goes on to the draw", () => {
  const mine = ["Predict", "Quicken", "Remote Isle"].map(n => toMyUpkeep([n], islandsOf(0, 2)));
  const none = toMyUpkeep(["Predict"], []);                         // nothing to pay with: nothing to ask
  const askedMe = c => c.step === "upkeep" && c.active === 0 && toMove(c) === 0;
  return mine.every(askedMe) && !askedMe(none) && go(mine[0], 0, { t: "pass" }).step !== "upkeep"
    || `${mine.map(c => c.step + "/" + toMove(c))} ${none.step}/${toMove(none)}`;
});
test("their upkeep is a stop for us with a Quicken in hand", () => {
  const c = toTheirUpkeep(["Quicken"], islandsOf(0, 1));
  return c.step === "upkeep" && toMove(c) === 0 || `${c.step}/${toMove(c)}`;
});
test("the computer's own upkeep is no stop for it: it is asked, and passes, with nothing to do on a known card", () => {
  const c = drive(scene({ active: 0, step: "end", turn: 5, prio: 0, passes: 1, hand: [[], ["Quicken"]], bf: islandsOf(1, 2) }), x => x.turn === 6, 40);
  return c.step === "upkeep" && toMove(c) === 1 && botMove(c, 1, { rng: seeded(1) }).t === "pass";
});
console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
