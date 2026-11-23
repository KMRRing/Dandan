// The blunder rate's fixed reference (23 Nov 2026, Korbi's proposal, Fable 09:45Z and 10:57Z): decisions from stored deep games of
// g12r-C against zl23 (match A, zdm001), two a game, chosen by a hash of game and move among the decisions with more than one
// option, and each searched by a reference: zl23's nets, four times the deals, the four-turn look on every option, no prior.
// A net under test is later scored by its own deep pick on the same positions (lab/blunder-pick.mjs): a blunder is a pick the
// reference puts 5 points or more below its best. Made once, reused for every net. Output, one line a decision:
// { pos: "<seed>:<move>", seat, turn, deals, ms, opts: [[move, mean], ...] }.
// usage: node lab/blunder-ref.mjs <shard> <shards> <out> [batch zdm001] [nets zl23] [deals 4096] [turns 4] [most per shard, 0 = all]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { zeroOptions } from "../dandan-zero.js";
import { generalBrain } from "./zero/zero-lib.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";

const [SH, SHS, OUT, batch = "zdm001", nets = "zl23", deals = "4096", turns = "4", most = "0"] = process.argv.slice(2);
// settings after the positional ones as KEY=value (PER, SKIP, COUNT), for the queue and lab-read, which pass no environment
for (const a of process.argv.slice(10)) { const m = /^([A-Z]+)=(.*)$/.exec(a); if (m) process.env[m[1]] = m[2]; }
const real = Math.random, J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m);
const hash = (seed, i) => { let h = Math.imul(seed ^ 0x5bd1e995, 0x85ebca6b) ^ Math.imul(i + 7, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return (h ^ (h >>> 13)) >>> 0; };
const store = await (await import("./lib.mjs")).labStore(), brain = await generalBrain(nets);
// batch: one or more, comma-separated (23 Nov 2026, zpteach001: zps036-zps039). Settings by environment (Fable 17:05Z and 16:55Z):
// PER the decisions a game (2); SKIP a batch of this script's results whose positions are not searched again (the requeue of
// zdref001's cut-off shards); COUNT=1 searches nothing and prints the positions wanted, those SKIP holds and its mean ms
const PER = Number(process.env.PER || 2), COUNT = process.env.COUNT === "1";
const SKIP = new Map();
if (process.env.SKIP) for (const n of (await store.list(`results/${process.env.SKIP}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)))
  for (const l of ((await store.get(n)) || "").split("\n")) if (l.startsWith('{"pos"')) { const o = JSON.parse(l); SKIP.set(o.pos, o.ms); }
let wanted = 0, held = 0;
const names = (await Promise.all(batch.split(",").map(b => store.list(`results/${b}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => COUNT || k % Number(SHS) === Number(SH));
if (OUT && OUT !== "-") fs.writeFileSync(OUT, "");
let done = 0;
// replays a game to its end, calling at(i, s, who) before each move with the brain caught up
function replay(g, at) {
  brain.reset();
  let G = recordOf(rules, g);
  for (let i = 0; i < g.moves.length; i++) {
    const [who, m] = g.moves[i], s = rules.restore(J(G.state));
    if (at(i, s, who) === false) return;
    Math.random = seeded(rngSeedOf(g, i));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = real;
    if (r.error) return;
    brain.seen(s, who, m, r.G.state);
    G = r.G;
  }
}
outer: for (const n of names) {
  let t = "";
  try { t = (await store.get(n)) || ""; } catch { continue; }
  for (const l of t.split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l);
    if (g.branch) continue;
    // the decisions with a choice (no question pending, past the mulligans), then the two with the lowest hash
    const ok = [];
    { let G = recordOf(rules, g); for (let i = 0; i < g.moves.length; i++) { const [who, m] = g.moves[i], s = G.state; if (i > 4 && !s.pending && !s.over && zeroOptions(s, who).length > 1) ok.push(i); Math.random = seeded(rngSeedOf(g, i)); const r = applyMove(rules, G, who, m, 0); Math.random = real; if (r.error) break; G = r.G; } }
    const pick = ok.sort((a, b) => hash(g.seed, a) - hash(g.seed, b)).slice(0, PER);
    wanted += pick.length; held += pick.filter(i => SKIP.has(`${g.seed}:${i}`)).length;
    if (COUNT) continue;
    const want = new Set(pick.filter(i => !SKIP.has(`${g.seed}:${i}`)));
    if (!want.size) continue;
    const last = Math.max(...want);
    replay(g, (i, s, who) => {
      if (want.has(i)) {
        const t0 = Date.now();
        Math.random = seeded(hash(g.seed, i));
        const r = brain.think(J(s), who, Number(deals), { deeper: { gap: 1, max: Number(turns) }, turns: Number(turns) });
        Math.random = real;
        const line = { pos: `${g.seed}:${i}`, seat: who, turn: s.turn, deals: r.deals, ms: Date.now() - t0, opts: r.list.map(o => [key(o.move), +(o.mean ?? 0).toFixed(4)]) };
        if (OUT && OUT !== "-") fs.appendFileSync(OUT, JSON.stringify(line) + "\n");
        console.log(`pos ${line.pos} seat ${who} turn ${s.turn}: ${line.opts.length} options, ${line.ms} ms`);
        done++;
      }
      return i < last;
    });
    if (Number(most) && done >= Number(most)) break outer;
  }
}
if (COUNT) { const ms = [...SKIP.values()]; console.log(`COUNT: ${wanted} positions wanted, ${held} already in ${process.env.SKIP || "-"}, ${wanted - held} missing; ${ms.length} stored, mean ${ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0} ms a decision`); }
console.log(`${done} decisions, shard ${SH} of ${SHS}`);
