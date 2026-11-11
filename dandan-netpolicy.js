// A learned policy: a small network that chooses among the moves a seat has with priority, trained to copy Medium
// (lab/policy-data.mjs plays the games, lab/policy/train.py learns from them). Korbi, 10 November 2026: step one of
// the loop where Hard's choices train the network its look-ahead then plays with; first it must agree with Medium and
// be much quicker than Medium's rules.
//
// It scores each legal move, passing included, from the position and the move, and takes the best. The position is the
// judge's 100 numbers (dandan-eval.js features) with the other player's hand by name blanked (Medium can't see it; only
// its size stays), the step, and how much is on the stack. A move is a handful of yes/no marks: its kind, its card, where
// it's cast from, what it targets (whose, a Dandân, a land, the spell on the stack or the card in the graveyard by name),
// its mode. Questions the engine asks (attack, block, order, a mulligan…) stay with Medium.
import { DECK, TOKEN_AT } from "./dandan-cards.js";
import { perm } from "./dandan-core.js";
import { moves, halfOf, STEPS } from "./dandan-engine.js";
import { features, featuresPlus, FEATURES, PLUS } from "./dandan-eval.js";
import { policyMove, PASS, Player, TUNE, ADJ, landFirst, izzetLast } from "./dandan-policy.js";

const SPELLS = ["Memory Lapse", "Dandân", "Piracy Charm", "Mind Bend", "Commit // Memory", "Narset's Reversal", "Repulse", "Metamorphose",
  "Lórien Revealed", "Brainstorm", "Predict", "Mystic Retrieval", "Deem Inferior", "Take Inventory", "Chart a Course", "Gone Missing", "Quicken"];
const LANDS = ["Island", "Mystic Sanctuary", "Thundering Falls", "Izzet Boilerworks", "Halimar Depths", "Flood Plain", "Lonely Sandbar", "Remote Isle"];
const CARD_AT = new Map([...SPELLS, ...LANDS, "Clue"].map((n, i) => [n, i]));
const SPELL_AT = new Map(SPELLS.map((n, i) => [n, i]));
const HALF_TO_CARD = { Commit: "Commit // Memory", Memory: "Commit // Memory" };

/** The position's numbers: the judge's (the other hand's names blanked), then the step and the stack. */
const BASE = FEATURES.length, PER_SEAT = (BASE - 3 - SPELLS.length) / 2, THEIR_NAMES = PER_SEAT + 15;
export const STATE_N = BASE + STEPS.length + 4;
export function stateOf(s, seat, out = new Float32Array(STATE_N)) {
  features(s, seat, out);
  for (let i = THEIR_NAMES; i < THEIR_NAMES + SPELLS.length + 7; i++) out[i] = 0;
  for (let i = BASE; i < STATE_N; i++) out[i] = 0;
  const step = STEPS.indexOf(s.step);
  if (step >= 0) out[BASE + step] = 1;
  out[BASE + STEPS.length + Math.min(3, s.stack.length)] = 1;
  return out;
}

/** A move's marks: the indices that are 1 (all others 0). */
const KIND = { pass: 0, land: 1, cast: 2, cycle: 3, ability: 4 };
const AT = { kind: 0, card: 5, yard: 31, memory: 32, tgt: 33, dandan: 40, land: 41, spell: 42, grave: 60, mode: 77 };
export const MOVE_N = 80;
export function marksOf(s, seat, m) {
  const out = [AT.kind + (KIND[m.t] ?? 0)];
  const card = id => { const n = id >= TOKEN_AT ? "Clue" : DECK[id]; const i = CARD_AT.get(n); if (i != null) out.push(AT.card + i); };
  if (m.t === "land" || m.t === "cycle") card(m.card);
  if (m.t === "ability") { const p = perm(s, m.id); if (p) card(p.id); }
  if (m.t === "cast") {
    card(m.card);
    if (m.from === "yard") { out.push(AT.yard); if (halfOf(m.card, "yard") === "Memory") out.push(AT.memory); }
    out.push(AT.mode + Math.min(2, m.mode || 0));
    const t = m.targets?.[0];
    if (!t) out.push(AT.tgt);
    else if (t.k === "c") {
      const p = perm(s, t.id);
      out.push(AT.tgt + (p && p.ctl === seat ? 1 : 2));
      if (p && DECK[p.id] === "Dandân") out.push(AT.dandan);
      else if (p && p.id < TOKEN_AT) out.push(AT.land);
    } else if (t.k === "s") {
      const x = s.stack.find(y => y.sid === t.sid);
      out.push(AT.tgt + (x && x.ctl === seat ? 3 : 4));
      const i = x ? SPELL_AT.get(HALF_TO_CARD[x.name] ?? x.name) : null;
      out.push(AT.spell + (i ?? 17));
    } else if (t.k === "g") {
      out.push(AT.tgt + 5);
      const i = SPELL_AT.get(DECK[t.id]);
      if (i != null) out.push(AT.grave + i);
    } else out.push(AT.tgt + 6);
  }
  return out;
}

