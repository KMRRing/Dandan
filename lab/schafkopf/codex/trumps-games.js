// Trumps' games, each its deal, its bidding, its cards' order and worth, what may be played, who takes a trick, and
// its scoring: Jass (the Schieber, as played in Switzerland: trumps chosen or pushed to the partner, Obenabe and
// Undenufe, Weis and Stöck), Belote (the classic: the turned card taken or another suit named)
// and Schafkopf (Bavaria's: Sauspiel with a called ace, Wenz, Solo). trumps-rules.js runs a hand the same
// way for all of them. Seats 0–3 play in turn (seat + 1 next); the page sets them out the game's way round the table.
import { RANKS, cid, suitOf, rankOf, deckFrom } from "./trumps-cards.js";

const next = s => (s + 1) % 4;
const teamOf = seat => seat % 2;
const shuffle = (list, rng) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const order = list => r => list.indexOf(r);

// ======================================================================= Jass
// Ranks low to high: plain suits and Obenabe; trumps (the Under, the Bauer, highest, the nine, the Nell, next);
// Undenufe (the six highest).
const J_PLAIN = order(["6", "7", "8", "9", "T", "J", "Q", "K", "A"]);
const J_TRUMP = order(["6", "7", "8", "T", "Q", "K", "A", "9", "J"]);
const J_UNDE = order(["A", "K", "Q", "J", "T", "9", "8", "7", "6"]);
const J_POINTS = {
  trump: { J: 20, 9: 14, A: 11, T: 10, K: 4, Q: 3 },
  plain: { A: 11, T: 10, K: 4, Q: 3, J: 2 },
  obe: { A: 11, T: 10, K: 4, Q: 3, J: 2, 8: 8 },
  unde: { 6: 11, T: 10, K: 4, Q: 3, J: 2, 8: 8 },
};
/** The Swiss count's multipliers: acorns and roses single, shields and bells double, Obenabe three, Undenufe four (in the French pack, black single, red double). */
export function jassMult(c, opts) {
  if (opts.count !== "swiss") return 1;
  if (c.mode === "obe") return 3;
  if (c.mode === "unde") return 4;
  if (opts.pack === "french") return [2, 1, 2, 1][c.suit];   // bells ♦ and roses ♥ red: double
  return [2, 2, 1, 1][c.suit];                               // bells, shields double; roses, acorns single
}
const jPower = (c, id, led) => {
  if (c.mode === "trump" && suitOf(id) === c.suit) return 100 + J_TRUMP(rankOf(id));
  if (suitOf(id) !== led) return -1;
  return c.mode === "unde" ? J_UNDE(rankOf(id)) : J_PLAIN(rankOf(id));
};
/** Weis: a player's runs of three or more in a suit (20, 50, 100, then 50 more a card) and four alike (Unders 200, nines 150, aces, kings, Obers and Banners 100). */
export function weisOf(hand) {
  const out = [];
  for (let s = 0; s < 4; s++) {
    let run = [];
    for (const r of RANKS) {
      if (hand.includes(cid(s, r))) run.push(r);
      if (!hand.includes(cid(s, r)) || r === "A") {
        if (run.length >= 3) out.push({ kind: "run", len: run.length, suit: s, top: RANKS.indexOf(run.at(-1)), value: [0, 0, 0, 20, 50, 100, 150, 200, 250, 300][run.length] });
        run = [];
      }
    }
  }
  for (const [r, v] of [["J", 200], ["9", 150], ["A", 100], ["K", 100], ["Q", 100], ["T", 100]]) {
    if ([0, 1, 2, 3].every(s => hand.includes(cid(s, r)))) out.push({ kind: "four", rank: r, top: RANKS.indexOf(r), value: v });
  }
  return out;
}
/** Which of two Weis is better: the value, then four alike over a run, then the higher card, then a run in trumps. */
function weisBeats(a, b, c) {
  if (a.value !== b.value) return a.value > b.value;
  if (a.kind !== b.kind) return a.kind === "four";
  if (a.top !== b.top) return c.mode === "unde" ? a.top < b.top : a.top > b.top;
  const at = c.mode === "trump" && a.suit === c.suit, bt = c.mode === "trump" && b.suit === c.suit;
  return at && !bt;
}

