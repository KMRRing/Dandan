// The chart's judge sees a short shared library: the seat that must draw from the empty one loses (Korbi, 6 November 2026).
import { deckedChance, winChance } from "../dandan-eval.js";
import { scene, islandsOf } from "./dandan-scene.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
// two cards left, the other seat's turn is next: draws go (seat 0 on its turn done) → seat 1, seat 0, then seat 1 draws from empty
const s = scene({ active: 0, step: "main1", turn: 12, lib: ["Island", "Island"], bare: true, bf: [...islandsOf(0, 3), ...islandsOf(1, 3)] });
check(deckedChance(s, 0) > 0.8 && deckedChance(s, 0) > winChance(s, 0), "two cards left, the other seat to draw first: it, then I, then it finds the library empty: I am well ahead");
s.active = 1;
check(deckedChance(s, 0) < 0.2, "the same library with the draw the other way round: I am well behind");
const long = scene({ active: 0, step: "main1", turn: 12, bf: [...islandsOf(0, 3), ...islandsOf(1, 3)] });
check(deckedChance(long, 0) === winChance(long, 0), "a long library leaves the judge as it was");
check(Math.abs(deckedChance(s, 0) + deckedChance(s, 1) - 1) < 1e-9, "the two seats' chances still add up to one");
if (bad) process.exit(1);
console.log("judge-decking: a short shared library pulls the chart's judge toward the seat that will not have to draw from it");
