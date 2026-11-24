// Trumps' computer players. Bidding by a count of the hand's strength for each way it could be played. Card play by
// sampling (Medium and Hard): deal the cards it can't see among the others as they could lie (each hand's size, the
// suits a player has shown to be out of), play each card it may play to the end of the hand in each such deal, every
// player playing by a quick rule of thumb, and play the card that did best on average for its side. Easy plays the
// rule of thumb alone, with a wobble. Schafkopf's Hard players think further (trumps-think.js): each deal played out
// with every card seen, both sides at their best, and a game bid where it pays on average.
import { GAMES, teamOf } from "./trumps-games.js";
import { suitOf, rankOf, cid } from "./trumps-cards.js";
import { sample } from "./trumps-deals.js";
import { thinkPlay, thinkBid } from "./trumps-think.js";

export const LEVEL_NAMES = [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]];
const SAMPLES = { medium: 14, hard: 40 };

// Moves worked out ahead, off the page's thread (trumps-worker.js), for the decision each answers: the table's move
// takes one when it's there instead of thinking again (seats.js asks for a move then and there).
const ahead = new Map();
/** A decision, told apart from any other: the hand, the bidding or the trick so far, the seat, its cards, the level. */
export const aheadKey = (s, seat, level) => [level, s.game, s.handNo, s.dealer, s.step, seat, s.bidlog?.length, s.tricks?.length, s.trick?.map(t => t.card).join(" "), s.hands[seat].join(" ")].join("|");
export function remember(key, move) {
  ahead.set(key, move);
  if (ahead.size > 12) ahead.delete(ahead.keys().next().value);
}
/** How long Hard may think in one go where it isn't worked out ahead (ms; 0 no limit): the page's own thread sets a
 *  limit, so a slow phone isn't held up long. */
export const THINK = { ms: 0 };
/** Whether Schafkopf's Hard players think further at this level (and so are worth working out ahead). */
export const thinksAhead = (game, level) => game === "schafkopf" && level === "hard";

export function botMove(s, seat, level = "medium", rng = Math.random) {
  const key = aheadKey(s, seat, level), known = ahead.get(key);
  if (known) {
    ahead.delete(key);
    const g = GAMES[s.game];
    if (s.step === "bid" ? g.bids(s, seat).some(b => JSON.stringify(b) === JSON.stringify(known)) : g.legal(s, seat).includes(known.card)) return known;
  }
  if (s.step === "bid") return thinksAhead(s.game, level) ? thinkBid(s, seat) : BID[s.game](s, seat, level, rng);
  if (thinksAhead(s.game, level)) return { t: "card", card: thinkPlay(s, seat, rng, { ms: THINK.ms, prefer: thumb(GAMES.schafkopf, s, seat, knownSides(s, seat), rng) }) };
  return { t: "card", card: playCard(s, seat, level, rng) };
}

// ---------------------------------------------------------------- bidding
const count = (hand, f) => hand.filter(f).length;
const has = (hand, s, r) => hand.includes(cid(s, r));

/** Jass: each way of playing counted; the best, or pushed to the partner when nothing is good. */
function jassStrength(hand, mode, suit) {
  let v = 0;
  if (mode === "trump") {
    for (const id of hand) {
      const s = suitOf(id), r = rankOf(id);
      if (s === suit) v += { J: 26, 9: 18, A: 12, K: 7, Q: 6, T: 6 }[r] ?? 5;
      else if (r === "A") v += 10;
      else if (r === "K" && has(hand, s, "A")) v += 4;
    }
    v += Math.max(0, count(hand, id => suitOf(id) === suit) - 3) * 6;
  } else {
    const top = mode === "obe" ? ["A", "K", "Q"] : ["6", "7", "8"];
    for (let s = 0; s < 4; s++) {
      const n = count(hand, id => suitOf(id) === s);
      if (has(hand, s, top[0])) { v += 15; if (has(hand, s, top[1])) { v += 9; if (has(hand, s, top[2])) v += 5; } v += Math.max(0, n - 3) * 4; }
    }
  }
  return v;
}
function jassBid(s, seat) {
  const hand = s.hands[seat], options = GAMES.jass.bids(s, seat);
  let best = null, bestV = -1;
  for (const o of options) {
    if (o.t === "push") continue;
    const v = jassStrength(hand, o.mode, o.suit);
    if (v > bestV) { bestV = v; best = o; }
  }
  if (bestV < 52 && options.some(o => o.t === "push")) return { t: "push" };
  return best;
}

