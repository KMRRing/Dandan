// Dandan's table: the zones, the permanents, the mana and what a card knows about the library. Pure functions on the
// game state (a plain object that survives JSON and the database); the rules of the turn, the stack and the moves are
// dandan-engine.js's, what each card does dandan-spells.js's.
//
// The format is the communal one: ONE library and ONE graveyard for both players, so "your graveyard" and "its
// owner's library" are the same pile for you and for the computer. A card in hand is its holder's; one on the stack or
// the battlefield belongs to whoever played it.
import { CARDS, DECK, HALVES, BASIC_MANA, TOKEN_AT, cardName, parseCost, total, isToken } from "./dandan-cards.js";
import { shuffle } from "./seats.js";

export const LIFE = 20, HAND = 7;
export const other = seat => 1 - seat;
/** A list as the database gives it back: dense, in order, whatever shape it came in (a list, or an object of indices). */
export const list = x => (Array.isArray(x) ? x.filter(v => v != null) : x && typeof x === "object" ? Object.values(x) : []);

// ---------- randomness: the move's own stream, set by whoever runs a move ----------
// quiet: a game the computer plays out in its head keeps no log (a line is a string built for nobody)
let rng = Math.random, quiet = false;
export function withRng(r, fn, hush = false) {
  const old = rng, was = quiet;
  rng = r || Math.random;
  quiet = hush;
  try { return fn(); } finally { rng = old; quiet = was; }
}
export const random = () => rng();
/** Whether the move being made is one played out in the head (no log, nothing noted for the table). */
export const hushed = () => quiet;

// ---------- the log: a line for each thing that happens, {s0} for whoever sits in seat 0 ----------
// The whole game is kept, for Copy log (a game runs to two or three hundred lines); the bound is against one that never ends.
const LOG_LINES = 1000;
export function say(s, text) {
  if (quiet) return;
  s.ln = (s.ln || 0) + 1;
  s.log.push({ n: s.ln, t: text });
  if (s.log.length > LOG_LINES) s.log.splice(0, s.log.length - LOG_LINES);
}

// ---------- cards ----------
/** The entry of what a card id is on its front face (a split card's front is Commit). (Looked up once for each card: it's asked everywhere.) */
const DEFS = DECK.map(n => CARDS[HALVES[n] ? HALVES[n][0] : n]);
export const defOf = id => (id >= TOKEN_AT ? CARDS.Clue : DEFS[id]);
export const isLandId = id => defOf(id).type === "land";
/** A card's name for the log. */
export const nm = id => (id >= TOKEN_AT ? "Clue" : DECK[id]);
/** Whether a card is an instant or a sorcery (the split card is both, in the graveyard). */
export const isSpellCard = id => id < TOKEN_AT && (defOf(id).type === "instant" || defOf(id).type === "sorcery" || !!HALVES[DECK[id]]);

// ---------- permanents ----------
export const perm = (s, id) => s.bf.find(p => p.id === id);
const tcMap = (tc, word) => { for (const [a, b] of tc || []) if (word === a) word = b; return word; };
export const isLand = p => defOf(p.id).type === "land";
export const isCreature = p => defOf(p.id).type === "creature";
/** The land types a land has now: its own, with Mind Bend's changes. (A card untouched by Mind Bend: read once, the same list each time.) */
const TYPES = new Map();
export function typesOf(p) {
  if (!p.tc) {
    let t = TYPES.get(p.id);
    if (!t) { const d = defOf(p.id); t = d.type === "land" ? [...new Set(d.subs)] : []; TYPES.set(p.id, t); }
    return t;
  }
  const d = defOf(p.id);
  return d.type === "land" ? [...new Set(d.subs.map(t => tcMap(p.tc, t)))] : [];
}
export const isIsland = p => typesOf(p).includes("Island");
export const islands = (s, seat) => s.bf.filter(p => p.ctl === seat && isIsland(p));
/** The land type a Dandân looks for in its text: "Island", unless Mind Bend changed it. */
export const needType = p => tcMap(p.tc, "Island");
/** The types a Flood Plain fetches, with the changes. */
export const fetchTypes = p => (defOf(p.id).fetch || []).map(t => tcMap(p.tc, t));
export const lands = (s, seat) => s.bf.filter(p => p.ctl === seat && isLand(p));
export const creatures = (s, seat) => s.bf.filter(p => (seat == null || p.ctl === seat) && isCreature(p));
/** Power and toughness now. */
export function pt(p) {
  const [a, b] = defOf(p.id).pt || [0, 0];
  return [a + (p.pump?.[0] || 0), b + (p.pump?.[1] || 0)];
}
/** Whether a creature may be blocked by anything: not while it has islandwalk and the defender has an Island. */
export const unblockable = (s, p) => !!p.walk && islands(s, other(p.ctl)).length > 0;
/** Whether a creature could attack now: untapped, here since before this turn, and its text's land type opposite. */
export function canAttack(s, p) {
  if (!isCreature(p) || p.tapped || p.ent >= s.turn || p.ctl !== s.active) return false;
  return s.bf.some(l => l.ctl === other(p.ctl) && isLand(l) && typesOf(l).includes(needType(p)));
}

