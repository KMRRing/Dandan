// The keep by the value net (13 November 2026, Korbi: "make sure mulligan is treated as what it is, which is the most important
// decision of the game"; Fable's design). Until now Hard handed the mulligan and the cards to the bottom to Medium, which
// counts lands and six named spells. Here a hand is rated by the value net at the start of turn 1, averaged over deals of
// what the other player may hold (no peeking: their hand and the library's order are dealt afresh from the cards we can't
// see), and kept if it beats the worth of a redraw. That worth, for a seat (on the play or the draw) and the mulligans
// counted so far, is a constant of the net: solved backwards over many sample hands by lab/keep-table.mjs and stored with
// the net as `mull` ({ play: [W0…W7], draw: [W0…W7] }). The cards to the bottom: those whose going the net minds least.
// The other seven is dealt as a hand he would keep (13 November, Fable): one short of lands or spells is redealt, as he would
// throw it back free. Dealing him any seven rated a fresh hand at 55% on both seats, which can't both be over a half.
import { restore, unplayable, bottomFor, MOST_MULLS } from "./dandan-engine.js";
import { other } from "./dandan-core.js";
import { seeded, mix, shuffle } from "./seats.js";

const J = x => JSON.parse(JSON.stringify(x));
/** Tries at a playable seven for the other player before the last deal is taken as it is. */
export const REDEALS = 20;
/** Rating deals of a hand in Hard's keep (Fable, 13 November: 256, not 32). */
export const KEEP_DEALS = 256;
/** Every way of choosing k of the items. */
export function combos(items, k) {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const out = [];
  items.forEach((x, i) => { for (const rest of combos(items.slice(i + 1), k - 1)) out.push([x, ...rest]); });
  return out;
}

/**
 * The seat's chance with `hand` at the start of turn 1, by `judge`, averaged over `deals` deals of the other hand and the
 * library from the cards the seat can't see; `bottom` (cards put on the bottom) stay at the library's bottom. The other hand
 * is the size it has if that player has kept, else seven; a seven of his is redealt while it is short of lands or spells
 * (his free mulligan), at most REDEALS times.
 */
export function handWorth(s, seat, hand, judge, { deals = 32, bottom = [], seed = 1 } = {}) {
  const opp = other(seat), theirs = s.mull?.done?.[opp] ? s.hand[opp].length : 7;
  const pool = [...s.lib, ...s.hand[opp], ...s.hand[seat]].filter(id => !hand.includes(id) && !bottom.includes(id));
  const base = J(s);
  Object.assign(base, { pending: null, reveal: null, turn: 1, active: base.first, prio: base.first, step: "upkeep", drawn: [0, 0], played: 0, passes: 0 });
  base.mull = { n: base.mull.n.slice(), done: [true, true] };
  const rng = seeded(seed);
  let sum = 0;
  for (let k = 0; k < deals; k++) {
    let deck = shuffle(pool.slice(), rng);
    for (let r = 0; theirs === 7 && r < REDEALS && unplayable({ hand: { [opp]: deck.slice(0, 7) } }, opp); r++) deck = shuffle(deck, rng);
    const c = J(base);
    c.hand[seat] = hand.slice(); c.hand[opp] = deck.slice(0, theirs); c.lib = [...deck.slice(theirs), ...bottom];
    sum += judge(restore(c), seat);
  }
  return sum / deals;
}

/** The best keep of a seven after `n` mulligans counted: its worth, and the cards to put on the bottom for it. */
export function keepWorth(s, seat, hand, n, judge, opts = {}) {
  const b = Math.min(hand.length, bottomFor(n));
  let best = { worth: -1, bottom: [] };
  for (const bottom of combos(hand, b)) {
    const worth = handWorth(s, seat, hand.filter(id => !bottom.includes(id)), judge, { ...opts, bottom });
    if (worth > best.worth) best = { worth, bottom };
  }
  return best;
}

