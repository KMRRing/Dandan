// Standing tests for the belief (16 Nov 2026, Fable's review, items 1, 2 and 6):
//   1. dealt hands follow Scry's odds, slot by slot (the fixed dealer: within 1.5 points on 20,000 deals; the old one was 26 off)
//   2. Scry 1.2's honest record is the same whether or not a seat was asked to act: a Dandân cast into three open Islands,
//      the other hand once with a Memory Lapse (asked, passes) and once without (passed over by the rules)
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { act, toMove } from "../dandan-engine.js";
import { DECK, NAMES } from "../dandan-cards.js";
import { knOf } from "../dandan-core.js";
import { seeded } from "../seats.js";
import { scryOf, dealBy, unknownSlots } from "../dandan-zeroview.js";
import { Record12 } from "../lab/zero/scry12.mjs";
import { scene, islandsOf, J, idIn } from "./dandan-scene.js";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const AT = new Map(NAMES.map((n, k) => [n, k]));

// 1. the deal follows the belief, slot by slot
{
  const net = JSON.parse(fs.readFileSync(new URL("../judges/zero-g9x-C-scry.json", import.meta.url), "utf8").split("\n")[0]), scry = scryOf(net);
  const s = scene({ active: 1, step: "main1", turn: 6, prio: 0, hand: [["Island", "Predict"], ["Memory Lapse", "Dandân", "Island", "Brainstorm", "Quicken"]], bf: [...islandsOf(0, 4), ...islandsOf(1, 4)] });
  const ids = unknownSlots(s, 0), b = scry(s, 0, null), pool = [...ids, ...s.lib.filter(id => !(knOf(s, id) & 1))].sort((x, y) => x - y);
  const N = 20000, rng = seeded(11);
  for (const fix of [true, false]) {
    const got = ids.map(() => new Float32Array(NAMES.length)), deal = dealBy(b.slots, fix);
    for (let d = 0; d < N; d++) deal(pool, ids.length, rng).slice(0, ids.length).forEach((id, j) => { got[j][AT.get(DECK[id])] += 1 / N; });
    let gap = 0;
    got.forEach((g, j) => g.forEach((v, k) => { gap = Math.max(gap, Math.abs(v - b.slots[j][k])); }));
    if (fix) check(gap < 0.015, `the fixed dealer follows Scry slot by slot (largest gap ${(100 * gap).toFixed(2)} points, bar 1.5)`);
    else console.log(`     (the old dealer: largest gap ${(100 * gap).toFixed(1)} points)`);
  }
}

// 2. the honest record doesn't depend on being asked
{
  const record = (theirs, honest) => {
    let s = scene({ active: 0, step: "main1", turn: 6, prio: 0, hand: [["Dandân", "Island"], theirs], bf: [...islandsOf(0, 3), ...islandsOf(1, 3)] });
    const R = new Record12(0, { honest });
    const step = (seat, m) => { const c = J(s), r = rules.act(c, seat, m, { rng: seeded(5) }); if (typeof r === "string") throw new Error(r); R.update(s, seat, m, r); s = r; };
    step(0, { t: "cast", card: idIn(s, 0, "Dandân"), from: "hand", targets: [] });
    for (let i = 0; i < 6 && s.stack.length && !s.over; i++) step(toMove(s), { t: "pass" });   // whoever is asked passes
    return R.events.map(e => Array.from(e).join(",")).join("|");
  };
  const withLapse = ["Memory Lapse", "Island"], without = ["Island", "Island"];
  check(record(withLapse, true) === record(without, true), "Scry 1.2's honest record is the same whether the other seat was asked or passed over");
  console.log(`     (the old record ${record(withLapse, false) === record(without, false) ? "was the same too" : "differs: it shows that they were asked"})`);
}
if (fails) process.exit(1);
