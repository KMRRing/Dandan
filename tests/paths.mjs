// Hard over four paths (dandan-think.js thinkPaths, Korbi 11 November 2026): each move valued on four plan pairings, then
// maximin. Quick: a few deals.
import { scene, islandsOf } from "./dandan-scene.js";
import { thinkPaths, PATHS } from "../dandan-think.js";
import { moves } from "../dandan-engine.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const s = scene({ active: 0, step: "main1", prio: 0, turn: 7, hand: [["Island", "Dandân", "Memory Lapse", "Brainstorm"], ["Island", "Brainstorm", "Predict"]], bf: [...islandsOf(0, 4), ...islandsOf(1, 4)] });
const r = thinkPaths(JSON.parse(JSON.stringify(s)), 0, { deals: 16, ms: 1e9 });
const legal = new Set(moves(s, 0).map(m => JSON.stringify(m)));
check(PATHS.length === 4 && r.list.every(c => c.paths.length === 4), "every move has a value on each of the four paths");
check(r.list.every(c => c.mean === Math.max(Math.min(c.paths[0], c.paths[1]), Math.min(c.paths[2], c.paths[3]))), "a move is worth the better plan's worse answer (maximin)");
check(r.best.t === "pass" || legal.has(JSON.stringify(r.best)), "the move chosen is legal");
if (bad) process.exit(1);
console.log("paths: Hard over four plan pairings, maximin");
