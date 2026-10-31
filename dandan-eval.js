// Dandan's judge of a position: the chance a seat goes on to win from it, as Medium against Medium would play it on.
// A small neural network (a value network) learned from 1.3 million positions of 45,000 games between Medium players,
// each the start of a turn with the game's result: what each side has on the table and in hand (its life in hits, its
// Dandâns and whether they can attack, its lands, Islands, red and open mana, every card in its hand by name), and what
// both share (the graveyard by name, the library, whose turn), read as 100 numbers, and the chance of winning that goes
// with them. Hard's look-ahead (dandan-think.js) ends each game it plays out in its head with this, and the coach's
// chances are its figures. (It replaced a logistic model of 35 features in October 2026: the README says how it was
// trained and checked.)
//
// The network g scores a position from one side; a seat's chance is sigmoid(g(its view) − g(the other's view)), so the
// two seats' chances always add up to one, and being the one to move is a feature like any other. It reads both hands:
// a game played out in the head has dealt the other one, so it is known there.
import { DECK, TOKEN_AT } from "./dandan-cards.js";
import { other, isLandId, isLand, typesOf, needType, creatures, manaAlts } from "./dandan-core.js";

/** The spells and the kinds of land a hand is counted by (the two cycling lands are one kind). */
const SPELLS = ["Memory Lapse", "Dandân", "Piracy Charm", "Mind Bend", "Commit // Memory", "Narset's Reversal", "Repulse", "Metamorphose",
  "Lórien Revealed", "Brainstorm", "Predict", "Mystic Retrieval", "Deem Inferior", "Take Inventory", "Chart a Course", "Gone Missing", "Quicken"];
const LANDS = ["Island", "Mystic Sanctuary", "Thundering Falls", "Izzet Boilerworks", "Halimar Depths", "Flood Plain", "Lonely Sandbar", "Remote Isle"];
const SPELL_AT = new Map(SPELLS.map((n, i) => [n, i]));
const LAND_AT = new Map(LANDS.map((n, i) => [n, Math.min(i, 6)]));

/** The features, in order: each seat's (the one judging first), then what both share. */
export const FEATURES = [
  ...["", "Them"].flatMap(w => [
    `hits${w}`, `lastHit${w}`, `twoHits${w}`, `threeHits${w}`, `dandans${w}`, `attackers${w}`, `onLastIsland${w}`,
    `lands${w}`, `islands${w}`, `noIsland${w}`, `red${w}`, `mana${w}`, `open${w}`, `clues${w}`, `hand${w}`,
    ...SPELLS.map(n => `${n}${w}`), ...LANDS.slice(0, 7).map(n => `${n === "Lonely Sandbar" ? "cycling land" : n}${w}`), `flashback${w}`,
  ]),
  "toMove", "library", ...SPELLS.map(n => `${n} in the graveyard`), "turn",
];
const N = FEATURES.length;

const hasType = (s, seat, type) => { for (const l of s.bf) if (l.ctl === seat && isLand(l) && typesOf(l).includes(type)) return true; return false; };
const ofType = (s, seat, type) => { let n = 0; for (const l of s.bf) if (l.ctl === seat && isLand(l) && typesOf(l).includes(type)) n++; return n; };

