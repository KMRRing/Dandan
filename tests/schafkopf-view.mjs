// Schafkopf through the lab's adapter (lab/schafkopf/sk-rules.js): deals play to the end and pay zero-sum, in tariffs; and
// a seat's view is the same in two deals that differ only in cards it can't see, the Sauspiel's partner included until the
// called ace falls (Fable, 24 Nov 2026 18:50Z); and every world the dealer deals replays the deal so far legally and shows the
// seat exactly what it sees in the real deal.
import { schafkopf as G, codexMove, DEALS } from "../lab/schafkopf/sk-rules.js";
import { seeded } from "../seats.js";

const fail = m => { console.error(`schafkopf-view: ${m}`); process.exit(1); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const t0 = Date.now();

// 1. whole deals, Codex Easy in every seat
const types = {};
for (let k = 0; k < 200; k++) {
  const rng = seeded(1000 + k), s = G.deal({ rng });
  let n = 0;
  while (!G.over(s)) {
    const who = G.toMove(s), m = codexMove(s, who, "easy", rng);
    if (!G.options(s, who).some(o => same(o, m))) fail(`deal ${k}: Codex's move isn't among the options`);
    if (typeof G.act(s, who, m, rng) === "string") fail(`deal ${k}: refused`);
    if (++n > 60) fail(`deal ${k}: no end`);
  }
  const p = G.payoff(s);
  if (Math.abs(p.reduce((a, b) => a + b, 0)) > 1e-9) fail(`deal ${k}: payoff ${p} not zero-sum`);
  if (p.some(x => Math.abs(x) > G.MAX_PAYOFF)) fail(`deal ${k}: payoff ${p} over MAX_PAYOFF`);
  types[s.thrown ? "thrown" : s.contract.type] = (types[s.thrown ? "thrown" : s.contract.type] || 0) + 1;
}

// 2. the view: swap two cards between two other seats, replay the same moves while they stay legal and the swapped cards
// are unplayed; the seat's view must not change at any step
let steps = 0, hidPartner = 0;
for (let k = 0; k < 300; k++) {
  const rng = seeded(5000 + k), a = G.deal({ rng }), seat = k % 4, b = G.fork(a);
  const others = [0, 1, 2, 3].filter(x => x !== seat), p = others[k % 3], q = others[(k + 1) % 3], i = k % 8, j = (k >> 3) % 8;
  const x = b.hands[p][i], y = b.hands[q][j];
  b.hands[p][i] = y; b.hands[q][j] = x;
  b.dealt = b.hands.map(h => h.slice());
  const r2 = seeded(9000 + k);
  for (let n = 0; n < 40 && !G.over(a); n++) {
    if (!same(G.view(a, seat), G.view(b, seat))) fail(`deal ${k}, seat ${seat}, step ${n}: the view shows a card it can't see`);
    steps++;
    if (a.contract?.type === "sau" && a.contract.partner !== b.contract?.partner && a.contract.partner !== seat && b.contract?.partner !== seat) hidPartner++;
    const who = G.toMove(a), m = codexMove(a, who, "easy", r2);
    if (m.card === x || m.card === y || !G.options(b, who).some(o => same(o, m))) break;
    G.act(a, who, m, r2); G.act(b, who, m, r2);
  }
}
// 3. the dealer: worlds from every seat's view along whole deals
let worlds = 0;
for (let k = 0; k < 25; k++) {
  const rng = seeded(700 + k), s = G.deal({ rng });
  while (!G.over(s)) {
    const w = G.toMove(s);
    if (!G.replay(s, s.dealt)) fail(`deal ${k}: the real deal doesn't replay`);
    for (const p of [0, 1, 2, 3]) { const x = G.determinize(s, p, rng); worlds++; if (!same(G.view(x, p), G.view(s, p)) || !G.replay(s, x.dealt)) fail(`deal ${k}: a world seat ${p} could tell from the real deal`); }
    G.act(s, w, codexMove(s, w, "easy", rng), rng);
  }
}
if (hidPartner < 20) fail(`only ${hidPartner} steps with the partner hidden: the test doesn't reach it`);
console.log(`schafkopf-view: 200 deals zero-sum (${Object.entries(types).map(([t, n]) => `${t} ${n}`).join(", ")}); ${steps} view steps alike, ${hidPartner} with the partner hidden; ${worlds} worlds dealt, ${(DEALS.tries / DEALS.worlds).toFixed(1)} tries a world; ${Date.now() - t0} ms`);