/** Belote: the turned suit taken with a good hand in it; in the second round, the best other suit if good enough. */
function beloteStrength(hand, suit) {
  let v = 0;
  for (const id of hand) {
    const s = suitOf(id), r = rankOf(id);
    if (s === suit) v += { J: 20, 9: 14, A: 10, T: 8, K: 4, Q: 4 }[r] ?? 3;
    else if (r === "A") v += 9;
    else if (r === "T" && has(hand, s, "A")) v += 4;
  }
  return v;
}
function beloteBid(s, seat) {
  const hand = s.hands[seat];
  if (s.round === 1) return beloteStrength([...hand, s.turned], suitOf(s.turned)) >= 46 ? { t: "take" } : { t: "pass" };
  let best = { t: "pass" }, bestV = 44;
  for (const o of GAMES.belote.bids(s, seat)) if (o.t === "take") { const v = beloteStrength(hand, o.suit); if (v > bestV) { bestV = v; best = o; } }
  return best;
}
/** Schafkopf: a Solo with a long run of trumps, a Wenz with Unters and aces, a Sauspiel with trumps and an ace to call. */
function schafkopfBid(s, seat) {
  const hand = s.hands[seat], opts = GAMES.schafkopf.bids(s, seat);
  const ou = id => rankOf(id) === "Q" || rankOf(id) === "J";
  const highOU = count(hand, id => ou(id) && (suitOf(id) >= 2 || rankOf(id) === "Q"));
  const aces = count(hand, id => rankOf(id) === "A");
  const soloSuit = [3, 2, 1, 0].map(su => ({ su, n: count(hand, id => ou(id) || suitOf(id) === su) })).sort((a, b) => b.n - a.n)[0];
  const solo = opts.find(o => o.type === "solo" && o.suit === soloSuit.su);
  if (solo && soloSuit.n >= 6 && highOU >= 3) return solo;
  const unters = count(hand, id => rankOf(id) === "J");
  const wenz = opts.find(o => o.type === "wenz");
  if (wenz && unters >= 2 && (has(hand, 3, "J") || has(hand, 2, "J")) && aces + unters >= 5) return wenz;
  const trumps = count(hand, id => ou(id) || suitOf(id) === 1);
  const sau = opts.filter(o => o.type === "sau");
  if (sau.length && trumps >= 4 && highOU >= 2) {
    // call the ace of the suit it holds fewest of, the likeliest to find it fast
    return sau.sort((a, b) => count(hand, id => !ou(id) && suitOf(id) === a.ace) - count(hand, id => !ou(id) && suitOf(id) === b.ace))[0];
  }
  return { t: "pass" };
}
const BID = { jass: jassBid, belote: beloteBid, schafkopf: schafkopfBid };

// ---------------------------------------------------------------- card play
/** The sides as a player can know them: Schafkopf's partner only once the called ace is seen, or by its holder. */
function knownSides(s, seat) {
  if (s.game !== "schafkopf" || s.contract.type !== "sau") return sidesOf(s, s.hands);
  const ace = cid(s.contract.ace, "A"), played = [...s.tricks.flatMap(x => x.cards), ...s.trick].find(t => t.card === ace);
  const partner = played ? played.seat : s.hands[seat].includes(ace) ? seat : -1;
  return p => (p === s.contract.declarer || p === partner ? 0 : 1);
}
/** The sides as this deal has them (Schafkopf's by the contract, the partner the called ace's holder in this deal). */
function sidesOf(s, hands) {
  if (s.game !== "schafkopf") return seat => teamOf(seat);
  const c = s.contract;
  let partner = -1;
  if (c.type === "sau") {
    const ace = cid(c.ace, "A");
    partner = hands.findIndex(h => h.includes(ace));
    if (partner < 0) for (const t of [...s.tricks.flatMap(x => x.cards), ...s.trick]) if (t.card === ace) partner = t.seat;
  }
  return seat => (seat === c.declarer || seat === partner ? 0 : 1);
}
/** What a card is worth keeping for the tricks still to come, in card points: TRICK for one no card still out can beat,
 *  less the more there are that can. TRICK is more than a trick's points, since the trick it takes decides who leads
 *  and where the others' Zehner go; 64 played best against the old points-only rule in Schafkopf, Jass and Belote
 *  (13 Nov 2026: Easy +8.5 card points a deal in Schafkopf, +12 in Jass, +4 in Belote; Medium +1.5, +5, even). */
const TRICK = 64;
function keepWorth(g, sim, p, card) {
  let over = 0;
  for (const [q, hand] of sim.hands.entries()) if (q !== p) for (const c of hand) if (g.winner(sim, [{ seat: 0, card }, { seat: 1, card: c }]) === 1) over++;
  return TRICK / (1 + over);
}
/** The rule of thumb: win a trick worth taking with the card least worth keeping, give points to a partner who holds
 *  it, else throw what's least worth, its points and the tricks it could still take together. Korbi, 13 Nov 2026:
 *  Sepp threw his Herz-Ober into the other side's trick because it is a point cheaper than his Eichel-König, and the
 *  next trick, which the Ober would have taken with a Zehner his partner had for it, went to the player: "Punkte über
 *  Stichtaktik", and not for the first time. Then, playing, he threw the Schellen-Ober under a Gras-Ober "obwohl er
 *  kleinere Trümpfe hat". A card that will take a trick is worth more than the points it saves, a Zehner's included. */
