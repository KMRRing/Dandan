// Trumps on seats.js: four at a table, a hand dealt, bid (or the trumps chosen), played a trick at a time and scored,
// then the next, until a side reaches the game's target (or, in Schafkopf, the deals agreed are played). The games'
// own rules are trumps-games.js's; the computer players' trumps-bot.js's.
import { GAMES, teamOf } from "./trumps-games.js";
import { botMove } from "./trumps-bot.js";
import { unlikeHard, leadsKept } from "./trumps-think.js";

export const TRICK_MS = 1150;          // a trick taken stays on the table this long
export const HAND_MS = 3400;           // a hand's score, shown before the next deal
const next = s => (s + 1) % 4;
const same = (a, b) => Object.keys({ ...a, ...b }).every(k => a[k] === b[k]);
const gameOf = s => GAMES[s.game];
// 12 Nov 2026, Korbi (Schafkopf): "cards shouldn't be taken off the table until all the players have approved": a trick taken stays
// until every seat has seen it (`seen`), the computer players at once (toMoveAll), each person with a tap ({ t: "seen" }, in any order)
const shown = s => s.step === "trick" && s.game === "schafkopf";
const SEATS = [0, 1, 2, 3];

function newHand(s, rng) {
  const g = gameOf(s);
  s.handNo++;
  s.trick = [];
  s.tricks = [];
  s.bidlog = [];
  delete s.contract; delete s.until;
  for (const k of ["weis", "stoeck", "turned", "stock", "round", "passes", "auction", "call", "said", "dealt", "forehand", "pushed"]) delete s[k];
  g.deal(s, rng);
}