/** One seat's features into out from k: its life in hits, its Dandâns, its lands and mana, its hand card by card. */
function seatFeatures(s, x, out, k) {
  const foe = other(x), hits = Math.min(6, Math.max(0, Math.ceil(s.life[x] / 4)));
  out[k++] = hits / 5; out[k++] = hits <= 1 ? 1 : 0; out[k++] = hits <= 2 ? 1 : 0; out[k++] = hits <= 3 ? 1 : 0;
  let dd = 0, att = 0, thin = 0;
  for (const d of creatures(s, x)) {
    dd++;
    if (hasType(s, foe, needType(d))) att++;
    if (ofType(s, x, needType(d)) <= 1) thin++;
  }
  out[k++] = Math.min(4, dd) / 2; out[k++] = Math.min(4, att) / 2; out[k++] = Math.min(4, thin) / 2;
  let nl = 0, isl = 0, red = 0, mana = 0, open = 0, clues = 0;
  for (const p of s.bf) {
    if (p.ctl !== x) continue;
    if (p.id >= TOKEN_AT) { clues++; continue; }
    if (!isLand(p)) continue;
    nl++;
    if (typesOf(p).includes("Island")) isl++;
    let big = 0;
    for (const a of manaAlts(p)) { if (a.length > big) big = a.length; if (a.includes("R")) red = 1; }
    mana += big;
    if (!p.tapped) open += big;
  }
  out[k++] = Math.min(10, nl) / 8; out[k++] = Math.min(5, isl) / 4; out[k++] = isl ? 0 : 1; out[k++] = red;
  out[k++] = Math.min(10, mana) / 8; out[k++] = Math.min(10, open) / 8; out[k++] = Math.min(3, clues);
  const hand = s.hand[x];
  out[k++] = Math.min(10, hand.length) / 7;
  const at = k;
  for (let i = 0; i < SPELLS.length + 7; i++) out[k++] = 0;
  for (const id of hand) {
    if (id >= TOKEN_AT) continue;
    const i = isLandId(id) ? SPELLS.length + LAND_AT.get(DECK[id]) : SPELL_AT.get(DECK[id]);
    if (i != null && out[at + i] < 3) out[at + i]++;
  }
  // a Mystic Retrieval in the graveyard it could flash back on its turn
  out[k++] = red && mana >= 3 && s.yard.some(id => DECK[id] === "Mystic Retrieval") ? 1 : 0;
  return k;
}

/** The features of a position for `me`, into out (a Float32Array of FEATURES.length). */
export function features(s, me, out = new Float32Array(N)) {
  let k = seatFeatures(s, me, out, 0);
  k = seatFeatures(s, other(me), out, k);
  out[k++] = s.active === me ? 1 : 0;
  out[k++] = Math.min(80, s.lib.length) / 80;
  const at = k;
  for (let i = 0; i < SPELLS.length; i++) out[k++] = 0;
  for (const id of s.yard) { const i = SPELL_AT.get(DECK[id]); if (i != null && out[at + i] < 3) out[at + i]++; }
  out[k++] = Math.min(40, s.turn) / 30;
  return out;
}

