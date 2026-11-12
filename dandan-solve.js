// The exact endgame calculator (lab, 12 November 2026; Fable's option 3, Korbi: "make sure that ALL the possibilities are
// considered: the deck-out endgame is a highly tactical moment that typically resolves within a single stack as people
// remove and add cards from the top of the deck to make their opponents draw dead").
//
// For one deal of the cards a player can't see (dandan-think.js `determinize`), it searches the game to its end with both
// sides choosing their best moves (minimax, alpha-beta, a table of positions already met): the method bridge programs
// call double-dummy solving. Over several deals it votes: the move that wins in the most deals.
//
// Every possibility, at every decision (`choices`, checked against a brute force by tests/solve.mjs):
//   - every priority stop of both players' turns, every step, and every response on the stack (fullStops below: the
//     game's usual stops pass over steps such as the other player's draw step and main phase);
//   - with priority: passing; every land, cast (each mode, each set of targets), cycling and ability; each paid with every
//     different set of lands (which lands stay untapped matters: a Mind Bend, a Boilerworks bounce, a second spell); each
//     cast either passing priority or holding it (to stack a second spell of one's own before the other may answer);
//     with something on the stack, tapping a land for mana on its own (it floats until the step ends: tapped in answer
//     to a spell that will take or change that land);
//   - every answer to a question: every pair of cards a Brainstorm puts back in each order, every discard, every
//     attack and every block, every order of Halimar Depths' cards, a search that finds any card or nothing (a Flood
//     Plain or an islandcycling may fail to find: the library keeps one card more), Predict's name as a hit or a miss,
//     Mystic Sanctuary's card or none, every Mind Bend, every new target for a copy.
// Answers that leave the same position are weighed once (two Islands to put back are one choice).
//
// What it assumes, as double-dummy solving does: within a deal, both players see every card. Near the end of the library
// little is hidden, so the error is small; the vote over deals is what weighs what a player really can't know.
// A shuffle (Flood Plain, islandcycling) is a chance: the position after it is averaged over `shuffles` orders.
// Memory resolving starts a new game (seven cards each from a full library): the search stops there and takes the value
// net's chance. A position met again on the path being searched is a draw (Memory Lapse and bounce can go round).
// Values are seat 0's: 1 a win, 0 a loss, a half when both lose (or a loop).
import { DECK, NAMES, BASICS, CARDS, HALVES } from "./dandan-cards.js";
import { act, moves, toMove, payment, fullStops } from "./dandan-engine.js";
import { payFrom, manaAlts, isLand, defOf } from "./dandan-core.js";
import { RES } from "./dandan-spells.js";
import { fork, determinize } from "./dandan-think.js";
import { seeded } from "./seats.js";
import { policyMove } from "./dandan-policy.js";

const PASS = { t: "pass" };
const nm = id => DECK[id] ?? "Clue";

// Memory resolving, seen as it happens (the engine's own resolution, wrapped; it does the same when no search runs)
let solving = 0, memoryHit = false;
const MEMORY = RES.Memory;
RES.Memory = function (s, it) { if (solving && it.step === 0) memoryHit = true; return MEMORY.call(this, s, it); };

/** A position's name: cards by name (two Islands are the same), every part of the state the rules read. */
export function keyOf(s) {
  const bf = s.bf.map(p => `${nm(p.id)}${p.ctl}${p.tapped ? "t" : ""}${p.ent === s.turn ? "n" : ""}${p.trig ? "x" : ""}${p.tc ? JSON.stringify(p.tc) : ""}${p.pump ? JSON.stringify(p.pump) : ""}${p.walk ? "w" : ""}${p.dmg ? "d" + p.dmg : ""}`).sort().join(",");
  return [s.turn % 2, s.active, s.step, s.prio, s.passes, s.life, s.drawn, s.played, s.attacked ? 1 : 0, s.quick, s.lost, s.res,
    s.hand.map(h => h.map(nm).sort().join(",")).join("|"), bf, s.yard.map(nm).sort().join(","), s.lib.map(nm).join(","), s.exile.length,
    JSON.stringify(s.stack.map(it => [it.sid, nm(it.card ?? -1), it.name, it.ctl, it.targets, it.d, it.mode, it.step, it.stop ? 1 : 0, it.aim ? 1 : 0])),
    JSON.stringify(s.pending), JSON.stringify(s.pool), JSON.stringify(s.combat)].join("#");
}

