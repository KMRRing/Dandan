// Zero (14 Nov 2026, Fable No. 12, Korbi 00:10Z and 02:59Z: "pure, more compute, Deep"): the from-scratch line. Nothing here
// calls dandan-policy.js (Medium) or reads a net or a game of the Medium line: the options are the rules' own (passing and every
// legal move; a question's answers listed by the cards), the look-aheads are played by Zero's own policy head (or at random
// before one is trained), the questions in the look-aheads at random, the hidden cards dealt without dandan-reads.js's tells
// (which read Medium's play), and the position judged by Zero's own value net (or, before one is trained, by nobody: generation 0
// plays at random, with no search). The inputs (dandan-eval.js features, dandan-netpolicy.js viewOf and marksOf) describe the
// game, not how to play it, and are kept.
import fs from "node:fs";
import { makeJudge, features, FEATURES } from "../../dandan-eval.js";
import { viewOf, marksOf } from "../../dandan-netpolicy.js";
import { zeroOptions, qMarksOf, makeZero, valueJudge } from "../../dandan-zero.js";
import { HandFilter, SlotFilter } from "./scry2.mjs";
import { Scry12 } from "./scry12.mjs";
// the options, the marks, the player and the brain: dandan-zero.js (the app's, since 15 Nov 2026); the nets read from files here
export { PASS, zeroOptions, qMarksOf, zeroPlayer, makeZero, valueJudge, RACE_N } from "../../dandan-zero.js";

/** Zero whole, from its nets' names (lab/zero/nets/<name>.json). */
export function zeroBrain(policyName, valueName, scryName = null) {
  // scryName (the swap matches): a Scry other than the policy's own, "-" for none, "pf" for Scry 2 (the particle filter,
  // scry2.mjs: no net, Zero's own policy and question head as the model of the other player)
  // "pf[:n=..][:eps=..]" Scry 2a; "pfs[...]" Scry 2b: the same filter with the policy's own Scry 1 dealing its fresh hands and
  // draws; "pfd[...]" Scry 2d: the hands they could still hold, struck hands replaced (Korbi 16:00)
  // "pfx[...]" the Scry fusion (16 Nov 2026, Korbi: one set of hands): Scry 2d's hands, struck and replaced, weighed by Scry 1
  const policy = netOf(policyName), qpolicy = qnetOf(policyName), pf = /^pf[sdx]?(:|$)/.test(scryName || ""), pfs = /^pf[sx](:|$)/.test(scryName || ""), pfd = /^pf[dx](:|$)/.test(scryName || ""), pfx = /^pfx(:|$)/.test(scryName || "");
  const opt = Object.fromEntries((scryName || "").split(":").slice(1).map(x => x.split("=")).map(([k, v]) => [k, Number(v)]));
  const bnet = pf ? (pfs ? scryNetOf(policyName) : null) : /^s12(:|$)/.test(scryName || "") ? null : scryName ? netOf(scryName) : scryNetOf(policyName);
  // "s12[:<net name>]" (16 Nov 2026): Scry 1.2 (scry12.mjs), the belief net on the raw record dealing whole hands; its net
  // lab/zero/nets/<net name>-scry12.json (default: the policy's own name)
  const s12 = /^s12(:|$)/.test(scryName || "");
  if (s12) {
    const nm = (scryName.split(":")[1] || policyName.replace(/-policy$/, "")) + "-scry12", net = netOf(nm);
    const value = valueName && valueName.includes("+") ? valueName.split("+").map(netOf) : netOf(valueName);
    return makeZero({ policy, qpolicy, scry: null, value }, { filterOf: me => new Scry12(me, net) });
  }
  const filterOf = !pf ? null : (me, scry, tracker) => pfd ? new SlotFilter(me, { policy, qpolicy, options: zeroOptions, qMarks: qMarksOf, ...opt, ...(pfx && scry ? { net: s => scry(s, me, tracker()).slots } : {}) }) : new HandFilter(me, { policy, qpolicy, options: zeroOptions, qMarks: qMarksOf, ...opt, ...(pfs && scry ? { prior: (s, x) => scry(s, x, tracker()).slots } : {}) });
  // "<a>+<b>": the value nets' mean (an ensemble, 15 Nov 2026)
  const value = valueName && valueName.includes("+") ? valueName.split("+").map(netOf) : netOf(valueName);
  return makeZero({ policy, qpolicy, scry: bnet, value }, { filterOf, scryAlso: pfs });
}

/** A net file of Zero's (lab/zero/nets/<name>.json), or null for "-". */
export const netOf = name => (name && name !== "-" ? JSON.parse(fs.readFileSync(new URL(`./nets/${name}.json`, import.meta.url), "utf8").split("\n")[0]) : null);
/** The question head that goes with a policy net (<name>-policy → <name>-qpolicy), or null when none has been trained yet. */
export const qnetOf = name => { if (!name || name === "-") return null; const q = name.replace(/-policy$/, "-qpolicy"); return q !== name && fs.existsSync(new URL(`./nets/${q}.json`, import.meta.url)) ? netOf(q) : null; };
/** Zero's value net as a judge (dandan-eval.js's layer format), or null. */
export const judgeOf = name => { const n = netOf(name); return n ? makeJudge(n.layers) : null; };
/** The Scry that goes with a policy net (<name>-policy → <name>-scry), or null. */
export const scryNetOf = name => { if (!name || name === "-") return null; const b = name.replace(/-policy$/, "-scry"); return b !== name && fs.existsSync(new URL(`./nets/${b}.json`, import.meta.url)) ? netOf(b) : null; };
/** Zero's value net as a judge, on either view, by name. */
export const valueJudgeOf = name => valueJudge(netOf(name));

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
/**
 * A searched decision as Zero's trainers read it. Each option: m its marks (the old policy's encoding), mv the move itself (Fable's
 * review, item 8: the packers take the options and the pick from the moves, never by matching marks, which twins share), q, se
 * and n from the first look (item 9: every soft target from the same depth); where the deeper look re-weighed the option, its
 * last look's d, dse, dn. v: the picked option's final mean, the value target (item 9); looks: the deeper looks made (0 none).
 */
export function decisionLine(s, seat, g, i, res, pick, deals, hold, x3) {
  const q = !!s.pending, mk = q ? qMarksOf : marksOf, r4 = v => +v.toFixed(4);
  return {
    g, i, seat, deep: deals >= 1024 ? 1 : 0, deals, x: viewOf(s, seat),
    c: res.list.map(c => ({ m: mk(s, seat, c.move), mv: c.move, s: 0, q: r4(c.first ?? c.mean), se: r4(c.firstSe ?? c.se), n: c.firstN ?? c.n, ...(c.first != null ? { d: r4(c.mean), dse: r4(c.se), dn: c.n } : {}) })),
    v: pick >= 0 ? r4(res.list[pick].mean) : null, looks: res.deeper || 0,
    med: 0, pick, every: 1, ...(q ? { qd: 1 } : {}), ...(hold ? { hold: 1 } : {}), ...(x3 != null ? { x3 } : {}),
  };
}

/** The general Monte (stage 3 step 3, lab/zero/general.mjs) by its nets' name: lab/zero/nets/<name>-gpolicy, -gvalue and
 *  -scry12 (the belief it was packed with). */
export async function generalBrain(name) {
  const { makeGeneral } = await import("./general.mjs");
  return makeGeneral({ policy: netOf(`${name}-gpolicy`), value: netOf(`${name}-gvalue`), scry12: netOf(`${name}-scry12`) });
}
