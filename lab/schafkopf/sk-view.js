// Schafkopf's views for the nets (Fable, 24 Nov 2026 17:50Z and 18:50Z), every seat named relative to the one viewing (0 itself,
// 1 the next to play after it, ...), built from a seat's view (sk-rules.js view) alone, so they can't hold what the seat can't see.
//  raw: what the nets get without it counting as auxiliary: the own hand, the bidding, the contract and who declared, the seat to
//    act, the trick on the table, and the play history in order (which trick each card fell in, and who played it).
//  aux inputs (the bundle tested against raw, 17:50Z (a)-(d)): (a) per seat and suit, trump its own, proven void by a failure to
//    follow; (b) unseen cards per suit and trumps; (c) card points taken per seat and points still out; (d) whether the partner is
//    known yet, and who.
//  aux targets (the output bundle, (e)-(g)), from the deal's end: (e) the acting seat's side's card points; (f) who held each card
//    the seat can't see (the dealer's target too); (g) who wins the trick on the table.
import { sFollow, GAMES } from "./codex/trumps-games.js";
import { cid } from "./codex/trumps-cards.js";

const C = 32;
const BIDS = ["pass", "sau0", "sau2", "sau3", "wenz", "solo0", "solo1", "solo2", "solo3"];
export const bidKey = b => (b.t === "pass" ? "pass" : b.type === "sau" ? `sau${b.ace}` : b.type === "wenz" ? "wenz" : `solo${b.suit}`);
/** Codex's card ids (suit × 9 + rank, the ranks from the 7) as 0..31, and back. */
export const id0 = id => id - 1 - Math.floor((id - 1) / 9);
export const idOf = k => k + 1 + Math.floor(k / 8);
/** The policy's moves: 32 cards then the 9 bids. */
export const ACTIONS = C + BIDS.length;
export const actionOf = m => (m.t === "card" ? id0(m.card) : C + BIDS.indexOf(bidKey(m)));

const RAW = { hand: C, history: C * (8 + 4), trick: 4 * C, leader: 4, toAct: 4, bids: 4 * (BIDS.length + 1), type: 3, trump: 4, ace: 3, declarer: 4, dealer: 4, phase: 2 };
const AUX = { void: 4 * 5, unseen: 5, taken: 4, out: 1, known: 1, partner: 4 };
const size = o => Object.values(o).reduce((a, b) => a + b, 0);
export const RAW_SIZE = size(RAW), AUX_SIZE = size(AUX);
/** The aux targets' sizes: (e) one number, (f) a holder (relative seat) per card, (g) the trick's winner. */
export const TARGETS = { points: 1, holder: C, winner: 1 };

const played = v => [...v.tricks.map(t => t.cards), v.trick];
/** The contract as the rules read it, from the view's (the partner's identity isn't needed to rank or follow). */
const ruleC = c => c && { type: c.type, trump: c.trump, ace: c.ace, declarer: c.declarer };
/** What a card is followed as, by the rules: 0..3 its Farbe (suit), 4 trump. */
const followOf = (c, id) => { const k = sFollow(c, id); return k === "T" ? 4 : k; };

export function rawView(v, x = new Float32Array(RAW_SIZE)) {
  const rel = p => (p - v.seat + 4) % 4;
  let o = 0;
  const at = i => { x[o + i] = 1; }, next = part => { o += RAW[part]; };
  for (const id of v.hand) at(id0(id)); next("hand");
  played(v).forEach((t, k) => { for (const c of t) { at(id0(c.card) * 12 + k); at(id0(c.card) * 12 + 8 + rel(c.seat)); } }); next("history");
  v.trick.forEach((c, i) => at(i * C + id0(c.card))); next("trick");
  if (v.trick.length) at(rel(v.trick[0].seat)); next("leader");
  if (v.turn != null) at(rel(v.turn)); next("toAct");
  const said = [null, null, null, null];
  for (const b of v.bids) said[rel(b.seat)] = BIDS.indexOf(bidKey(b));
  said.forEach((k, r) => at(r * (BIDS.length + 1) + (k == null ? BIDS.length : k))); next("bids");
  const c = v.contract;
  if (c) at(["sau", "wenz", "solo"].indexOf(c.type)); next("type");
  if (c && c.trump >= 0) at(c.trump); next("trump");
  if (c && c.type === "sau") at([0, 2, 3].indexOf(c.ace)); next("ace");
  if (c) at(rel(c.declarer)); next("declarer");
  at(rel(v.dealer)); next("dealer");
  at(v.step === "bid" ? 0 : 1); next("phase");
  return x;
}

/** The aux input bundle, (a)-(d), derived by the rules from the view alone. */
export function auxView(v, x = new Float32Array(AUX_SIZE)) {
  const rel = p => (p - v.seat + 4) % 4, c = ruleC(v.contract);
  let o = 0;
  const next = part => { o += AUX[part]; };
  if (c) {
    // (a) a seat that played otherwise than the suit led holds none of it
    for (const t of played(v)) { const led = followOf(c, t[0]?.card); for (const k of t.slice(1)) if (followOf(c, k.card) !== led) x[o + rel(k.seat) * 5 + led] = 1; }
  }
  next("void");
  if (c) {
    // (b) the cards the seat hasn't seen, by suit (trump its own)
    const seen = new Set([...v.hand, ...played(v).flat().map(k => k.card)]);
    for (let k = 0; k < C; k++) { const id = idOf(k); if (!seen.has(id)) x[o + followOf(c, id)] += 1 / 8; }
  }
  next("unseen");
  // (c) card points taken per seat, and still out (of 120)
  let taken = 0;
  for (const t of v.tricks) { x[o + rel(t.winner)] += t.pts / 120; taken += t.pts; }
  next("taken");
  x[o] = (120 - taken) / 120; next("out");
  // (d) the partner known, and who
  const p = v.contract?.type === "sau" ? v.contract.partner : null;
  x[o] = p != null ? 1 : 0; next("known");
  if (p != null) x[o + rel(p)] = 1; next("partner");
  return x;
}