const jass = {
  id: "jass", name: "Jass", sub: "Schieber", low: "6", ccw: true, teams: "fixed", last: 5,
  defaults: { pack: "swiss", count: "simple", target: 1000, weis: true },
  pack: opts => (opts.pack === "french" ? "french" : "swiss"),

  deal(s, rng) {
    const cards = shuffle(deckFrom("6"), rng);
    s.hands = [0, 1, 2, 3].map(i => cards.slice(i * 9, i * 9 + 9));
    s.forehand = next(s.dealer);
    s.step = "bid";
    s.turn = s.forehand;
    s.pushed = false;
  },
  bids(s, seat) {
    const all = [0, 1, 2, 3].map(suit => ({ t: "trump", mode: "trump", suit })).concat([{ t: "trump", mode: "obe" }, { t: "trump", mode: "unde" }]);
    return s.pushed || seat !== s.forehand ? all : [...all, { t: "push" }];
  },
  bid(s, seat, m) {
    if (m.t === "push") {
      s.pushed = true;
      s.turn = (s.forehand + 2) % 4;
      return { say: `{s${seat}} pushes to {s${s.turn}}.` };
    }
    s.contract = { mode: m.mode, ...(m.mode === "trump" ? { suit: m.suit } : {}), chooser: seat, pushed: s.pushed };
    s.contract.mult = jassMult(s.contract, s.opts);
    // the Weis each player holds, and the Stöck (king and Ober of trumps in one hand)
    s.weis = s.opts.weis ? s.hands.map(h => weisOf(h)) : [[], [], [], []];
    s.stoeck = s.opts.weis && m.mode === "trump" ? s.hands.findIndex(h => h.includes(cid(m.suit, "K")) && h.includes(cid(m.suit, "Q"))) : -1;
    s.step = "play";
    s.leader = s.turn = s.forehand;
    return { say: null };
  },
  legal(s, seat) {
    const hand = s.hands[seat], c = s.contract;
    if (!s.trick.length) return hand;
    const led = suitOf(s.trick[0].card), follow = hand.filter(x => suitOf(x) === led);
    if (c.mode !== "trump") return follow.length ? follow : hand;
    const T = c.suit, trumps = hand.filter(x => suitOf(x) === T);
    if (led === T) return follow.some(x => rankOf(x) !== "J") ? follow : hand;   // the Bauer alone needn't follow
    const best = Math.max(-1, ...s.trick.filter(t => suitOf(t.card) === T).map(t => J_TRUMP(rankOf(t.card))));
    const higher = trumps.filter(x => J_TRUMP(rankOf(x)) > best);
    if (follow.length) return [...follow, ...(best < 0 ? trumps : higher)];
    const plain = hand.filter(x => suitOf(x) !== T);
    const ok = best < 0 ? hand : [...plain, ...higher];
    return ok.length ? ok : hand;                                              // nothing but lower trumps: one of them
  },
  winner(s, trick) {
    const led = suitOf(trick[0].card);
    let best = 0;
    trick.forEach((t, i) => { if (jPower(s.contract, t.card, led) > jPower(s.contract, trick[best].card, led)) best = i; });
    return best;
  },
  points(s, id) {
    const c = s.contract, r = rankOf(id);
    const table = c.mode === "obe" ? J_POINTS.obe : c.mode === "unde" ? J_POINTS.unde : suitOf(id) === c.suit ? J_POINTS.trump : J_POINTS.plain;
    return table[r] || 0;
  },
  /** The first trick's Weis: the best single Weis decides which side scores all its Weis. */
  weisWinner(s) {
    let best = null, by = -1;
    for (let k = 0; k < 4; k++) {
      const seat = (s.forehand + k) % 4;
      for (const w of s.weis[seat] || []) if (!best || weisBeats(w, best, s.contract)) { best = w; by = seat; }
    }
    return by < 0 ? -1 : teamOf(by);
  },
  scoreHand(s) {
    const c = s.contract, mult = c.mult, tricks = [0, 0], pts = [0, 0];
    for (const t of s.tricks) { tricks[teamOf(t.winner)]++; pts[teamOf(t.winner)] += t.pts; }
    const match = tricks.findIndex(n => n === 9);
    if (match >= 0) pts[match] += 100;
    const wt = s.opts.weis ? this.weisWinner(s) : -1;
    const weis = [0, 0];
    if (wt >= 0) for (const seat of [wt, wt + 2]) for (const w of s.weis[seat]) weis[wt] += w.value;
    const stoeck = [0, 0];
    if (s.stoeck >= 0) stoeck[teamOf(s.stoeck)] = 20;
    const delta = [0, 1].map(t => (pts[t] + weis[t] + stoeck[t]) * mult);
    s.scores = s.scores.map((v, t) => v + delta[t]);
    return { pts, weis, stoeck, mult, delta, match, tricks };
  },
  done(s) {
    const top = Math.max(...s.scores);
    if (top < s.opts.target) return null;
    return [s.scores[0] >= s.scores[1] ? 0 : 1];
  },
};

