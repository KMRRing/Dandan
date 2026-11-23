// How well the dealer reads the other hand, by turn band (23 Nov 2026, Fable 17:05Z: is the gain of zceil001-H, the true hand
// known, a poor late-game belief or only less noise?). On a match's stored games, at decisions of the nets' seat (the one not
// the rival's), the hands the general dealer deals for the other seat (the search's own dealer, root() as in play) are compared
// with the hand it truly holds, and so are the hands a counting dealer deals (the unseen cards at random, the same world
// otherwise: determinize with no weights). Per band (turns 1-3, 4-7, 8-12, 13+): the mean chance a card truly in the hand is in a
// dealt hand (its name, at least as many copies), and the share of the hand's cards a dealt hand holds (by name, multiset).
// reader=policy (Fable 17:30Z, item 3): a third reader, the counting dealer's hands weighed by how likely the other seat's own
// decisions of the last `back` turns were under its policy with that hand (the hand's hidden cards swapped into each past
// position), as a particle filter's weights; scored as the others, each hand counting by its weight.
// Read-only. usage: node lab/dealer-band.mjs <batch zdm001> [nets zl23] [games 300] [every 4] [hands 64] [reader=policy] [back=3]
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { DECK } from "../dandan-cards.js";
import { determinize } from "../dandan-think.js";
import { zeroOptions } from "../dandan-zero.js";
import { generalBrain } from "./zero/zero-lib.mjs";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";

const [batch = "zdm001", nets = "zl23", most = "300", every = "4", hands = "64"] = process.argv.slice(2).filter(a => !a.includes("="));
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.includes("=")).map(a => a.split("="))), READER = opt.reader === "policy", BACK = Number(opt.back || 3);
const key = m => JSON.stringify(m);
const real = Math.random, J = x => JSON.parse(JSON.stringify(x)), nm = id => DECK[id] ?? "Clue";
const store = await (await import("./lib.mjs")).labStore(), brain = await generalBrain(nets);
const BANDS = ["1-3", "4-7", "8-12", "13+"], band = t => (t <= 3 ? 0 : t <= 7 ? 1 : t <= 12 ? 2 : 3);
const acc = ["dealer", "count", "policy"].map(() => BANDS.map(() => ({ n: 0, card: 0, share: 0, cards: 0 })));
const tally = (a, truth, dealt, w = 1) => {
  const want = new Map(); for (const id of truth) want.set(nm(id), (want.get(nm(id)) || 0) + 1);
  const got = new Map(); for (const id of dealt) got.set(nm(id), (got.get(nm(id)) || 0) + 1);
  let hit = 0;
  for (const [k, c] of want) hit += Math.min(c, got.get(k) || 0);
  // a card truly in the hand is "in" the dealt hand when the dealt hand has at least as many of its name as the true one
  let cardIn = 0;
  for (const [k, c] of want) if ((got.get(k) || 0) >= c) cardIn += c;
  a.card += w * cardIn; a.cards += w * truth.length; a.share += w * (truth.length ? hit / truth.length : 0); a.n += w;
};
// a past position with the true hidden cards swapped for the dealt ones (a permutation of ids over both hands and the library)
function swapped(p, map) {
  const q = J(p), sw = id => (map.has(id) ? map.get(id) : id);
  q.hand = q.hand.map(h => h.map(sw)); q.lib = q.lib.map(sw);
  return rules.restore(q);
}
function weightOf(past, map, o) {
  let lw = 0;
  for (const d of past) {
    const q = swapped(d.s, map), ms = zeroOptions(q, o);
    if (ms.length < 2) continue;
    const at = ms.findIndex(m => key(m) === key(d.m));
    const pr = brain.player.probs(q, o, ms);
    lw += Math.log(Math.max(1e-3, at >= 0 ? pr[at] : 0));
  }
  return lw;
}
const names = (await store.list(`results/${batch}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)).sort();
let games = 0;
outer: for (const n of names) {
  for (const l of ((await store.get(n)) || "").split("\n")) {
    if (!l.startsWith('{"game"')) continue;
    const g = JSON.parse(l);
    if (g.branch) continue;
    // a match: the nets' seat reads the rival; self-play (no vs): one seat a game, taking turns by seed
    const me = g.vs ? 1 - g.vs.seat : g.seed % 2, o = 1 - me;
    brain.reset();
    let G = recordOf(rules, g), k = 0;
    const past = [];   // the other seat's decisions: { s, m, turn }
    for (let i = 0; i < g.moves.length; i++) {
      const [who, m] = g.moves[i], s = rules.restore(J(G.state));
      if (who === me && !s.over && s.hand[o].length && k++ % Number(every) === 0) {
        const { deal } = brain.root(s, me), rng = seeded(g.seed * 7919 + i), b = band(s.turn);
        const ws = [], recent = READER ? past.filter(d => d.turn >= s.turn - BACK) : [];
        for (let h = 0; h < Number(hands); h++) {
          tally(acc[0][b], s.hand[o], determinize(s, me, rng, false, false, deal ? (pool, n, r) => deal(pool, n, r) || pool : null).hand[o]);
          const w = determinize(s, me, rng, false, false, null);
          tally(acc[1][b], s.hand[o], w.hand[o]);
          if (READER) {
            // the dealt ids in the true hand's slots: swap each true hidden card with the one dealt in its place, and back
            const map = new Map();
            s.hand[o].forEach((id, j) => { const d = w.hand[o][j]; if (d !== id && !map.has(id) && !map.has(d)) { map.set(id, d); map.set(d, id); } });
            ws.push([w.hand[o], weightOf(recent, map, o)]);
          }
        }
        if (READER && ws.length) {
          const top = Math.max(...ws.map(x => x[1])), e = ws.map(x => Math.exp(x[1] - top)), z = e.reduce((a, c) => a + c, 0);
          ws.forEach((x, j) => tally(acc[2][b], s.hand[o], x[0], e[j] / z));
        }
      }
      if (READER && who === o) past.push({ s, m, turn: s.turn });
      Math.random = seeded(rngSeedOf(g, i));
      const r = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (r.error) break;
      brain.seen(s, who, m, r.G.state);
      G = r.G;
    }
    if (++games >= Number(most)) break outer;
  }
}
console.log(`${batch}: ${games} games, ${nets}'s dealer about the rival's hand, every ${every}th decision of ${nets}'s seat, ${hands} dealt hands each`);
BANDS.forEach((b, j) => {
  const [d, c] = [acc[0][j], acc[1][j]], p = x => (x.cards ? (100 * x.card / x.cards).toFixed(1) : "-"), q = x => (x.n ? (100 * x.share / x.n).toFixed(1) : "-");
  const r = acc[2][j];
  console.log(`  turns ${b}: ${d.n / Number(hands)} decisions; a true card in a dealt hand: dealer ${p(d)}%, counting ${p(c)}%${READER ? `, policy-weighed ${p(r)}%` : ""}; share of the hand dealt: dealer ${q(d)}%, counting ${q(c)}%${READER ? `, policy-weighed ${q(r)}%` : ""}`);
});
