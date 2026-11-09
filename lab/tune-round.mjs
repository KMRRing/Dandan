// One round of tuning Medium by matches. Candidates are the fit build's ADJ constants (dandan-policy.js on the champion ref's
// side is plain main), each nudged up and down by `step` from the base in lab/tune-state.json. Every candidate plays the same
// deals against main Medium with the seats swapped; a row is the candidate's score for one deal (0, 0.5 or 1 per game, averaged).
// usage: node lab/tune-round.mjs <shard> <shards> <out.jsonl> <pairs per candidate> <first pair> <candidates: all | list of numbers 0,3,17> [fit ref medium-fit-2] [step] [base pass]
// Tuning deals start at pair 100000 (+ first pair), so they never overlap the quick-pair confirmation deals (0 up).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { J } from "./lib.mjs";
const [shard, shards, out, perCand, first0, pick = "all", fitRef = "medium-fit-2", stepArg, passArg] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5]), Number(process.argv[6]), process.argv[7], process.argv[8], process.argv[9], process.argv[10]];
const state = JSON.parse(fs.readFileSync(new URL("./tune-state.json", import.meta.url), "utf8"));
if (passArg !== undefined) (state.base ??= {}).pass = Number(passArg); // base pass, overriding the state file
const step = stepArg ? Number(stepArg) : state.step ?? 0.5;
const git = (...a) => execFileSync("git", a, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const dirA = path.resolve(".");
git("fetch", "-q", "--depth=1", "origin", fitRef);
const dirB = path.resolve("..", "tune-fit"); git("worktree", "add", "-q", "--detach", dirB, "FETCH_HEAD");
const polA = await import(`${dirA}/dandan-policy.js`), polB = await import(`${dirB}/dandan-policy.js`);
const { DECK } = await import(`${dirA}/dandan-cards.js`);
const { rules } = await import(`${dirA}/dandan-rules.js`), { newRecord, applyMove, seeded, mix } = await import(`${dirA}/seats.js`);
const names = [...new Set(DECK)];
const spells = ["Brainstorm", "Commit", "Memory", "Memory Lapse", "Metamorphose", "Mind Bend", "Narset's Reversal", "Piracy Charm", "Predict", "Quicken", "Repulse", "Chart a Course", "Deem Inferior", "Gone Missing", "Lórien Revealed", "Mystic Retrieval", "Take Inventory", "Dandân"];
const lands = ["Flood Plain", "Halimar Depths", "Island", "Izzet Boilerworks", "Lonely Sandbar", "Mystic Sanctuary", "Remote Isle", "Thundering Falls"];
for (const n of [...spells.filter(n => !names.includes(n) && !names.some(d => d.split(" // ").includes(n))), ...lands.filter(n => !names.includes(n))]) throw new Error("unknown card " + n);
const params = ["pass", ...spells.map(n => "cast:" + n), "hold:Dandân", ...lands.map(n => "land:" + n), "cycle:Lonely Sandbar", "cycle:Remote Isle", "cycle:Flood Plain", "ability:Flood Plain", "ability:Mystic Sanctuary", "ability:Thundering Falls", "ability:Izzet Boilerworks"];
const put = (ADJ, k, v) => { if (k === "pass") ADJ.pass = v; else { const [g, n] = k.split(":"); ADJ[g] ??= {}; ADJ[g][n] = v; } };
const cands = [];
for (const k of params) for (const d of [step, -step]) cands.push({ k, d });
cands.push({ k: "pass", d: 0 }); // the base itself, last, so earlier numbers stay put
const use = pick === "all" ? cands.map((_, i) => i) : pick.split(",").map(Number);
if (shard === 0 && process.env.LIST) console.log(cands.map((c, i) => `${i} ${c.k} ${c.d}`).join("\n"));
function load(c) { // set polB.ADJ to the base plus the nudge
  const A = polB.ADJ; for (const g of ["cast", "hold", "land", "cycle", "ability"]) for (const n of Object.keys(A[g] ?? {})) delete A[g][n]; A.pass = 0;
  for (const [k, v] of Object.entries(state.base)) put(A, k, v);
  if (c) put(A, c.k, (state.base[c.k] ?? 0) + c.d);
}
const play = (pol, ADJmode) => ({ move: (s, seat) => pol.policyMove(s, seat, { rng: Math.random }) });
const PA = play(polA), PB = play(polB);
const base = Math.floor(perCand / shards), extra = perCand % shards, first = first0 + shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
const realRandom = Math.random;
for (const ci of use) {
  load(cands[ci]);
  for (let p = first; p < first + n; p++) {
    let score = 0;
    for (const bSeat of [0, 1]) {
      let G = newRecord(rules, { seats: 2, seed: 105000 + p, now: 0 });
      for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
        const who = rules.toMove(G.state), s = rules.restore(J(G.state)), pl = who === bSeat ? PB : PA;
        Math.random = seeded(mix(105000 + p, i + 1));
        G = applyMove(rules, G, who, pl.move(s, who), 0).G;
      }
      Math.random = realRandom;
      const w = G.state.winner; score += w === bSeat ? 1 : w < 0 ? 0.5 : 0;
    }
    fs.appendFileSync(out, JSON.stringify({ cand: ci, k: cands[ci].k, d: cands[ci].d, pair: p, score: score / 2 }) + "\n");
  }
}