// ======================================================================= Belote
const B_PLAIN = order(["7", "8", "9", "J", "Q", "K", "T", "A"]);
const B_TRUMP = order(["7", "8", "Q", "K", "T", "A", "9", "J"]);
const B_POINTS = { trump: { J: 20, 9: 14, A: 11, T: 10, K: 4, Q: 3 }, plain: { A: 11, T: 10, K: 4, Q: 3, J: 2 } };
const bPower = (T, id, led) => (suitOf(id) === T ? 100 + B_TRUMP(rankOf(id)) : suitOf(id) === led ? B_PLAIN(rankOf(id)) : -1);
/** Belote's play, follow suit; else trump, unless your partner holds the trick; and when trumps are in, beat the best trump if you can. */
function beloteLegal(s, seat) {
  const hand = s.hands[seat], T = s.contract.suit;
  if (!s.trick.length) return hand;
  const led = suitOf(s.trick[0].card), follow = hand.filter(x => suitOf(x) === led);
  const trumps = hand.filter(x => suitOf(x) === T);
  const trumpsIn = s.trick.filter(t => suitOf(t.card) === T).map(t => B_TRUMP(rankOf(t.card)));
  const best = trumpsIn.length ? Math.max(...trumpsIn) : -1;
  const over = trumps.filter(x => B_TRUMP(rankOf(x)) > best);
  if (led === T) return trumps.length ? (over.length ? over : trumps) : hand;
  if (follow.length) return follow;
  // can't follow: the partner holding the trick frees you; else trump, over the best trump if you can
  const lead = belote.winner(s, s.trick), partnerHolds = s.trick[lead].seat === (seat + 2) % 4;
  if (partnerHolds || !trumps.length) return hand;
  return over.length ? over : trumps;
}
const beloteBase = {
  low: "7", ccw: true, teams: "fixed", last: 10,
  pack: () => "french",
  legal: beloteLegal,
  winner(s, trick) {
    const led = suitOf(trick[0].card), T = s.contract.suit;
    let best = 0;
    trick.forEach((t, i) => { if (bPower(T, t.card, led) > bPower(T, trick[best].card, led)) best = i; });
    return best;
  },
  points(s, id) { return (suitOf(id) === s.contract.suit ? B_POINTS.trump : B_POINTS.plain)[rankOf(id)] || 0; },
  /** Belote and rebelote: the king and queen of trumps in one hand, 20 to that side. */
  beloteSeat(s) { return s.dealt.findIndex(h => h.includes(cid(s.contract.suit, "K")) && h.includes(cid(s.contract.suit, "Q"))); },
  done(s) {
    const top = Math.max(...s.scores);
    if (top < s.opts.target) return null;
    return [s.scores[0] >= s.scores[1] ? 0 : 1];
  },
};