/** The moves weighed: passing first, then every legal move (as Medium's are listed). */
export const choices = (s, seat) => [PASS, ...moves(s, seat)];

/** A policy from a trained network ({ s: [STATE_N][H1], m: [MOVE_N][H1], b1, w2: [H1][H2], b2, w3: [H2] }, flat arrays). */
export function makePolicy(net) {
  const H1 = net.b1.length, H2 = net.b2.length;
  const Ws = Float32Array.from(net.s), Wm = Float32Array.from(net.m), b1 = Float32Array.from(net.b1);
  const W2 = Float32Array.from(net.w2), b2 = Float32Array.from(net.b2), w3 = Float32Array.from(net.w3);
  const x = new Float32Array(STATE_N), base = new Float32Array(H1), h1 = new Float32Array(H1);
  /** The score of each choice: the position's part of the first layer once, each move's marks added to it. */
  const scores = (s, seat, list) => {
    stateOf(s, seat, x);
    base.set(b1);
    for (let i = 0; i < STATE_N; i++) { const v = x[i]; if (v === 0) continue; const r = i * H1; for (let o = 0; o < H1; o++) base[o] += v * Ws[r + o]; }
    return list.map(m => {
      h1.set(base);
      for (const i of marksOf(s, seat, m)) { const r = i * H1; for (let o = 0; o < H1; o++) h1[o] += Wm[r + o]; }
      let out = 0;
      for (let o2 = 0; o2 < H2; o2++) {
        let v = b2[o2];
        for (let o = 0; o < H1; o++) { const h = h1[o]; if (h > 0) v += h * W2[o * H2 + o2]; }
        if (v > 0) out += v * w3[o2];
      }
      return out;
    });
  };
  const move = (s, seat) => {
    if (s.pending) return policyMove(s, seat);
    const list = choices(s, seat);
    if (list.length === 1) return PASS;
    const v = scores(s, seat, list);
    let best = 0;
    for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
    return list[best];
  };
  return { move, scores };
}

// ---------- stage 1: Medium plus a learned correction (monte-plan.md 3.3-3.4, 11 November 2026) ----------
const r3 = v => Math.round(v * 1000) / 1000, PLUS_BUF = new Float32Array(FEATURES.length + 2 * PLUS);
/** The mover's view for the model: stateOf, the mover's own squeeze inputs (its hand and public counts only), library ≤ 12. */
export function viewOf(s, seat) {
  const x = Array.from(stateOf(s, seat), r3);
  featuresPlus(s, seat, PLUS_BUF);
  for (let k = 0; k < PLUS; k++) x.push(r3(PLUS_BUF[FEATURES.length + k]));
  x.push(s.lib.length <= 12 ? 1 : 0);
  return x;
}
/** Medium's bar for a move over passing, and its own pick (as policyMove makes it), from one Player. */
export function mediumView(s, seat, rng = Math.random) {
  const P = new Player(s, seat, { rng }), scored = P.scored(), bar = TUNE.pass + (s.stack.length ? 0 : ADJ.pass);
  const top = scored.length && scored[0].v > bar ? scored[0].m : PASS;
  const pick = landFirst(s, seat, top) || (TUNE.izzetLast ? izzetLast(s, seat, top, { rng }) : null) || top;
  return { scored, bar, pick };
}
/**
 * The trained model (lab/policy-train.mjs's line: { alpha, beta, net }) as a player for priority: passing, Medium's own pick
 * and Medium's `wide` best-scored moves, each scored alpha·(Medium's score) + beta·(is Medium's pick) + f(position, move,
 * Medium's score); the best is played. Questions (attack, block, a mulligan…) stay with Medium. move(s, seat, rng) fits
 * dandan-think.js think's `rollout`.
 */
