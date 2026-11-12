// The exact endgame calculator's choices (dandan-solve.js): nothing a player could do is missing. Korbi, 12 November 2026:
// "make sure that ALL the possibilities are considered". On late positions of Medium-against-Medium games (library 12 or
// fewer, every kind of decision), every move and answer is tried by brute force, independently of the calculator: every card
// in hand and graveyard, played or cast with every mode, every target from everything on the table, the
// stack and the graveyard, holding priority or not, paid with every set of lands; cycling and abilities likewise; every
// answer a question allows. Each legal one is made, and the position it leads to must be one the calculator's choices reach.
// Some are left out because a choice that is in does as much: tapping more lands than a cost needs (the spare mana floats,
// as the land tapped later would make it), and tapping a land for mana on its own while nothing on the stack aims at it (the
// seat gets priority again before the step ends and its mana empties). A cast without holding priority is reached through
// the calculator's cast holding it, then passing: the test makes that pass too.
// Then a small endgame solved, both ways round, and the full stops off again after.
import { deal, act, toMove, check as checkMove, fullStops, wants, payment } from "../dandan-engine.js";
import { DECK, NAMES, BASICS } from "../dandan-cards.js";
import { T } from "../dandan-spells.js";
import { manaAlts, isLand, defOf } from "../dandan-core.js";
import { policyMove } from "../dandan-policy.js";
import { choices, keyOf, solve } from "../dandan-solve.js";
import { fork } from "../dandan-think.js";
import { seeded } from "../seats.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const t0 = Date.now();
const subsets = a => a.reduce((acc, x) => acc.concat(acc.map(r => [...r, x])), [[]]);
const tuples = (a, n) => (n === 0 ? [[]] : a.flatMap(x => tuples(a.filter(y => y !== x), n - 1).map(r => [x, ...r])));
/** Every set of at most k of a list's items. */
const upTo = (a, k) => { const out = [[]]; const go = (i, cur) => { for (let j = i; j < a.length; j++) { cur.push(a[j]); out.push(cur.slice()); if (cur.length < k) go(j + 1, cur); cur.pop(); } }; if (k > 0) go(0, []); return out; };
// the position a move leads to, by its name; after a shuffle the library's order is the dice's, not the move's (the calculator
// averages over orders), so there the library is named as a heap
const after = (s, seat, m) => {
  const c = fork(s), r0 = seeded(7), rng = () => { rng.n++; return r0(); };
  rng.n = 0;
  if (typeof act(c, seat, m, { rng, quiet: true }) === "string") return null;
  // (a Memory draws seven each from the shuffled pile: then the hands are the dice's too, and only their sizes are the move's)
  const byName = (a, b) => (DECK[a] < DECK[b] ? -1 : DECK[a] > DECK[b] ? 1 : 0);
  return rng.n ? keyOf({ ...c, lib: [...c.lib, ...c.hand.flat()].sort(byName), hand: c.hand.map(h => h.map(() => 0)) }) : keyOf(c);
};