const belote = {
  ...beloteBase, id: "belote", name: "Belote", sub: "classic",
  defaults: { target: 1000 },
  deal(s, rng) {
    const cards = shuffle(deckFrom("7"), rng);
    s.hands = [0, 1, 2, 3].map(i => cards.slice(i * 5, i * 5 + 5));
    s.stock = cards.slice(20);
    s.turned = s.stock[0];
    s.round = 1;
    s.step = "bid";
    s.turn = next(s.dealer);
    s.passes = 0;
  },
  bids(s) {
    if (s.round === 1) return [{ t: "take" }, { t: "pass" }];
    return [0, 1, 2, 3].filter(x => x !== suitOf(s.turned)).map(suit => ({ t: "take", suit })).concat([{ t: "pass" }]);
  },
  bid(s, seat, m) {
    if (m.t === "pass") {
      s.passes++;
      if (s.passes < 4) { s.turn = next(seat); return { say: null }; }
      if (s.round === 1) { s.round = 2; s.passes = 0; s.turn = next(s.dealer); return { say: "Nobody takes: a second round, any other suit." }; }
      return { redeal: true, say: "Nobody takes: a new deal." };
    }
    const suit = s.round === 1 ? suitOf(s.turned) : m.suit;
    // the taker has the turned card and two more; the others three each
    const stock = s.stock.slice(1);
    s.hands[seat].push(s.turned);
    for (let k = 1; k <= 4; k++) { const p = (s.dealer + k) % 4; s.hands[p].push(...stock.splice(0, p === seat ? 2 : 3)); }
    delete s.stock;
    s.contract = { suit, taker: seat };
    s.dealt = s.hands.map(h => h.slice());
    s.step = "play";
    s.leader = s.turn = next(s.dealer);
    return { say: null };
  },
  scoreHand(s) {
    const c = s.contract, tricks = [0, 0], pts = [0, 0];
    for (const t of s.tricks) { tricks[teamOf(t.winner)]++; pts[teamOf(t.winner)] += t.pts; }
    const bel = [0, 0], bs = this.beloteSeat(s);
    if (bs >= 0) bel[teamOf(bs)] = 20;
    const att = teamOf(c.taker), def = 1 - att;
    const capot = tricks.findIndex(n => n === 8);
    let delta = [0, 0], made;
    if (capot >= 0) { delta[capot] = 250; made = capot === att; }
    else {
      made = pts[att] + bel[att] > pts[def] + bel[def];
      if (made) delta = [...pts];
      else delta[def] = 162;
    }
    delta = delta.map((v, t) => v + bel[t]);
    s.scores = s.scores.map((v, t) => v + delta[t]);
    return { pts, bel, delta, made, capot, tricks };
  },
};

// ======================================================================= Schafkopf
// The German pack's suits here: 0 bells (Schellen), 1 hearts (Herz), 2 leaves (Gras), 3 acorns (Eichel); among the
// trump Obers and Unters, acorns highest, then leaves, hearts, bells.
const S_SUITRANK = [0, 1, 2, 3];
const S_PLAIN = order(["7", "8", "9", "K", "T", "A"]);
const S_WENZ_PLAIN = order(["7", "8", "9", "Q", "K", "T", "A"]);
const S_POINTS = { A: 11, T: 10, K: 4, Q: 3, J: 2 };
const HERZ = 1;
const sTrump = (c, id) => (c.type === "wenz" ? rankOf(id) === "J" : rankOf(id) === "Q" || rankOf(id) === "J" || suitOf(id) === c.trump);
/** A card's place among the trumps (higher better), or −1. */
function sTrumpPower(c, id) {
  if (!sTrump(c, id)) return -1;
  const r = rankOf(id), s = S_SUITRANK[suitOf(id)];
  if (c.type === "wenz") return 50 + s;
  if (r === "Q") return 60 + s;
  if (r === "J") return 50 + s;
  return S_PLAIN(r);
}
/** What a card counts as when following: "T" for a trump, else its suit. */
const sFollow = (c, id) => (sTrump(c, id) ? "T" : suitOf(id));
/** The trumps from the top a side holds in an unbroken run: the Laufende. */
export function laufende(c, hands, side) {
  const all = deckFrom("7").filter(id => sTrump(c, id)).sort((a, b) => sTrumpPower(c, b) - sTrumpPower(c, a));
  const has = id => side.some(seat => hands[seat].includes(id));
  const first = has(all[0]);
  let n = 0;
  for (const id of all) { if (has(id) !== first) break; n++; }
  return n;
}
const SK_RANK = { sau: 1, wenz: 2, solo: 3 };

