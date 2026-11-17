// Zero (14 Nov 2026, Fable No. 12, Korbi 00:10Z and 02:59Z: "pure, more compute, Deep"): the from-scratch line. Nothing here
// calls dandan-policy.js (Medium) or reads a net or a game of the Medium line: the options are the rules' own (passing and every
// legal move; a question's answers listed by the cards), the look-aheads are played by Zero's own policy head (or at random
// before one is trained), the questions in the look-aheads at random, the hidden cards dealt without dandan-reads.js's tells
// (which read Medium's play), and the position judged by Zero's own value net (or, before one is trained, by nobody: generation 0
// plays at random, with no search). The inputs (dandan-eval.js features, dandan-netpolicy.js viewOf and marksOf) describe the
// game, not how to play it, and are kept.
// Moved from lab/zero/zero-lib.mjs into the app on 15 Nov 2026 (Korbi 16:21: Zero in the game lab): the options, the question
// head's marks, the player and the brain take their nets as objects here; the lab's zero-lib.mjs reads them from files.
import { moves, MOST_MULLS } from "./dandan-engine.js";
import { think } from "./dandan-think.js";
import { DECK, NAMES } from "./dandan-cards.js";
import { makeJudge, features, featuresRace, FEATURES, PLUS, RACE } from "./dandan-eval.js";
import { freeScorer, viewInto, marksOf, VIEW_N } from "./dandan-netpolicy.js";
import { EXT_N, NN, Tracker, scryOf, dealBy, extJudge, ext } from "./dandan-zeroview.js";