/** The aux targets for the seat at this position, from the deal's end (`end`, the full final state) and the position's view:
 *  (e) its side's card points /120, (f) each card's holder (relative seat) where the seat can't see it, else -1, (g) who wins the
 *  trick on the table (relative seat), -1 when no trick is open. */
export function auxTargets(v, end) {
  const rel = p => (p - v.seat + 4) % 4, c = end.contract;
  let pts = 0;
  if (c) { const side = c.type === "sau" ? [c.declarer, c.partner] : [c.declarer], mine = side.includes(v.seat); for (const t of end.tricks) if (side.includes(t.winner) === mine) pts += t.pts; }
  const seen = new Set([...v.hand, ...played(v).flat().map(k => k.card)]), holder = new Int8Array(C).fill(-1);
  end.dealt.forEach((h, p) => { for (const id of h) if (!seen.has(id)) holder[id0(id)] = rel(p); });
  let winner = -1;
  if (v.trick.length) { const t = end.tricks[v.tricks.length]; if (t) winner = rel(t.winner); }
  return { points: pts / 120, holder, winner };
}

// ---------------------------------------------------------------- the partner (Fable 25 Nov 2026 16:20Z, step 1; Korbi 16:01 local:
// "your view of who the partner is and your knowledge of what your opponents know is integral"). Exact facts, derived by the rules:
// each card a seat played is replayed through Codex's legal() as if that seat had also held the called ace; a play that would
// then have been illegal shows the seat never held it. Relative seats as everywhere here.
//   public mask (4): who can still be the partner on the public record alone (what any seat, or an onlooker, can know)
//   own mask (4): the same from the seat's own view (its hand settles whether it is the partner itself)
//   public (1): the partner is known to every seat (the ace fell, or one seat is left)
//   declarer after me (1), declarer last (1): where the seat sits in the open trick relative to the declarer
export const PART_SIZE = 11;
const SK = GAMES.schafkopf;

/** Which absolute seats can be the partner on the public record of `v` (the declarer never), and who, once the ace has fallen. */
export function publicPartner(v) {
  const c = ruleC(v.contract);
  if (!c || c.type !== "sau") return null;
  const ace = cid(c.ace, "A"), can = [0, 1, 2, 3].map(p => p !== c.declarer), all = played(v).flat();
  const ofCalled = id => id !== ace && followOf(c, id) === c.ace;
  for (const t of played(v)) {
    for (let i = 0; i < t.length; i++) {
      const { seat: p, card: x } = t[i];
      if (x === ace) return { can: can.map((_, q) => q === p), fell: true };
      if (!can[p]) continue;
      const trick = t.slice(0, i), ok = hand => { const hands = []; hands[p] = hand; return SK.legal({ contract: c, hands, trick }, p).includes(x); };
      // a lead from the called suit is the partner's only when it holds four of it (running away): give it up to two more of the
      // called suit that it may have held then (not played before this, nor by another seat)
      const spare = () => {
        const before = new Set(all.slice(0, all.findIndex(k => k.card === x)).map(k => k.card));
        return [...Array(C).keys()].map(idOf).filter(id => ofCalled(id) && id !== x && !before.has(id) && !all.some(k => k.card === id && k.seat !== p)).slice(0, 2);
      };
      if (!ok([x, ace]) && !(ofCalled(x) && !trick.length && ok([x, ace, ...spare()]))) can[p] = false;
    }
  }
  return { can, fell: false };
}

export function partnerView(v, x = new Float32Array(PART_SIZE)) {
  const rel = p => (p - v.seat + 4) % 4, c = v.contract;
  if (!c || v.step === "bid") return x;
  const pub = publicPartner(v);
  if (pub) {
    const own = pub.fell ? pub.can : v.hand.includes(cid(c.ace, "A")) ? [0, 1, 2, 3].map(p => p === v.seat) : pub.can.map((k, p) => k && p !== v.seat);
    pub.can.forEach((k, p) => { if (k) x[rel(p)] = 1; });
    own.forEach((k, p) => { if (k) x[4 + rel(p)] = 1; });
    x[8] = pub.can.filter(Boolean).length === 1 ? 1 : 0;
  }
  const d = rel(c.declarer), after = 3 - v.trick.length;
  if (d >= 1 && d <= after) x[9] = 1;
  if (d >= 1 && d === after) x[10] = 1;
  return x;
}
/** The called ace's holder (relative seat) for the belief nets' target, from the deal's end; -1 outside a Sauspiel. */
export function aceHolderOf(v, end) {
  const c = end.contract;
  if (!c || c.type !== "sau" || v.step === "bid") return -1;
  const ace = cid(c.ace, "A");
  return (end.dealt.findIndex(h => h.includes(ace)) - v.seat + 4) % 4;
}
