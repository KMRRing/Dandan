// Which inputs Zero's nets lean on (16 Nov 2026, Korbi 11:50: "scramble all the non-fundamental values"): permutation
// importance on the frozen held-out games. The positions are replayed exactly, every input each net reads is collected, then
// one group of inputs at a time is scrambled: each position gets that group from another position at random (the rest kept),
// and the nets are scored again. A group the net ignores leaves its loss where it was; one it leans on raises it. The raw
// extended view is scrambled too, as the yardstick for a group that carries real information. No fleet: a runner, minutes.
// Reliance, not necessity: a net trained without a group may learn the same from the raw inputs (the review doc, change 7).
// usage: node lab/zero-scramble.mjs <nets, e.g. g9x-C> [games a job 60] [held-out jobs az-g10-c,az-g10-c2] [repeats 3]
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { DECK, NAMES } from "../dandan-cards.js";
import { score as mlp, featuresRace, FEATURES, PLUS, RACE } from "../dandan-eval.js";
import { viewInto, marksOf, freeScorer, VIEW_N } from "../dandan-netpolicy.js";
import { zeroBrain, zeroOptions, qMarksOf } from "./zero/zero-lib.mjs";
import { readNet, ext, EXT_N, NN, TRACK_N, SLOT_N, BX, seenBy, unknownSlots, scryInput, handCounts } from "./zero/zero-view.mjs";

const NETS = process.argv[2] || "g9x-C", PER = Number(process.argv[3] || 60), JOBS = (process.argv[4] || "az-g10-c,az-g10-c2").split(","), REP = Number(process.argv[5] || 3);
const net = k => readNet(new URL(`./zero/nets/${NETS}-${k}.json`, import.meta.url).pathname);
const P = net("policy"), Q = net("qpolicy"), S = net("scry"), V = net("value");
const pscore = freeScorer(P), qscore = Q ? freeScorer(Q) : null;
const NAME_AT = new Map(NAMES.map((n, k) => [n, k])), J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m), realRandom = Math.random;
const N = FEATURES.length + 2 * PLUS + 2 * RACE;   // the value net's hand-built part (132), then the extended view (533)

// the value net (int8 layers) as plain weights, read as extJudge reads them
const vnet = V.layers.map(L => {
  const [nIn, nOut] = L.n, raw = Buffer.from(L.q, "base64"), W = new Float32Array(nIn * nOut), b = new Float32Array(nOut);
  for (let i = 0; i < raw.length; i++) { let v = raw[i]; if (v > 127) v -= 256; W[i] = v * L.s[i % nOut]; }
  if (L.b.length) b.set(L.b);
  return { nIn, nOut, W, b, y: new Float32Array(nOut) };
});
if (vnet[0].nIn !== N + EXT_N) throw new Error(`the value net reads ${vnet[0].nIn} inputs, not ${N + EXT_N}`);

// Scry 1 from its inputs: g = b1 + x·Wg, per slot h = relu(g + sf·Ws), z = b2 + h·W2 + log(unseen), softmax
const F = a => Float32Array.from(a), Sg = { H: S.H, Wg: F(S.Wg), Ws: F(S.Ws), b1: F(S.b1), W2: F(S.W2), b2: F(S.b2) };
function scryLoss(bx, sf, lp, y) {
  const H = Sg.H, g = Float32Array.from(Sg.b1), z = Float32Array.from(Sg.b2);
  for (let i = 0; i < BX; i++) { const v = bx[i]; if (!v) continue; const r = i * H; for (let o = 0; o < H; o++) g[o] += v * Sg.Wg[r + o]; }
  for (let i = 0; i < SLOT_N; i++) { const v = sf[i]; if (!v) continue; const r = i * H; for (let o = 0; o < H; o++) g[o] += v * Sg.Ws[r + o]; }
  for (let o = 0; o < H; o++) { const h = g[o]; if (h <= 0) continue; const r = o * NN; for (let n = 0; n < NN; n++) z[n] += h * Sg.W2[r + n]; }
  let top = -Infinity; for (let n = 0; n < NN; n++) { z[n] = lp[n] === -Infinity ? -Infinity : z[n] + lp[n]; if (z[n] > top) top = z[n]; }
  let sum = 0; for (let n = 0; n < NN; n++) sum += z[n] === -Infinity ? 0 : Math.exp(z[n] - top);
  return z[y] === -Infinity ? -Math.log(1e-9) : -(z[y] - top - Math.log(sum));   // as the scorecard: a name the pool rules out costs 1e-9
}
const softLoss = (sc, k) => { const top = Math.max(...sc); let z = 0; for (const v of sc) z += Math.exp(v - top); return -(sc[k] - top - Math.log(z)); };

