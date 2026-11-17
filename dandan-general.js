// The general encoding (17 Nov 2026, stage 3 step 3 of the plan to a general engine): every net input and every move's marks
// generated from the card files and the rules, with no card named in this file. A matchup's cards are its pool (the names in
// its decklists, and the tokens its cards make); each card is known to the nets two ways at once:
//   - by name: its own slot in the pool's vocabulary (a learned identity, as one-hot counts feeding the first layer are);
//   - by its printed facts: type, mana cost (generic and each colour), land types, power and toughness, the mana it makes, how it
//     enters, cycling, flashback, aftermath, modes, what it fetches; on the table its current land types and text changes too.
//     These are read off the card files, never written by hand, so a card the nets have not met still looks like the cards it
//     resembles.
// Everything is built from observe(state, seat) (dandan-view.js): what that seat sees, nothing more.
//   generalView(s, seat, theirHand, theirAny) — the position for the policy (the other hand as the belief's counts and "at least
//     one" chances) and, with the other hand dealt face up, for the value net (valueView)
//   generalMarks(s, seat, move) — a move's or an answer's marks: its kind, the card and its facts, where it is cast from, its
//     mode, each target (kind, whose, its card and facts), a question's chosen cards, counts and choices
import { CARDS, DECK, NAMES, HALVES, TOKEN_AT, BASICS, BASIC_MANA, parseCost } from "./dandan-cards.js";
import { typesOf } from "./dandan-core.js";
import { observe, HIDDEN } from "./dandan-view.js";

const other = x => 1 - x;
// the rules' own words: steps, the kinds of moves and questions (dandan-engine.js), colours of mana
const STEPS = ["mull", "upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end", "over"];
const KINDS = ["pass", "land", "cast", "cycle", "ability", "attack", "block", "keep", "mull", "putback", "discard", "bottom", "order",
  "surveil", "search", "pick", "owner", "bend", "retarget", "name", "free", "other"];
const COLOURS = ["W", "U", "B", "R", "G", "C"];

/** A card's printed facts, as words (a split card: both halves'). */
function printedFacts(name) {
  const halves = HALVES[name] || [name], out = new Set();
  if (HALVES[name]) out.add("split");
  for (const h of halves) {
    const d = CARDS[h];
    if (!d) continue;
    out.add(`type:${d.type}`);
    const c = parseCost(d.cost), mv = Object.values(c).reduce((a, b) => a + b, 0);
    out.add(`mv:${Math.min(7, mv)}`);
    if (c.g) out.add(`generic:${Math.min(5, c.g)}`);
    for (const k of COLOURS) if (c[k]) for (let i = 1; i <= Math.min(3, c[k]); i++) out.add(`pip:${k}${i}`);
    for (const t of d.subs || []) { out.add(`sub:${t}`); if (BASIC_MANA[t]) out.add(`mana:${BASIC_MANA[t]}`); }
    if (d.basic) out.add("basic");
    if (d.pt) { out.add(`pow:${Math.min(6, d.pt[0])}`); out.add(`tough:${Math.min(6, d.pt[1])}`); }
    for (const alt of d.mana || []) { for (const m of alt) out.add(`mana:${m}`); if (alt.length > 1) out.add("mana:both"); }
    if (d.tapped) out.add("enters-tapped");
    if (d.flash || d.type === "instant") out.add("instant-speed");
    if (d.cycling) out.add("cycling");
    if (d.islandcycling) out.add("typecycling");
    if (d.flashback) out.add("flashback");
    if (d.aftermath) out.add("aftermath");
    if (d.modes) out.add(`modes:${Math.min(4, d.modes.length)}`);
    for (const t of d.fetch || []) out.add(`fetch:${t}`);
    if (d.clue) out.add("sacrifice-draw");
  }
  return [...out];
}
/** The pool of a matchup: its vocabulary of names and of facts, the facts of each name, and the mark space. */
export function poolOf(names = NAMES) {
  const tokens = Object.keys(CARDS).filter(n => CARDS[n].type === "token");
  const vocab = [...names, ...tokens.filter(t => !names.includes(t))], V = vocab.length, at = new Map(vocab.map((n, i) => [n, i]));
  const factsOf = new Map(vocab.map(n => [n, printedFacts(n)]));
  // facts the table can show beyond the printed ones: a land's current types (Mind Bend), a text change, damage, a pump
  const live = [...BASICS.map(t => `now-sub:${t}`), ...BASICS.flatMap(t => [`changed-from:${t}`, `changed-to:${t}`]), "damaged", "pumped", "walks", "arrived"];
  const facts = [...new Set([...[...factsOf.values()].flat(), ...live])].sort(), F = facts.length, fat = new Map(facts.map((f, i) => [f, i]));
  // the mark space: a kind, the card and its facts, where it is cast from, a mode, a target (kind and whose), the target's card and
  // facts, a second card (an order), counts, yes/no choices, a land type chosen
  const keys = [...KINDS.map(k => `kind:${k}`), ...vocab.map(n => `card:${n}`), ...facts.map(f => `fact:${f}`), "from:hand", "from:yard",
    ...[0, 1, 2, 3].map(m => `mode:${m}`), "tgt:none", ...["perm", "spell", "player", "yard"].flatMap(k => [`tgt:${k}:mine`, `tgt:${k}:theirs`]),
    ...vocab.map(n => `tcard:${n}`), ...facts.map(f => `tfact:${f}`), ...vocab.map(n => `second:${n}`), ...[0, 1, 2, 3, 4].map(n => `count:${n}`),
    "yes", "none", ...BASICS.map(t => `to:${t}`)];
  return { vocab, V, at, factsOf, facts, F, fat, keys, MARK_N: keys.length, mark: new Map(keys.map((k, i) => [k, i])) };
}
export const POOL = poolOf();
// a card id's name; a token's from the card files (the one token kind this pool makes)
const TOKEN_NAME = Object.keys(CARDS).find(n => CARDS[n].type === "token");
const cardNameOf = id => (id >= TOKEN_AT ? TOKEN_NAME : DECK[id]);
const nameOf = id => (id == null || id === HIDDEN ? null : cardNameOf(id));