// ---------- every choice ----------
const subsets = a => a.reduce((acc, x) => acc.concat(acc.map(r => [...r, x])), [[]]);
function perms(a) {
  if (a.length <= 1) return [a.slice()];
  const out = [];
  a.forEach((x, i) => { for (const r of perms([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...r]); });
  return out;
}
/** Every way of choosing n cards from a hand: ordered (a putback, top card first) or not; one for each different set of names. */
function pickN(hand, n, ordered) {
  const out = [], seen = new Set();
  const go = (start, chosen) => {
    if (chosen.length === n) {
      const k = ordered ? chosen.map(nm).join(",") : chosen.map(nm).sort().join(",");
      if (!seen.has(k)) { seen.add(k); out.push(chosen.slice()); }
      return;
    }
    for (let i = ordered ? 0 : start; i < hand.length; i++) if (!chosen.includes(hand[i])) { chosen.push(hand[i]); go(i + 1, chosen); chosen.pop(); }
  };
  go(0, []);
  return out;
}
const byName = (ids, k = nm) => { const m = new Map(); for (const id of ids) if (!m.has(k(id))) m.set(k(id), id); return [...m.values()]; };

/** Every answer to the question a seat is asked. */
function answers(s, seat) {
  const p = s.pending, out = [];
  switch (p.t) {
    case "attack": for (const ids of subsets(p.ids)) out.push({ t: "attack", ids }); break;
    case "block": {
      // each blocker blocks one attacker or none
      let all = [[]];
      for (const b of p.blockers) all = all.flatMap(pairs => [pairs, ...p.attackers.map(a => [...pairs, [b, a]])]);
      for (const pairs of all) out.push({ t: "block", pairs });
      break;
    }
    case "order": { const seen = new Set(); for (const o of perms(p.cards)) { const k = o.map(nm).join(","); if (!seen.has(k)) { seen.add(k); out.push({ t: "order", cards: o }); } } break; }
    case "surveil": out.push({ t: "surveil", yard: true }, { t: "surveil", yard: false }); break;
    case "search": for (const id of byName(p.ids)) out.push({ t: "search", card: id }); out.push({ t: "search", card: null }); break;
    case "pick": {
      const key = p.for === "boil" ? id => { const q = s.bf.find(x => x.id === id); return `${nm(id)}${q?.tapped ? "t" : ""}${q?.tc ? JSON.stringify(q.tc) : ""}${q?.ent === s.turn ? "n" : ""}`; } : nm;
      for (const id of byName(p.ids, key)) out.push({ t: "pick", card: id });
      if (p.optional) out.push({ t: "pick", card: null });
      break;
    }
    case "owner": out.push({ t: "owner", bottom: true }, { t: "owner", bottom: false }); break;
    case "bend": for (const from of p.froms) for (const to of BASICS) if (to !== from) out.push({ t: "bend", from, to }); break;
    case "retarget": out.push({ t: "retarget", targets: [] }); for (const o of p.options) out.push({ t: "retarget", targets: o }); break;
    case "putback": for (const cards of pickN(s.hand[seat], p.n, true)) out.push({ t: "putback", cards }); break;
    case "discard": case "bottom": for (const cards of pickN(s.hand[seat], Math.min(p.n, s.hand[seat].length), false)) out.push({ t: p.t, cards }); break;
    case "name": {
      // in a deal the top card is fixed: naming it is a hit, naming anything else a miss, and those are the two outcomes
      const top = s.lib.length ? DECK[s.lib[0]] : null;
      if (top) out.push({ t: "name", name: top });
      const miss = NAMES.find(n => n !== top);
      if (miss) out.push({ t: "name", name: miss });
      break;
    }
    case "mull": out.push({ t: "keep" }, { t: "mull" }); break;
    default: throw new Error("dandan-solve: no answers for " + p.t);
  }
  return out;
}

/** The mana lands of a seat that are untapped. */
const sources = (s, seat) => s.bf.filter(p => p.ctl === seat && !p.tapped && isLand(p) && manaAlts(p).length);
const landKey = p => `${nm(p.id)}${p.tc ? JSON.stringify(p.tc) : ""}`;
/**
 * Every different way to pay a move: the sets of lands that pay it with none to spare (a land more only floats mana that
 * empties at the step's end, and tapping one on its own is a move of its own with a spell on the stack). Sets of the same
 * lands by name are one. null: the move costs no mana.
 */
function payments(s, seat, m) {
  const pay = payment(s, seat, m);
  if (!pay) return [null];
  const need = pay.cost.g + pay.cost.U + pay.cost.R;
  // the lands by kind (an Island is an Island): each set is so many of each kind, never more lands than mana needed
  const kinds = new Map();
  for (const p of sources(s, seat)) { const k = landKey(p); if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(p.id); }
  const groups = [...kinds.values()], out = [];
  const pays = ids => !!payFrom(s, seat, pay.cost, ids);
  const go = (g, ids) => {
    if (g === groups.length) {
      if (!ids.length || !pays(ids)) return;
      // none to spare: no land of the set could stay untapped
      if (ids.some((_, i) => pays(ids.filter((__, j) => j !== i)))) return;
      out.push(ids.slice());
      return;
    }
    for (let n = 0; n <= groups[g].length && ids.length + n <= need; n++) go(g + 1, [...ids, ...groups[g].slice(0, n)]);
  };
  go(0, []);
  return out.length ? out : [null];
}

/**
 * The race scope (Fable and Korbi, 12 November 2026: option 2): every possibility where the fight over who draws last is
 * fought, and Medium's own choice elsewhere. Every land; every cast, cycling and ability that takes from or adds to the
 * library (below), with every target; with a spell on the stack, every response of any kind; every answer that orders, puts
 * back, mills, finds, names or discards; and Medium's move at each decision as well, so what it would do besides is played.
 * Paid as the game pays by itself (the auto plan), holding priority; attacks and blocks are Medium's.
 */
const LIBRARY = new Set(["Brainstorm", "Predict", "Quicken", "Repulse", "Memory Lapse", "Commit", "Memory", "Gone Missing", "Deem Inferior", "Metamorphose",
  "Chart a Course", "Lórien Revealed", "Take Inventory", "Narset's Reversal"]);
const MEDIUM_ANSWERS = new Set(["attack", "block"]);
const half = m => { const full = DECK[m.card]; return m.from === "yard" && full === "Commit // Memory" ? "Memory" : HALVES[full] ? HALVES[full][0] : full; };
const sameMove = (a, b) => JSON.stringify({ ...a, hold: undefined, taps: undefined }) === JSON.stringify({ ...b, hold: undefined, taps: undefined });
function raceChoices(s, seat) {
  const medium = policyMove(s, seat, { rng: seeded(1) });
  if (s.pending) {
    const out = MEDIUM_ANSWERS.has(s.pending.t) ? [] : answers(s, seat);
    if (!out.some(m => sameMove(m, medium))) out.unshift(medium);
    return out;
  }
  const out = [PASS];
  for (const m of moves(s, seat)) {
    const keep = m.t === "land" || m.t === "cycle" || m.t === "ability" || s.stack.length > 0 || (m.t === "cast" && LIBRARY.has(half(m)));
    if (keep) out.push(m.t === "land" ? m : { ...m, hold: true });
  }
  if (!out.some(m => sameMove(m, medium))) out.push(medium);
  return out;
}

/** Every choice the seat to move has (scope "all"), or the race scope's. */
export function choices(s, seat, scope = "all") {
  if (scope === "race") return raceChoices(s, seat);
  if (s.pending) return answers(s, seat);
  const out = [PASS];
  // each spell or ability holding priority: the seat may then stack another of its own, or pass, which is the same position
  // as not holding (the other seat to answer, one pass made), so not holding is among what holding leads to
  for (const m of moves(s, seat)) for (const taps of m.t === "land" ? [null] : payments(s, seat, m)) out.push({ ...m, ...(taps && taps.length ? { taps } : {}), ...(m.t === "land" ? {} : { hold: true }) });
  // a land tapped for mana on its own: the mana floats until the step ends, and the seat is given priority again before
  // that (after every resolution, and both must pass to end a step), so it is worth more than tapping the land when the
  // mana is spent only if the land may not be there to tap by then: something on the stack aims at it (Mind Bend,
  // Metamorphose) or a Boilerworks of the seat's may return it
  const aimed = new Set(s.stack.flatMap(it => (it.name === "@boil" && it.ctl === seat ? sources(s, seat).map(p => p.id) : (it.targets || []).filter(t => t.k === "c").map(t => t.id))));
  for (const p of sources(s, seat)) if (aimed.has(p.id)) manaAlts(p).forEach((_, alt) => out.push({ t: "mana", id: p.id, alt }));
  return out;
}

// ---------- the search ----------
class Capped extends Error {}
/** A dice that counts how often it is thrown: a move that throws it shuffled. */
function counted(seed) { const r = seeded(seed), f = () => { f.n++; return r(); }; f.n = 0; return f; }
const value = s => (s.winner === 0 ? 1 : s.winner === 1 ? 0 : 0.5);

/**
 * The value of a dealt position for seat 0, both sides playing their best, and of each choice at its root.
 * opts: judge (s, me) → chance, for the cut at Memory; nodes, ms: the budget (over it: capped, value null);
 * shuffles: orders a shuffle is averaged over; rootAll: value every root choice exactly (else alpha-beta at the root too).
 */
export function solve(root, { judge = null, nodes = 2e6, ms = 3e4, shuffles = 3, rootAll = true, turns = Infinity, scope = "all" } = {}) {
  // turns: a horizon (the search stops as the turn `turns` after the root's begins, and takes the value net's chance there);
  // Infinity searches to the end of the game
  const lastTurn = root.turn + turns;
  const st = { nodes: 0, hits: 0, loops: 0, chance: 0, memory: 0, horizon: 0, maxPly: 0, t0: Date.now() }, table = new Map(), path = new Set();
  const wasStops = fullStops(true);
  solving++;
  // one choice made: its value (null if not legal), averaged over the orders of a shuffle it led to
  const child = (s, seat, m, alpha, beta, ply, seen) => {
    let sum = 0, n = 0;
    for (let k = 0; k < shuffles; k++) {
      const c = fork(s), rng = counted(7 + 1000 * k);
      memoryHit = false;
      const r = act(c, seat, m, { rng, quiet: true });
      if (typeof r === "string") return null;
      let v;
      if (memoryHit) { st.memory++; v = judge ? judge(c, 0) : 0.5; }
      else {
        if (k === 0 && seen) { const ck = keyOf(c); if (seen.has(ck)) return undefined; seen.add(ck); }
        v = rec(c, rng.n || k ? -1 : alpha, rng.n || k ? 2 : beta, ply + 1);
      }
      sum += v; n++;
      if (!rng.n) break;          // nothing was shuffled: one order is all there is
      if (k === 0) st.chance++;
    }
    return sum / n;
  };
  const rec = (s, alpha, beta, ply) => {
    if (s.over) return value(s);
    if (s.turn > lastTurn) { st.horizon++; return judge ? judge(s, 0) : 0.5; }
    const seat = toMove(s);
    if (seat == null) return 0.5;
    if (ply > st.maxPly) st.maxPly = ply;
    const k = keyOf(s);
    if (path.has(k)) { st.loops++; return 0.5; }
    const t = table.get(k);
    if (t) {
      if (t.lo >= beta || t.hi <= alpha || t.lo === t.hi) { st.hits++; return t.lo >= beta ? t.lo : t.hi <= alpha ? t.hi : t.lo; }
      alpha = Math.max(alpha, t.lo); beta = Math.min(beta, t.hi);
    }
    if (++st.nodes > nodes || ((st.nodes & 1023) === 0 && Date.now() - st.t0 > ms)) throw new Capped();
    if (ply > 600) return 0.5;
    const a0 = alpha, b0 = beta, seen = new Set();
    let best = seat === 0 ? -1 : 2;
    path.add(k);
    for (const m of choices(s, seat, scope)) {
      const v = child(s, seat, m, alpha, beta, ply, seen);
      if (v == null) continue;
      if (seat === 0) { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
      if (alpha >= beta) break;
    }
    path.delete(k);
    if (best === -1 || best === 2) best = 0.5;
    const e = table.get(k) || { lo: 0, hi: 1 };
    if (best <= a0) e.hi = Math.min(e.hi, best); else if (best >= b0) e.lo = Math.max(e.lo, best); else { e.lo = best; e.hi = best; }
    table.set(k, e);
    return best;
  };
  let out;
  try {
    if (root.over) out = { value: value(root), list: [] };
    else {
      const seat = toMove(root), list = [], seen = new Set();
      let alpha = -1, beta = 2;
      for (const m of choices(root, seat, scope)) {
        const v = rootAll ? child(root, seat, m, -1, 2, 0, seen) : child(root, seat, m, alpha, beta, 0, seen);
        if (v == null) continue;
        list.push({ move: m, value: v });
        if (!rootAll) { if (seat === 0) alpha = Math.max(alpha, v); else beta = Math.min(beta, v); }
      }
      list.sort((a, b) => (seat === 0 ? b.value - a.value : a.value - b.value));
      out = { value: list.length ? list[0].value : 0.5, list };
    }
    out.capped = false;
  } catch (e) {
    if (!(e instanceof Capped)) throw e;
    out = { value: null, list: [], capped: true };
  } finally {
    solving--;
    fullStops(wasStops);
  }
  return { ...out, nodes: st.nodes, distinct: table.size, hits: st.hits, loops: st.loops, chance: st.chance, memory: st.memory, horizon: st.horizon, maxPly: st.maxPly, ms: Date.now() - st.t0 };
}

/** A choice's name for a report: what it is, by card names. */
export function choiceName(s, m) {
  const c = id => (id == null ? "nothing" : nm(id));
  switch (m.t) {
    case "pass": return "pass";
    case "land": return "play " + c(m.card);
    case "cast": return `cast ${c(m.card)}${m.from === "yard" ? " from the graveyard" : ""}${m.mode != null ? " mode " + m.mode : ""}${m.targets?.length ? " at " + m.targets.map(t => t.k === "s" ? s.stack.find(i => i.sid === t.sid)?.name ?? "a spell" : t.k === "p" ? "seat " + t.seat : c(t.id)).join(", ") : ""}${m.taps ? " tapping " + m.taps.map(c).join("+") : ""}${m.hold ? " (holding priority)" : ""}`;
    case "cycle": return `cycle ${c(m.card)}${m.hold ? " (holding priority)" : ""}`;
    case "ability": return `use ${c(m.id)}${m.hold ? " (holding priority)" : ""}`;
    case "mana": return `tap ${c(m.id)} for mana`;
    case "putback": return "put back " + m.cards.map(c).join(" then ");
    case "discard": case "bottom": return m.t + " " + m.cards.map(c).join(", ");
    case "search": return "find " + c(m.card);
    case "pick": return "pick " + c(m.card);
    case "name": return "name " + m.name;
    case "attack": return m.ids.length ? `attack with ${m.ids.length}` : "no attack";
    case "block": return m.pairs.length ? `block ${m.pairs.length}` : "no block";
    default: return JSON.stringify(m);
  }
}

/**
 * The vote over deals for the seat to move at a real position: each deal of what it can't see solved, and for each of its
 * choices the deals it wins (value ≥ 0.75 for it), draws and loses, and its mean value. Capped deals are counted apart.
 */
export function solveDeals(s, { deals = 16, seed = 1, ...opts } = {}) {
  const seat = toMove(s), rng = seeded(seed), table = new Map(), runs = [];
  for (let d = 0; d < deals; d++) {
    const world = determinize(s, seat, rng, false);
    const r = solve(world, opts);
    runs.push({ capped: r.capped, nodes: r.nodes, ms: r.ms, value: r.value });
    if (r.capped) continue;
    for (const { move, value: v } of r.list) {
      const mine = seat === 0 ? v : 1 - v, k = JSON.stringify({ ...move, taps: move.taps?.map(nm).sort() });
      const e = table.get(k) || { move, name: choiceName(world, move), wins: 0, draws: 0, losses: 0, sum: 0, n: 0 };
      if (mine >= 0.75) e.wins++; else if (mine <= 0.25) e.losses++; else e.draws++;
      e.sum += mine; e.n++;
      table.set(k, e);
    }
  }
  const list = [...table.values()].map(e => ({ ...e, mean: e.sum / e.n })).sort((a, b) => b.wins - a.wins || b.mean - a.mean);
  return { seat, list, runs };
}
