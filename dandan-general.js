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
import { CARDS, DECK, NAMES, HALVES, TOKEN_AT, BASICS, BASIC_MANA, LIBRARY, parseCost } from "./dandan-cards.js";
import { typesOf, lands, creatures, pt, needType, manaAlts, canAttack, fetchTypes, poolOf as manaPool } from "./dandan-core.js";
import { hasType } from "./dandan-spells.js";
import { targetLists } from "./dandan-spells.js";
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
/** A name's slot and its facts' slots, compiled once per pool (the view's and the marks' hot path: no string keys per call). */
function compiled(P) {
  if (P._names) return P._names;
  const names = new Map();
  const slots = fs => Int32Array.from(fs.map(f => P.fat.get(f)).filter(j => j != null));
  // fj: the printed facts' slots; pj: a permanent's printed part (the land types left out: on the table they are read as they are now)
  for (const n of P.vocab) names.set(n, { i: P.at.get(n), fj: slots(P.factsOf.get(n) || []), pj: slots((P.factsOf.get(n) || []).filter(f => !f.startsWith("sub:"))) });
  Object.defineProperty(P, "_byId", { value: [], enumerable: false });
  const marks = new Map();
  Object.defineProperty(P, "_names", { value: names, enumerable: false });
  Object.defineProperty(P, "_marks", { value: marks, enumerable: false });
  return names;
}
/** A card id's entry (compiled), by id: null for a card not in the pool. */
function idEntry(P, id) {
  const B = P._byId;
  let e = B[id];
  if (e === undefined) B[id] = e = compiled(P).get(cardNameOf(id)) || null;
  return e;
}
/** A permanent's facts beyond its printed ones (permFacts less the printed part). */
function liveFacts(p, turn, out) {
  const n = cardNameOf(p.id);
  if (CARDS[n]?.type === "land") for (const t of typesOf(p)) out.push(`now-sub:${t}`);
  for (const [a, b] of p.tc || []) out.push(`changed-from:${a}`, `changed-to:${b}`);
  if (p.dmg) out.push("damaged");
  if (p.pump) out.push("pumped");
  if (p.walk) out.push("walks");
  if (p.ent === turn) out.push("arrived");
  return out;
}
/** The marks of a card by name under a prefix pair (card/fact, tcard/tfact), compiled once per pool. */
function nameMarks(P, pre, fpre, name) {
  compiled(P);
  let byPre = P._marks.get(pre);
  if (!byPre) P._marks.set(pre, (byPre = new Map()));
  let m = byPre.get(name);
  if (!m) {
    const out = [], add = k => { const i = P.mark.get(k); if (i != null) out.push(i); };
    add(`${pre}:${name}`);
    for (const f of P.factsOf.get(name) || []) add(`${fpre}:${f}`);
    byPre.set(name, (m = Int32Array.from(out)));
  }
  return m;
}
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
// version 3 (18 Nov 2026, Korbi 14:51–15:08: "make the policy stronger"; the inputs a small net works out badly, appended after
// version 2): computed from the rules' own functions and the card files, no card named:
//   each seat (the seat's, then the other's): untapped mana by colour and in all, all its lands' mana in all and blue, its lands
//     by their current basic type; its creatures' power that could attack (the land type each needs on the other side: the
//     rules' needType, Dandân's own text, so a format with other creatures needs the rules to say it), the power that can
//     attack now (canAttack: untapped, not new, its turn), turns to lethal at the first, how near its creatures are to being
//     sacrificed (the fewest of its lands of the type one of them needs: a creature with none is gone already), its creatures;
//   the counter window: the chance the other hand holds an answer (a card that can target a spell on the stack: probed from
//     the rules' targets), the chance it holds one it can cast with its untapped mana now, their untapped mana ≥ 2, my answers in
//     hand and those castable now, whether the top of the stack is my spell;
//   the library short (≤ 1, ≤ 3, ≤ 6); cards drawn this turn, each seat;
//   the stack's top four items' targets: the target's card and facts, and whose
const SEAT3 = 6 + 1 + 2 + BASICS.length + 5 + 10, WIN3 = 6, extra3 = P => 2 * SEAT3 + WIN3 + 3 + 2 + 2 + STACK * (P.V + P.F + 2);
export const viewSize = (P = POOL, v = 3) => viewSize1(P) + (v >= 2 ? extra2(P) : 0) + (v >= 3 ? extra3(P) : 0);
export const VIEW_VERSIONS = P => [viewSize(P, 1), viewSize(P, 2), viewSize(P, 3)];
/** Which of the pool's names can answer a spell (target one on the stack), probed from the rules' targets once per pool. */
export function answers(P = POOL) {
  if (P._ans) return P._ans;
  // the probe: the other seat's instant on the stack (the pool's first instant; Narset's Reversal answers instants and sorceries only)
  const instant = P.vocab.flatMap(n => HALVES[n] || [n]).find(h => CARDS[h]?.type === "instant") || "?";
  const probe = { stack: [{ kind: "spell", sid: 1, name: instant, ctl: 1, card: -1 }], bf: [], yard: [], exile: [], hand: [[], []], lib: [], life: [20, 20], turn: 1 };
  const can = h => { try { return targetLists(probe, 0, h).some(ts => ts.some(t => t?.k === "s")); } catch { return false; } };
  const ans = Uint8Array.from(P.vocab.map(n => ((HALVES[n] || [n]).some(can) ? 1 : 0)));
  Object.defineProperty(P, "_ans", { value: ans, enumerable: false });
  return ans;
}
const COLOR_OF = { W: 0, U: 1, B: 2, R: 3, G: 4, C: 5 };
/** Version 3's part: from the observation, at offset k; `ans`: the chance the other hand holds an answer (null: from theirAny). */
/**
 * The mana a seat can make at instant speed: one entry a source, its alternatives (each a list of colour letters): untapped lands
 * (Izzet Boilerworks: blue and red together), untapped fetch lands whose kind may still be in the library as the observer sees it
 * (a known library place, or a card it hasn't seen: cracked, the land comes in untapped), and the floating pool.
 */
