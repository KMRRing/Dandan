// Zero 2 (16 Nov 2026, Korbi 16:48: stages 1 and 2 of "Monte: the path to the general solution", one bundle): Monte Scry Zero
// with every hand-built input cut and the general pieces in their place, in the lab until it wins.
//   - Scry 1.2 (scry12.mjs): the belief net on the raw record, dealing whole hands, in place of Scry 1's 25 history numbers.
//   - One policy for moves and answers: one action encoding (MARK_N marks: a move's marks 0-79 as dandan-netpolicy.js's
//     marksOf, a question's answer 80-159 as dandan-zero.js's qMarksOf, and every target of a cast described in full at
//     160-255: a permanent by its name and controller, a spell by its name and controller, a player), trained on both.
//   - The policy reads the raw view only: rules facts (the step, the stack, whose turn, a question pending) and the extended view
//     with Scry 1.2's counts, in place of the 121-number view of the old judge's features and the squeeze features.
//   - The value net reads the extended view alone, face up (no featuresRace: the clock, the squeeze, the race), trained with
//     the search's values blended into its targets and a second output (who decks out) to learn the clock from the board.
import { DECK, NAMES, TOKEN_AT } from "../../dandan-cards.js";
import { perm } from "../../dandan-core.js";
import { marksOf, freeScorer } from "../../dandan-netpolicy.js";
import { think } from "../../dandan-think.js";
import { zeroOptions, qMarksOf, PASS } from "../../dandan-zero.js";
import { EXT_N, NN, ext, extJudge } from "./zero-view.mjs";
import { Scry12 } from "./scry12.mjs";

const NAME_AT = new Map(NAMES.map((n, k) => [n, k])), HALF_TO_CARD = { Commit: "Commit // Memory", Memory: "Commit // Memory" };
const STEPS = ["mull", "upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end", "over"];
export const RAW_N = STEPS.length + 4 + 3, X2 = RAW_N + EXT_N, MARK_N = 256;
const MT = { permMine: 160, permTheirs: 185, spell: 210, spellMine: 235, spellTheirs: 236, playerMe: 237, playerThem: 238, yard: 239, token: 240 };

/** The rules facts of a decision (RAW_N): the step, the stack's size (0, 1, 2, 3+), whose turn, a question pending, mulligans. */
export function rawView(s, seat, out = new Float32Array(RAW_N)) {
  out.fill(0);
  const st = STEPS.indexOf(s.mull && !(s.mull.done?.[0] && s.mull.done?.[1]) ? "mull" : s.step);
  if (st >= 0) out[st] = 1;
  out[STEPS.length + Math.min(3, s.stack.length)] = 1;
  out[STEPS.length + 4] = s.active === seat ? 1 : 0;
  out[STEPS.length + 5] = s.pending ? 1 : 0;
  out[STEPS.length + 6] = Math.min(3, s.mull?.n?.[seat] || 0) / 3;
  return out;
}

/** One action's marks, a move and an answer alike (MARK_N). */
export function marks2(s, seat, m) {
  if (s.pending) return qMarksOf(s, seat, m).map(k => 80 + k);
  const out = marksOf(s, seat, m);
  if (m.t === "cast") for (const t of m.targets || []) {
    if (t.k === "c") {
      const p = perm(s, t.id);
      if (!p) continue;
      if (p.id >= TOKEN_AT) { out.push(MT.token); continue; }
      const i = NAME_AT.get(DECK[p.id]);
      if (i != null) out.push((p.ctl === seat ? MT.permMine : MT.permTheirs) + i);
    } else if (t.k === "s") {
      const x = s.stack.find(y => y.sid === t.sid);
      if (!x) continue;
      out.push(x.ctl === seat ? MT.spellMine : MT.spellTheirs);
      const i = NAME_AT.get(HALF_TO_CARD[x.name] ?? x.name);
      if (i != null) out.push(MT.spell + i);
    } else if (t.k === "p") out.push(t.seat === seat ? MT.playerMe : MT.playerThem);
    else if (t.k === "g") out.push(MT.yard);
  }
  return [...new Set(out)];
}

