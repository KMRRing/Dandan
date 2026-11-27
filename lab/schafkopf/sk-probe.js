// The father's two rules as a probe (Korbi 27 Nov 2026 11:05 local, Fable 09:15Z): are his points A and B mistakes at all? An
// engine with his rule hard-coded plays against M1 and the difference says. Lab only, measurement only: never a rule in Monte zero,
// M1 or any engine we train, and no game played under it trains anything.
//   A: a defender, on lead against a Solo or Wenz whose declarer plays last to the trick, never leads a trump if another lead is legal;
//   B: the Sauspiel's declarer, on lead while the called ace is still out, never leads the called suit if another lead is legal.
// A filter on the root's legal options before the search, nothing else.
import { suitOf, rankOf, cid } from "./codex/trumps-cards.js";
import { aceFell } from "./sk-leads.js";

const trump = (c, id) => (c.type === "wenz" ? rankOf(id) === "J" : rankOf(id) === "Q" || rankOf(id) === "J" || suitOf(id) === c.trump);

/** The options left to seat `w` under `rules` ("A", "B" or "AB"), or null where no rule removes any. */
export function probeFilter(s, w, ops, rules) {
  const c = s.contract;
  if (!rules || s.step !== "play" || !c || s.trick.length || ops.length < 2) return null;
  let bad = null;
  if (rules.includes("A") && (c.type === "solo" || c.type === "wenz") && w !== c.declarer && (w + 3) % 4 === c.declarer) bad = m => trump(c, m.card);
  else if (rules.includes("B") && c.type === "sau" && w === c.declarer && !aceFell(s, cid(c.ace, "A"))) bad = m => suitOf(m.card) === c.ace && !trump(c, m.card);
  if (!bad) return null;
  const keep = ops.filter(m => !bad(m));
  return keep.length && keep.length < ops.length ? keep : null;
}

/** rule=<A|B|AB> (our seat) and opprule=<A|B|AB> (the other engine's seats, and the reference table's) from the command line. */
export const probeArgs = argv => ({
  rule: (argv.find(a => a.startsWith("rule=")) || "").slice(5) || null,
  opprule: (argv.find(a => a.startsWith("opprule=")) || "").slice(8) || null,
});
