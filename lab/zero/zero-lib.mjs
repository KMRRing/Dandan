// Zero (14 Nov 2026, Fable No. 12, Korbi 00:10Z and 02:59Z: "pure, more compute, Deep"): the from-scratch line. Nothing here
// calls dandan-policy.js (Medium) or reads a net or a game of the Medium line: the options are the rules' own (passing and every
// legal move; a question's answers listed by the cards), the look-aheads are played by Zero's own policy head (or at random
// before one is trained), the questions in the look-aheads at random, the hidden cards dealt without dandan-reads.js's tells
// (which read Medium's play), and the position judged by Zero's own value net (or, before one is trained, by nobody: generation 0
// plays at random, with no search). The inputs (dandan-eval.js features, dandan-netpolicy.js viewOf and marksOf) describe the
// game, not how to play it, and are kept.
import fs from "node:fs";
import { moves, MOST_MULLS } from "../../dandan-engine.js";
import { DECK, NAMES } from "../../dandan-cards.js";
import { makeJudge, features, FEATURES } from "../../dandan-eval.js";
import { freeScorer, viewInto, viewOf, marksOf } from "../../dandan-netpolicy.js";

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
 *  policy's fewest top moves holding 90%. */
export function zeroPlayer(policy, qpolicy = null) {
  const score = policy ? freeScorer(policy) : null, qscore = qpolicy ? freeScorer(qpolicy) : null;
  const rollout = (s, seat, rng) => {
    const ms = zeroOptions(s, seat);
    if (ms.length <= 1) return ms[0] ?? PASS;
    if (s.pending) {
      if (!qscore) return ms[Math.floor(rng() * ms.length)];
      const q = qscore(viewInto(s, seat), ms.map(m => qMarksOf(s, seat, m)));
      let b = 0;
      for (let k = 1; k < q.length; k++) if (q[k] > q[b]) b = k;
      return ms[b];
    }
    if (!score) return ms[Math.floor(rng() * ms.length)];
    const sc = score(viewInto(s, seat), ms.map(m => marksOf(s, seat, m)));
    let b = 0;
    for (let k = 1; k < sc.length; k++) if (sc[k] > sc[b]) b = k;
    return ms[b];
  };
  const focus = score ? (s, seat, mass = 0.9, most = 6) => {
    const ms = zeroOptions(s, seat), sc = score(viewInto(s, seat), ms.map(m => marksOf(s, seat, m)));
    const order = sc.map((v, k) => k).sort((a, b) => sc[b] - sc[a] || a - b), top = sc[order[0]];
    const e = order.map(k => Math.exp(sc[k] - top)), z = e.reduce((a, b) => a + b, 0), out = [];
    let cum = 0;
    for (let r = 0; r < order.length && out.length < most; r++) { out.push(ms[order[r]]); cum += e[r] / z; if (cum >= mass) break; }
    return out;
  } : null;
  return { rollout, focus };
}

/** A net file of Zero's (lab/zero/nets/<name>.json), or null for "-". */
export const netOf = name => (name && name !== "-" ? JSON.parse(fs.readFileSync(new URL(`./nets/${name}.json`, import.meta.url), "utf8").split("\n")[0]) : null);
/** The question head that goes with a policy net (<name>-policy → <name>-qpolicy), or null when none has been trained yet. */
export const qnetOf = name => { if (!name || name === "-") return null; const q = name.replace(/-policy$/, "-qpolicy"); return q !== name && fs.existsSync(new URL(`./nets/${q}.json`, import.meta.url)) ? netOf(q) : null; };
/** Zero's value net as a judge (dandan-eval.js's layer format), or null. */
export const judgeOf = name => { const n = netOf(name); return n ? makeJudge(n.layers) : null; };

// ---------- lessons written as the games are played ----------
const N = FEATURES.length, r3 = v => Math.round(v * 1000) / 1000;
/** A position's value-net row for `me`: its features and the other side's (the same numbers seen from the other seat, as
 *  dandan-eval.js makeJudge builds them), both rounded to 3 places. */
export function valueRow(s, me) {
  const mine = features(s, me, new Float32Array(N)), half = (N - 3 - SPELLS_N) / 2, theirs = new Float32Array(N);
  theirs.set(mine.subarray(half, 2 * half), 0); theirs.set(mine.subarray(0, half), half); theirs.set(mine.subarray(2 * half, N), 2 * half);
  theirs[2 * half] = 1 - mine[2 * half];
  return [Array.from(mine, r3), Array.from(theirs, r3)];
}
const SPELLS_N = 17;   // dandan-eval.js SPELLS.length: (N − 3 − 17) / 2 = 40 numbers a seat
/** A searched decision as lab/export.mjs writes one (so lab/fetch-ex.mjs and lab/policy_np.py read it unchanged): the view, each
 *  option's marks and the search's value, the search's pick, every legal move weighed, Deep when 1,024 deals. */
export function decisionLine(s, seat, g, i, res, pick, deals, hold, x3) {
  const q = !!s.pending, mk = q ? qMarksOf : marksOf;
  return {
    g, i, seat, deep: deals >= 1024 ? 1 : 0, deals, x: viewOf(s, seat),
    c: res.list.map(c => ({ m: mk(s, seat, c.move), s: 0, q: +c.mean.toFixed(4), se: +c.se.toFixed(4), n: c.n })),
    med: 0, pick, every: 1, ...(q ? { qd: 1 } : {}), ...(hold ? { hold: 1 } : {}), ...(x3 != null ? { x3 } : {}),
  };
}