// ---------- the view ----------
const ZONES = ["myHand", "theirHand", "myUntapped", "myTapped", "theirUntapped", "theirTapped", "yard", "exile", "known top", "unseen"];
const STACK = 4, SCALARS = STEPS.length + 4 + 2 + KINDS.length + 1 + 2 * (2 + COLOURS.length) + 6;
const viewSize1 = P => ZONES.length * (P.V + P.F) + P.V + STACK * (P.V + P.F + 6) + SCALARS;
// version 2 (17 Nov 2026, Korbi 16:40): what is known of each library by place, and who knows it, appended after version 1 (a net
// trained on version 1 reads the first part, as before; a version-2 net warm-started from it has zero weights on the rest):
//   per library (the seat's and the other's; Dandân's one library is the seat's, with `shared` set): its top three and bottom three
//   places, each the card if the seat knows it, whether hidden, whether the other player knows it; the cards the seat knows are
//   in it elsewhere; how many places the other player knows at the top, the bottom and elsewhere;
//   the seat's hand cards the other player knows; the cards seen earlier in the match (a best of three; Dandân plays single games);
//   whether the library is shared.
const SLOTS = 6, LIB2 = P => SLOTS * (P.V + P.F + 2) + (P.V + P.F) + 3;
const extra2 = P => 2 * LIB2(P) + 2 * (P.V + P.F) + 1;
export const viewSize = (P = POOL, v = 2) => viewSize1(P) + (v >= 2 ? extra2(P) : 0);
export const VIEW_VERSIONS = P => [viewSize(P, 1), viewSize(P, 2)];

/** A permanent's facts now: its printed ones (land types as they now are), changes, damage, a pump, arrival this turn. */
function permFacts(P, p, turn) {
  const n = cardNameOf(p.id), out = (P.factsOf.get(n) || []).filter(f => !f.startsWith("sub:"));
  if (CARDS[n]?.type === "land") for (const t of typesOf(p)) out.push(`now-sub:${t}`);
  for (const [a, b] of p.tc || []) out.push(`changed-from:${a}`, `changed-to:${b}`);
  if (p.dmg) out.push("damaged");
  if (p.pump) out.push("pumped");
  if (p.walk) out.push("walks");
  if (p.ent === turn) out.push("arrived");
  return out;
}

/**
 * The position as `seat` sees it (viewSize numbers). `theirHand`: the other hand's counts by the pool's names (the belief's
 * expected counts, or a dealt world face up); `theirAny`: the chance they hold at least one of each (face up: 1 where they do).
 */
