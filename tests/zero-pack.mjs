// Standing test for Zero 2's packer (16 Nov 2026, Fable's review, items 8, 9 and 12): a self-play game's decision lines (one game,
// tests/fixtures/zero-game-4245.jsonl: lab/zero/zero-play.mjs, g11w-C, 8 deals, deeper 0.03) packed by lab/zero/replay-pack2.mjs.
// Every line carries its options' moves (no match by marks), every packed pick is the move the game played, and the value target is
// the picked option's final mean. A game from before moves were stored (tests/fixtures/zero-game-old.jsonl, the filler zps of
// 16 Nov) packs too: every line, as hard picks, the pick the move played. If the engine changes play, the game no longer replays the same: make the fixture again with
//   node lab/zero/zero-play.mjs 0 1 tests/fixtures/zero-game-4245.jsonl 8 1 4245 g11w-C-policy g11w-C-value 400 deeper=0.03
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const game = new URL("./fixtures/zero-game-4245.jsonl", import.meta.url).pathname, dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp2-"));
const lines = fs.readFileSync(game, "utf8").split("\n").filter(l => l.startsWith('{"g"')).map(l => JSON.parse(l));
check(lines.length > 100 && lines.every(d => d.c.every(c => c.mv) && d.v != null), `every decision line stores its options' moves and a value target (${lines.length} lines)`);
check(lines.every(d => Math.abs(d.v - (d.c[d.pick].d ?? d.c[d.pick].q)) < 1e-9), "the value target is the picked option's final mean");
check(lines.every(d => d.looks != null && d.c.every(c => c.se != null && c.n != null && (c.d == null || (c.dse != null && c.dn != null)))), "each option keeps the first look's q, se and n, a re-weighed one the last look's too, and the line its looks");
check(lines.some(d => d.c.some(c => c.d != null)), "the deeper look's options keep the first look's mean as their soft target (q) and the last look's apart (d)");
const pack = file => execFileSync(process.execPath, [new URL("../lab/zero/replay-pack2.mjs", import.meta.url).pathname, dir, `file:${file}`, new URL("../lab/zero/nets/g12h2-scry12.json", import.meta.url).pathname], { encoding: "utf8" });
const count = out => re => Number((out.match(re) || [])[1]);
const out = pack(game), n = count(out);
check(n(/(\d+) games \(0 not the same\)/) === 1, "the game replays the same (if not: make the fixture again, above)");
check(n(/decisions (\d+)/) === lines.length && n(/(\d+) unmatched/) === 0 && n(/(\d+) from before/) === 0, `every line is packed from its moves (${out.trim().split("; ")[1]})`);
check(n(/(\d+) picks not among/) === 0 && n(/(\d+) where the move played was not/) === 0, "every packed pick is the move the game played, and the line's own pick");
const oldGame = new URL("./fixtures/zero-game-old.jsonl", import.meta.url).pathname, oldLines = fs.readFileSync(oldGame, "utf8").split("\n").filter(l => l.startsWith('{"g"')).length;
const o = count(pack(oldGame));
check(o(/(\d+) games \(0 not the same\)/) === 1 && o(/decisions (\d+)/) === oldLines && o(/(\d+) from before/) === oldLines && o(/(\d+) unmatched/) === 0 && o(/(\d+) picks not among/) === 0, `an old game packs every line as hard picks, each pick the move played (${oldLines} lines)`);
fs.rmSync(dir, { recursive: true, force: true });
if (fails) process.exit(1);