function thumb(g, sim, p, side, rng, wobble = 0) {
  const cards = g.legal(sim, p);
  if (cards.length === 1) return cards[0];
  const pts = c => g.points(sim, c), memo = new Map(), keep = c => (memo.has(c) ? memo.get(c) : memo.set(c, keepWorth(g, sim, p, c)).get(c));
  const powerIn = (trick, c) => { const t = [...trick, { seat: p, card: c }]; return g.winner(sim, t) === t.length - 1; };
  const jitter = () => (wobble ? (rng() - 0.5) * wobble : 0);
  const least = list => list.sort((a, b) => pts(a) + keep(a) - pts(b) - keep(b) + jitter())[0];
  if (!sim.trick.length) {
    // lead a card no other can beat if there's one (an ace, the top trump), else the one least worth keeping
    const winners = cards.filter(c => isTop(g, sim, c));
    if (winners.length) return winners.sort((a, b) => pts(b) - pts(a) + jitter())[0];
    return least(cards);
  }
  const w = sim.trick[g.winner(sim, sim.trick)].seat, partner = side(w) === side(p), last = sim.trick.length === 3;
  if (partner && (last || isTop(g, sim, sim.trick[g.winner(sim, sim.trick)].card))) {
    // fatten the partner's trick: the most points, but not with a card that would take a trick of its own later
    const under = cards.filter(c => !powerIn(sim.trick, c)), from = under.length ? under : cards;
    return from.sort((a, b) => pts(b) - keep(b) - pts(a) + keep(a) + jitter())[0];
  }
  const take = cards.filter(c => powerIn(sim.trick, c));
  const worth = sim.trick.reduce((a, t) => a + pts(t.card), 0);
  // taking last, a card's points come home with the trick; before the others have played they may yet go to them
  if (take.length && (last || worth >= 4 || take.some(c => isTop(g, sim, c)))) return take.sort((a, b) => keep(a) + (last ? -pts(a) : pts(a)) - keep(b) - (last ? -pts(b) : pts(b)) + jitter())[0];
  return least(cards);
}
/** Whether no card still out can beat this one if it's led (the highest left of its kind). */
function isTop(g, sim, card) {
  const out = sim.hands.flat().filter(c => c !== card);
  return out.every(c => g.winner(sim, [{ seat: 0, card }, { seat: 1, card: c }]) === 0);
}

/** A hand played out from here in one deal: what this seat's side ends up with (its points less the others', and what the contract makes of them). */
function playout(g, s, hands, seat, first, side, rng) {
  const sim = { ...s, hands: hands.map(h => h.slice()), trick: s.trick.slice(), tricks: s.tricks.slice() };
  let p = seat, card = first;
  for (;;) {
    sim.hands[p] = sim.hands[p].filter(c => c !== card);
    sim.trick.push({ seat: p, card });
    if (sim.trick.length === 4) {
      const w = sim.trick[g.winner(sim, sim.trick)].seat, last = sim.hands.every(h => !h.length);
      sim.tricks.push({ cards: sim.trick, winner: w, pts: sim.trick.reduce((a, t) => a + g.points(sim, t.card), 0) + (last ? g.last : 0) });
      sim.trick = [];
      if (last) break;
      p = w;
    } else p = (p + 1) % 4;
    card = thumb(g, sim, p, side, rng);
  }
  const mine = side(seat), pts = [0, 0], tricks = [0, 0];
  for (const t of sim.tricks) { pts[side(t.winner)] += t.pts; tricks[side(t.winner)]++; }
  let v = pts[mine] - pts[1 - mine];
  // what the contract makes of the points: crossing its line counts for more than the points either side of it
  const c = s.contract;
  if (s.game === "jass") { if (tricks[mine] === 9) v += 100; }
  else if (s.game === "schafkopf") { const decl = side(c.declarer); const made = pts[decl] >= 61; v += (decl === mine ? 1 : -1) * (made ? 40 : -40); }
  else {
    const att = side(c.taker), made = pts[att] > pts[1 - att];
    v += (att === mine ? 1 : -1) * (made ? 60 : -60);
  }
  return v;
}

function playCard(s, seat, level, rng) {
  const g = GAMES[s.game], legal = g.legal(s, seat);
  if (legal.length === 1) return legal[0];
  if (level === "easy" || !SAMPLES[level]) return thumb(g, s, seat, knownSides(s, seat), rng, 8);
  const per = new Map(legal.map(c => [c, []]));
  for (let k = 0; k < SAMPLES[level]; k++) {
    const hands = sample(s, seat, rng);
    if (!hands) continue;
    const side = sidesOf(s, hands);
    for (const c of legal) per.get(c).push(playout(g, s, hands, seat, c, side, rng));
  }
  const rule = thumb(g, s, seat, knownSides(s, seat), rng), n = per.get(legal[0]).length;
  if (n < 2) return rule;
  // a few deals tell cards apart only so far: where the rule of thumb's card is within a standard error of the best
  // (over the same deals), it's played, so the deals' noise doesn't throw an Ober away (Korbi, 13 Nov 2026)
  const mean = c => per.get(c).reduce((a, v) => a + v, 0) / n, best = legal.reduce((a, c) => (mean(c) > mean(a) ? c : a));
  const d = per.get(best).map((v, i) => v - per.get(rule)[i]), gap = d.reduce((a, v) => a + v, 0) / n;
  const se = Math.sqrt(d.reduce((a, v) => a + (v - gap) ** 2, 0) / (n - 1) / n);
  return gap <= se ? rule : best;
}