export function makePlus(model, { wide = 5, free = false } = {}) {
  const { alpha, beta } = model, n = model.net, H1 = n.H1, H2 = n.H2, XN = n.XN;
  const wx = Float32Array.from(n.wx), wm = Float32Array.from(n.wm), ws = Float32Array.from(n.ws), b1 = Float32Array.from(n.b1);
  const w2 = Float32Array.from(n.w2), b2 = Float32Array.from(n.b2), w3 = Float32Array.from(n.w3);
  const base = new Float32Array(H1), h1 = new Float32Array(H1), key = m => JSON.stringify(m);
  const f = (s, seat, x, m, sc) => {
    h1.set(base);
    for (const i of marksOf(s, seat, m)) { const r = i * H1; for (let o = 0; o < H1; o++) h1[o] += wm[r + o]; }
    let out = 0;
    for (let o = 0; o < H1; o++) h1[o] = Math.max(0, h1[o] + sc * ws[o]);
    for (let o2 = 0; o2 < H2; o2++) {
      let v = b2[o2];
      for (let o = 0; o < H1; o++) { const h = h1[o]; if (h > 0) v += h * w2[o * H2 + o2]; }
      if (v > 0) out += v * w3[o2];
    }
    return out;
  };
  const move = (s, seat, rng = Math.random) => {
    if (s.pending) return policyMove(s, seat, { rng });
    if (!moves(s, seat).length) return PASS;
    const { scored, bar, pick } = mediumView(s, seat, rng);
    // Lands stay Medium's (11 November 2026, G1 lost 16% to Medium): in the search a land played now or later is worth about the
    // same, so the model learned passing ≈ a land and, playing, kept putting its land off. When Medium plays a land, so does it.
    if (!free && pick.t === "land") return pick;
    // The same for passing: in the search a spell held to the next priority is worth about the same as casting it now, so the
    // model learned passing ≈ acting and kept holding. When Medium acts, the model picks which move, not whether to pass.
    const cands = [...(free || pick.t === "pass" ? [{ m: PASS, v: bar }] : []), ...scored.slice(0, wide)];
    if (!cands.some(c => key(c.m) === key(pick))) cands.push({ m: pick, v: scored.find(c => key(c.m) === key(pick))?.v ?? bar });
    const x = viewOf(s, seat);
    base.set(b1);
    for (let i = 0; i < XN; i++) { const v = x[i]; if (v === 0) continue; const r = i * H1; for (let o = 0; o < H1; o++) base[o] += v * wx[r + o]; }
    let best = null, top = -Infinity;
    const pk = key(pick);
    for (const c of cands) {
      const v = alpha * c.v + (key(c.m) === pk ? beta : 0) + f(s, seat, x, c.m, c.v);
      if (v > top) { top = v; best = c.m; }
    }
    return best;
  };
  // the same scores as a ranking of passing and Medium's scored moves (best first), for think's `rank`: the model orders the
  // moves Hard weighs instead of playing past the tree
  const rank = (s, seat, scored = null) => {
    const sc = scored || new Player(s, seat).scored(), bar = TUNE.pass + (s.stack.length ? 0 : ADJ.pass);
    const x = viewOf(s, seat);
    base.set(b1);
    for (let i = 0; i < XN; i++) { const v = x[i]; if (v === 0) continue; const r = i * H1; for (let o = 0; o < H1; o++) base[o] += v * wx[r + o]; }
    return [{ m: PASS, v: bar }, ...sc].map(c => ({ m: c.m, z: alpha * c.v + f(s, seat, x, c.m, c.v) })).sort((a, b) => b.z - a.z).map(c => c.m);
  };
  return { move, rank };
}