/** The policy's input (X2): the rules facts, then the extended view with the other hand as Scry 1.2 believes it. */
export function input2(s, seat, counts, any, out = new Float32Array(X2)) {
  out.set(rawView(s, seat), 0);
  out.set(ext(s, seat, counts, new Float32Array(EXT_N), null, any), RAW_N);
  return out;
}

/** The one policy as the look-aheads' player and the tree's focus (dandan-zero.js zeroPlayer's, on the new input and marks). */
export function player2(policy, ctx) {
  const score = policy ? freeScorer(policy) : null, none = new Float32Array(NN), XB = new Float32Array(X2);
  const view = (s, seat) => input2(s, seat, ctx.counts[seat] ?? none, ctx.any[seat] ?? none, XB);
  const rollout = (s, seat, rng) => {
    const ms = zeroOptions(s, seat);
    if (ms.length <= 1) return ms[0] ?? PASS;
    if (!score) return ms[Math.floor(rng() * ms.length)];
    const sc = score(view(s, seat), ms.map(m => marks2(s, seat, m)));
    let b = 0;
    for (let k = 1; k < sc.length; k++) if (sc[k] > sc[b]) b = k;
    return ms[b];
  };
  const focus = score ? (s, seat, mass = 0.9, most = 6) => {
    const ms = zeroOptions(s, seat), sc = score(view(s, seat), ms.map(m => marks2(s, seat, m)));
    const order = sc.map((v, k) => k).sort((a, b) => sc[b] - sc[a] || a - b), top = sc[order[0]];
    const e = order.map(k => Math.exp(sc[k] - top)), z = e.reduce((a, b) => a + b, 0), out = [];
    let cum = 0;
    for (let r = 0; r < order.length && out.length < most; r++) { out.push(ms[order[r]]); cum += e[r] / z; if (cum >= mass) break; }
    return out;
  } : null;
  return { rollout, focus };
}

/** The raw value net (value_np.py over the extended view alone, EXT_N inputs a seat) as a judge, face up. */
export function judge2(net) {
  if (!net) return null;
  if (net.layers[0].n[0] !== EXT_N) throw new Error(`Zero 2's value net reads ${net.layers[0].n[0]} inputs, not ${EXT_N}`);
  return extJudge(net.layers, () => {}, 0);
}

/** Zero 2 whole: { policy, value, scry12 } nets as read from their files; the same interface as dandan-zero.js makeZero. */
export function makeZero2({ policy = null, value = null, scry12 = null } = {}) {
  const ctx = { counts: [new Float32Array(NN), new Float32Array(NN)], any: [null, null] }, player = player2(policy, ctx), judge = judge2(value);
  let filters = scry12 ? [new Scry12(0, scry12), new Scry12(1, scry12)] : null;
  return {
    player, judge, wide: true, dealing: !!scry12, filters: () => filters, scry: null,
    reset() { if (scry12) filters = [new Scry12(0, scry12), new Scry12(1, scry12)]; },
    tracker: () => null,
    seen(s, who, m, after) { if (filters) for (const f of filters) f.update(s, who, m, after); },
    root(s, seat) {
      if (!filters) return {};
      const b = [filters[0].belief(s), filters[1].belief(s)];
      ctx.counts[0] = b[0].counts; ctx.counts[1] = b[1].counts; ctx.any[0] = b[0].any; ctx.any[1] = b[1].any;
      return { deal: filters[seat].deal() };
    },
    think(s, seat, deals, extra = {}) {
      return think(s, seat, { deals, ms: 1e9, all: true, options: zeroOptions, weigh: false, rollout: player.rollout, judge, ...(player.focus ? { focus: player.focus } : {}), ...this.root(s, seat), ...extra });
    },
  };
}