export const PASS = { t: "pass" };
const key = m => JSON.stringify(m);
const subsets = a => a.reduce((acc, x) => [...acc, ...acc.map(s => [...s, x])], [[]]);
function orders(a) {
  if (a.length <= 1) return [a.slice()];
  const out = [];
  a.forEach((x, i) => { for (const r of orders([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...r]); });
  return out;
}
/** One card of each name among ids (the first of each), so two copies of a card are one option. */
const byName = ids => { const m = new Map(); for (const id of ids) if (!m.has(DECK[id] ?? id)) m.set(DECK[id] ?? id, id); return [...m.values()]; };
/** n cards out of a hand, by name: every distinct choice (in both orders when `ordered`, for a putback of two). */
function cardsOutOf(hand, n, ordered) {
  if (n <= 1) return byName(hand).map(id => [id]);
  const out = [], seen = new Set();
  const pick = (from, chosen) => {
    if (chosen.length === n) {
      const names = chosen.map(id => DECK[id]), k = ordered ? names.join("|") : names.slice().sort().join("|");
      if (!seen.has(k)) { seen.add(k); out.push(chosen.slice()); }
      return;
    }
    for (let i = ordered ? 0 : from; i < hand.length; i++) if (!chosen.includes(hand[i])) { chosen.push(hand[i]); pick(i + 1, chosen); chosen.pop(); }
  };
  pick(0, []);
  return out;
}
/**
 * Zero's options at a decision: with priority, passing and every legal move; for a question, every answer the rules allow,
 * cards that are the same counted once. No answer is put first.
 */
export function zeroOptions(s, seat) {
  const p = s.pending, out = [], seen = new Set();
  const add = m => { const k = key(m); if (!seen.has(k)) { seen.add(k); out.push(m); } };
  if (!p) { add(PASS); for (const m of moves(s, seat)) add(m); return out; }
  switch (p.t) {
    case "attack": for (const ids of p.ids.length <= 4 ? subsets(p.ids) : [[], p.ids, ...p.ids.map(x => p.ids.filter(y => y !== x))]) add({ t: "attack", ids }); break;
    case "block": {
      add({ t: "block", pairs: [] });
      for (const a of p.attackers) for (const b of p.blockers) add({ t: "block", pairs: [[b, a]] });
      if (p.attackers.length > 1) add({ t: "block", pairs: p.blockers.slice(0, p.attackers.length).map((b, i) => [b, p.attackers[i]]) });
      break;
    }
    case "order": for (const o of orders(p.cards)) add({ t: "order", cards: o }); break;
    case "surveil": add({ t: "surveil", yard: true }); add({ t: "surveil", yard: false }); break;
    case "search": for (const id of byName(p.ids)) add({ t: "search", card: id }); break;
    case "pick": {
      const ids = p.for === "boil" ? [...new Set(p.ids)] : byName(p.ids);
      for (const id of ids) add({ t: "pick", card: id });
      if (p.optional) add({ t: "pick", card: null });
      break;
    }
    case "owner": add({ t: "owner", bottom: true }); add({ t: "owner", bottom: false }); break;
    case "bend": for (const from of p.froms) for (const to of ["Island", "Swamp", "Mountain", "Plains", "Forest"]) if (to !== from) add({ t: "bend", from, to }); break;
    case "retarget": add({ t: "retarget" }); for (const o of p.options) add({ t: "retarget", targets: o }); break;
    case "putback": case "discard": for (const cards of cardsOutOf(s.hand[seat], p.n, p.t === "putback")) add({ t: p.t, cards }); break;
    case "bottom": for (const cards of cardsOutOf(s.hand[seat], p.n, false)) add({ t: "bottom", cards }); break;
    case "mull": add({ t: "keep" }); if (p.free || p.taken < MOST_MULLS) add({ t: "mull" }); break;
    case "name": for (const n of NAMES) add({ t: "name", name: n }); break;
    default: break;
  }
  return out;
}

// ---------- the question head's marks (14 Nov 2026): a question's answer described by what it does ----------
const Q_TYPES = ["attack", "block", "order", "surveil", "search", "pick", "owner", "bend", "retarget", "putback", "discard", "bottom", "mull", "name"];
const NAME_AT = new Map(NAMES.map((n, i) => [n, i])), LANDS5 = ["Island", "Swamp", "Mountain", "Plains", "Forest"];
/** The marks of a question's answer, in the 80 slots the move-picker's nets take: its kind (0–14), the cards it names or moves
 *  (15–39 by name; an order's second card 40–64), a count (65–69: attackers, blockers), a yes (70: to the graveyard, to the bottom,
 *  a mulligan, no card, no new target), a land type (71–75). */
export function qMarksOf(s, seat, m) {
  const t = Q_TYPES.indexOf(m.t), out = [t >= 0 ? t : 14], card = (id, at = 15) => { const i = NAME_AT.get(DECK[id]); if (i != null) out.push(at + i); };
  switch (m.t) {
    case "attack": out.push(65 + Math.min(4, m.ids.length)); break;
    case "block": out.push(65 + Math.min(4, m.pairs.length)); break;
    case "order": if (m.cards[0] != null) card(m.cards[0]); if (m.cards[1] != null) card(m.cards[1], 40); break;
    case "surveil": if (m.yard) out.push(70); break;
    case "search": case "pick": if (m.card == null) out.push(70); else card(m.card); break;
    case "owner": if (m.bottom) out.push(70); break;
    case "bend": { const i = LANDS5.indexOf(m.to); if (i >= 0) out.push(71 + i); break; }
    case "retarget": if (!m.targets) out.push(70); break;
    case "putback": case "discard": case "bottom": for (const id of m.cards) card(id); break;
    case "mull": out.push(70); break;
    case "keep": out[0] = 12; break;
    case "name": { const i = NAME_AT.get(m.name); if (i != null) out.push(15 + i); break; }
    default: break;
  }
  return [...new Set(out)];
}

/** Zero's player for the look-aheads: its policy head's top move with priority (uniform at random before one is trained), a
 *  question's answer by its question head (at random before one is trained); and its focus for the tree (No. 17 point 6), the
 *  policy's fewest top moves holding 90%. A policy trained on the extended view (its XN past VIEW_N: zero-view.mjs) reads it,
 *  the other hand as ctx.counts[seat] says (Scrys frozen at the root). */
export function zeroPlayer(policy, qpolicy = null, ctx = null) {
  const score = policy ? freeScorer(policy) : null, qscore = qpolicy ? freeScorer(qpolicy) : null;
  const wide = !!(policy && policy.net.XN > VIEW_N), XB = new Float32Array(VIEW_N + EXT_N), EB = new Float32Array(EXT_N), none = new Float32Array(NN);
  const view = wide ? (s, seat) => { XB.set(viewInto(s, seat), 0); XB.set(ext(s, seat, ctx?.counts[seat] ?? none, EB, null, ctx?.any?.[seat] ?? none), VIEW_N); return XB; } : (s, seat) => viewInto(s, seat);
  const rollout = (s, seat, rng) => {
    const ms = zeroOptions(s, seat);
    if (ms.length <= 1) return ms[0] ?? PASS;
    if (s.pending) {
      if (!qscore) return ms[Math.floor(rng() * ms.length)];
      const q = qscore(view(s, seat), ms.map(m => qMarksOf(s, seat, m)));
      let b = 0;
      for (let k = 1; k < q.length; k++) if (q[k] > q[b]) b = k;
      return ms[b];
    }
    if (!score) return ms[Math.floor(rng() * ms.length)];
    const sc = score(view(s, seat), ms.map(m => marksOf(s, seat, m)));
    let b = 0;
    for (let k = 1; k < sc.length; k++) if (sc[k] > sc[b]) b = k;
    return ms[b];
  };
  const focus = score ? (s, seat, mass = 0.9, most = 6) => {
    const ms = zeroOptions(s, seat), sc = score(view(s, seat), ms.map(m => marksOf(s, seat, m)));
    const order = sc.map((v, k) => k).sort((a, b) => sc[b] - sc[a] || a - b), top = sc[order[0]];
    const e = order.map(k => Math.exp(sc[k] - top)), z = e.reduce((a, b) => a + b, 0), out = [];
    let cum = 0;
    for (let r = 0; r < order.length && out.length < most; r++) { out.push(ms[order[r]]); cum += e[r] / z; if (cum >= mass) break; }
    return out;
  } : null;
  // the same for a question (17 Nov 2026, Fable 09:40Z): its head's fewest top answers holding 90%, for the tree (qtree)
  const qfocus = qscore ? (s, seat, mass = 0.9, most = 6) => {
    const ms = zeroOptions(s, seat), sc = qscore(view(s, seat), ms.map(m => qMarksOf(s, seat, m)));
    const order = sc.map((v, k) => k).sort((a, b) => sc[b] - sc[a] || a - b), top = sc[order[0]];
    const e = order.map(k => Math.exp(sc[k] - top)), z = e.reduce((a, b) => a + b, 0), out = [];
    let cum = 0;
    for (let r = 0; r < order.length && out.length < most; r++) { out.push(ms[order[r]]); cum += e[r] / z; if (cum >= mass) break; }
    return out;
  } : null;
  return { rollout, focus, qfocus, wide };
}

/** Zero whole, from its nets (14 Nov 2026, Korbi 10:04): the player, the value net (either view), and Scry kept up to date after
 *  every move (seen) and frozen at each root (root: think's extra options, the deal by Scry). reset() at a new game.
 *  nets: { policy, qpolicy, scry (null: none), value } as read from their files. filterOf (the lab's Scry 2, scry2.mjs): a
 *  belief filter for a seat in place of Scry 1; `dealing` whether it deals. */
export function makeZero({ policy = null, qpolicy = null, scry: bnet = null, value = null } = {}, { filterOf = null, scryAlso = false } = {}) {
  const pf = !!filterOf;
  const ctx = { counts: [new Float32Array(NN), new Float32Array(NN)], any: [null, null] }, player = zeroPlayer(policy, qpolicy, ctx);
  const scry = (!pf || scryAlso) && (bnet || player.wide) ? scryOf(bnet) : null, judge = valueJudge(value);
  let tracker = new Tracker(), filters = pf ? [filterOf(0, scry, () => tracker), filterOf(1, scry, () => tracker)] : null;
  return {
    player, judge, scry, wide: player.wide, dealing: !!bnet || pf, filters: () => filters,
    reset() { tracker = new Tracker(); if (pf) filters = [filterOf(0, scry, () => tracker), filterOf(1, scry, () => tracker)]; },
    tracker: () => tracker,
    seen(s, who, m, after) { tracker.update(s, who, m, after); if (filters) for (const f of filters) f.update(s, who, m, after); },
    root(s, seat) {
      if (filters) {
        const b = [filters[0].belief(s), filters[1].belief(s)];
        ctx.counts[0] = b[0].counts; ctx.counts[1] = b[1].counts; ctx.any[0] = b[0].any; ctx.any[1] = b[1].any;
        return { deal: filters[seat].deal() };
      }
      if (!scry) return {};
      const b = [scry(s, 0, tracker), scry(s, 1, tracker)];
      ctx.counts[0] = b[0].counts; ctx.counts[1] = b[1].counts; ctx.any[0] = b[0].any; ctx.any[1] = b[1].any;
      return bnet ? { deal: dealBy(b[seat].slots) } : {};
    },
    think(s, seat, deals, extra = {}) {
      // qtree (lab): questions in the tree by the question head's top answers (player.qfocus), not in list order
      const { qtree, ...rest } = extra;
      return think(s, seat, { deals, ms: 1e9, all: true, options: zeroOptions, weigh: false, rollout: player.rollout, judge, ...(player.focus ? { focus: player.focus } : {}), ...(qtree && player.qfocus ? { qfocus: player.qfocus } : {}), ...this.root(s, seat), ...rest });
    },
  };
}

/** Zero's value net as a judge, on either view: the extended one (its first layer reads FEATURES + EXT_N) or the old. */
export const RACE_N = FEATURES.length + 2 * PLUS + 2 * RACE;   // 132: dandan-eval.js featuresRace, as the crowned Monte's value net reads
export const valueJudge = n => {
  if (!n) return null;
  // several nets (15 Nov 2026, Korbi: a freebie to try): the mean of their chances, each on its own view
  if (Array.isArray(n)) { const js = n.map(valueJudge).filter(Boolean); return js.length === 1 ? js[0] : (s, me) => js.reduce((a, j) => a + j(s, me), 0) / js.length; }
  const nIn = n.layers[0].n[0];
  // the extended view face up: from generation 6 over featuresRace (the race inputs, Korbi 11:41), g4x-A's over features
  return nIn === RACE_N + EXT_N ? extJudge(n.layers, featuresRace, RACE_N) : nIn === FEATURES.length + EXT_N ? extJudge(n.layers, features, FEATURES.length) : makeJudge(n.layers);
};