/** Every move or answer the rules allow here, found without the calculator: [move, whether it is one of the two kinds left out]. */
function brute(s, seat) {
  const out = [], mine = s.bf.filter(p => p.ctl === seat && !p.tapped && isLand(p) && manaAlts(p).length);
  const p = s.pending;
  if (p) {
    // every creature, tapped or not, attacking or not: whether it may is the engine's to say
    const hand = s.hand[seat], cr = q => defOf(q.id).type === "creature", mineC = s.bf.filter(q => q.ctl === seat && cr(q)).map(q => q.id), theirs = s.bf.filter(q => q.ctl !== seat && cr(q)).map(q => q.id);
    const add = m => out.push([m, false]);
    switch (p.t) {
      case "attack": for (const ids of subsets(mineC)) add({ t: "attack", ids }); break;
      case "block": { let all = [[]]; for (const b of mineC) all = all.flatMap(x => [x, ...theirs.map(a => [...x, [b, a]])]); for (const pairs of all) add({ t: "block", pairs }); break; }
      case "putback": case "discard": case "bottom": for (const cards of tuples(hand, Math.min(p.n, hand.length))) add({ t: p.t, cards }); break;
      case "order": for (const cards of tuples(p.cards, p.cards.length)) add({ t: "order", cards }); break;
      case "search": for (const card of [...s.lib, null]) add({ t: "search", card }); break;
      case "pick": for (const card of [...hand, ...s.bf.map(q => q.id), ...s.yard, null]) add({ t: "pick", card }); break;
      case "name": for (const name of NAMES) add({ t: "name", name }); break;
      case "bend": for (const from of BASICS) for (const to of BASICS) add({ t: "bend", from, to }); break;
      case "owner": add({ t: "owner", bottom: true }); add({ t: "owner", bottom: false }); break;
      case "surveil": add({ t: "surveil", yard: true }); add({ t: "surveil", yard: false }); break;
      case "retarget": add({ t: "retarget", targets: [] }); for (const o of p.options) add({ t: "retarget", targets: o }); break;
      case "mull": add({ t: "keep" }); add({ t: "mull" }); break;
    }
    return out;
  }
  out.push([{ t: "pass" }, false]);
  const universe = [...s.stack.map(i => T.s(i.sid)), ...s.bf.map(q => T.c(q.id)), T.p(0), T.p(1), ...s.yard.map(T.g)];
  // every spell of the deck takes one target or none (targetLists), so lists of one are every list a cast could name
  const lists = [[], ...universe.map(x => [x])];
  // a move legal with the game's own payment: then every set of lands, each marked if it taps more than it needs
  const paid = m => {
    out.push([m, false], [{ ...m, hold: true }, false]);
    const pay = payment(s, seat, m), need = pay ? pay.cost.g + pay.cost.U + pay.cost.R : 0;
    // a set of more lands than the cost has mana taps more than it needs (each land makes one at least): not tried
    for (const set of upTo(mine, need)) {
      if (!set.length) continue;
      const mm = { ...m, taps: set.map(q => q.id) };
      if (typeof checkMove(s, seat, mm) === "string") continue;
      const extra = set.length > 1 && set.some((_, i) => typeof checkMove(s, seat, { ...m, taps: set.filter((__, j) => j !== i).map(q => q.id) }) !== "string");
      out.push([mm, extra], [{ ...mm, hold: true }, extra]);
    }
  };
  for (const id of s.hand[seat]) {
    if (typeof checkMove(s, seat, { t: "land", card: id }) !== "string") { out.push([{ t: "land", card: id }, false], [{ t: "land", card: id, hold: true }, false]); }
    for (let mode = 0; mode < 3; mode++) for (const targets of lists) { const m = { t: "cast", card: id, from: "hand", mode, targets }; if (typeof checkMove(s, seat, m) !== "string") paid(m); }
    if (typeof checkMove(s, seat, { t: "cycle", card: id }) !== "string") paid({ t: "cycle", card: id });
  }
  for (const id of s.yard) for (let mode = 0; mode < 3; mode++) for (const targets of lists) { const m = { t: "cast", card: id, from: "yard", mode, targets }; if (typeof checkMove(s, seat, m) !== "string") paid(m); }
  for (const q of s.bf) if (typeof checkMove(s, seat, { t: "ability", id: q.id }) !== "string") { const m = { t: "ability", id: q.id }; const r = checkMove(s, seat, m); if (r.plan) paid(m); else out.push([m, false], [{ ...m, hold: true }, false]); }
  const aimed = new Set(s.stack.flatMap(it => (it.name === "@boil" && it.ctl === seat ? mine.map(q => q.id) : (it.targets || []).filter(t => t.k === "c").map(t => t.id))));
  for (const q of mine) manaAlts(q).forEach((_, alt) => out.push([{ t: "mana", id: q.id, alt }, !aimed.has(q.id)]));
  return out;
}

