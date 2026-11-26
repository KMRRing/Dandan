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

/** A deal from given starting hands and dealer (the GPU engine's records, gpu/sk_play_t.py), no decision made. */
export function dealWith(hands, dealer) { return startOf({ dealer }, hands); }
/** The deal as it started with these hands: the same dealer and table, no decision made. */
function startOf(s, hands) {
  const w = codex.deal({ options: { game: "schafkopf", deals: 1 }, rng: () => 0 });
  w.dealer = s.dealer; w.turn = (s.dealer + 1) % 4;
  w.hands = hands.map(h => h.slice()); w.dealt = hands.map(h => h.slice());
  return w;
}
/** How many of the deal's decisions so far replay legally from these starting hands, and the replayed deal when all do. */
function replayed(s, hands) {
  const w = startOf(s, hands), log = s.log || [];
  for (let k = 0; k < log.length; k++) { const [who, m] = log[k]; if (toMove(w) !== who || typeof act(w, who, m, () => 0) === "string") return { depth: k, w: null }; }
  return { depth: log.length, w };
}
/** The deal replayed from these starting hands, or null if any decision made so far is illegal in it. */
export const replay = (s, hands) => replayed(s, hands).w;
/** The deal replayed from these starting hands with `each(state, who, move)` called before every decision is made (the belief's
 *  weights read the position each seat chose in); the replayed deal, or null if a decision is illegal there. */
export function replayWith(s, hands, each) {
  const w = startOf(s, hands);
  for (const [who, m] of s.log || []) { if (toMove(w) !== who) return null; each(w, who, m); if (typeof act(w, who, m, () => 0) === "string") return null; }
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
export const DEALS = { worlds: 0, tries: 0, failed: 0, walks: 0, walkTried: 0, walkKept: 0 };
/** The dealer's counts in a line, for each shard's output (Fable 21:48Z: how many positions needed the walk, its acceptance). */
export const dealsLine = () => `worlds ${DEALS.worlds}, ${(DEALS.tries / Math.max(1, DEALS.worlds - DEALS.walks)).toFixed(1)} deals a world; walk: ${DEALS.failed} positions, ${DEALS.walks} worlds, acceptance ${DEALS.walkTried ? (100 * DEALS.walkKept / DEALS.walkTried).toFixed(1) : "-"}%`;
// the positions where plain rejection found no world, by state, seat and decision (a state is played on in place, so the
// decision count tells its positions apart): the rest of their deals come from the walk below
const WALKS = new WeakMap(), walkKey = (s, seat) => `${seat}:${(s.log || []).length}`;
export function determinize(s, seat, rng, tries = 20000) {
  const known = seenStart(s, seat), mine = new Set(known.flat());
  const pool = s.dealt.flat().filter(id => !mine.has(id)), need = [0, 1, 2, 3].map(p => (p === seat ? 0 : s.hands[p].length));
  const handsOf = cards => { let at = 0; return known.map((h, p) => h.concat(cards.slice(at, (at += need[p])))); };
  DEALS.worlds++;
  const walk = WALKS.get(s)?.get(walkKey(s, seat));
  if (walk) return walkOn(s, walk, need, handsOf, rng);
  for (let t = 0; t < tries; t++) {
    DEALS.tries++;
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const w = replay(s, handsOf(pool));
    if (w) return w;
  }
  // a position that tightly constrained (27 Nov 2026, ska-self: about 1 shard in 100 met one, Fable 18:50Z: a faster sampler
  // is fine if every world it emits passes the replay check): a random walk over the possible worlds. A step swaps two unseen
  // cards between two other seats and is kept only if the deal still replays: the proposal is symmetric and the target flat, so
  // the walk visits every world it can reach equally often, as rejection would. Its start is searched for from a random deal
  // (swaps kept while they replay at least as far), never taken from the real deal; then it walks a while before its first world
  DEALS.failed++;
  const cards = pool.slice();
  let depth = replayed(s, handsOf(cards)).depth;
  const full = (s.log || []).length;
  for (let t = 0; depth < full; t++) {
    if (t > 400000) throw new Error(`schafkopf: no world found by rejection or the walk (the real one would leak what the seat can't see)`);
    const [i, j] = swapIn(need, rng);
    [cards[i], cards[j]] = [cards[j], cards[i]];
    const d = replayed(s, handsOf(cards)).depth;
    if (d >= depth) depth = d; else [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  const w = { cards };
  (WALKS.get(s) || WALKS.set(s, new Map()).get(s)).set(walkKey(s, seat), w);
  for (let k = 0; k < 200; k++) walkStep(s, w, need, handsOf, rng);
  return walkOn(s, w, need, handsOf, rng);
}
/** Two places in the unseen cards that belong to different seats, or null-like [0, 0] when no two do. */
function swapIn(need, rng) {
  const n = need.reduce((a, b) => a + b, 0), seatAt = [];
  need.forEach((k, p) => { for (let x = 0; x < k; x++) seatAt.push(p); });
  for (let t = 0; t < 50; t++) { const i = Math.floor(rng() * n), j = Math.floor(rng() * n); if (seatAt[i] !== seatAt[j]) return [i, j]; }
  return [0, 0];
}
function walkStep(s, w, need, handsOf, rng) {
  const [i, j] = swapIn(need, rng), c = w.cards;
  [c[i], c[j]] = [c[j], c[i]];
  DEALS.walkTried++;
  if (replay(s, handsOf(c))) { DEALS.walkKept++; return true; }
  [c[i], c[j]] = [c[j], c[i]];
  return false;
}
/** The walk's next world: taken only after as many kept swaps as there are unseen cards (Fable 21:48Z: successive worlds of one
 *  walk are correlated), or after 200 tries a kept swap, whichever first (a walk that hardly moves is reported, not hidden). */
function walkOn(s, w, need, handsOf, rng) {
  DEALS.walks++;
  const n = w.cards.length;
  for (let kept = 0, t = 0; kept < n && t < 200 * n; t++) if (walkStep(s, w, need, handsOf, rng)) kept++;
  return replay(s, handsOf(w.cards));
}
/** A seed from what the seat can see: one position, one search. */
export function seedOf(s, seat) {
  const t = JSON.stringify(view(s, seat));
  let h = 0x9e3779b9;
  for (let i = 0; i < t.length; i++) h = mix(h, t.charCodeAt(i));
  return h >>> 0;
}

/** The rules engine as the general Monte takes it. */
export const schafkopf = { id: "schafkopf", seats: 4, deal, dealWith, toMove, options, act, over, payoff, view, fork, determinize, seedOf, replay, MAX_PAYOFF, CARDS };

/** Codex's own computer player for a seat (Easy, Medium, Hard): the opponent to measure against, never a teacher. */
export const codexMove = (s, seat, level, rng) => codex.bot(s, seat, { level, rng });
