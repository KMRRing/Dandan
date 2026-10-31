// The computer must not use what it can't see: dealt the cards it can't see again (the other hand, the library), a search
// weighs every move at the same value and picks the same one. A difference means the search read the real hidden cards.
// (Checked on 60 recorded positions of Hard against Hard before this test was written: none differed.)
import { think, determinize } from "../dandan-think.js";
import { seeded } from "../seats.js";
import { scene, islandsOf } from "./dandan-scene.js";

const positions = {
  "main phase, a full hand": scene({ active: 0, step: "main1", turn: 6, prio: 0, hand: [["Dandân", "Memory Lapse", "Predict", "Brainstorm", "Island", "Chart a Course"], ["Memory Lapse", "Piracy Charm", "Mind Bend", "Quicken", "Take Inventory"]], bf: [...islandsOf(0, 4), ...islandsOf(1, 4)] }),
  "their end step, holding up mana": scene({ active: 1, step: "end", turn: 7, prio: 0, hand: [["Memory Lapse", "Quicken", "Island"], ["Dandân", "Predict", "Island"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 3)] }),
  "before the draw, with a Flood Plain": scene({ active: 0, step: "upkeep", turn: 6, prio: 0, hand: [["Predict", "Island"], ["Memory Lapse", "Brainstorm"]], bf: [[0, "Flood Plain"], ...islandsOf(0, 3), ...islandsOf(1, 3)] }),
};
const summary = r => JSON.stringify([r.best, r.list.map(c => [JSON.stringify(c.move), c.n, +c.mean.toFixed(9)])]);
let bad = 0;
for (const [what, s] of Object.entries(positions)) {
  for (const seat of [0, 1]) {
    const base = summary(think(s, seat, { deals: 16, ms: 1e9 }));
    const same = [11, 12].every(k => {
      const scrambled = determinize(s, seat, seeded(k), false);
      scrambled.log = s.log;                                   // the log is public; the deal only clears it
      return summary(think(scrambled, seat, { deals: 16, ms: 1e9 })) === base;
    });
    console.log(`${same ? "ok  " : "FAIL"} seat ${seat}, ${what}: the same weighing after the unseen cards are dealt again`);
    if (!same) bad++;
  }
}
console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