// ---------- mana ----------
/** What a land can tap for: alternatives, each a list of colours made together (Boilerworks one of two, Falls two of one). */
const ALTS = new Map();
export function manaAlts(p) {
  if (!p.tc) { let a = ALTS.get(p.id); if (!a) { a = altsOf(p); ALTS.set(p.id, a); } return a; }
  return altsOf(p);
}
function altsOf(p) {
  const d = defOf(p.id), out = [], seen = new Set();
  const add = a => { const k = a.join(""); if (!seen.has(k)) { seen.add(k); out.push(a); } };
  for (const t of typesOf(p)) if (BASIC_MANA[t]) add([BASIC_MANA[t]]);
  for (const a of d.mana || []) add(a);
  return out;
}
/** How much we'd rather keep a land untapped: lands that make more, or either colour, are kept for last. */
const keepValue = alts => (alts.length > 1 ? 1.3 : alts[0].length > 1 ? 1.6 : 1);
const countOf = (str, c) => { let n = 0; for (let i = 0; i < str.length; i++) if (str[i] === c) n++; return n; };
/** The mana floating in a seat's pool (a string of colour letters, "R"): what a land made and a cost didn't use, until the step ends. */
export const poolOf = (s, seat) => s.pool?.[seat] || "";
/** What's left of some mana once a cost is paid from it: the colours the cost names first, the generic from the least useful (red is kept over the colours nothing here needs, blue over red). */
function leftover(mana, cost) {
  const left = [...mana];
  const take = c => { const i = left.indexOf(c); if (i >= 0) left.splice(i, 1); };
  for (let i = 0; i < cost.U; i++) take("U");
  for (let i = 0; i < cost.R; i++) take("R");
  for (let i = 0; i < cost.g; i++) take(["W", "B", "G", "R", "U"].find(c => left.includes(c)));
  return left.sort().join("");
}

/**
 * How to pay a cost ({ g, U, R }) from a seat's pool and untapped lands: { seat, taps: [land ids], pool (what floats
 * after) }, or null if it can't. The pool is spent first; among the ways to tap, the one that leaves the most behind:
 * lands that are worth more (red, two mana) stay untapped, and mana made and not used counts against a way (it floats
 * only to the end of the step). Deterministic.
 */