const seedOf = (s, seat) => mix(s.lib.length * 977 + seat, s.hand[seat].reduce((a, id) => mix(a, id + 1), 7));
/** The redraw's worth for this seat at `n` mulligans counted, from the net's table (null if the net has none). */
export function redrawWorth(s, seat, n, judge) {
  const t = judge?.mull?.[seat === s.first ? "play" : "draw"];
  return t ? t[Math.min(n, t.length - 1)] : null;
}

/**
 * Hard's answer to the keep and to the cards to the bottom, by the net: null if the net has no redraw table (the caller then
 * asks Medium, as before). The worth of each keep is in `why` for the log and the lab.
 */
export function keepMove(s, seat, judge, { deals = KEEP_DEALS } = {}) {
  const p = s.pending;
  if (!p || !judge?.mull) return null;
  const seed = seedOf(s, seat), hand = s.hand[seat];
  if (p.t === "mull") {
    const n = p.taken, keep = keepWorth(s, seat, hand, n, judge, { deals, seed });
    // the free mulligan of a short hand doesn't count; otherwise a mulligan moves to n + 1 (none past MOST_MULLS)
    const canMull = p.free || n < MOST_MULLS, redraw = canMull ? redrawWorth(s, seat, p.free ? n : n + 1, judge) : null;
    const mull = redraw != null && redraw > keep.worth;
    return { move: { t: mull ? "mull" : "keep" }, why: { keep: +keep.worth.toFixed(4), redraw: redraw == null ? null : +redraw.toFixed(4), n, free: !!p.free } };
  }
  if (p.t === "bottom") {
    let best = { worth: -1, bottom: hand.slice(0, p.n) };
    for (const bottom of combos(hand, p.n)) {
      const worth = handWorth(s, seat, hand.filter(id => !bottom.includes(id)), judge, { deals, bottom, seed });
      if (worth > best.worth) best = { worth, bottom };
    }
    return { move: { t: "bottom", cards: best.bottom }, why: { keep: +best.worth.toFixed(4) } };
  }
  return null;
}

/**
 * The redraw table of a net (lab/keep-table.mjs): for each seat (on the play, on the draw), W[n], the worth of a fresh seven
 * with n mulligans counted when every keep after it is made this same way: W[n] = the mean over sample sevens of the better
 * of keeping (its best bottoms) and mulligan again (W[n] for a short hand's free one, else W[n + 1]; none past MOST_MULLS).
 * Solved from n = MOST_MULLS down; each W[n] by iteration, as the free mulligan returns to it. `deal` makes a fresh game.
 */
export function solveTable(judge, deal, { hands = 400, deals = 24, rng = Math.random } = {}) {
  const out = {};
  for (const role of ["play", "draw"]) {
    const rows = [];
    for (let h = 0; h < hands; h++) {
      const s = deal({ rng }), seat = role === "play" ? s.first : other(s.first), hand = s.hand[seat];
      const free = unplayable(s, seat), seed = mix(h + 1, role === "play" ? 11 : 13);
      rows.push({ free, keep: Array.from({ length: MOST_MULLS + 1 }, (_, n) => keepWorth(s, seat, hand, n, judge, { deals, seed }).worth) });
    }
    const W = new Array(MOST_MULLS + 1);
    for (let n = MOST_MULLS; n >= 0; n--) {
      let w = 0.5;
      for (let it = 0; it < 100; it++) {
        const next = rows.reduce((a, r) => a + Math.max(r.keep[n], r.free ? w : n < MOST_MULLS ? W[n + 1] : -1), 0) / rows.length;
        if (Math.abs(next - w) < 1e-7) { w = next; break; }
        w = next;
      }
      W[n] = +w.toFixed(5);
    }
    out[role] = W;
    out[role + "Keep"] = +(rows.filter(r => !r.free && r.keep[0] >= W[1]).length / rows.filter(r => !r.free).length).toFixed(3);
  }
  return { ...out, hands, deals };
}
