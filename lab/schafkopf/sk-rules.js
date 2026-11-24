// Schafkopf for the general Monte (Fable, 24 Nov 2026 18:50Z): Codex's own rules (codex/, a copy checked against Crates by
// tests/schafkopf-copy.mjs), driven one deal at a time, bidding included, as the lab's rules engine. The table's pacing
// (every seat tapping "seen" after a trick, the clock before the next) is answered here, so a game is only the decisions:
// bid, then cards. The payoff is the deal's delta per seat in tariffs (÷ the Sauspiel tariff); a deal all pass is thrown in
// and pays nothing. A seat's view (view) holds only what that seat may know: whitelisted, so nothing hidden leaks by default.
import { rules as codex } from "./codex/trumps-rules.js";
import { GAMES } from "./codex/trumps-games.js";
import { cid } from "./codex/trumps-cards.js";
import { mix } from "../../seats.js";

const S = GAMES.schafkopf, SEATS = [0, 1, 2, 3], NOW = 0;
export const CARDS = 32;

/** A fresh deal: dealer from the rng, the hands dealt by Codex. */
export function deal({ rng, dealer = null }) {
  const s = codex.deal({ options: { game: "schafkopf", deals: 1 }, rng });
  if (dealer != null && dealer !== s.dealer) { s.dealer = dealer; s.turn = (dealer + 1) % 4; }
  return s;
}

export const over = s => s.step === "over" || s.step === "scored" || !!s.thrown;
export const toMove = s => (over(s) ? null : codex.toMove(s));

/** Every legal decision for the seat to move: a bid (Codex's bids) or a card ({ t: "card", card }). */
export function options(s, seat) {
  if (s.step === "bid") return S.bids(s, seat);
  if (s.step === "play") return S.legal(s, seat).map(card => ({ t: "card", card }));
  return [];
}

/** Makes the move in place (Codex's act mutates the state it's given); returns the state, or why not as a string. */
export function act(s, seat, m, rng) {
  const bids = s.step === "bid" ? s.bidlog.length : -1;
  const r = codex.act(s, seat, m, { rng, now: NOW });
  if (typeof r === "string") return r;
  (s.log ||= []).push([seat, m]);                     // the deal's decisions, for the dealer's replay check
  // all passed: Codex throws the deal in and deals again (its bid log starts over); here the deal ends, paying nothing
  if (bids === 3 && !s.contract) { s.thrown = true; return s; }
  if (s.step === "trick") {
    for (const k of SEATS) codex.act(s, k, { t: "seen" }, { rng, now: NOW });   // the last tap wakes it: next trick, or scored
  }
  return s;
}

/** What the deal pays each seat, in tariffs (zero-sum). */
export function payoff(s) {
  if (s.thrown || !s.result) return [0, 0, 0, 0];
  return s.result.delta.map(d => d / s.opts.tariff);
}
/** The largest a deal can pay one seat, in tariffs (Fable 18:50Z: the value targets are scaled by this fixed constant): a
 *  Solo's declarer (5), Schneider and schwarz (1 each), all fourteen trumps running (1 each), from each of the other three. */
export const MAX_PAYOFF = 3 * (5 + 1 + 1 + 14);

/** Whether the seat knows who the partner is: it is the partner, or the called ace has been played. */
function partnerKnown(s, seat) {
  const c = s.contract;
  if (!c || c.type !== "sau") return true;
  if (c.partner === seat) return true;
  const ace = cid(c.ace, "A");
  return s.tricks.some(t => t.cards.some(x => x.card === ace)) || s.trick.some(x => x.card === ace);
}

/** A seat's view: its own hand, the others' hand sizes, the bidding, the contract (the partner only once it knows it), the
 *  tricks and the trick on the table. Two deals that differ only in cards the seat can't see give the same view. */
export function view(s, seat) {
  const c = s.contract;
  return {
    seat, dealer: s.dealer, step: over(s) ? "over" : s.step, turn: toMove(s),
    hand: s.hands[seat].slice().sort((a, b) => a - b),
    sizes: s.hands.map(h => h.length),
    bids: s.bidlog.map(b => ({ ...b })),
    contract: c ? { type: c.type, declarer: c.declarer, trump: c.trump, ...(c.type === "sau" ? { ace: c.ace, partner: partnerKnown(s, seat) ? c.partner : null } : {}) } : null,
    tricks: s.tricks.map(t => ({ cards: t.cards.map(x => ({ ...x })), winner: t.winner, pts: t.pts })),
    trick: s.trick.map(x => ({ ...x })),
    ...(over(s) ? { payoff: payoff(s) } : {}),
  };
}

export const fork = s => structuredClone(s);

/** The deal as it started with these hands: the same dealer and table, no decision made. */
function startOf(s, hands) {
  const w = codex.deal({ options: { game: "schafkopf", deals: 1 }, rng: () => 0 });
  w.dealer = s.dealer; w.turn = (s.dealer + 1) % 4;
  w.hands = hands.map(h => h.slice()); w.dealt = hands.map(h => h.slice());
  return w;
}
/** The deal replayed from these starting hands, or null if any decision made so far is illegal in it. */
export function replay(s, hands) {
  const w = startOf(s, hands);
  for (const [who, m] of s.log || []) if (toMove(w) !== who || typeof act(w, who, m, () => 0) === "string") return null;
  return w;
}
/** The cards each seat started with that the seat can see: its own, and every card played. */
function seenStart(s, seat) {
  const known = [0, 1, 2, 3].map(p => (p === seat ? s.dealt[seat].slice() : []));
  for (const t of [...s.tricks.map(t => t.cards), s.trick]) for (const c of t) if (c.seat !== seat) known[c.seat].push(c.card);
  return known;
}
/**
 * A world the seat can't tell from the real deal (Fable 18:50Z: a world is valid if and only if replaying the seen history in
 * it is legal under the rules; never patched): the cards it hasn't seen dealt at random to the others, as many as each holds,
 * kept only if the deal replays. Plain rejection; `tries` and how many it took are counted for the lab (DEALS).
 */
export const DEALS = { worlds: 0, tries: 0, failed: 0 };
export function determinize(s, seat, rng, tries = 20000) {
  const known = seenStart(s, seat), mine = new Set(known.flat());
  const pool = s.dealt.flat().filter(id => !mine.has(id)), need = [0, 1, 2, 3].map(p => (p === seat ? 0 : s.hands[p].length));
  DEALS.worlds++;
  for (let t = 0; t < tries; t++) {
    DEALS.tries++;
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    let at = 0;
    const hands = known.map((h, p) => h.concat(pool.slice(at, (at += need[p]))));
    const w = replay(s, hands);
    if (w) return w;
  }
  DEALS.failed++;
  throw new Error(`schafkopf: no world found in ${tries} deals (the real one would leak what the seat can't see)`);
}
/** A seed from what the seat can see: one position, one search. */
export function seedOf(s, seat) {
  const t = JSON.stringify(view(s, seat));
  let h = 0x9e3779b9;
  for (let i = 0; i < t.length; i++) h = mix(h, t.charCodeAt(i));
  return h >>> 0;
}

/** The rules engine as the general Monte takes it. */
export const schafkopf = { id: "schafkopf", seats: 4, deal, toMove, options, act, over, payoff, view, fork, determinize, seedOf, replay, MAX_PAYOFF, CARDS };

/** Codex's own computer player for a seat (Easy, Medium, Hard): the opponent to measure against, never a teacher. */
export const codexMove = (s, seat, level, rng) => codex.bot(s, seat, { level, rng });
