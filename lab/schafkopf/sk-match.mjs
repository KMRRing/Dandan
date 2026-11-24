// Schafkopf's measure (Fable, 24 Nov 2026 18:50Z): paired deals. Each deal is played first at a table of four Codex Hard (the
// reference), then four times more with our engine in one seat (each seat in turn) and Codex Hard in the other three. The
// score is our seat's payoff less the reference's in that seat on that deal, in tariffs. Codex's players draw their randomness
// from the deal, the seat and the move's number, so until our seat plays otherwise than Hard did, the two tables are the same
// deal played the same way. Every game's decisions are kept (ours with the search's means), for the first auxiliary reading.
// usage: node lab/schafkopf/sk-match.mjs <shard> <shards> <out> <deals per decision> <paired deals per shard> <first seed> [ref=hard]
//   [close=<gap>:<mult>] [only=<shard,...>] [sd=<tariffs>] (Fable 20:38Z, job 2: a close call searched again at mult times the deals)
import fs from "node:fs";
import { schafkopf as G, codexMove, dealsLine } from "./sk-rules.js";
import { bareThink } from "./sk-monte.js";
import { seeded, mix } from "../../seats.js";

const [shard0, , out, deals, per, seed0] = process.argv.slice(2).map((x, i) => (i === 2 ? x : Number(x)));
// only=<n,...> (a re-run of failed shards): shard k plays the original shard ONLY[k], its deals and seeds exactly
const ONLY = (process.argv.find(a => a.startsWith("only=")) || "").slice(5).split(",").filter(Boolean).map(Number), shard = ONLY.length ? ONLY[shard0] : shard0;
const ref = (process.argv.find(a => a.startsWith("ref=")) || "ref=hard").slice(4);
const cl = (process.argv.find(a => a.startsWith("close=")) || "").slice(6).split(":").map(Number), close = cl[0] ? { gap: cl[0], mult: cl[1] || 4 } : null;
// sd=<tariffs> (the value unit; default sk-monte.js SD): a re-run keeps its parent job's unit, so its deals are searched alike
const sdArg = Number((process.argv.find(a => a.startsWith("sd=")) || "").slice(3)) || undefined;
const key = m => JSON.stringify(m);

function roleOf(s, seat) {
  if (s.thrown) return "thrown";
  const c = s.contract;
  return c.declarer === seat ? "declarer" : c.type === "sau" && c.partner === seat ? "partner" : "defender";
}
/** One deal played out: ours in seat `me` (-1: all four Codex). */
function play(seed, me) {
  const s = G.deal({ rng: seeded(seed) }), clock = [0, 0], dec = [];
  for (let i = 0; !G.over(s); i++) {
    const w = G.toMove(s), t0 = Date.now();
    let m;
    if (w === me) {
      const ops = G.options(s, w);
      if (ops.length > 1) {
        const r = bareThink(s, w, { deals, close, sd: sdArg });
        m = r.best;
        dec.push({ i, opts: r.list.map(c => [key(c.move), Number.isNaN(c.mean) ? null : +c.mean.toFixed(5), c.n]), ...(r.deeper ? { close: 1 } : {}) });
      } else m = ops[0];
    } else m = codexMove(s, w, ref, seeded(mix(mix(seed, w + 1), i + 1)));
    clock[w === me ? 0 : 1] += Date.now() - t0;
    if (typeof G.act(s, w, m, seeded(mix(seed, 0x51))) === "string") throw new Error(`deal ${seed}: ${key(m)} refused`);
  }
  return { s, clock, dec };
}

const lines = [];
for (let j = 0; j < per; j++) {
  const seed = mix(seed0, shard * per + j), r0 = play(seed, -1), p0 = G.payoff(r0.s);
  const seats = [0, 1, 2, 3].map(me => {
    const r = play(seed, me), p = G.payoff(r.s);
    return { me, payoff: p[me], diff: +(p[me] - p0[me]).toFixed(4), role: roleOf(r.s, me), contract: r.s.contract ? { type: r.s.contract.type, declarer: r.s.contract.declarer } : null,
      clock: r.clock, log: r.s.log, dec: r.dec };
  });
  lines.push({ seed, dealer: r0.s.dealer, ref: { payoff: p0, role: [0, 1, 2, 3].map(p => roleOf(r0.s, p)), contract: r0.s.contract ? { type: r0.s.contract.type, declarer: r0.s.contract.declarer } : null, log: r0.s.log, clock: r0.clock[1] }, seats });
  fs.writeFileSync(out, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
}
console.log(`sk-match: ${lines.length} paired deals; ${dealsLine()}`);