const schafkopf = {
  id: "schafkopf", name: "Schafkopf", sub: "Sauspiel, Wenz, Solo", low: "7", ccw: false, teams: "contract", last: 0,
  defaults: { deals: 8, tariff: 10, solo: 50 },
  pack: () => "german",

  deal(s, rng) {
    const cards = shuffle(deckFrom("7"), rng);
    s.hands = [0, 1, 2, 3].map(i => cards.slice(i * 8, i * 8 + 8));
    s.dealt = s.hands.map(h => h.slice());
    s.step = "bid";
    s.turn = next(s.dealer);
    s.said = 0;
    s.call = null;                                       // the highest game said so far: { type, seat }
  },
  /** The aces a hand may call in a Sauspiel: of a suit not trumps (not hearts), whose ace it doesn't hold, and of which it holds a card. */
  callable(hand) {
    return [0, 2, 3].filter(su => !hand.includes(cid(su, "A")) && hand.some(id => suitOf(id) === su && !["Q", "J"].includes(rankOf(id))));
  },
  bids(s, seat) {
    const top = s.call ? SK_RANK[s.call.type] : 0, out = [{ t: "pass" }];
    if (top < 1) for (const ace of this.callable(s.hands[seat])) out.push({ t: "play", type: "sau", ace });
    if (top < 2) out.push({ t: "play", type: "wenz" });
    if (top < 3) for (const suit of [3, 2, 1, 0]) out.push({ t: "play", type: "solo", suit });
    return out;
  },
  bid(s, seat, m) {
    s.said++;
    if (m.t === "play") s.call = { ...m, seat };
    if (s.said < 4) { s.turn = next(seat); return { say: m.t === "pass" ? null : `{s${seat}}: ${m.type === "sau" ? "I'd play" : m.type === "wenz" ? "Wenz" : "Solo"}.` }; }
    if (!s.call) return { redeal: true, say: "All pass: thrown in, a new deal." };
    const k = s.call, c = { type: k.type, declarer: k.seat, trump: k.type === "solo" ? k.suit : k.type === "sau" ? HERZ : -1 };
    if (k.type === "sau") { c.ace = k.ace; c.partner = s.hands.findIndex(h => h.includes(cid(k.ace, "A"))); }
    s.contract = c;
    s.step = "play";
    s.leader = s.turn = next(s.dealer);
    return { say: null };
  },
  legal(s, seat) {
    const hand = s.hands[seat], c = s.contract;
    const ace = c.type === "sau" ? cid(c.ace, "A") : -1, holdsAce = hand.includes(ace);
    const suitOfAce = c.type === "sau" ? c.ace : -1;
    if (!s.trick.length) {
      // the partner may not run from the called suit (lead another card of it) unless holding four or more of it
      if (holdsAce) {
        const ofSuit = hand.filter(id => sFollow(c, id) === suitOfAce);
        if (ofSuit.length < 4) return hand.filter(id => sFollow(c, id) !== suitOfAce || id === ace);
      }
      return hand;
    }
    const led = sFollow(c, s.trick[0].card), follow = hand.filter(id => sFollow(c, id) === led);
    if (follow.length) {
      if (holdsAce && led === suitOfAce) return [ace];                      // the called suit led: its ace must come
      return follow;
    }
    // free to play anything, but the called ace isn't thrown away before the last trick
    if (holdsAce && hand.length > 1) return hand.filter(id => id !== ace);
    return hand;
  },
  winner(s, trick) {
    const c = s.contract, led = sFollow(c, trick[0].card);
    const power = id => {
      const t = sTrumpPower(c, id);
      if (t >= 0) return 100 + t;
      return suitOf(id) === led ? (c.type === "wenz" ? S_WENZ_PLAIN(rankOf(id)) : S_PLAIN(rankOf(id))) : -1;
    };
    let best = 0;
    trick.forEach((t, i) => { if (power(t.card) > power(trick[best].card)) best = i; });
    return best;
  },
  points(s, id) { return S_POINTS[rankOf(id)] || 0; },
  side(s) { const c = s.contract; return c.type === "sau" ? [c.declarer, c.partner] : [c.declarer]; },
  scoreHand(s) {
    const c = s.contract, side = this.side(s), pts = [0, 0], tricks = [0, 0];
    for (const t of s.tricks) { const k = side.includes(t.winner) ? 0 : 1; pts[k] += t.pts; tricks[k]++; }
    // Schneider: the players under 31 when they lose, the others under 30 when the players win (91 makes it: 90 doesn't)
    const won = pts[0] >= 61;
    const schneider = won ? pts[1] < 30 : pts[0] < 31, schwarz = won ? tricks[1] === 0 : tricks[0] === 0;
    const base = c.type === "sau" ? s.opts.tariff : s.opts.solo;
    const lauf = laufende(c, s.dealt, side), counted = lauf >= (c.type === "wenz" ? 2 : 3) ? lauf : 0;
    const amount = base + (schneider ? s.opts.tariff : 0) + (schwarz ? s.opts.tariff : 0) + counted * s.opts.tariff;
    const delta = [0, 0, 0, 0];
    for (let seat = 0; seat < 4; seat++) {
      const mine = side.includes(seat);
      if (c.type === "sau") delta[seat] = (mine === won ? 1 : -1) * amount;
      else delta[seat] = mine ? (won ? 3 : -3) * amount : (won ? -1 : 1) * amount;
    }
    s.scores = s.scores.map((v, i) => v + delta[i]);
    return { pts, tricks, won, schneider, schwarz, laufende: counted, amount, delta, side };
  },
  done(s) {
    if (s.handNo < s.opts.deals) return null;
    const top = Math.max(...s.scores);
    return s.scores.map((v, i) => (v === top ? i : -1)).filter(i => i >= 0);
  },
};