// ---------- the network ----------
// Each layer's weights (inputs by outputs) as signed bytes, base64, with a scale for each output; the hidden layers'
// biases (the last layer's would cancel in g(mine) − g(theirs)). Trained in float and rounded so, which moves a chance
// by a third of a point on average and leaves the fit as it was.
const LAYERS = [
  {"n":[100,32],"q":"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","s":[0.0038036,0.0041799,0.0036309,0.0046206,0.0050485,0.0066924,0.0083796,0.0049822,0.0046101,0.0058326,0.0055275,0.0091581,0.0045177,0.0093296,0.0032389,0.0038169,0.0078782,0.0052668,0.0037353,0.0054727,0.0044911,0.0059489,0.0056983,0.012376,0.0058008,0.0071706,0.0095121,0.0060648,0.0043079,0.012708,0.0045512,0.0040918],"b":[0.11148,-0.057217,0.05049,0.11164,0.075847,-0.0014802,0.10859,0.010854,0.052021,0.34159,-0.065575,0.30671,0.083233,0.053781,-0.051768,-0.031072,0.025969,0.11549,0.13442,0.1647,0.26967,-0.051709,0.013818,0.27651,0.00119,0.12428,0.030992,0.067441,-0.048719,-0.18182,0.067259,-0.089211]},
  {"n":[32,16],"q":"7hFqHQkaAyj0Ln+y/PYbAP1r2fcGHh0LHs9DwicgBgD2ierY0hbuCNMJAuX2QuoALpfx29G5vcLX5kRc/yj1ABEr6vXEtvLXt9Db8X/c7ADq6jDE6QC7BTI4XPjxRVgA5zs5HZUuH8B0CecUTNfbADHpJxlKFD46TlIUN8dTLgDlWhMYKQoIyxGvCUwKHtMAJQEOxNnuwy+fCwrUBUschj3RsxTkwdX4HbUugeYs5QDh4FANT5kr9RA0Djhf2iD+3EccC/7qAfAH7bnzGBjKABP+Jvh/19Q9zvA0+QxJCwAw8jf8TdzJ7tsbIhMq/NQAIpb166Tv/dolzQfbMdeBAH/QNeJgoOcFJVFPN9sMXAAY2hYKQwjnVhP03yvjMyQANS0A89BE9//F+bL0E4ziAMAWWAQhMu00zCbO00ucEwAD2hTuG/PS17+BYiklf4j/8Au9x/guEvod4ey9G0/mABEg5jAW6Bsd0/AvDyD2nwC8DXQfHxwDPB8D5kZ4tteBEf9yBdezsg3ZGBqmwjlOAPwf3WOYXCTQIhfTC0r5GQAcWPYxNGx/+TcqHQ0LHyIA67Zz2wnl+dQkVQwvJKo/AOix0yHbwg32DIMA0Ba/rQAlgYELorO0K4EtaAPBZRoAETbzfzx/AD3kJSg8tXkQ/xLc/enOF1uBpj3G4AybPAA=","s":[0.0091346,0.0046707,0.0057991,0.0051981,0.0042233,0.0043905,0.0067425,0.0063027,0.0070295,0.0062453,0.0056554,0.0048587,0.005035,0.0033615,0.0051992,3.8716e-13],"b":[-0.027998,-0.046133,0.45846,0.036259,0.20513,0.026502,-0.018901,-0.016133,-0.00076366,0.11371,0.20509,0.24765,-3.0169e-38,0.18349,0.089553,1.8171e-36]},
  {"n":[16,1],"q":"gRTMIOYsOe5czujjJO2wAA==","s":[0.0065213],"b":[]},
];
const NET = LAYERS.map(L => {
  const [nIn, nOut] = L.n, raw = atob(L.q), W = new Float32Array(nIn * nOut), b = new Float32Array(nOut);
  for (let i = 0; i < raw.length; i++) { let v = raw.charCodeAt(i); if (v > 127) v -= 256; W[i] = v * L.s[i % nOut]; }
  if (L.b.length) b.set(L.b);
  return { nIn, nOut, W, b, y: new Float32Array(nOut) };
});
if (NET[0].nIn !== N) throw new Error("dandan-eval: the network reads a different number of features");

/** g: a position's score from one side's features (the hidden layers rectified, the last one not). */
function score(x) {
  let h = x;
  for (let l = 0; l < NET.length; l++) {
    const { nIn, nOut, W, b, y } = NET[l];
    y.set(b);
    for (let i = 0; i < nIn; i++) {
      const v = h[i];
      if (v === 0) continue;
      const row = i * nOut;
      for (let o = 0; o < nOut; o++) y[o] += v * W[row + o];
    }
    if (l < NET.length - 1) for (let o = 0; o < nOut; o++) if (y[o] < 0) y[o] = 0;
    h = y;
  }
  return h[0];
}

const mine = new Float32Array(N), theirs = new Float32Array(N);
/** The chance `me` wins from here: 1 or 0 for a game over (a half for both losing), else the network's. */
export function winChance(s, me) {
  if (s.over) return s.winner < 0 ? 0.5 : s.winner === me ? 1 : 0;
  // the other side's view is the same numbers with the seats' halves swapped and the turn the other way round
  features(s, me, mine);
  const half = (N - 3 - SPELLS.length) / 2;
  theirs.set(mine.subarray(half, 2 * half), 0);
  theirs.set(mine.subarray(0, half), half);
  theirs.set(mine.subarray(2 * half), 2 * half);
  theirs[2 * half] = 1 - mine[2 * half];
  return 1 / (1 + Math.exp(score(theirs) - score(mine)));
}
