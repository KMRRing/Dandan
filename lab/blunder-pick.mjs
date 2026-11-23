// The blunder rate (23 Nov 2026, Fable 09:45Z, 10:57Z and 12:35Z): a net's own deep pick on the reference's positions
// (lab/blunder-ref.mjs, batch zdref001), scored by the reference's means: the points it gives up against the reference's best.
// The games (match A, zdm001) are replayed to each position with the net under test watching every move, as in play; its pick is
// one deep search there (1,024 deals, close calls up to 4 turns ahead, as in the matches; the prior if asked, and the margin term).
// Output, one line a position: { pos, seat, turn, pick, loss, best, n }; loss = the reference's best mean − its mean of the pick
// (0 when the pick is the reference's best; null when the reference has no mean for it). Summarised by lab/blunder-sum.mjs.
// usage: node lab/blunder-pick.mjs <shard> <shards> <out> <nets: gen:<name> | <name> for the old line, as g12r-C>
//          [prior 0|1] [ref zdref001[,zdref002]] [batch zdm001] [deals 1024] [margin -|<w>:<k>]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { generalBrain, zeroBrain } from "./zero/zero-lib.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";

const [SH, SHS, OUT, nets, prior = "0", ref = "zdref001", batch = "zdm001", deals = "1024", margin = "-"] = process.argv.slice(2);
const real = Math.random, J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m);
const store = await (await import("./lib.mjs")).labStore();
const brain = nets.startsWith("gen:") ? await generalBrain(nets.slice(4)) : zeroBrain(`${nets}-policy`, `${nets}-value`);
const opts = { deeper: { gap: 0.03, max: 4 }, ...(Number(prior) ? { prior: Number(prior) } : {}), ...(margin !== "-" ? { margin } : {}) };
// the reference: every position's means, by "<seed>:<move>"
const R = new Map();
for (const n of (await Promise.all(ref.split(",").map(r => store.list(`results/${r}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)))
  for (const l of ((await store.get(n)) || "").split("\n")) if (l.startsWith('{"pos"')) { const o = JSON.parse(l); R.set(o.pos, o); }
const names = (await store.list(`results/${batch}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % Number(SHS) === Number(SH));
if (OUT && OUT !== "-") fs.writeFileSync(OUT, "");
let done = 0, lost = 0;
for (const n of names) {
  let t = "";
  try { t = (await store.get(n)) || ""; } catch { continue; }
  for (const l of t.split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l);
    const want = new Set([...Array(g.moves.length).keys()].filter(i => R.has(`${g.seed}:${i}`)));
    if (!want.size) continue;
    const last = Math.max(...want);
    brain.reset?.();
    let G = recordOf(rules, g);
    for (let i = 0; i <= last; i++) {
      const [who, m] = g.moves[i], s = rules.restore(J(G.state));
      if (want.has(i)) {
        const rf = R.get(`${g.seed}:${i}`), t0 = Date.now();
        const r = brain.think(J(s), who, Number(deals), opts), pk = key(r.best), means = new Map(rf.opts), top = Math.max(...rf.opts.map(o => o[1]));
        const loss = means.has(pk) ? +(top - means.get(pk)).toFixed(4) : null;
        const line = { pos: rf.pos, seat: who, turn: rf.turn, pick: pk, loss, best: rf.opts.find(o => o[1] === top)[0], n: rf.opts.length, ms: Date.now() - t0 };
        if (OUT && OUT !== "-") fs.appendFileSync(OUT, JSON.stringify(line) + "\n");
        console.log(`pos ${line.pos} turn ${line.turn}: ${line.n} options, loss ${loss ?? "n/a"}, ${line.ms} ms`);
        done++; if (loss == null) lost++;
      }
      Math.random = seeded(rngSeedOf(g, i));
      const res = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (res.error) break;
      brain.seen(s, who, m, res.G.state);
      G = res.G;
    }
  }
}
console.log(`${done} positions (${lost} picks the reference has no mean for), shard ${SH} of ${SHS}`);
