// The general Monte's four-seat change must leave Dandan's play exactly as it was (Fable, 24 Nov 2026 18:50Z): the wide engine
// (zp27wide, live since 24 Nov) searches fixed positions of a recorded game, seeded, and must pick the same move with the same
// means as recorded in fixtures/nseat-identity.json before the change. --record writes that file (only ever before a change).
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { zeroOptions } from "../dandan-zero.js";
import { generalBrain } from "../lab/zero/zero-lib.mjs";

const FIX = new URL("./fixtures/nseat-identity.json", import.meta.url), record = process.argv.includes("--record"), t0 = Date.now();
const line = fs.readFileSync(new URL("./fixtures/zero-game-4245.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(JSON.parse).find(o => o.game != null);
const brain = await generalBrain("zp27wide"), real = Math.random, out = [];
brain.reset();
let G = newRecord(rules, { seats: 2, seed: line.seed, now: 0 });
for (let i = 0; i < line.moves.length && out.length < 6; i++) {
  const s = G.state, [who, m] = line.moves[i];
  if (i % 9 === 4 && zeroOptions(s, who).length > 1) {
    Math.random = seeded(mix(77, i));
    const r = brain.think(s, who, 24, { deeper: { gap: 0.03, max: 4 } });
    Math.random = real;
    out.push({ i, best: JSON.stringify(r.best), means: r.list.map(c => [JSON.stringify(c.move), Number.isNaN(c.mean) ? null : +c.mean.toFixed(12)]) });
  }
  Math.random = seeded(mix(line.seed, i + 1));
  const r = applyMove(rules, G, who, m, 0);
  Math.random = real;
  brain.seen(s, who, m, r.G.state); G = r.G;
}
if (record) { fs.writeFileSync(FIX, JSON.stringify(out) + "\n"); console.log(`nseat-identity: recorded ${out.length} positions, ${Date.now() - t0} ms`); process.exit(0); }
const want = JSON.parse(fs.readFileSync(FIX, "utf8"));
const bad = want.filter((w, k) => JSON.stringify(w) !== JSON.stringify(out[k]));
if (bad.length || want.length !== out.length) { console.error(`nseat-identity: Dandan plays differently at ${bad.map(b => `move ${b.i}`).join(", ") || "a different set of positions"}`); process.exit(1); }
console.log(`nseat-identity: ${out.length} positions, the same moves and means as before the four-seat change; ${Date.now() - t0} ms`);