export function payPlan(s, seat, cost, skip = []) {
  const need = cost.g + cost.U + cost.R, pool = poolOf(s, seat);
  if (need === 0) return { seat, taps: [], pool };
  // the lands that could pay, and a quick bound: enough mana at most, and enough sources of blue and of red
  const mine = [];
  let most = pool.length, us = countOf(pool, "U"), rs = countOf(pool, "R");
  for (const p of s.bf) {
    if (p.ctl !== seat || p.tapped || !isLand(p) || (skip.length && skip.includes(p.id))) continue;
    const alts = manaAlts(p);
    if (!alts.length) continue;
    let big = 0, u = false, r = false;
    for (const a of alts) { if (a.length > big) big = a.length; if (a.includes("U")) u = true; if (a.includes("R")) r = true; }
    most += big; if (u) us++; if (r) rs++;
    mine.push({ id: p.id, alts, keep: keepValue(alts) });
  }
  if (most < need || us < cost.U || rs < cost.R) return null;
  const cap = need + 3, keyOf = (u, r, t) => (u * 16 + r) * 64 + t;
  const start = { u: Math.min(cost.U, countOf(pool, "U")), r: Math.min(cost.R, countOf(pool, "R")), t: Math.min(cap, pool.length), pen: 0, land: null, alt: null, prev: null };
  let states = new Map([[keyOf(start.u, start.r, start.t), start]]);
  for (const land of mine) {
    const next = new Map(states);
    for (const st of states.values()) {
      for (const alt of land.alts) {
        const u = Math.min(cost.U, st.u + countOf(alt, "U")), r = Math.min(cost.R, st.r + countOf(alt, "R"));
        const t = Math.min(cap, st.t + alt.length), pen = st.pen + land.keep;
        const k = keyOf(u, r, t), old = next.get(k);
        if (!old || pen < old.pen) next.set(k, { u, r, t, pen, land: land.id, alt, prev: st });
      }
    }
    states = next;
  }
  let best = null;
  for (const st of states.values()) {
    if (st.u < cost.U || st.r < cost.R || st.t < need) continue;
    const score = st.pen + 0.9 * (st.t - need);
    if (!best || score < best.score) best = { score, st };
  }
  if (!best) return null;
  const taps = [];
  let made = "";
  for (let st = best.st; st && st.land != null; st = st.prev) { taps.unshift(st.land); made += st.alt.join(""); }
  return { seat, taps, pool: leftover(pool + made, cost) };
}
export const canPay = (s, seat, cost, skip) => !!payPlan(s, seat, cost, skip);
/**
 * A payment from lands chosen by hand (the manual tap, 23 October 2026): { seat, taps, pool } for tapping exactly these
 * lands, each for one of the ways it can tap, with the pool, or null if one isn't an untapped land of the seat's or they
 * don't make the cost. Mana a chosen land makes beyond the cost floats like any other, to the end of the step: a player
 * may tap a land to bounce it, or to keep another open. Of the ways to tap them the one that leaves the most behind.
 */
export function payFrom(s, seat, cost, ids) {
  const taps = [...new Set(ids)], need = cost.g + cost.U + cost.R, pool = poolOf(s, seat);
  const ps = taps.map(id => perm(s, id));
  if (ps.some(p => !p || p.ctl !== seat || p.tapped || !isLand(p) || !manaAlts(p).length)) return null;
  // every way of tapping them, kept by what it makes of blue, red and in all (the alternatives are few)
  let states = new Map([["", { made: "" }]]);
  for (const p of ps) {
    const next = new Map();
    for (const st of states.values()) for (const alt of manaAlts(p)) {
      const made = st.made + alt.join(""), k = [...made].sort().join("");
      if (!next.has(k)) next.set(k, { made });
    }
    states = next;
  }
  let best = null;
  for (const { made } of states.values()) {
    const all = pool + made;
    if (countOf(all, "U") < cost.U || countOf(all, "R") < cost.R || all.length < need) continue;
    const left = leftover(all, cost);
    if (!best || left.length > best.pool.length) best = { seat, taps, pool: left };
  }
  return best;
}
/**
 * Whether a seat could pay a cost, without working out how: enough mana at most, enough lands that can make blue and
 * enough that can make red. For this deck's costs that is exact (no cost asks for both blue and red, and a land that
 * makes either makes one mana whichever), and much quicker than payPlan, which the game uses to pay.
 */
export function affords(s, seat, cost) {
  const need = cost.g + cost.U + cost.R;
  if (need === 0) return true;
  const pool = poolOf(s, seat);
  let most = pool.length, us = countOf(pool, "U"), rs = countOf(pool, "R");
  for (const p of s.bf) {
    if (p.ctl !== seat || p.tapped || !isLand(p)) continue;
    const alts = manaAlts(p);
    let big = 0, u = false, r = false;
    for (const a of alts) { if (a.length > big) big = a.length; if (a.includes("U")) u = true; if (a.includes("R")) r = true; }
    most += big; if (u) us++; if (r) rs++;
  }
  return most >= need && us >= cost.U && rs >= cost.R;
}
/** Pays: taps the lands of a plan, and what they made and the cost didn't use floats in the pool. */
export function pay(s, plan) {
  for (const id of plan.taps) perm(s, id).tapped = true;
  (s.pool ||= ["", ""])[plan.seat] = plan.pool;
}
/** Every pool empties as a step ends. */
export function emptyPools(s) { s.pool = ["", ""]; }

