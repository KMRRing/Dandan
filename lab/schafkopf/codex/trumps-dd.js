// Schafkopf with every card seen (double dummy), fast enough for a turn at the table: how many points the players'
// side takes from the rest of a hand when both sides play their best for points. trumps-solve.js's search counts
// schwarz and every point together, exactly, and takes seconds on a whole hand; this one counts points alone (the 61
// and Schneider are points) by alpha-beta over the cards as bits, keeping what it learns of each position at a trick's
// start, and trying once each run of cards that can't differ (two Obers side by side in one hand, the 8 and 9 below
// them). Schwarz, which is tricks and not points, it looks for on its own when a side is about to take nothing.
// The computer players (trumps-bot.js) and the coach play by it: each deal of the cards they can't see solved after
// each card they may play.
import { GAMES, sTrump } from "./trumps-games.js";
import { deckFrom, cid } from "./trumps-cards.js";

const S = GAMES.schafkopf;
const DECK = deckFrom("7");                                  // the 32 cards, by bit
const BIT = new Map(DECK.map((id, b) => [id, b]));
const PTS = Int8Array.from(DECK, id => S.points(null, id));
const T = 4;                                                 // the trumps' class; the Farben are 0–3
const pop = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const low = m => 31 - Math.clz32(m & -m);                    // the lowest bit's index
/** Cards as bits, and back. */
export const maskOf = ids => ids.reduce((m, id) => m | (1 << BIT.get(id)), 0);
export const idOf = b => DECK[b];

/** A contract's cards as bits: each card's class (trumps, or its Farbe), its strength within the class, its class's
 *  cards strongest first, and the called Sau. */
function tablesOf(c) {
  const cls = new Int8Array(32), pow = new Int16Array(32), mask = new Int32Array(5), order = [[], [], [], [], []];
  const beats = (a, b) => S.winner({ contract: c }, [{ seat: 0, card: DECK[b] }, { seat: 1, card: DECK[a] }]) === 1;   // a played on b led
  for (let b = 0; b < 32; b++) { cls[b] = sTrump(c, DECK[b]) ? T : Math.floor(DECK[b] / 9); mask[cls[b]] |= 1 << b; order[cls[b]].push(b); }
  for (const list of order) {
    list.sort((a, b) => (beats(a, b) ? -1 : 1));
    list.forEach((b, i) => { pow[b] = list.length - i; });
  }
  const ace = c.type === "sau" ? BIT.get(cid(c.ace, "A")) : -1;
  return { cls, pow, mask, order, ace, aceCls: ace >= 0 ? cls[ace] : -1 };
}

// the transposition table: positions at a trick's start (the four hands, who leads), with the bounds known of their
// worth and the card that did best; entries from an earlier deal are told apart by a generation
const TT_BITS = 18, TT_SIZE = 1 << TT_BITS;
const ttH = new Int32Array(TT_SIZE * 4), ttMeta = new Int32Array(TT_SIZE), ttLo = new Int8Array(TT_SIZE), ttHi = new Int8Array(TT_SIZE), ttBest = new Int8Array(TT_SIZE);
let gen = 0;
const slot = (h, lead) => (Math.imul(h[0], 0x9E3779B1) ^ Math.imul(h[1], 0x85EBCA77) ^ Math.imul(h[2], 0xC2B2AE3D) ^ Math.imul(h[3], 0x27D4EB2F) ^ Math.imul(lead + 1, 0x165667B1)) >>> (32 - TT_BITS);

/**
 * A solver for one deal: hands (the cards each seat holds now), the trick so far ([{ seat, card }]), whose turn, and
 * the sides (seat → 0 the players, 1 the others). value(card) is the points the players take from here to the end
 * after `card` (the trick's cards included), both sides playing for points; tricks(card, side) whether that side can
 * take at least one more trick after it (for schwarz).
 */
/** A search that has run past its budget of positions: the caller leaves that deal out. */
export class TooLong extends Error {}
/** Positions searched, all told (for the tests and the tools). */
export const stats = { nodes: 0 };

