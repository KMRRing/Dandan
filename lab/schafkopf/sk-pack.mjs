// Schafkopf's training rows from self-play (Fable, 24 Nov 2026 20:38Z: the four arms and the dealer on ska-self, a held-out tenth
// by deal). Each deal is replayed from its seed and log; every searched decision gives one row for the seat to move:
//   X.u8    the raw view then the aux inputs (sk-view.js), each number × 255
//   M.u8    the legal moves (41: 32 cards, 9 bids)    P.f32  the policy's target: softmax of the search's means ÷ TAU over them
//   V.f32   the deal's payoff per relative seat ÷ MAX_PAYOFF (zero-sum)
//   E.f32   (e) the seat's side's card points ÷ 120    H.i8  (f) each card's holder (relative seat), -1 where it sees the card
//   W.i8    (g) who wins the trick on the table, -1 when none is open    T.u8  tricks played    D.u32  the deal's number (the split)
//   Q.u8    the partner facts (sk-view.js partnerView, 11) × 255    A.i8  who held the called ace (relative seat), -1 outside a
//           Sauspiel's play: the belief nets' target (Fable 25 Nov 16:20Z)
//   PL.u8   the move played (its action)    K.u8  the father's lead the position allows (sk-leads.js): 0 none, 1 A, 2 B
//   QM.u8   the questioned moves of that lead (41), for the played-move head's reading (Fable 25 Nov 19:00Z)
//   XW.u8   with SK_WORLD=1 (Fable 23:58Z, the world-view value net): the four seats' raw views of the position, in relative order
//           from the seat to move (the dealt world and the public history), each number × 255. Training only: at play time the
//           net is given the search's dealt worlds, never the real one.
// usage: node lab/schafkopf/sk-pack.mjs <out dir> <part-*.jsonl files or folders...>
import fs from "node:fs";
import path from "node:path";
import { schafkopf as G } from "./sk-rules.js";
import { rawView, auxView, auxTargets, partnerView, aceHolderOf, RAW_SIZE, AUX_SIZE, PART_SIZE, ACTIONS, actionOf } from "./sk-view.js";
import { questioned } from "./sk-leads.js";
import { seeded, mix } from "../../seats.js";

/** The policy target's temperature, in value units (1 unit = 2 SD of the payoff): options 0.02 apart differ by e in weight. */
export const TAU = 0.02;
const [out, ...srcs] = process.argv.slice(2);
const files = srcs.flatMap(p => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(f => f.endsWith(".jsonl")).map(f => path.join(p, f)) : [p]));
fs.mkdirSync(out, { recursive: true });
const WORLD = process.env.SK_WORLD === "1";
const W = Object.fromEntries(["X", "M", "P", "V", "E", "H", "W", "T", "D", "Q", "A", "PL", "K", "QM", ...(WORLD ? ["XW"] : [])].map(k => [k, fs.openSync(path.join(out, `${k}`), "w")]));
const put = (k, a) => fs.writeSync(W[k], Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const F = RAW_SIZE + AUX_SIZE, xr = new Float32Array(RAW_SIZE), xa = new Float32Array(AUX_SIZE);
let rows = 0, deals = 0, seen = new Set();
// a deal is counted once per line: a job and its re-runs (<id>-rr, <id>-r) are one line (sk-fetch.mjs names each file <job>-part-n),
// while two lines played on the same deal seeds (skb-self-r and skb-self-i) are both kept
const jobOf = f => path.basename(f).replace(/-part-\d+\.jsonl$/, ""), jobs = new Set(files.map(jobOf));
const lineOf = f => { const j = jobOf(f); if (j.endsWith("-rr")) return j.slice(0, -3); const b = j.replace(/-r\d*$/, ""); return b !== j && jobs.has(b) ? b : j; };
for (const f of files) for (const l of fs.readFileSync(f, "utf8").split("\n")) {
  if (!l.startsWith("{")) continue;
  const g = JSON.parse(l), k = `${lineOf(f)}:${g.seed}`;
  if (seen.has(k)) continue;
  seen.add(k);
  const s = G.deal({ rng: seeded(g.seed) }), byI = new Map(g.dec.map(d => [d.i, d])), states = [];
  for (let i = 0; i < g.log.length; i++) {
    const [w, m] = g.log[i], d = byI.get(i);
    if (d) states.push({ v: G.view(s, w), d, m, qa: questioned(s, w, "A"), qb: questioned(s, w, "B"), ...(WORLD ? { vs: [0, 1, 2, 3].map(r => G.view(s, (w + r) % 4)) } : {}) });
    if (typeof G.act(s, w, m, seeded(mix(g.seed, 0x51))) === "string") throw new Error(`deal ${g.seed}: move ${i} refused on replay`);
  }
  if (JSON.stringify(G.payoff(s)) !== JSON.stringify(g.payoff)) throw new Error(`deal ${g.seed}: the replay pays otherwise than the record`);
  const pay = G.payoff(s);
  for (const { v, d, vs, m, qa, qb } of states) {
    if (vs) { const xw = new Uint8Array(4 * RAW_SIZE); vs.forEach((u, r) => { xr.fill(0); rawView(u, xr); for (let k = 0; k < RAW_SIZE; k++) xw[r * RAW_SIZE + k] = Math.round(255 * xr[k]); }); put("XW", xw); }
    xr.fill(0); xa.fill(0); rawView(v, xr); auxView(v, xa);
    const x = new Uint8Array(F);
    for (let k = 0; k < RAW_SIZE; k++) x[k] = Math.round(255 * xr[k]);
    for (let k = 0; k < AUX_SIZE; k++) x[RAW_SIZE + k] = Math.round(255 * Math.min(1, xa[k]));
    const mask = new Uint8Array(ACTIONS), p = new Float32Array(ACTIONS), opts = d.opts.map(([k, mean]) => [actionOf(JSON.parse(k)), mean]);
    const top = Math.max(...opts.map(o => o[1]));
    let z = 0;
    for (const [a, mean] of opts) { mask[a] = 1; p[a] = Math.exp((mean - top) / TAU); z += p[a]; }
    for (let a = 0; a < ACTIONS; a++) p[a] /= z;
    const t = auxTargets(v, s), rel = r => pay[(v.seat + r) % 4] / G.MAX_PAYOFF;
    put("X", x); put("M", mask); put("P", p); put("V", Float32Array.of(rel(0), rel(1), rel(2), rel(3)));
    put("E", Float32Array.of(t.points)); put("H", t.holder); put("W", Int8Array.of(t.winner)); put("T", Uint8Array.of(v.tricks.length)); put("D", Uint32Array.of(deals));
    put("Q", Uint8Array.from(partnerView(v), q => Math.round(255 * q))); put("A", Int8Array.of(aceHolderOf(v, s)));
    const qm = new Uint8Array(ACTIONS);
    for (const id of qa || qb || []) qm[actionOf({ t: "card", card: id })] = 1;
    put("PL", Uint8Array.of(actionOf(m))); put("K", Uint8Array.of(qa ? 1 : qb ? 2 : 0)); put("QM", qm);
    rows++;
  }
  deals++;
}
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ rows, deals, world: WORLD, raw: RAW_SIZE, aux: AUX_SIZE, part: PART_SIZE, actions: ACTIONS, cards: 32, tau: TAU, maxPayoff: G.MAX_PAYOFF }) + "\n");
console.log(`sk-pack: ${deals} deals, ${rows} rows (${RAW_SIZE} raw + ${AUX_SIZE} aux inputs)`);
