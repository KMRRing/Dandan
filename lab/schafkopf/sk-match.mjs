// Schafkopf's measure (Fable, 24 Nov 2026 18:50Z): paired deals. Each deal is played first at a table of four Codex Hard (the
// reference), then four times more with our engine in one seat (each seat in turn) and Codex Hard in the other three. The
// score is our seat's payoff less the reference's in that seat on that deal, in tariffs. Codex's players draw their randomness
// from the deal, the seat and the move's number, so until our seat plays otherwise than Hard did, the two tables are the same
// deal played the same way. Every game's decisions are kept (ours with the search's means), for the first auxiliary reading.
// usage: node lab/schafkopf/sk-match.mjs <shard> <shards> <out> <deals per decision> <paired deals per shard> <first seed> [ref=hard]
//   [opp=<net file> [oppgreedy=1] [oppbid=<n>]] [close=<gap>:<mult>] [only=<shard,...>] [sd=<tariffs>] [rollout=<net file from the repo root>] [greedy=1] [noref=1] [belief=<net file>] [value=<net file>:<w>] [biddeals=<n>] [rule=<A|B|AB>] [opprule=<A|B|AB>] (Fable 20:38Z, job 2: a close call searched again at mult times the deals)
import fs from "node:fs";
import { schafkopf as G, codexMove, dealsLine } from "./sk-rules.js";
import { bareThink } from "./sk-monte.js";
import { loadNet, policyRollout } from "./sk-net.js";
import { beliefDealer, beliefLine } from "./sk-belief.js";
import { probeFilter, probeArgs } from "./sk-probe.js";
import { seeded, mix } from "../../seats.js";

const [shard0, , out, deals, per, seed0] = process.argv.slice(2).map((x, i) => (i === 2 ? x : Number(x)));
// only=<n,...> (a re-run of failed shards): shard k plays the original shard ONLY[k], its deals and seeds exactly
const ONLY = (process.argv.find(a => a.startsWith("only=")) || "").slice(5).split(",").filter(Boolean).map(Number), shard = ONLY.length ? ONLY[shard0] : shard0;
const ref = (process.argv.find(a => a.startsWith("ref=")) || "ref=hard").slice(4);
const NOREF = process.argv.includes("noref=1");
// refonly=1 (Fable 25 Nov 16:20Z): the reference tables alone (with opp=, four Monte zero), for later matches to read with --ref
const REFONLY = process.argv.includes("refonly=1");
// biddeals=<n> (Fable 07:50Z, arm B): the bidding decisions searched at n deals, every card as `deals`
const BIDDEALS = Number((process.argv.find(a => a.startsWith("biddeals=")) || "").slice(9)) || 0;
// value=<net file>:<w> (Fable 03:12Z): the bid valued as (1 − w) × the play-out mean + w × that value net's prediction after the bid
const vaArg = (process.argv.find(a => a.startsWith("value=")) || "").slice(6).split(":"), valueMix = vaArg[0] ? { net: loadNet(new URL(`../../${vaArg[0]}`, import.meta.url)), w: Number(vaArg[1] ?? 0.5) } : null;
// belief=<net file> (Fable 02:10Z, order 1): our seat's worlds weighted by that policy's likelihood of the others' bids and cards
const beArg = (process.argv.find(a => a.startsWith("belief=")) || "").slice(7), dealer = beArg ? beliefDealer(loadNet(new URL(`../../${beArg}`, import.meta.url))) : null;
const cl = (process.argv.find(a => a.startsWith("close=")) || "").slice(6).split(":").map(Number), close = cl[0] ? { gap: cl[0], mult: cl[1] || 4 } : null;
// sd=<tariffs> (the value unit; default sk-monte.js SD): a re-run keeps its parent job's unit, so its deals are searched alike
const sdArg = Number((process.argv.find(a => a.startsWith("sd=")) || "").slice(3)) || undefined;
// rollout=<net file> (Fable 22:52Z/23:28Z, generation 1): the play-outs drawn from that policy net (lab/schafkopf/nets/), not uniform
const roArg = (process.argv.find(a => a.startsWith("rollout=")) || "").slice(8), rollout = roArg ? policyRollout(loadNet(new URL(`../../${roArg}`, import.meta.url)), process.argv.includes("greedy=1")) : undefined;
// opp=<net file> (Fable 25 Nov 16:20Z, the new yardstick): the other three seats, and the reference table's four, are a Monte
// zero search with that policy (oppgreedy=1 greedy play-outs, oppbid=<n> deals at a bid; cards at `deals`) instead of Codex
const opArg = (process.argv.find(a => a.startsWith("opp=")) || "").slice(4);
const oppRollout = opArg ? policyRollout(loadNet(new URL(`../../${opArg}`, import.meta.url)), process.argv.includes("oppgreedy=1")) : null;
const OPPBID = Number((process.argv.find(a => a.startsWith("oppbid=")) || "").slice(7)) || 0;
// rule= / opprule= (Fable 27 Nov 09:15Z, the father's probe, sk-probe.js): our seat's, or the other engine's, root options filtered
// by his rule; each table counts the decisions where the filter removed an option (`fired`). Measurement only.
const { rule: RULE, opprule: OPPRULE } = probeArgs(process.argv);
let fired = 0;
const filtered = (s, w, rules) => { const keep = probeFilter(s, w, G.options(s, w), rules); if (keep) fired++; return keep; };
const oppMove = (s, w) => {
  const ops = G.options(s, w); if (ops.length < 2) return ops[0];
  const keep = filtered(s, w, OPPRULE); if (keep?.length === 1) return keep[0];
  return bareThink(s, w, { deals: OPPBID && s.step === "bid" ? OPPBID : deals, sd: sdArg, rollout: oppRollout, rootOptions: keep }).best;
};
const key = m => JSON.stringify(m);