// ---------- zones ----------
export const count = (arr, f) => arr.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
export const knOf = (s, id) => s.kn.find(e => e[0] === id)?.[1] || 0;
export function knSet(s, id, mask) { const e = s.kn.find(x => x[0] === id); if (e) e[1] = mask; else s.kn.push([id, mask]); }
export function knDrop(s, id) { const i = s.kn.findIndex(e => e[0] === id); if (i >= 0) s.kn.splice(i, 1); }
/**
 * A card in a hand that the other player knows is there (kh, [id, mask] as kn): one drawn from a top they had seen, one
 * returned to a hand in the open (bounced, sent back by Narset's Reversal, found by a search that reveals it). It's
 * forgotten when the card leaves the hand, or the hand is shuffled away.
 */
export const khOf = (s, id) => s.kh?.find(e => e[0] === id)?.[1] || 0;
export function khSet(s, id, mask) { const e = (s.kh ||= []).find(x => x[0] === id); if (e) e[1] = mask; else s.kh.push([id, mask]); }
export function khDrop(s, id) { const i = s.kh ? s.kh.findIndex(e => e[0] === id) : -1; if (i >= 0) s.kh.splice(i, 1); }
/** The cards in `holder`'s hand that `seat` knows of. */
export const knownIn = (s, holder, seat) => s.hand[holder].filter(id => khOf(s, id) & (1 << seat));
/** A card put into a hand in the open: both players know it's there. */
export function toHandOpen(s, seat, id) { s.hand[seat].push(id); khSet(s, id, BOTH); }

// ---------- tells: what a player's play has shown the table ----------
/**
 * A seat's tells, each the count of cards it had drawn when the table saw it (-1: never): keep, its opening hand kept;
 * land, a turn of its own ended with no land played; lapse, an opposing spell it would surely have countered (on: its
 * name) let resolve with a Memory Lapse's mana open; kill, an unblocked Dandân let hit it with blue open (mana: how
 * much it had open). lands: the lands it has played. All public: anyone at the table saw them (dandan-reads.js reads them).
 */
export const freshTells = () => ({ keep: -1, land: -1, lapse: -1, on: "", kill: -1, mana: 0, lands: 0 });
export const tellsOf = (s, seat) => (s.tells ||= [freshTells(), freshTells()])[seat];

/** The top card of the library, if this seat knows what it is (a spell put on top in the open, a look at it). */
export const topKnown = (s, seat) => (s.lib.length && (knOf(s, s.lib[0]) & (1 << seat)) ? s.lib[0] : null);
export const BOTH = 3;

/** A card into the library: "top", "second" (second from the top) or "bottom", known to the seats in mask. */
export function toLib(s, id, where, mask = 0) {
  if (isToken(id)) return;
  if (where === "top") s.lib.unshift(id);
  else if (where === "second") s.lib.splice(Math.min(1, s.lib.length), 0, id);
  else s.lib.push(id);
  if (mask) knSet(s, id, mask); else knDrop(s, id);
}
export function toYard(s, id) { if (!isToken(id)) s.yard.push(id); }
export function fromYard(s, id) { const i = s.yard.indexOf(id); if (i >= 0) s.yard.splice(i, 1); return i >= 0; }
export function fromLib(s, id) { const i = s.lib.indexOf(id); if (i >= 0) { s.lib.splice(i, 1); knDrop(s, id); } return i >= 0; }
export function fromHand(s, seat, id) { const h = s.hand[seat], i = h.indexOf(id); if (i >= 0) { h.splice(i, 1); khDrop(s, id); } return i >= 0; }
/** A whole hand into the library (a mulligan, Memory): what was known of it goes with it. */
export function handToLib(s, seat) { for (const id of s.hand[seat]) khDrop(s, id); s.lib.push(...s.hand[seat]); s.hand[seat] = []; }
export function shuffleLib(s) { s.lib = shuffle(s.lib, rng); s.kn = []; }