// ---------- collect every input each net reads, on the held-out games ----------
const rows = { p: [], q: [], v: [], s: [] };
function replay(game) {
  const seed = game.seed, x3 = game.explore3?.i, won = seat => (game.winner === seat ? 1 : game.winner == null || game.winner < 0 ? 0.5 : 0);
  const b = zeroBrain(`${NETS}-policy`, `${NETS}-value`);
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), lastTurn = -1;
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = rules.restore(J(G.state)), rng = seeded(mix(seed, 777 + i));
    if (rng() < 1 / 6) for (const me of [0, 1]) {               // Scry: each unknown card of the other hand
      const seen = seenBy(s, me);
      if (seen.unknown > 0) {
        const bx = Float32Array.from(scryInput(s, me, b.tracker(), seen)), lp = new Float32Array(NN);
        for (let n = 0; n < NN; n++) lp[n] = seen.unseen[n] > 0 ? Math.log(seen.unseen[n]) : -Infinity;
        for (const id of unknownSlots(s, me)) { const sf = new Float32Array(SLOT_N); b.tracker().slotOf(me, s, id, sf); rows.s.push({ bx, sf, lp, y: NAME_AT.get(DECK[id]) }); }
      }
    }
    if (s.turn !== lastTurn && !s.pending) {                     // value: each turn's start, both seats, past an explored move
      lastTurn = s.turn;
      if (x3 == null || i > x3) for (const me of [0, 1]) {
        const side = x => { const out = new Float32Array(N + EXT_N); featuresRace(s, x, out.subarray(0, N)); out.set(ext(s, x, handCounts(s, 1 - x)), N); return out; };
        rows.v.push({ a: side(me), b: side(1 - me), y: won(me) });
      }
    }
    const ms = zeroOptions(s, who), k = ms.findIndex(x => key(x) === key(m));
    if (i !== x3 && ms.length >= 2 && k >= 0) {                  // policy and question head: the move the search made
      const bel = b.scry ? b.scry(s, who, b.tracker()) : null, none = new Float32Array(NN);
      const x = new Float32Array(VIEW_N + EXT_N); x.set(viewInto(s, who), 0); x.set(ext(s, who, bel?.counts ?? none, new Float32Array(EXT_N), null, bel?.any ?? none), VIEW_N);
      if (s.pending) { if (qscore) rows.q.push({ x, marks: ms.map(mm => qMarksOf(s, who, mm)), k }); }
      else rows.p.push({ x, marks: ms.map(mm => marksOf(s, who, mm)), k });
    }
    Math.random = seeded(mix(seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = realRandom;
    if (r.error) throw new Error(`game ${seed} move ${i}: ${r.error}`);
    b.seen(s, who, m, r.G.state);
    G = r.G;
  }
}
const store = await labStore();
let games = 0;
for (const id of JOBS) {
  let n = 0;
  for (const name of (await store.list(`results/${id}/`)).filter(o => /\/part-\d+\.jsonl$/.test(o)).sort()) {
    if (n >= PER) break;
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line.startsWith('{"game"')) continue;
      const g = JSON.parse(line);
      if (g.seed % 5 !== 0) continue;                           // held out: no generation trains on these
      replay(g); n++; games++;
      if (n >= PER) break;
    }
  }
}

// ---------- score, with one group scrambled ----------
// a group: [start, end) of an input; scrambling takes those values from another row (the same donor for both of a value row's
// sides, so a position's two views stay one position's)
const perm = (n, seed) => { const r = seeded(seed), p = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } return p; };
// a group is a range [a, b) or a list of indices
const take = (x, donor, g) => { const y = Float32Array.from(x); if (typeof g[0] === "number" && g.length === 2 && !g.list) y.set(donor.subarray(g[0], g[1]), g[0]); else for (const i of g) y[i] = donor[i]; return y; };
const idx = (names, off = 0) => { const out = []; FEATURES.forEach((f, i) => { if (names.some(n => (typeof n === "string" ? f === n || f === n + "Them" : n.test(f)))) out.push(off + i); }); out.list = true; return out; };
const CLOCK = ["hits", "lastHit", "twoHits", "threeHits", "dandans", "attackers", "onLastIsland"], MANA = ["lands", "islands", "noIsland", "red", "mana", "open", "clues"];
const SUMS = ["cycling land", "flashback"], HAND = ["hand", ...FEATURES.slice(15, 38)], GY = [/ in the graveyard$/], BASICS = ["toMove", "library", "turn"];
const judgeGroups = off => [
  ["hand-built: the clock (hits taken, last hit, two and three hits away, Dandâns and attackers out, on the last Island), both seats", idx(CLOCK, off)],
  ["hand-built: lands and mana (lands, Islands, none, red, mana, open, clues), both seats", idx(MANA, off)],
  ["hand-built: hand summaries (cycling lands, flashback cards held), both seats", idx(SUMS, off)],
  ["fundamental: the hand by name, both seats", idx(HAND, off)],
  ["fundamental: the graveyard by name", idx(GY, off)],
  ["fundamental: to move, library, turn", idx(BASICS, off)]];
