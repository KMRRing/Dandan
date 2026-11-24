// Schafkopf's raw view for the nets (Fable, 24 Nov 2026 18:50Z, step 1): a seat's view (sk-rules.js view) as numbers, every
// seat named relative to the one viewing (0 itself, 1 the next to play after it, ...). Raw only: the cards and who played
// them, the trick on the table, the bidding, the contract. Nothing derived (points so far, trumps out, voids): those are
// the auxiliary bundles, tested apart (the four arms). Built from the view alone, so it can't hold what the seat can't see.
const C = 32;
const BIDS = ["pass", "sau0", "sau2", "sau3", "wenz", "solo0", "solo1", "solo2", "solo3"];
const bidKey = b => (b.t === "pass" ? "pass" : b.type === "sau" ? `sau${b.ace}` : b.type === "wenz" ? "wenz" : `solo${b.suit}`);
const id0 = id => id - 1 - Math.floor((id - 1) / 9);    // Codex's card ids (suit*9 + rank, ranks from the 7) → 0..31

export const PARTS = { hand: C, played: 4 * C, trick: 4 * C, leader: 4, bids: 4 * (BIDS.length + 1), type: 3, trump: 4, ace: 3, declarer: 4, partner: 5, dealer: 4, phase: 2 };
export const SIZE = Object.values(PARTS).reduce((a, b) => a + b, 0);

export function rawView(v) {
  const x = new Float32Array(SIZE), rel = p => (p - v.seat + 4) % 4;
  let o = 0;
  const at = (part, i) => { x[o + i] = 1; }, next = part => { o += PARTS[part]; };
  for (const id of v.hand) at("hand", id0(id)); next("hand");
  for (const t of [...v.tricks.map(t => t.cards), v.trick]) for (const c of t) at("played", rel(c.seat) * C + id0(c.card)); next("played");
  v.trick.forEach((c, i) => at("trick", i * C + id0(c.card))); next("trick");
  if (v.trick.length) at("leader", rel(v.trick[0].seat)); next("leader");
  const said = [null, null, null, null];
  for (const b of v.bids) said[rel(b.seat)] = BIDS.indexOf(bidKey(b));
  said.forEach((k, r) => at("bids", r * (BIDS.length + 1) + (k == null ? BIDS.length : k))); next("bids");
  const c = v.contract;
  if (c) {
    at("type", ["sau", "wenz", "solo"].indexOf(c.type)); next("type");
    if (c.trump >= 0) at("trump", c.trump); next("trump");
    if (c.type === "sau") at("ace", [0, 2, 3].indexOf(c.ace)); next("ace");
    at("declarer", rel(c.declarer)); next("declarer");
    if (c.type === "sau") at("partner", c.partner == null ? 4 : rel(c.partner)); next("partner");
  } else for (const p of ["type", "trump", "ace", "declarer", "partner"]) next(p);
  at("dealer", rel(v.dealer)); next("dealer");
  at("phase", v.step === "bid" ? 0 : 1); next("phase");
  return x;
}
