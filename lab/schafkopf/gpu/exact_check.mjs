// The JS search on exactly the GPU search's worlds and option orders (worlds_dump.py): with greedy play-outs both searches are
// then deterministic, so each option's mean must match the GPU's to rounding; where they differ, the trees differ.
// usage: node lab/schafkopf/gpu/exact_check.mjs <positions.jsonl> <worlds.jsonl> <net> <deals> > out.jsonl
import fs from "node:fs";
import { think } from "../../../dandan-think.js";
import { schafkopf as G } from "../sk-rules.js";
import { judgeOf } from "../sk-monte.js";
import { loadNet, policyRollout } from "../sk-net.js";
import { actionOf } from "../sk-view.js";

const [posFile, worldFile, netFile, dealsArg] = process.argv.slice(2);
const P = fs.readFileSync(posFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const Wd = fs.readFileSync(worldFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const rollout = policyRollout(loadNet(new URL(`../../../${netFile}`, import.meta.url)), true), id = k => k + 1 + Math.floor(k / 8);
P.forEach((p, i) => {
  const s = G.dealWith(p.hands.map(h => h.map(id)), p.dealer);
  for (const a of p.log) { const w = G.toMove(s); G.act(s, w, G.options(s, w).find(m => actionOf(m) === a), () => 0); }
  let d = 0;
  const dealer = st => { const hands = Wd[i].worlds[d++].map(h => h.map(id)); const w = G.replay(st, hands); if (!w) throw new Error(`position ${i} deal ${d - 1}: the GPU's world doesn't replay`); return w; };
  const r = think(s, p.seat, { deals: Number(dealsArg), ms: 1e9, all: true, options: G.options, rollout, judge: judgeOf(), game: { ...G, determinize: dealer }, hold: false });
  process.stdout.write(JSON.stringify({ hands: p.hands, dealer: p.dealer, log: p.log, seat: p.seat, step: p.step, best: actionOf(r.best), opts: r.list.map(c => [actionOf(c.move), c.mean, c.n, c.se]) }) + "\n");
});