const mayFetch = (o, types) => o.lib.some(id => id !== HIDDEN && id != null && hasType(id, types)) || o.unseenIds.some(id => hasType(id, types));
function sourcesOf(o, x) {
  const out = [], may = types => mayFetch(o, types);
  for (const l of lands(o, x)) {
    if (l.tapped) continue;
    const ft = fetchTypes(l);
    if (ft.length) { if (may(ft)) out.push(ft.map(t => [BASIC_MANA[t]]).filter(a => a[0])); continue; }
    const alts = manaAlts(l);
    if (alts.length) out.push(alts);
  }
  for (const c of manaPool(o, x)) out.push([[c]]);
  return out;
}
/** Whether sources (sourcesOf) pay a cost ({ g, U, R, … }): every way of picking one alternative a source, tried (a handful of sources). */
function payable(cost, src) {
  const need = Object.entries(cost).filter(([c, n]) => c !== "g" && n), total = Object.values(cost).reduce((a, b) => a + b, 0);
  if (!total) return true;
  const have = {};
  const go = i => {
    if (i === src.length) { let t = 0; for (const c in have) t += have[c]; return t >= total && need.every(([c, n]) => (have[c] || 0) >= n); }
    for (const alt of src[i]) { for (const c of alt) have[c] = (have[c] || 0) + 1; const ok = go(i + 1); for (const c of alt) have[c]--; if (ok) return true; }
    return go(i + 1);   // the source left unused
  };
  return src.length <= 12 ? go(0) : true;
}
const libOf = name => (HALVES[name] || [name]).reduce((a, h) => { const l = LIBRARY[h] || {}; return { take: Math.max(a.take, l.take || 0, l.cycle || 0), add: Math.max(a.add, l.add || 0) }; }, { take: 0, add: 0 });
function view3(o, seat, P, out, k, theirHand, theirAny, ans) {
  const opp = other(seat), Z = P.V + P.F, A = answers(P), C = compiled(P), SRC = [sourcesOf(o, seat), sourcesOf(o, opp)];
  // the shared library's race: whose draw comes next, and who would draw from the empty library first if nobody draws extra
  const L = o.lib.length, nextDraw = (o.step === "upkeep" || o.step === "draw") && !(o.drawn?.[o.active]) ? o.active : other(o.active);
  const fatal = L % 2 === 0 ? nextDraw : other(nextDraw);
  for (const x of [seat, opp]) {
    const ls = lands(o, x), b = k, src = SRC[x === seat ? 0 : 1];
    let untapped = 0, all = 0, allU = 0;
    for (const l of ls) {
      const alts = manaAlts(l), most = alts.reduce((a, m) => Math.max(a, m.length), 0), cs = new Set(alts.flat());
      all += most; if (cs.has("U")) allU += 1;
      if (!l.tapped) { untapped += most; for (const c of cs) out[b + COLOR_OF[c]] += 1 / 4; }
    }
    // scales in quarters and eighths (exact in a float: no rounding of their own)
    out[b + 6] = Math.min(8, untapped) / 4; out[b + 7] = Math.min(16, all) / 8; out[b + 8] = Math.min(16, allU) / 8;
    BASICS.forEach((t, i) => { out[b + 9 + i] = Math.min(8, ls.filter(l => typesOf(l).includes(t)).length) / 4; });
    const theirLands = lands(o, other(x)), mine = creatures(o, x);
    const power = mine.filter(c => theirLands.some(l => typesOf(l).includes(needType(c)))).reduce((a, c) => a + Math.max(0, pt(c)[0]), 0);
    const now = mine.filter(c => canAttack(o, c)).reduce((a, c) => a + Math.max(0, pt(c)[0]), 0);
    let j = b + 9 + BASICS.length;
    out[j] = Math.min(16, power) / 8;
    out[j + 1] = Math.min(16, now) / 8;
    out[j + 2] = power > 0 ? Math.min(16, Math.ceil(Math.max(1, o.life[other(x)]) / power)) / 16 : 1;
    out[j + 3] = mine.length ? Math.min(4, Math.min(...mine.map(c => ls.filter(l => typesOf(l).includes(needType(c))).length))) / 4 : 1;
    out[j + 4] = Math.min(8, mine.length) / 4;
    j += 5;
    // mana at instant speed with the fetch lands cracked: sources, and those that can make blue
    out[j] = Math.min(8, src.length) / 4; out[j + 1] = Math.min(8, src.filter(a => a.some(m => m.includes("U"))).length) / 4;
    out[j + 2] = Math.min(4, ls.filter(l => !l.tapped && fetchTypes(l).length).length) / 4;
    // the race: faces the empty library first, its own draws until then (its failing one counted)
    out[j + 3] = fatal === x ? 1 : 0;
    out[j + 4] = Math.min(16, x === nextDraw ? Math.floor(L / 2) + 1 : Math.floor((L + 1) / 2) + 1) / 16;
    // cards that take from or add to the library: held (mine as they are, theirs as the belief), and on its battlefield
    let tk = 0, tkN = 0, ad = 0;
    if (x === seat) for (const id of o.hand[seat]) { const l = libOf(cardNameOf(id)); if (l.take) { tk++; tkN += l.take; } if (l.add) ad++; }
    else P.vocab.forEach((n, i) => { const c = theirHand[i]; if (!c) return; const l = libOf(n); if (l.take) { tk += c; tkN += c * l.take; } if (l.add) ad += c; });
    const inPlay = o.bf.filter(p => p.ctl === x && libOf(cardNameOf(p.id)).take && (!fetchTypes(p).length || (!p.tapped && mayFetch(o, fetchTypes(p))))).length;
    out[j + 5] = Math.min(4, tk) / 4; out[j + 6] = Math.min(16, tkN) / 8; out[j + 7] = Math.min(4, inPlay) / 4; out[j + 8] = Math.min(4, ad) / 4;
    out[j + 9] = Math.min(8, o.hand[x].length) / 4;
    k += SEAT3;
  }
  // the counter window: castable with the mana each seat can make at instant speed (fetch lands, two-mana lands, the pool)
  const castable = (x, name) => (HALVES[name] || [name]).some(h => A[P.at.get(name)] && CARDS[h]?.cost != null && payable(parseCost(CARDS[h].cost), SRC[x === seat ? 0 : 1]));
  let none = 1, noneNow = 1;
  P.vocab.forEach((n, i) => {
    if (!A[i]) return;
    const q = theirAny ? theirAny[i] : theirHand[i] > 0.5 ? 1 : 0;
    none *= 1 - q;
    if (q && castable(opp, n)) noneNow *= 1 - q;
  });
  const anyAns = ans != null ? ans : 1 - none, nowAns = Math.min(anyAns, 1 - noneNow);
  out[k] = anyAns; out[k + 1] = nowAns;
  out[k + 2] = payable({ g: 2 }, SRC[1]) ? 1 : 0;   // they can make two mana now
  let held = 0, heldNow = 0;
  for (const id of o.hand[seat]) { const n = cardNameOf(id), i = P.at.get(n); if (i != null && A[i]) { held++; if (castable(seat, n)) heldNow++; } }
  out[k + 3] = Math.min(4, held) / 4; out[k + 4] = Math.min(4, heldNow) / 4;
  const top = o.stack[o.stack.length - 1];
  out[k + 5] = top && top.kind === "spell" && top.ctl === seat ? 1 : 0;
  k += WIN3;
  out[k] = L <= 1 ? 1 : 0; out[k + 1] = L <= 3 ? 1 : 0; out[k + 2] = L <= 6 ? 1 : 0; k += 3;
  out[k] = Math.min(8, o.drawn?.[seat] || 0) / 4; out[k + 1] = Math.min(8, o.drawn?.[opp] || 0) / 4; k += 2;
  // the graveyard: cards castable from it (aftermath, flashback), and the library's adders among them
  const yc = o.yard.map(id => nameOf(id)).filter(Boolean).flatMap(n => HALVES[n] || [n]).filter(h => CARDS[h]?.aftermath || CARDS[h]?.flashback);
  out[k] = Math.min(4, yc.length) / 4; out[k + 1] = Math.min(4, o.yard.length) / 32; k += 2;
  // the stack's targets
  for (let j = 0; j < STACK; j++, k += Z + 2) {
    const it = o.stack[o.stack.length - 1 - j], t = it?.targets?.[0];
    if (!t) continue;
    let name = null, whose = null;
    if (t.k === "c") { const p = o.bf.find(x => x.id === t.id); if (p) { name = cardNameOf(p.id); whose = p.ctl; } }
    else if (t.k === "s") { const x = o.stack.find(y => y.sid === t.sid); if (x) { name = x.card != null ? nameOf(x.card) : null; whose = x.ctl; } }
    else if (t.k === "g") { name = nameOf(t.id); whose = seat; }
    else if (t.k === "p") whose = t.seat;
    const e = name != null ? C.get(name) : null;
    if (e) { out[k + e.i] = 1; for (let q = 0; q < e.fj.length; q++) out[k + P.V + e.fj[q]] = 1; }
    if (whose != null) out[k + Z + (whose === seat ? 0 : 1)] = 1;
  }
  return k;
}

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
export function generalView(s, seat, theirHand, theirAny = null, P = POOL, out = new Float32Array(viewSize(P)), ans = null) {
  const o = observe(s, seat), opp = other(seat), Z = P.V + P.F;
  out.fill(0);
  const C = compiled(P);
  const card = (z, name, w = 1) => {
    const e = C.get(name);
    if (!e) return;
    const base = z * Z, q = w / 4, fb = base + P.V, fj = e.fj;
    out[base + e.i] += q;
    for (let t = 0; t < fj.length; t++) out[fb + fj[t]] += q;
  };
  const byId = (z, id, w = 1) => {
    if (id == null || id === HIDDEN) return;
    const e = idEntry(P, id);
    if (!e) return;
    const base = z * Z, q = w / 4, fb = base + P.V, fj = e.fj;
    out[base + e.i] += q;
    for (let t = 0; t < fj.length; t++) out[fb + fj[t]] += q;
  };
  const live = [];
  const perm = (z, p) => {
    const base = z * Z, e = idEntry(P, p.id), fb = base + P.V;
    if (e) { out[base + e.i] += 0.25; for (let t = 0; t < e.pj.length; t++) out[fb + e.pj[t]] += 0.25; }
    else for (const f of (P.factsOf.get(cardNameOf(p.id)) || []).filter(f => !f.startsWith("sub:"))) { const j = P.fat.get(f); if (j != null) out[fb + j] += 0.25; }
    live.length = 0;
    for (const f of liveFacts(p, o.turn, live)) { const j = P.fat.get(f); if (j != null) out[fb + j] += 0.25; }
  };
  for (const id of o.hand[seat]) byId(0, id);
  P.vocab.forEach((n, i) => { if (theirHand[i]) card(1, n, theirHand[i]); });
  for (const p of o.bf) perm((p.ctl === seat ? 2 : 4) + (p.tapped ? 1 : 0), p);
  for (const id of o.yard) byId(6, id);
  for (const id of o.exile) byId(7, id);
  for (let i = 0; i < 5; i++) { const id = o.lib[i]; if (id != null && id !== HIDDEN) byId(8, id, 1 - i / 5); }
  // the unseen pool: every card of the pool less those this seat has seen (the hidden ones, by name: public)
  for (const id of o.unseenIds) byId(9, id);
  let k = ZONES.length * Z;
  for (let i = 0; i < P.V; i++) out[k + i] = theirAny ? theirAny[i] : theirHand[i] > 0.5 ? 1 : 0;
  k += P.V;
  for (let j = 0; j < STACK; j++, k += Z + 6) {
    const it = o.stack[o.stack.length - 1 - j];
    if (!it) continue;
    const e = it.card != null ? C.get(nameOf(it.card)) : null;
    if (e) { out[k + e.i] = 1; for (let t = 0; t < e.fj.length; t++) out[k + P.V + e.fj[t]] = 1; }
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
  if (out.length >= viewSize(P, 2)) k = view2(o, seat, P, out, k);
  if (out.length >= viewSize(P, 3)) view3(o, seat, P, out, k, theirHand, theirAny, ans);
  return out;
}
/** Version 2's part (see viewSize): from the observation, at offset k. */
function view2(o, seat, P, out, k) {
  const opp = other(seat), Z = P.V + P.F, theirs = new Set(o.theirLib || []);
  const C = compiled(P);
  const cardAt = (base, name, w = 1) => {
    const e = C.get(name);
    if (!e) return;
    const q = w / 4, fb = base + P.V, fj = e.fj;
    out[base + e.i] += q;
    for (let t = 0; t < fj.length; t++) out[fb + fj[t]] += q;
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
  return k;
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
export function generalMarks(s, seat, m, P = POOL, legacy = false) {
  const out = new Set(), add = k => { const i = P.mark.get(k); if (i != null) out.add(i); };
  const cardMarks = (name, pre = "card", fpre = "fact") => {
    if (name == null) return;
    if (!P.at.has(name)) { add(`${pre}:${name}`); for (const f of P.factsOf.get(name) || []) add(`${fpre}:${f}`); return; }
    for (const i of nameMarks(P, pre, fpre, name)) out.add(i);
  };
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
    // each pair (18 Nov 2026: a block's marks were its count alone): the blocker as card/fact, the attacker it blocks as tcard/tfact;
    // legacy: the count alone, for a policy from before view version 3
    case "block": add(`count:${Math.min(4, m.pairs.length)}`); if (!legacy) for (const [bl, at] of m.pairs) { const p = s.bf.find(x => x.id === bl), q = s.bf.find(x => x.id === at); if (p) permMarks(p, "card", "fact"); if (q) permMarks(q, "tcard", "tfact"); } break;
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