export function solver(contract, { hands, trick, turn, side, limit = Infinity }) {
  const X = tablesOf(contract), { cls, pow, mask, order, ace, aceCls } = X;
  const h = Int32Array.from(hands, maskOf), sideOf = Int8Array.from([0, 1, 2, 3], side);
  const tSeat = new Int8Array(4), tBit = new Int8Array(4);
  let n = 0, lead = trick.length ? trick[0].seat : turn;
  for (const t of trick) { tSeat[n] = t.seat; tBit[n] = BIT.get(t.card); n++; }
  gen = (gen + 1) & 0x3fffffff;
  const moves = new Int8Array(33 * 8), scores = new Float64Array(8), hist = new Float64Array(32 * 4);

  /** What a seat may play now, as bits (the called Sau's rules included). */
  function legal(seat) {
    const hand = h[seat], holds = ace >= 0 && (hand >> ace) & 1;
    if (!n) {
      if (holds) { const of = hand & mask[aceCls]; if (pop(of) < 4) return hand & ~(of & ~(1 << ace)); }
      return hand;
    }
    const f = hand & mask[cls[tBit[0]]];
    if (f) return holds && cls[tBit[0]] === aceCls ? 1 << ace : f;
    return holds && pop(hand) > 1 ? hand & ~(1 << ace) : hand;
  }
  /** The card that takes the trick so far: its place in it. */
  function holder(k) {
    let best = 0;
    for (let i = 1; i < k; i++) if (stronger(tBit[i], tBit[best])) best = i;
    return best;
  }
  const stronger = (a, b) => (cls[a] === cls[b] ? pow[a] > pow[b] : cls[a] === T || (cls[b] !== T && cls[a] === cls[tBit[0]] && cls[b] !== cls[tBit[0]]));
  /** Whether a card would be left over with one of its run: the next stronger card of its class still in play is the
   *  mover's own and counts the same, so playing that one comes to the same. */
  function twin(seat, b, inTrick, ok) {
    const list = order[cls[b]];
    for (let i = list.indexOf(b) - 1; i >= 0; i--) {
      const o = list[i];
      if ((h[seat] >> o) & 1) return PTS[o] === PTS[b] && !!((ok >> o) & 1);
      if (inTrick & (1 << o)) return false;
      for (let s = 0; s < 4; s++) if ((h[s] >> o) & 1) return false;
    }
    return false;
  }
  /** The moves to try at this ply, best guesses first: written into moves[ply * 8…], their count returned. */
  function gen8(seat, ply, first) {
    const ok = legal(seat), many = (ok & (ok - 1)) !== 0;
    let m = ok, k = 0, inTrick = 0;
    for (let i = 0; i < n; i++) inTrick |= 1 << tBit[i];
    const top = n ? holder(n) : -1, ours = n && sideOf[tSeat[top]] === sideOf[seat], last = n === 3;
    while (m) {
      const b = low(m);
      m &= m - 1;
      if (many && twin(seat, b, inTrick, ok)) continue;
      let sc;
      if (!n) sc = cls[b] === T ? 400 + pow[b] : PTS[b] === 11 ? 300 : 100 - PTS[b] * 4 + pow[b];
      else {
        const wins = stronger(b, tBit[top]);
        if (ours) sc = wins ? 100 - pow[b] : 300 + PTS[b] * 4;                 // the trick is our side's: fatten it
        else if (wins) sc = 400 - (last ? pow[b] + PTS[b] * 2 : pow[b]) + PTS[b];
        else sc = 200 - PTS[b] * 4;
      }
      sc = sc * 1e6 + hist[seat * 32 + b];
      if (b === first) sc = 1e12;
      let i = k++;
      while (i > 0 && scores[i - 1] < sc) { scores[i] = scores[i - 1]; moves[ply * 8 + i] = moves[ply * 8 + i - 1]; i--; }
      scores[i] = sc;
      moves[ply * 8 + i] = b;
    }
    return k;
  }

  let left = 0;                                              // the points still in the hands and the trick
  for (let s = 0; s < 4; s++) for (let m = h[s]; m; m &= m - 1) left += PTS[low(m)];
  for (let i = 0; i < n; i++) left += PTS[tBit[i]];

  /** Alpha-beta: the players' points from here, both sides playing for points. */
  let budget = limit;
  function search(alpha, beta, ply) {
    if (--budget < 0) throw new TooLong();
    stats.nodes++;
    if (!n) {
      if (!h[0] && !h[1] && !h[2] && !h[3]) return 0;
      if (left <= alpha) return left;                        // can't reach alpha even taking everything
      if (beta <= 0) return 0;
    }
    let e = -1, firstMove = -1;
    if (!n) {
      e = slot(h, lead);
      if (ttMeta[e] === ((gen << 2) | lead) && ttH[e * 4] === h[0] && ttH[e * 4 + 1] === h[1] && ttH[e * 4 + 2] === h[2] && ttH[e * 4 + 3] === h[3]) {
        const lo = ttLo[e] & 0xff, hi = ttHi[e] & 0xff;
        if (lo >= beta) return lo;
        if (hi <= alpha) return hi;
        if (lo === hi) return lo;
        if (lo > alpha) alpha = lo;
        if (hi < beta) beta = hi;
        firstMove = ttBest[e];
      }
    }
    const a0 = alpha, b0 = beta, seat = (lead + n) % 4, maxing = sideOf[seat] === 0;
    const k = gen8(seat, ply, firstMove);
    let best = maxing ? -1 : 999, bestMove = -1;
    for (let i = 0; i < k; i++) {
      const b = moves[ply * 8 + i];
      h[seat] &= ~(1 << b);
      tSeat[n] = seat; tBit[n] = b; n++;
      let v;
      if (n === 4) {
        const w = tSeat[holder(4)], pts = PTS[tBit[0]] + PTS[tBit[1]] + PTS[tBit[2]] + PTS[tBit[3]], got = sideOf[w] === 0 ? pts : 0;
        const keep = [tSeat[0], tBit[0], tSeat[1], tBit[1], tSeat[2], tBit[2], tSeat[3], tBit[3]], oldLead = lead;
        n = 0; lead = w; left -= pts;
        v = got + search(alpha - got, beta - got, ply + 1);
        left += pts; lead = oldLead; n = 4;
        for (let j = 0; j < 4; j++) { tSeat[j] = keep[j * 2]; tBit[j] = keep[j * 2 + 1]; }
      } else v = search(alpha, beta, ply + 1);
      n--;
      h[seat] |= 1 << b;
      if (maxing ? v > best : v < best) { best = v; bestMove = b; }
      if (maxing) { if (best > alpha) alpha = best; } else if (best < beta) beta = best;
      if (alpha >= beta) { hist[seat * 32 + b] += (33 - ply) * (33 - ply); break; }
    }
    if (e >= 0) {
      const known = ttMeta[e] === ((gen << 2) | lead) && ttH[e * 4] === h[0] && ttH[e * 4 + 1] === h[1] && ttH[e * 4 + 2] === h[2] && ttH[e * 4 + 3] === h[3];
      let lo = known ? ttLo[e] & 0xff : 0, hi = known ? ttHi[e] & 0xff : 255;
      if (best <= a0) hi = Math.min(hi, best); else if (best >= b0) lo = Math.max(lo, best); else lo = hi = best;
      ttH[e * 4] = h[0]; ttH[e * 4 + 1] = h[1]; ttH[e * 4 + 2] = h[2]; ttH[e * 4 + 3] = h[3];
      ttMeta[e] = (gen << 2) | lead; ttLo[e] = lo; ttHi[e] = Math.min(hi, 255); ttBest[e] = bestMove;
    }
    return best;
  }

  /** Whether `want` (a side) can take at least one more trick from here, the other side trying to stop it. */
  const seenTricks = new Map();
  function anyTrick(want, ply) {
    if (!n && !h[0] && !h[1] && !h[2] && !h[3]) return false;
    if (!n) {
      // the highest trump still out takes whatever trick it falls in: its holder's side takes one for certain
      for (const b of order[T]) {
        let s = 0;
        while (s < 4 && !((h[s] >> b) & 1)) s++;
        if (s < 4) { if (sideOf[s] === want) return true; break; }
      }
    }
    const key = n ? null : `${h[0]},${h[1]},${h[2]},${h[3]},${lead},${want}`;
    if (key && seenTricks.has(key)) return seenTricks.get(key);
    const r = anyTrickHere(want, ply);
    if (key) seenTricks.set(key, r);
    return r;
  }
  function anyTrickHere(want, ply) {
    if (--budget < 0) throw new TooLong();
    stats.nodes++;
    const seat = (lead + n) % 4, mine = sideOf[seat] === want;
    // strongest first: the likeliest to take the trick, for the side after one and the side keeping it from them
    const list = [];
    for (let m = legal(seat); m; m &= m - 1) list.push(low(m));
    list.sort((a, b) => (cls[b] === T) - (cls[a] === T) || pow[b] - pow[a]);
    for (const b of list) {
      h[seat] &= ~(1 << b);
      tSeat[n] = seat; tBit[n] = b; n++;
      let r;
      if (n === 4) {
        const w = tSeat[holder(4)], keep = [tSeat[0], tBit[0], tSeat[1], tBit[1], tSeat[2], tBit[2], tSeat[3], tBit[3]], oldLead = lead;
        if (sideOf[w] === want) r = true;
        else { n = 0; lead = w; r = anyTrick(want, ply + 1); lead = oldLead; n = 4; for (let j = 0; j < 4; j++) { tSeat[j] = keep[j * 2]; tBit[j] = keep[j * 2 + 1]; } }
      } else r = anyTrick(want, ply + 1);
      n--;
      h[seat] |= 1 << b;
      if (r === mine) return r;                              // the mover found what it wants
    }
    return !mine;
  }

  const play = (card, f) => {
    const seat = turn, b = BIT.get(card), saved = [n, lead, left];
    h[seat] &= ~(1 << b);
    tSeat[n] = seat; tBit[n] = b; n++;
    let r;
    if (n === 4) {
      const w = tSeat[holder(4)], pts = PTS[tBit[0]] + PTS[tBit[1]] + PTS[tBit[2]] + PTS[tBit[3]];
      const done = { w, pts };
      n = 0; lead = w; left -= pts;
      r = f(done);
    } else r = f(null);
    [n, lead, left] = saved;
    for (let i = 0; i < trick.length; i++) { tSeat[i] = trick[i].seat; tBit[i] = BIT.get(trick[i].card); }
    h[seat] |= 1 << b;
    return r;
  };
  /** The exact value from here by zero-window searches homing in from a guess (MTD(f)): each one cheap, the bounds
   *  they leave kept for the next. */
  function exact(guess) {
    let g = guess, lo = 0, hi = left;
    while (lo < hi) {
      const beta = g === lo ? g + 1 : g;
      g = search(beta - 1, beta, 0);
      if (g < beta) hi = g; else lo = g;
    }
    return lo;
  }
  let guess = -1;
  return {
    /** The cards the seat to move may play. */
    cards: () => { const out = []; for (let m = legal(turn); m; m &= m - 1) out.push(DECK[low(m)]); return out; },
    /** The players' points from here to the end after `card`, the trick's included. */
    value: card => play(card, done => {
      const got = done && sideOf[done.w] === 0 ? done.pts : 0;
      if (guess < 0) guess = left >> 1;
      const v = exact(Math.min(left, Math.max(0, guess)));
      guess = v;
      return got + v;
    }),
    /** Whether the players take at least `t` points from here, before anyone plays (a whole hand, for bidding). */
    reaches: t => t <= 0 || search(t - 1, t, 0) >= t,
    /** Whether `want` can take at least one trick from here, before anyone plays (schwarz, for bidding). */
    takes: want => anyTrick(want, 0),
    /** Whether the players take at least `t` points from here after `card` (cheaper than the exact value). */
    atLeast: (card, t) => play(card, done => {
      const got = done && sideOf[done.w] === 0 ? done.pts : 0;
      return got >= t || search(t - got - 1, t - got, 0) >= t - got;
    }),
    /** Whether `want` can still take a trick after `card` (this trick, if it falls to it, counts). */
    tricks: (card, want) => play(card, done => (done && sideOf[done.w] === want) || anyTrick(want, 0)),
    /** More positions to search, on top of what's left of the budget (a refinement after the main questions). */
    extend: n => { budget = Math.max(budget, 0) + n; },
  };
}
