// The redraw table of a value net (dandan-keep.js solveTable): what a fresh seven is worth, on the play and on the draw, after
// n mulligans counted, when every keep is made by the net. Written into the net's file in judges/ as `mull`, so Hard with
// "-keep" (lab/hard-match.mjs) and the game can compare a hand with it. Also prints how often the net keeps a playable first seven.
// usage: node lab/keep-table.mjs <judge file in judges/> [sample hands 400] [deals of the other hand 24] [seed 1]
import fs from "node:fs";
import { makeJudge } from "../dandan-eval.js";
import { deal } from "../dandan-engine.js";
import { seeded } from "../seats.js";
import { solveTable } from "../dandan-keep.js";

const [file, hands = 400, deals = 24, seed = 1] = process.argv.slice(2);
const url = new URL(`../judges/${file}`, import.meta.url), net = JSON.parse(fs.readFileSync(url, "utf8")), t0 = Date.now();
const table = solveTable(makeJudge(net.layers), deal, { hands: Number(hands), deals: Number(deals), rng: seeded(Number(seed)) });
net.mull = { ...table, made: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(url, JSON.stringify(net));
console.log(JSON.stringify({ file, ...net.mull, seconds: Math.round((Date.now() - t0) / 1000) }));