/** Draws n cards; a draw from an empty library marks the seat to lose when the game next checks. */
export function draw(s, seat, n = 1) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!s.lib.length) { s.lost[seat] = true; say(s, `{s${seat}} has to draw from an empty library`); break; }
    const id = s.lib.shift(), mask = knOf(s, id);
    knDrop(s, id);
    s.hand[seat].push(id);
    if (mask & (1 << other(seat))) khSet(s, id, mask);           // the other player saw it on top: they know where it went
    s.drawn[seat]++;
    (s.draws ||= [0, 0])[seat]++;
    got++;
  }
  return got;
}
/** The top n cards of the library into the graveyard (the ids milled). */
export function mill(s, n = 1) {
  const out = [];
  for (let i = 0; i < n && s.lib.length; i++) { const id = s.lib.shift(); knDrop(s, id); toYard(s, id); out.push(id); }
  return out;
}

// ---------- the stack ----------
export function pushItem(s, it) {
  it.sid = s.nid++;
  it.step = 0;
  it.d ||= {};
  it.targets ||= [];
  s.stack.push(it);
  return it;
}
export const itemOf = (s, sid) => s.stack.find(i => i.sid === sid);
/**
 * A spell leaves the stack for dest: "yard", "hand" (its owner's), "libtop", "libsecond", "exile", or "none" (its
 * resolution has already put the card somewhere). A copy ceases to exist; a flashback or aftermath spell is exiled
 * wherever it would have gone.
 */
export function leaveStack(s, it, dest) {
  s.stack = s.stack.filter(x => x.sid !== it.sid);
  if (it.kind !== "spell" || it.copy || dest === "none") return;
  if (it.eol) dest = "exile";
  if (dest === "yard") toYard(s, it.card);
  else if (dest === "hand") toHandOpen(s, it.ctl, it.card);
  else if (dest === "libtop") toLib(s, it.card, "top", BOTH);
  else if (dest === "libsecond") toLib(s, it.card, "second", BOTH);
  else s.exile.push(it.card);
}

// ---------- the battlefield ----------
/** A card onto the battlefield under ctl's control; enters-the-battlefield triggers go on the stack. */
export function enterBf(s, id, ctl, { tapped } = {}) {
  const d = defOf(id);
  let tap = tapped ?? !!d.tapped;
  if (nm(id) === "Mystic Sanctuary") tap = islands(s, ctl).length < 3;
  // oid: this object, so a card that leaves and comes back is a new one (a trigger or a target of the old one misses it)
  const p = { id, ctl, tapped: tap, ent: s.turn, oid: s.nid++ };
  s.bf.push(p);
  const name = nm(id);
  const trig = { "Halimar Depths": "@depths", "Thundering Falls": "@falls", "Izzet Boilerworks": "@boil" }[name] || (name === "Mystic Sanctuary" && !tap ? "@sanct" : null);
  // Mystic Sanctuary's trigger targets: its card is chosen as it goes on the stack (aim), before anyone may answer it
  if (trig) pushItem(s, { kind: "trigger", name: trig, ctl, src: id, oid: p.oid, ...(trig === "@sanct" ? { aim: true } : {}) });
  return p;
}
export function leaveBf(s, id) { const i = s.bf.findIndex(p => p.id === id); if (i >= 0) s.bf.splice(i, 1); return i >= 0; }
/** A permanent dies or is sacrificed: into the graveyard (a token just goes). */
export function toGrave(s, id) { if (leaveBf(s, id)) toYard(s, id); }
/** A permanent back to its owner's hand (a token just goes). */
export function bounce(s, id) {
  const p = perm(s, id);
  if (!p) return;
  leaveBf(s, id);
  if (!isToken(id)) toHandOpen(s, p.ctl, id);
}
/** A permanent into the library (a token just goes); where is "top", "second" or "bottom". */
export function permToLib(s, id, where) {
  if (!leaveBf(s, id)) return;
  toLib(s, id, where, BOTH);
}

// ---------- questions put to a player ----------
/**
 * A decision for a seat, mid-resolution of an item (or a turn-based one: it = null). The item waits on the stack
 * and carries on at `next` when the answer's in.
 */
export function ask(s, it, pend, next) {
  if (it) { it.step = next; pend.sid = it.sid; s.res = it.sid; }
  s.pending = pend;
  return "wait";
}

export { CARDS, DECK, HALVES, BASIC_MANA, TOKEN_AT, cardName, parseCost, total, isToken };