function roleOf(s, seat) {
  if (s.thrown) return "thrown";
  const c = s.contract;
  return c.declarer === seat ? "declarer" : c.type === "sau" && c.partner === seat ? "partner" : "defender";
}
/** One deal played out: ours in seat `me` (-1: all four Codex). */
function play(seed, me) {
  const s = G.deal({ rng: seeded(seed) }), clock = [0, 0], dec = [];
  fired = 0;
  for (let i = 0; !G.over(s); i++) {
    const w = G.toMove(s), t0 = Date.now();
    let m;
    if (w === me) {
      const ops = G.options(s, w);
      const keep = ops.length > 1 ? filtered(s, w, RULE) : null;
      if (keep?.length === 1) { m = keep[0]; dec.push({ i, opts: [[key(m), null, 0]], ruled: 1 }); }
      else if (ops.length > 1) {
        const r = bareThink(s, w, { deals: BIDDEALS && s.step === "bid" ? BIDDEALS : deals, close, sd: sdArg, rollout, dealer, valueMix, rootOptions: keep });
        m = r.best;
        dec.push({ i, opts: r.list.map(c => [key(c.move), Number.isNaN(c.mean) ? null : +c.mean.toFixed(5), c.n]), ...(r.deeper ? { close: 1 } : {}), ...(keep ? { ruled: 1 } : {}) });
      } else m = ops[0];
    } else m = oppRollout ? oppMove(s, w) : codexMove(s, w, ref, seeded(mix(mix(seed, w + 1), i + 1)));
    clock[w === me ? 0 : 1] += Date.now() - t0;
    if (typeof G.act(s, w, m, seeded(mix(seed, 0x51))) === "string") throw new Error(`deal ${seed}: ${key(m)} refused`);
  }
  return { s, clock, dec, fired };
}

const lines = [];
for (let j = 0; j < per; j++) {
  // noref=1 (Fable 23:28Z): the four-Hard reference table isn't replayed; its payoffs come from the batch it was played in
  // (ska-base, the same deals), so the line keeps only our four seat runs and `diff` is left to the read (sk-sum.mjs --ref)
  const seed = mix(seed0, shard * per + j), r0 = NOREF ? null : play(seed, -1), p0 = r0 ? G.payoff(r0.s) : null;
  const seats = REFONLY ? [] : [0, 1, 2, 3].map(me => {
    const r = play(seed, me), p = G.payoff(r.s);
    return { me, payoff: p[me], diff: p0 ? +(p[me] - p0[me]).toFixed(4) : null, role: roleOf(r.s, me), contract: r.s.contract ? { type: r.s.contract.type, declarer: r.s.contract.declarer } : null,
      clock: r.clock, log: r.s.log, dec: r.dec, ...(r.fired ? { fired: r.fired } : {}) };
  });
  lines.push({ seed, ...(r0 ? { dealer: r0.s.dealer, ref: { payoff: p0, role: [0, 1, 2, 3].map(p => roleOf(r0.s, p)), contract: r0.s.contract ? { type: r0.s.contract.type, declarer: r0.s.contract.declarer } : null, log: r0.s.log, clock: r0.clock[1], ...(r0.fired ? { fired: r0.fired } : {}) } } : {}), seats });
  fs.writeFileSync(out, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
}
console.log(`sk-match: ${lines.length} paired deals; ${dealsLine()}${dealer ? `; ${beliefLine()}` : ""}`);