export const rules = {
  id: "trumps",
  seats: { min: 4, max: 4 },

  deal({ options = {}, rng }) {
    const g = GAMES[options.game] || GAMES.jass;
    const s = { seats: 4, game: g.id, opts: { ...g.defaults, ...options, game: g.id }, dealer: Math.floor(rng() * 4), handNo: 0,
      scores: g.teams === "fixed" ? [0, 0] : [0, 0, 0, 0], history: [] };
    newHand(s, rng);
    s.say = `${g.name}${g.sub ? ` (${g.sub})` : ""}: {s${s.dealer}} deals.`;
    return s;
  },

  toMove: s => (s.step === "bid" || s.step === "play" ? s.turn : shown(s) ? SEATS.find(k => !s.seen?.[k]) ?? null : null),
  toMoveAll: s => (shown(s) ? SEATS.filter(k => !s.seen?.[k]) : []),
  anytime: m => m?.t === "seen",

  act(s, seat, m, { rng, now }) {
    const g = gameOf(s);
    if (m?.t === "seen") {
      if (!shown(s)) return "Not now";
      s.seen ||= SEATS.map(() => false);                        // (a trick left on the table before the wait, by its clock)
      if (s.seen[seat]) return "Waiting for the others";
      s.seen[seat] = true;
      return s.seen.every(Boolean) ? rules.wake(s, { rng, now }) : s;
    }
    if (rules.toMove(s) !== seat) return "It isn't your turn";
    if (s.step === "bid") {
      if (!m || !g.bids(s, seat).some(b => same(b, m))) return "That can't be bid now";
      s.bidlog.push({ seat, ...m });
      const r = g.bid(s, seat, m);
      if (r.say) s.say = r.say;
      if (r.redeal) {
        s.dealer = next(s.dealer);
        s.handNo--;                                    // a hand thrown in isn't counted
        newHand(s, rng);
        s.say = r.say;
      }
      return s;
    }
    if (s.step !== "play") return "Wait for the table";
    if (!m || m.t !== "card" || !g.legal(s, seat).includes(m.card)) return "That card can't be played now";
    s.hands[seat] = s.hands[seat].filter(c => c !== m.card);
    s.trick.push({ seat, card: m.card });
    delete s.say;
    if (s.trick.length < 4) { s.turn = next(seat); return s; }
    const w = s.trick[g.winner(s, s.trick)].seat, last = s.hands.every(h => !h.length);
    const pts = s.trick.reduce((a, t) => a + g.points(s, t.card), 0) + (last ? g.last : 0);
    s.tricks.push({ cards: s.trick.slice(), winner: w, pts });
    s.step = "trick";
    s.turn = w;
    if (s.game === "schafkopf") s.seen = SEATS.map(() => false);
    else s.until = now + TRICK_MS;
    return s;
  },

  bot: (s, seat, { level, rng }) => (shown(s) ? { t: "seen" } : botMove(s, seat, level, rng)),
  over: s => s.step === "over",
  wakeAt: s => (s.step === "trick" || s.step === "scored" ? s.until : null),

  wake(s, { rng, now }) {
    const g = gameOf(s);
    if (s.step === "trick") {
      delete s.seen;
      if (s.hands.some(h => h.length)) {
        s.trick = [];
        s.leader = s.turn;
        s.step = "play";
        delete s.until;
        return s;
      }
      const r = g.scoreHand(s);
      s.result = r;
      s.history.push(g.teams === "fixed" ? r.delta : r.delta.slice());
      // every card shown: who bid otherwise than Hard would have, and how each kept the leads' conventions, for the
      // computer players to read the rest of the game by (trumps-think.js)
      if (s.game === "schafkopf") {
        const u = unlikeHard(s), k = leadsKept(s);
        s.unlike = [0, 1, 2, 3].map(p => (s.unlike?.[p] || 0) + u[p]);
        s.signals = [0, 1, 2, 3].flatMap(p => k[p].map((n, i) => (s.signals?.[4 * p + i] || 0) + n));
      }
      s.step = "scored";
      s.until = now + HAND_MS;
      s.say = summary(s, r);
      return s;
    }
    if (s.step === "scored") {
      const done = g.done(s);
      if (done) {
        s.step = "over";
        s.winners = g.teams === "fixed" ? [done[0], done[0] + 2] : done;
        s.say = g.teams === "fixed" ? `{s${done[0]}} and {s${done[0] + 2}} win, ${s.scores[done[0]]} to ${s.scores[1 - done[0]]}.`
          : `${s.winners.map(w => `{s${w}}`).join(" and ")} ${s.winners.length > 1 ? "win" : "wins"}.`;
        delete s.until;
        return s;
      }
      s.dealer = next(s.dealer);
      newHand(s, rng);
      s.say = `{s${s.dealer}} deals.`;
      return s;
    }
    return null;
  },

  restore(s) {
    const list = v => (v ? Object.values(v) : []);
    s.hands = [0, 1, 2, 3].map(i => list(s.hands?.[i]));
    s.trick = list(s.trick);
    s.tricks = list(s.tricks).map(t => ({ ...t, cards: list(t.cards) }));
    s.bidlog = list(s.bidlog);
    s.history = list(s.history).map(list);
    s.scores = Array.from({ length: gameOf(s).teams === "fixed" ? 2 : 4 }, (_, i) => s.scores?.[i] || 0);
    if (s.dealt) s.dealt = [0, 1, 2, 3].map(i => list(s.dealt[i]));
    if (s.weis) s.weis = [0, 1, 2, 3].map(i => list(s.weis[i]));
    if (s.stock) s.stock = list(s.stock);
    if (s.winners) s.winners = list(s.winners);
    if (s.seen) s.seen = SEATS.map(k => !!s.seen[k]);
    if (s.result) for (const k of ["pts", "weis", "stoeck", "delta", "tricks", "bel", "side"]) if (s.result[k] !== undefined) s.result[k] = list(s.result[k]).map(x => x ?? 0);
    return s;
  },
};

/** A hand's score in a line. */
function summary(s, r) {
  if (s.game === "schafkopf") {
    const c = s.contract, who = c.type === "sau" ? `{s${c.declarer}} and {s${c.partner}}` : `{s${c.declarer}}`;
    return `${who} ${r.won ? (c.type === "sau" ? "win" : "wins") : (c.type === "sau" ? "lose" : "loses")} with ${r.pts[0]}${r.schwarz ? ", schwarz" : r.schneider ? ", Schneider" : ""}${r.laufende ? `, ${r.laufende} Laufende` : ""}.`;
  }
  const us = `{s0} and {s2}`, them = `{s1} and {s3}`;
  if (s.game === "jass") return `${us} ${r.delta[0]}, ${them} ${r.delta[1]}${r.match >= 0 ? ": a match!" : "."}`;
  const att = teamOf(s.contract.taker);
  return `${att === 0 ? us : them} ${r.made ? "made it" : "went down"}: ${us} ${r.delta[0]}, ${them} ${r.delta[1]}.`;
}
