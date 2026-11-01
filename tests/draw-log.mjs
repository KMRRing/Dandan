// A draw of a card the other player saw on top is in the log (1 November 2026, a tester: "my dandan got hit by
// metamorphosis, but then wasn't the top card of the deck"). The cause was no fault in the rules: the computer cast
// Metamorphose in its own upkeep, so Dave's Dandân went on top and it drew it in the draw step, and a draw said nothing.
// Run: node tests/draw-log.mjs
import { DECK } from "../dandan-cards.js";
import { scene, islandsOf, go, cast, answer, resolveStack, idIn, onBf, names, J } from "./dandan-scene.js";
import { draw, knSet, BOTH } from "../dandan-core.js";

let bad = 0;
const test = (what, fn) => {
  try { const r = fn(); const ok = r !== false && typeof r !== "string"; console.log(`${ok ? "ok  " : "FAIL"} ${what}${typeof r === "string" ? " — " + r : ""}`); if (!ok) bad++; }
  catch (e) { console.log(`FAIL ${what}: ${e.message}`); bad++; }
};
const lines = s => s.log.map(l => l.t);
const drawn = s => lines(s).filter(t => / draws /.test(t));

// Dave's game: the computer's upkeep, Metamorphose on his Dandân, his Dandân from hand dropped in, then the draw step
const steal = () => {
  let s = scene({
    active: 1, turn: 5, step: "upkeep", prio: 1, hand: [["Dandân", "Island"], ["Metamorphose", "Thundering Falls"]],
    bf: [[0, "Dandân"], ...islandsOf(0, 2), ...islandsOf(1, 3)], lib: ["Lonely Sandbar", "Island"],
  });
  const dd = onBf(s, 0, "Dandân");
  s = cast(s, 1, "Metamorphose", [{ k: "c", id: dd, oid: s.bf.find(p => p.id === dd).oid }]);
  s = resolveStack(s);
  const top = s.lib[0];
  s = answer(s, { t: "pick", card: idIn(s, 0, "Dandân") });
  return { s, top, dd };
};

test("a Metamorphosed Dandân drawn in the caster's upkeep is in the log, and in the caster's hand", () => {
  const { s, top, dd } = steal();
  return top === dd && s.hand[1].includes(dd) && lines(s).includes("{s1} draws Dandân, which was on top")
    || `top ${DECK[top]}; hand ${names(s.hand[1])}; log ${drawn(s)}`;
});
test("…so the surveil of a land the computer plays next sees the card that was under it", () => {
  const { s } = steal();
  const c = go(s, 1, { t: "land", card: idIn(s, 1, "Thundering Falls") });
  return c.pending?.t === "surveil" && DECK[c.pending.card] === "Lonely Sandbar" || `${c.step} ${c.pending?.t} top ${names(c.lib.slice(0, 2))}`;
});
test("a draw of a card nobody else saw says nothing", () => {
  const s = scene({ active: 1, hand: [[], []], lib: ["Island", "Dandân"] });
  const c = J(s);
  draw(c, 1, 1);
  return drawn(c).length === 0 || `logged ${drawn(c)}`;
});
test("a card only the drawer saw (a look at the top) says nothing", () => {
  const s = scene({ active: 1, hand: [[], []], lib: ["Island", "Dandân"] });
  knSet(s, s.lib[0], 1 << 1);
  draw(s, 1, 1);
  return drawn(s).length === 0 || `logged ${drawn(s)}`;
});
test("a card both saw on top (a countered spell) is named when its owner draws it", () => {
  const s = scene({ active: 0, hand: [[], []], lib: ["Piracy Charm", "Island"] });
  knSet(s, s.lib[0], BOTH);
  draw(s, 0, 1);
  return drawn(s).join() === "{s0} draws Piracy Charm, which was on top" || `logged ${drawn(s)}`;
});

if (bad) { console.log(`${bad} failed`); process.exit(1); }
console.log("all ok");
