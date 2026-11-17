// Scry G, the general dealer (lab/zero/scryg.mjs), with small random weights on Zero's fixture game: what it believes is the same
// when the cards the seat can't see are dealt again (it reads only what the seat sees); it never deals a card with no copy left
// unseen; a whole guess's chance is the product of its cards' (logProb matches the dealt chain); untrained (W2 = 0) its odds are
// the unseen copies'.
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { knOf, knownIn } from "../dandan-core.js";
import { POOL } from "../dandan-general.js";
import { ScryG, targetsOf, evSize, posSize } from "../lab/zero/scryg.mjs";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const J = x => JSON.parse(JSON.stringify(x));
function redeal(s, me, rng) {
  // two classes, each dealt again among its own places (the places stay, the contents move; Fable 15:10Z): the cards the other
  // player knows and the seat doesn't (their hidden hand, the library places only they know), and the library places neither knows
  const c = J(s), opp = 1 - me, bit = 1 << me, kh = new Set(knownIn(c, opp, me)), theirs = [], none = [];
  c.hand[opp].forEach((id, i) => { if (!kh.has(id)) theirs.push(["h", i]); });
  c.lib.forEach((id, i) => { const k = knOf(c, id); if (!(k & bit)) (k & (1 << opp) ? theirs : none).push(["l", i]); });
  for (const at of [theirs, none]) {
    const ids = at.map(([z, i]) => (z === "h" ? c.hand[opp][i] : c.lib[i])), bits = ids.map(id => knOf(c, id));
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    at.forEach(([z, i], k) => { if (z === "h") c.hand[opp][i] = ids[k]; else c.lib[i] = ids[k]; });
    // what the other player knows stays with the place: each id takes the knowledge of the place it now sits in
    const was = new Map(at.map(([z, i], k) => [ids[k], bits[k]]));
    c.kn = c.kn.filter(e => !was.has(e[0]));
    at.forEach(([z, i], k) => { if (z === "l" && bits[k]) c.kn.push([ids[k], bits[k]]); });
  }
  return c;
}
const P = POOL, D = 4, A = 4, H = 8, r0 = seeded(5), w = n => Array.from({ length: n }, () => (r0() - 0.5) * 0.2);
const net = { scryg: 1, V: P.V, EV: evSize(P), X: posSize(P), D, A, H, We: w(D * evSize(P)), be: w(D), Wk: w(A * D), wa: w(A), Wv: w(D * D), Wx: w(H * posSize(P)), bx: w(H),
  Wq: w(A * H), W1: w(H * (H + 2 * D)), b1: w(H), Wc: w(H * P.V), W2: w(P.V * H), b2: w(P.V) };
const flat = { ...net, W2: new Array(P.V * H).fill(0), b2: new Array(P.V).fill(0) };
const line = fs.readFileSync(new URL("./fixtures/zero-game-4245.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(JSON.parse).find(o => o.game != null);
let G = newRecord(rules, { seats: 2, seed: line.seed, now: 0 }), n = 0, same = 0, legal = 0, deals = 0, chain = 0, untrained = 0;
const S = [new ScryG(0, net), new ScryG(1, net)], Z = [new ScryG(0, flat), new ScryG(1, flat)], rng = seeded(17);
for (let i = 0; i < line.moves.length; i++) {
  const s = G.state;
  if (i % 9 === 4) for (const me of [0, 1]) {
    const t = targetsOf(s, me);
    if (!t.handN) continue;
    n++;
    const a = S[me].score(s).p1, b = S[me].score(redeal(s, me, rng)).p1;
    if (a.every((v, k) => Math.abs(v - b[k]) < 1e-6)) same++;
    S[me].belief(s, 8);
    for (let k = 0; k < 4; k++) {
      const h = S[me].hand(rng); deals++;
      if (h.slots.every((c, j) => h.dealt[c] <= t.u[c])) legal++;
      if (Math.abs(S[me].logProb(h.slots.map(c => P.vocab[c])) - h.lp) < 1e-4) chain++;
    }
    const z = Z[me].score(s).p1, tot = t.u.reduce((x, y) => x + y, 0);
    if (z.every((v, k) => Math.abs(v - t.u[k] / tot) < 1e-5)) untrained++;
  }
  const [who, m] = line.moves[i];
  Math.random = seeded(mix(line.seed, i + 1));
  const r = applyMove(rules, G, who, m, 0);
  if (r.error) break;
  for (const x of [...S, ...Z]) x.update(s, who, m, r.G.state);
  G = r.G;
}
check(n > 0 && same === n, `Scry G believes the same with the hidden cards dealt again (${same} of ${n})`);
check(legal === deals, `it never deals a card with no unseen copy left (${legal} of ${deals})`);
check(chain === deals, `a guess's chance is its cards' product (${chain} of ${deals})`);
check(untrained === n, `untrained, its odds are the unseen copies' (${untrained} of ${n})`);
if (fails) process.exit(1);