function evalPolicy(R, sc, g, seed) {
  const pi = g ? perm(R.length, seed) : null; let ok = 0, loss = 0;
  R.forEach((r, i) => { const x = g ? take(r.x, R[pi[i]].x, g) : r.x, v = sc(x, r.marks); let best = 0; for (let k = 1; k < v.length; k++) if (v[k] > v[best]) best = k; if (best === r.k) ok++; loss += softLoss(v, r.k); });
  return { agree: ok / R.length, loss: loss / R.length };
}
function evalValue(g, seed) {
  const pi = g ? perm(rows.v.length, seed) : null; let loss = 0;
  rows.v.forEach((r, i) => {
    const a = g ? take(r.a, rows.v[pi[i]].a, g) : r.a, b = g ? take(r.b, rows.v[pi[i]].b, g) : r.b;
    const p = Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.exp(mlp(vnet, b) - mlp(vnet, a)))));
    loss -= r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p);
  });
  return { loss: loss / rows.v.length };
}
function evalScry(g, seed) {
  const pi = g ? perm(rows.s.length, seed) : null; let loss = 0;
  rows.s.forEach((r, i) => {
    let bx = r.bx, sf = r.sf;
    if (g) { const d = rows.s[pi[i]]; if (g[0] === "slot") sf = d.sf; else bx = take(r.bx, d.bx, g); }
    loss += scryLoss(bx, sf, r.lp, r.y);
  });
  return { loss: loss / rows.s.length };
}
const avg = (f, g) => { const out = []; for (let k = 0; k < REP; k++) out.push(f(g, 9100 + k)); return Object.fromEntries(Object.keys(out[0]).map(key => [key, out.reduce((a, o) => a + o[key], 0) / REP])); };
const fmt = x => x.toFixed(4), pc = x => `${(100 * x).toFixed(1)}%`;

console.log(`Scrambled inputs, ${NETS}, on ${games} held-out games of ${JOBS.join(", ")}: ${rows.p.length} decisions, ${rows.q.length} questions, ${rows.v.length} value rows, ${rows.s.length} Scry slots; each scramble averaged over ${REP}`);
console.log("(hand-built groups are the ones that could be removed; the raw extended view is the yardstick of a group that carries real information)");
const NB = FEATURES.length;
const vGroups = [["none", null], ...judgeGroups(0), ["all of the Monte 1 judge's 100 features", [0, NB]], ["hand-built: 16 squeeze features (card and land lead, answers, counters, draw spells, Dandâns held, hits it can take, counter with mana open)", [NB, NB + 2 * PLUS]], ["hand-built: 16 deck-out race features", [NB + 2 * PLUS, N]], ["all 132 hand-built together", [0, N]], ["raw: the extended view (533)", [N, N + EXT_N]]];
const v0 = evalValue(null).loss;
console.log(`\nValue net (log loss, lower better): ${fmt(v0)} as trained`);
for (const [name, g] of vGroups.slice(1)) { const r = avg(evalValue, g); console.log(`  ${name}: ${fmt(r.loss)} (${r.loss - v0 >= 0 ? "+" : ""}${fmt(r.loss - v0)})`); }
const pGroups = [...judgeGroups(0), ["fundamental: the step and the stack", [NB, VIEW_N - PLUS - 1]], ["hand-built: 8 squeeze features", [VIEW_N - PLUS - 1, VIEW_N - 1]], ["hand-built: library 12 or fewer", [VIEW_N - 1, VIEW_N]], ["all 121 of the policy view", [0, VIEW_N]], ["raw: the extended view with Scry's belief (533)", [VIEW_N, VIEW_N + EXT_N]]];
for (const [label, R, sc] of [["Policy", rows.p, pscore], ["Question head", rows.q, qscore]]) {
  if (!R.length || !sc) continue;
  const b0 = evalPolicy(R, sc, null);
  console.log(`\n${label} (agreement with the search's move, higher better; loss of that move, lower better): ${pc(b0.agree)}, ${fmt(b0.loss)} as trained`);
  for (const [name, g] of pGroups) { const r = avg((gg, sd) => evalPolicy(R, sc, gg, sd), g); console.log(`  ${name}: ${pc(r.agree)} (${((r.agree - b0.agree) * 100).toFixed(1)} points), ${fmt(r.loss)} (+${fmt(r.loss - b0.loss)})`); }
}
const sGroups = [["hand-built: the 13 tracker counters of their play (declines, counters, land drops missed, draws, casts, main phases passed, mulligans…)", [EXT_N, EXT_N + TRACK_N]], ["hand-built: each card's 12-feature history", ["slot"]], ["the unknown-card count", [EXT_N + TRACK_N, BX]], ["raw: the extended view (533)", [0, EXT_N]]];
const s0 = evalScry(null).loss;
console.log(`\nScry (nats a card, lower better): ${fmt(s0)} as trained`);
for (const [name, g] of sGroups) { const r = avg(evalScry, g); console.log(`  ${name}: ${fmt(r.loss)} (+${fmt(r.loss - s0)})`); }
