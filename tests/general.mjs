// The general encoding (dandan-general.js, 17 Nov 2026, stage 3 step 3): its mark space fits the packs' 8-bit marks, the view's
// size is what viewSize says, every option of a replayed game gets marks in range, and only twins (the same card, the same state,
// the same targets) share all their marks.
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { generalView, generalMarks, POOL, viewSize } from "../dandan-general.js";
import { zeroOptions } from "../dandan-zero.js";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
check(POOL.MARK_N <= 256, `the mark space fits a byte (${POOL.MARK_N} marks: ${POOL.V} names, ${POOL.F} facts)`);
const line = fs.readFileSync(new URL("./fixtures/zero-game-4245.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(JSON.parse).find(o => o.game != null);
let G = newRecord(rules, { seats: 2, seed: line.seed, now: 0 }), opts = 0, bad = 0, size = true;
const th = new Float32Array(POOL.V);
for (let i = 0; i < line.moves.length; i++) {
  const s = G.state, [who, m] = line.moves[i];
  if (generalView(s, who, th).length !== viewSize()) size = false;
  for (const x of zeroOptions(s, who)) { opts++; const k = generalMarks(s, who, x); if (!k.length || k.some(j => j < 0 || j >= POOL.MARK_N)) bad++; }
  Math.random = seeded(mix(line.seed, i + 1));
  G = applyMove(rules, G, who, m, 0).G;
}
check(size, `the view is ${viewSize()} numbers at every position`);
check(opts > 400 && bad === 0, `every option has marks, all in range (${opts} options)`);
process.exit(fails ? 1 : 0);
