// Where a Medium-free move-picker's time goes (14 Nov 2026, Fable No. 9 point 2): Medium plays both seats over a few deals and,
// at every priority decision with a legal move, the model's parts are timed apart: the view (viewOf), listing the legal
// moves (choices), the marks of every move (marksOf), the first layer's position part (once a decision) and the net's
// per-move part (the marks' rows, then the second layer); Medium's own move at the same decisions beside it.
// usage: node lab/mp-time.mjs [model lab/policy/mpN.json] [deals 6] [first seed 700000]
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { policyMove } from "../dandan-policy.js";
import { moves } from "../dandan-engine.js";
import { viewOf, choices, marksOf } from "../dandan-netpolicy.js";

const file = process.argv[2] || "lab/policy/mpN.json", deals = Number(process.argv[3] || 6), first = Number(process.argv[4] || 700000);
const n = JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]).net, { H1, H2, XN } = n;
const wx = Float32Array.from(n.wx), wm = Float32Array.from(n.wm), b1 = Float32Array.from(n.b1);
const w2 = Float32Array.from(n.w2), b2 = Float32Array.from(n.b2), w3 = Float32Array.from(n.w3);
const base = new Float32Array(H1), h1 = new Float32Array(H1), J = x => JSON.parse(JSON.stringify(x));
const t = { view: 0, list: 0, marks: 0, layer1: 0, perMove: 0, medium: 0 };
let decisions = 0, movesSeen = 0;
const now = () => performance.now();
for (let d = 0; d < deals; d++) for (let first0 = 0; first0 < 2; first0++) {
  let G = newRecord(rules, { seats: 2, seed: first + d, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state)), rng = seeded(mix(first + d, i + 1));
    let t0 = now();
    const m = policyMove(s, who, { rng });
    const tm = now() - t0;
    if (!s.pending && moves(s, who).length) {
      decisions++; t.medium += tm;
      t0 = now(); const x = viewOf(s, who); t.view += now() - t0;
      t0 = now(); const list = choices(s, who); t.list += now() - t0;
      t0 = now(); const mk = list.map(c => marksOf(s, who, c)); t.marks += now() - t0;
      t0 = now();
      base.set(b1);
      for (let k = 0; k < XN; k++) { const v = x[k]; if (v === 0) continue; const r = k * H1; for (let o = 0; o < H1; o++) base[o] += v * wx[r + o]; }
      t.layer1 += now() - t0;
      t0 = now();
      for (const marks of mk) {
        h1.set(base);
        for (const k of marks) { const r = k * H1; for (let o = 0; o < H1; o++) h1[o] += wm[r + o]; }
        for (let o = 0; o < H1; o++) h1[o] = Math.max(0, h1[o]);
        let out = 0;
        for (let o2 = 0; o2 < H2; o2++) { let v = b2[o2]; for (let o = 0; o < H1; o++) { const h = h1[o]; if (h > 0) v += h * w2[o * H2 + o2]; } if (v > 0) out += v * w3[o2]; }
      }
      t.perMove += now() - t0; movesSeen += list.length;
    }
    const r = applyMove(rules, G, who, m, 0);
    if (r.error) throw new Error(`deal ${first + d} move ${i}: ${r.error}`);
    G = r.G;
  }
}
const per = k => (t[k] / decisions * 1000).toFixed(1);
const model = t.view + t.list + t.marks + t.layer1 + t.perMove;
console.log(`${file}: ${decisions} decisions, ${(movesSeen / decisions).toFixed(1)} choices a decision (passing included), µs a decision:`);
for (const k of ["view", "list", "marks", "layer1", "perMove"]) console.log(`  ${k.padEnd(8)} ${per(k).padStart(7)}  (${Math.round(100 * t[k] / model)}%)`);
console.log(`  model    ${(model / decisions * 1000).toFixed(1).padStart(7)}  against Medium's move ${per("medium")} (${(model / t.medium).toFixed(2)}×)`);