export function generalView(s, seat, theirHand, theirAny = null, P = POOL, out = new Float32Array(viewSize(P))) {
  const o = observe(s, seat), opp = other(seat), Z = P.V + P.F;
  out.fill(0);
  const card = (z, name, w = 1) => {
    const base = z * Z, i = P.at.get(name);
    if (i == null) return;
    out[base + i] += w / 4;
    for (const f of P.factsOf.get(name) || []) { const j = P.fat.get(f); if (j != null) out[base + P.V + j] += w / 4; }
  };
  const perm = (z, p) => {
    const base = z * Z, name = cardNameOf(p.id), i = P.at.get(name);
    if (i != null) out[base + i] += 0.25;
    for (const f of permFacts(P, p, o.turn)) { const j = P.fat.get(f); if (j != null) out[base + P.V + j] += 0.25; }
  };
  for (const id of o.hand[seat]) card(0, nameOf(id));
  P.vocab.forEach((n, i) => { if (theirHand[i]) card(1, n, theirHand[i]); });
  for (const p of o.bf) perm((p.ctl === seat ? 2 : 4) + (p.tapped ? 1 : 0), p);
  for (const id of o.yard) card(6, nameOf(id));
  for (const id of o.exile) card(7, nameOf(id));
  for (let i = 0; i < 5; i++) { const id = o.lib[i]; if (id != null && id !== HIDDEN) card(8, nameOf(id), 1 - i / 5); }
  // the unseen pool: every card of the pool less those this seat has seen (the hidden ones, by name: public)
  for (const id of o.unseenIds) card(9, nameOf(id));
  let k = ZONES.length * Z;
  for (let i = 0; i < P.V; i++) out[k + i] = theirAny ? theirAny[i] : theirHand[i] > 0.5 ? 1 : 0;
  k += P.V;
  for (let j = 0; j < STACK; j++, k += Z + 6) {
    const it = o.stack[o.stack.length - 1 - j];
    if (!it) continue;
    const name = it.card != null ? nameOf(it.card) : null, i = name != null ? P.at.get(name) : null;
    if (i != null) { out[k + i] = 1; for (const f of P.factsOf.get(name) || []) { const q = P.fat.get(f); if (q != null) out[k + P.V + q] = 1; } }
    out[k + Z] = it.ctl === seat ? 1 : 0;
    out[k + Z + 1] = it.kind === "spell" ? 0 : 1;
    const t = it.targets?.[0];
    if (t) {
      const kind = { c: 0, s: 1, p: 2, g: 3 }[t.k];
      if (kind != null) out[k + Z + 2 + kind] = 1;
    }
  }
  const st = o.over ? STEPS.length - 1 : o.mull && !o.mull.done.every(Boolean) ? 0 : STEPS.indexOf(o.step);
  if (st >= 0) out[k + st] = 1;
  k += STEPS.length;
  out[k + Math.min(3, o.stack.length)] = 1; k += 4;
  out[k++] = o.active === seat ? 1 : 0;
  out[k++] = o.prio === seat ? 1 : 0;
  if (o.pending) { const q = KINDS.indexOf(o.pending.t); out[k + (q >= 0 ? q : KINDS.length - 1)] = 1; }
  k += KINDS.length;
  out[k++] = Math.min(3, o.mull?.n?.[seat] || 0) / 3;
  for (const x of [seat, opp]) {
    out[k++] = Math.max(0, o.life[x]) / 20;
    out[k++] = Math.min(10, o.hand[x].length) / 7;
    const pool = (o.pool || ["", ""])[x] || "";
    for (const ch of pool) { const c = COLOURS.indexOf(ch); if (c >= 0) out[k + c] += 1 / 3; }
    k += COLOURS.length;
  }
  out[k++] = Math.min(60, o.turn) / 40;
  out[k++] = Math.min(80, o.lib.length) / 80;
  out[k++] = o.lib.length % 2;   // who faces the empty library: odd and even, which one number for the size can't show
  out[k++] = o.played ? 1 : 0;
  out[k++] = o.attacked ? 1 : 0;
  out[k++] = (o.hand[opp].length - o.hand[seat].length) / 7;
  if (out.length >= viewSize(P, 2)) view2(o, seat, P, out, k);
  return out;
}
/** Version 2's part (see viewSize): from the observation, at offset k. */
function view2(o, seat, P, out, k) {
  const opp = other(seat), Z = P.V + P.F, theirs = new Set(o.theirLib || []);
  const cardAt = (base, name, w = 1) => {
    const i = P.at.get(name);
    if (i == null) return;
    out[base + i] += w / 4;
    for (const f of P.factsOf.get(name) || []) { const j = P.fat.get(f); if (j != null) out[base + P.V + j] += w / 4; }
  };
  // the libraries: the engine's per-seat ones (o.libs), else the one shared library as the seat's
  const libs = o.libs ? [o.libs[seat], o.libs[opp]] : [o.lib, null];
  for (const lib of libs) {
    if (lib) {
      const n = lib.length, at = [0, 1, 2, n - 1, n - 2, n - 3];
      at.forEach((i, j) => {
        const b = k + j * (Z + 2);
        if (i < 0 || i >= n || (j >= 3 && i < 3)) return;   // a short library: each place once
        const id = lib[i];
        if (id !== HIDDEN && id != null) cardAt(b, nameOf(id), 4); else out[b + Z] = 1;
        // (with two libraries, o.libs, observe has no theirLib for them yet: these marks stay off until step 4 gives one per library)
        if (!o.libs && theirs.has(i)) out[b + Z + 1] = 1;
      });
      const mid = k + SLOTS * (Z + 2);
      let top = 0, bottom = 0, rest = 0;
      lib.forEach((id, i) => {
        const edge = i < 3 || i >= n - 3;
        if (!edge && id !== HIDDEN && id != null) cardAt(mid, nameOf(id));
        if (!o.libs && theirs.has(i)) { if (i < 3) top++; else if (i >= n - 3) bottom++; else rest++; }
      });
      out[mid + Z] = top / 3; out[mid + Z + 1] = bottom / 3; out[mid + Z + 2] = Math.min(5, rest) / 5;
    }
    k += LIB2(P);
  }
  // the seat's hand cards the other player knows (their knowledge, kh: the other's bit)
  const kh = new Map(o.kh || []);
  for (const id of o.hand[seat]) if ((kh.get(id) || 0) & (1 << opp)) cardAt(k, nameOf(id));
  k += Z;
  for (const name of o.match?.seen?.[opp] || []) cardAt(k, name);   // seen earlier in the match: none in Dandân
  k += Z;
  out[k++] = o.libs ? 0 : 1;
  return out;
}
/** The value net's view: the position face up for `seat` (the other hand as dealt), as generalView reads it. */
export function valueView(s, seat, P = POOL, out) {
  const theirs = new Float32Array(P.V);
  for (const id of s.hand[other(seat)]) { const i = P.at.get(nameOf(id)); if (i != null) theirs[i]++; }
  return generalView(s, seat, theirs, null, P, out);
}
/** The belief's counts (by the name list NAMES, as Scry gives them) on the pool's vocabulary. */
export function onPool(counts, P = POOL, names = NAMES) {
  const out = new Float32Array(P.V);
  names.forEach((n, i) => { const j = P.at.get(n); if (j != null) out[j] = counts[i]; });
  return out;
}