export const GAMES = { jass, belote, schafkopf };

/**
 * A hand sorted as a player holds it: by suit, the trumps together on the right, each suit rising to the right, by the
 * contract once there is one. Schafkopf's before its game is called sorts as for the usual game, a Sauspiel: the
 * Farben (the plain suits), then hearts, then the Unters and the Obers, as a player sorts it to see what to play.
 */
export function sortHand(s, hand) {
  const g = GAMES[s.game], c = s.contract || (s.game === "schafkopf" ? { type: "sau", trump: HERZ } : null);
  const key = id => {
    let su = suitOf(id), hi;
    if (c) {
      // a card's strength: how many of the hand's others it beats, led against each
      const t = { ...s, contract: c, trick: [] };
      hi = 0;
      for (const o of hand) if (o !== id && g.winner(t, [{ seat: 0, card: id }, { seat: 1, card: o }]) === 0) hi++;
      if ((s.game === "schafkopf" && sTrump(c, id)) || (s.game === "jass" && c.mode === "trump" && su === c.suit) || (s.game === "belote" && su === c.suit)) su = 9;
    } else hi = RANKS.indexOf(rankOf(id));
    return su * 100 + hi;
  };
  return [...hand].sort((a, b) => key(a) - key(b));
}
export { teamOf, sTrump, sTrumpPower, sFollow };