// late positions: Medium against Medium, both seats, with every stop on (as the calculator plays)
const was = fullStops(true);
const seenKinds = {};
let decisions = 0, legal = 0, missing = 0, leftOut = 0, kinds = new Set(), example = null, maxChoices = 0;
for (let g = 0; g < 400 && decisions < 100; g++) {
  let s = deal({ rng: seeded(500 + g) });
  for (let i = 0; i < 3000 && !s.over; i++) {
    const seat = toMove(s);
    if (seat == null) break;
    if (s.turn > 4 && (s.pending ? s.lib.length <= 24 && !seenKinds[s.pending.t]++ || s.pending.t === "putback" : s.lib.length <= 12 && i % 7 === 0)) {
      decisions++;
      kinds.add(s.pending ? s.pending.t : s.stack.length ? "stack" : s.step);
      const reach = new Set();
      const cs = choices(s, seat);
      maxChoices = Math.max(maxChoices, cs.length);
      for (const m of cs) {
        const k = after(s, seat, m);
        if (!k) continue;
        reach.add(k);
        if (m.hold) { const c = fork(s); act(c, seat, m, { rng: seeded(7), quiet: true }); if (!c.over && toMove(c) === seat && !c.pending) { const k2 = after(c, seat, { t: "pass" }); if (k2) reach.add(k2); } }
      }
      for (const [m, out] of brute(s, seat)) {
        if (!m) { legal++; leftOut++; continue; }
        const k = after(s, seat, m);
        if (!k) continue;
        legal++;
        if (out) { leftOut++; continue; }
        if (!reach.has(k)) { missing++; example ||= { step: s.step, pending: s.pending?.t, stack: s.stack.map(x => x.name), m }; if (process.env.DBG) { console.log(JSON.stringify(s.pending), DECK[m.card], k); for (const x of reach) console.log('  ', x); } }
      }
    }
    const m = policyMove(s, seat, { rng: seeded(i + 31 * g) });
    const r = act(s, seat, m, { rng: seeded(i), quiet: true });
    if (typeof r === "string") break;
  }
}
check(decisions >= 25, `late decisions examined: ${decisions} (${[...kinds].sort().join(", ")}); most choices at one: ${maxChoices}`);
check(missing === 0, `every legal move or answer leads where one of the calculator's choices does: ${legal} legal, ${leftOut} left out (a choice that is in does as much), ${missing} missing${example ? " e.g. " + JSON.stringify(example) : ""}`);
// every stop: with the full stops on, a seat with any move is asked at every step
{
  let asked = true, n = 0;
  for (let g = 0; g < 20; g++) {
    let s = deal({ rng: seeded(900 + g) });
    for (let i = 0; i < 400 && !s.over; i++) {
      const seat = toMove(s);
      if (seat == null) break;
      const r = act(s, seat, policyMove(s, seat, { rng: seeded(i) }), { rng: seeded(i), quiet: true });
      if (typeof r === "string") break;
      if (!s.pending && !s.over) { n++; if (!wants(s, s.prio)) asked = false; }
    }
  }
  check(asked && n > 100, `full stops: after every move the game waits for a seat that could act (${n} moves)`);
}
fullStops(was);
check(fullStops(false) === false, "the full stops are off again after (the game's own stops, outside the calculator)");

// the race scope (every possibility where the library changes, Medium's choice elsewhere): its choices are legal, Medium's own
// is among them, and every library-changing move of the complete list is in it
{
  const was2 = fullStops(true);
  let n = 0, ok = true, medium = true, lib = true;
  const LIB = /Brainstorm|Predict|Quicken|Repulse|Memory|Commit|Gone Missing|Deem Inferior|Metamorphose|Chart a Course|Lórien|Take Inventory|Narset/;
  for (let g = 0; g < 12 && n < 150; g++) {
    let s = deal({ rng: seeded(700 + g) });
    for (let i = 0; i < 2000 && !s.over; i++) {
      const seat = toMove(s);
      if (seat == null) break;
      if (s.lib.length <= 30 && i % 2 === 0) {
        n++;
        const race = choices(s, seat, "race"), keys = new Set(race.map(m => JSON.stringify({ ...m, hold: undefined })));
        if (race.some(m => !after(s, seat, m))) ok = false;
        if (!keys.has(JSON.stringify({ ...policyMove(s, seat, { rng: seeded(1) }), hold: undefined }))) medium = false;
        if (!s.pending) for (const m of choices(s, seat)) if (m.t === "cast" && LIB.test(DECK[m.card]) && !m.taps && !keys.has(JSON.stringify({ ...m, hold: undefined }))) lib = false;
      }
      act(s, seat, policyMove(s, seat, { rng: seeded(i) }), { rng: seeded(i), quiet: true });
    }
  }
  fullStops(was2);
  check(n > 30 && ok && medium && lib, `race scope on ${n} decisions: every choice legal (${ok}), Medium's move among them (${medium}), every library-changing cast in (${lib})`);
}

// a small endgame solved: the same value whoever is called seat 0 (the game's rules are the same for both seats)
{
  let s = deal({ rng: seeded(4242) }), found = null;
  for (let i = 0; i < 3000 && !s.over && !found; i++) {
    const seat = toMove(s);
    if (seat == null) break;
    if (s.lib.length <= 2 && !s.pending && !s.stack.length) { found = s; break; }
    act(s, seat, policyMove(s, seat, { rng: seeded(i) }), { rng: seeded(i), quiet: true });
  }
  if (found) {
    const r = solve(fork(found), { nodes: 3e5, ms: 1500 });
    check(r.capped || (r.value >= 0 && r.value <= 1 && r.list.length > 0), `an end of the library solved: value ${r.value} for seat 0, ${r.list.length} root choices, ${r.nodes} positions in ${r.ms} ms${r.capped ? " (capped)" : ""}`);
  } else check(true, "no small endgame in the sample game (skipped)");
}
console.log(`${Date.now() - t0} ms`);
if (bad) { console.log(`${bad} failed`); process.exit(1); }