// ---------- the marks ----------
/** A move's or an answer's marks: indices into the pool's mark space (POOL.keys). */
export function generalMarks(s, seat, m, P = POOL) {
  const out = new Set(), add = k => { const i = P.mark.get(k); if (i != null) out.add(i); };
  const cardMarks = (name, pre = "card", fpre = "fact") => { if (name == null) return; add(`${pre}:${name}`); for (const f of P.factsOf.get(name) || []) add(`${fpre}:${f}`); };
  const permMarks = (p, pre, fpre) => { const n = cardNameOf(p.id); add(`${pre}:${n}`); for (const f of permFacts(P, p, s.turn)) add(`${fpre}:${f}`); };
  add(`kind:${KINDS.includes(m.t) ? m.t : "other"}`);
  switch (m.t) {
    case "land": case "cycle": cardMarks(nameOf(m.card)); break;
    case "ability": { const p = s.bf.find(x => x.id === m.id); if (p) permMarks(p, "card", "fact"); break; }
    case "cast": {
      cardMarks(nameOf(m.card));
      add(m.from === "yard" ? "from:yard" : "from:hand");
      add(`mode:${Math.min(3, m.mode || 0)}`);
      if (!m.targets?.length) add("tgt:none");
      for (const t of m.targets || []) {
        if (t.k === "c") { const p = s.bf.find(x => x.id === t.id); if (p) { add(`tgt:perm:${p.ctl === seat ? "mine" : "theirs"}`); permMarks(p, "tcard", "tfact"); } }
        else if (t.k === "s") { const x = s.stack.find(y => y.sid === t.sid); if (x) { add(`tgt:spell:${x.ctl === seat ? "mine" : "theirs"}`); cardMarks(nameOf(x.card), "tcard", "tfact"); } }
        else if (t.k === "p") add(`tgt:player:${t.seat === seat ? "mine" : "theirs"}`);
        else if (t.k === "g") { add("tgt:yard:mine"); cardMarks(nameOf(t.id), "tcard", "tfact"); }
      }
      break;
    }
    case "attack": add(`count:${Math.min(4, m.ids.length)}`); for (const id of m.ids) { const p = s.bf.find(x => x.id === id); if (p) permMarks(p, "card", "fact"); } break;
    case "block": add(`count:${Math.min(4, m.pairs.length)}`); break;
    case "order": if (m.cards[0] != null) cardMarks(nameOf(m.cards[0])); if (m.cards[1] != null) add(`second:${nameOf(m.cards[1])}`); break;
    case "surveil": if (m.yard) add("yes"); break;
    case "search": case "pick": if (m.card == null) add("none"); else cardMarks(nameOf(m.card)); break;
    case "owner": if (m.bottom) add("yes"); break;
    case "bend": add(`to:${m.to}`); break;
    case "retarget": if (!m.targets) add("none"); break;
    case "putback": case "discard": case "bottom": for (const id of m.cards) cardMarks(nameOf(id)); add(`count:${Math.min(4, m.cards.length)}`); break;
    case "name": cardMarks(m.name); break;
    default: break;
  }
  return [...out];
}
