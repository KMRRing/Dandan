// The log says when each thing on the stack resolves (1 November 2026, Korbi, after a game where a Mind Bend was countered by
// Memory Lapse onto the top of the library, then a Repulse below it resolved and drew it: the order was right and the log didn't
// show it). The last cast resolves first; each item says so as it comes off. Draws stay unnamed in the log.
// Run: node tests/resolve-log.mjs
import { DECK } from "../dandan-cards.js";
import { scene, islandsOf, go, cast, answer, pass, resolveStack, drive, idIn, onBf, names, sidOf } from "./dandan-scene.js";

let bad = 0;
const test = (what, fn) => {
  try { const r = fn(); const ok = r !== false && typeof r !== "string"; console.log(`${ok ? "ok  " : "FAIL"} ${what}${typeof r === "string" ? " — " + r : ""}`); if (!ok) bad++; }
  catch (e) { console.log(`FAIL ${what}: ${e.message}`); bad++; }
};
const lines = s => s.log.map(l => l.t);
const oidOf = (s, id) => s.bf.find(p => p.id === id).oid;

/** Repulse on their Dandân; they answer with a Mind Bend on one of our Islands; we answer that with a Memory Lapse. */
const stack = () => {
  let s = scene({
    active: 0, step: "main1", hand: [["Repulse", "Memory Lapse"], ["Mind Bend"]], lib: ["Island", "Island"],
    bf: [[1, "Dandân"], ...islandsOf(1, 2), ...islandsOf(0, 5)],
  });
  s = cast(s, 0, "Repulse", [{ k: "c", id: onBf(s, 1, "Dandân"), oid: oidOf(s, onBf(s, 1, "Dandân")) }]);
  const isle = s.bf.find(p => p.ctl === 0 && DECK[p.id] === "Island");
  s = cast(s, 1, "Mind Bend", [{ k: "c", id: isle.id, oid: isle.oid }]);
  s = cast(s, 0, "Memory Lapse", [{ k: "s", sid: sidOf(s, "Mind Bend") }]);
  return s;
};

test("each item says it resolves, the last cast first: Memory Lapse, then Repulse", () => {
  const s = resolveStack(stack());
  const l = lines(s), at = t => l.indexOf(t);
  return at("Memory Lapse resolves") >= 0 && at("Memory Lapse resolves") < at("Mind Bend is countered and goes on top of the library")
    && at("Mind Bend is countered and goes on top of the library") < at("Repulse resolves")
    && !l.includes("Mind Bend resolves")                 // countered: it never resolves
    || l.join(" | ");
});
test("…and the Repulse drew the card Memory Lapse put on top, which the log doesn't name", () => {
  const s = resolveStack(stack());
  return names(s.hand[0]).includes("Mind Bend") && !s.log.filter(l => !l.st).some(l => /draws/.test(l.t)) || `${names(s.hand[0])} / ${lines(s).filter(t => /draw/.test(t))}`;
});
test("a trigger and an ability say so too", () => {
  let s = scene({ active: 1, step: "main1", hand: [[], ["Thundering Falls"]], lib: ["Island", "Island"], bf: [[1, "Island"], [0, "Island"]] });
  s = go(s, 1, { t: "land", card: idIn(s, 1, "Thundering Falls") });
  s = resolveStack(s);
  return lines(s).includes("Thundering Falls trigger resolves") || lines(s).join(" | ");
});
test("a spell whose target has gone fizzles and doesn't say it resolves", () => {
  let s = scene({ active: 0, step: "main1", hand: [["Repulse"], ["Repulse"]], bf: [[1, "Dandân"], ...islandsOf(1, 3), ...islandsOf(0, 3)] });
  const dd = onBf(s, 1, "Dandân"), t = { k: "c", id: dd, oid: oidOf(s, dd) };
  s = cast(s, 0, "Repulse", [t]);
  s = cast(s, 1, "Repulse", [t]);                                    // they take their own Dandân back first
  s = resolveStack(s);
  const l = lines(s);
  return l.filter(x => x === "Repulse resolves").length === 1 && l.includes("Repulse fizzles: its target is gone") || l.join(" | ");
});

// 6 November 2026, Korbi, from a game where a Dandân came back to the wrong hand (or looked it): the log names the target
// with whoever controls it, says whose hand a returned card goes to, and marks each step of the turn.
test("a cast names its target with the player who controls it, and a Repulse says whose hand the Dandân goes to", () => {
  let s = scene({ active: 0, step: "main1", hand: [["Repulse"], []], lib: ["Island", "Island"], bf: [[1, "Dandân"], ...islandsOf(1, 3), ...islandsOf(0, 3)] });
  const dd = onBf(s, 1, "Dandân");
  s = cast(s, 0, "Repulse", [{ k: "c", id: dd, oid: oidOf(s, dd) }]);
  s = resolveStack(s);
  const l = lines(s);
  return l.includes("{s0} casts Repulse on {s1}'s Dandân") && l.includes("Dandân returns to {s1}'s hand") && names(s.hand[1]).includes("Dandân") && !names(s.hand[0]).includes("Dandân")
    || l.join(" | ");
});
test("a spell targeting a spell names its caster too", () => {
  const l = lines(stack());
  return l.includes("{s0} casts Memory Lapse on {s1}'s Mind Bend") || l.join(" | ");
});
test("each step of a turn is a line of its own: untap, upkeep, the draw (who drew), main, a skipped combat", () => {
  let s = scene({ active: 0, step: "end", prio: 0, turn: 5, drawn: [0, 0], hand: [[], []], lib: ["Island", "Island"], bf: [...islandsOf(0, 2), ...islandsOf(1, 2)] });
  s = drive(s, c => c.active === 1 && c.step === "main2");
  const steps = s.log.filter(l => l.st).map(l => l.t);
  return steps.join("|") === "Untap|Upkeep|Draw: {s1} draws a card|Main 1|Combat (skip)|Main 2" || steps.join("|");
});
test("the first turn's draw is a skip, and step lines are never counted as something done", () => {
  let s = scene({ active: 0, step: "end", prio: 0, turn: 0, hand: [[], []], lib: ["Island", "Island"], bf: [] });
  s = drive(s, c => c.step === "main1");
  const l = s.log.filter(x => x.st).map(x => x.t);
  return (s.turn === 1 ? l.includes("Draw (skip)") : l.some(t => /^Draw/.test(t))) && s.log.filter(x => x.st).every(x => x.st === 1) || `${s.turn} ${l.join("|")}`;
});

if (bad) { console.log(`${bad} failed`); process.exit(1); }
console.log("all ok");
