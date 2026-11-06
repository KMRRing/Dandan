// The end of the library (Korbi, 1 November 2026: "make sure that every time the computer has initiative the board state and
// stack are correctly assessed… particularly when playing for the top of the deck, when the deck is almost empty and the loser
// is decided by who will draw on the empty deck"). One library is shared; whoever draws from it empty loses. Medium rated a
// draw of three the same with no cards left as with sixty (+1.45 for a Lórien Revealed with an empty library, which loses on
// the spot), the judge never saw a game end that way, and the look-ahead stopped two turns on whatever was left. Checked here:
// the rule as the engine plays it, that the policy's count of who draws last is that rule, and what Medium and Hard do.
import { moves, toMove, act } from "../dandan-engine.js";
import { DECK } from "../dandan-cards.js";
import { Player, libraryMove, emptiedBy, facts, RACE } from "../dandan-policy.js";
import { candidates, thinkMove, endOfLibrary } from "../dandan-think.js";
import { scene, islandsOf, go, J, idIn, names, drive } from "./dandan-scene.js";
import { botMove } from "../dandan-bot.js";
import { seeded } from "../seats.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const label = m => (m.t === "cast" ? DECK[m.card] : m.t === "cycle" ? "cycle " + DECK[m.card] : m.t);
const rate = (s, seat, name) => new Player(s, seat).scored().find(r => label(r.m) === name)?.v;

const FILLER = ["Halimar Depths", "Halimar Depths", "Remote Isle", "Remote Isle", "Lonely Sandbar", "Lonely Sandbar", "Mystic Sanctuary", "Mystic Sanctuary", "Thundering Falls", "Thundering Falls", "Flood Plain", "Flood Plain", "Gone Missing", "Gone Missing", "Deem Inferior", "Deem Inferior", "Mind Bend", "Mind Bend", "Piracy Charm", "Piracy Charm", "Repulse", "Repulse", "Metamorphose", "Mystic Retrieval", "Take Inventory", "Take Inventory", "Chart a Course", "Quicken", "Predict", "Predict"];
/** The computer (seat 1) in its first main phase with a library of `n` Islands under it, a draw spell or two in hand. */
function position(n, { hand = ["Brainstorm", "Lórien Revealed"], active = 1, theirs = ["Dandân"] } = {}) {
  return scene({
    active, step: "main1", prio: active, turn: 40, drawn: [0, 1], bare: true,
    hand: [theirs, [...hand]], bf: [...islandsOf(0, 3), ...islandsOf(1, 6), [1, "Dandân"]], lib: [...Array(Math.min(n, 7)).fill("Island"), ...FILLER].slice(0, n),
  });
}
/** Both seats passing (and answering what they're asked as the bot would) until the game ends: the seat that lost, and how. */
function playOut(s) {
  let c = J(s);
  for (let i = 0; i < 600 && !c.over; i++) {
    const who = toMove(c);
    if (who == null) break;
    c = go(c, who, c.pending ? botMove(c, who, { rng: seeded(i) }) : { t: "pass" });
  }
  return c;
}

// the rule as the engine plays it: a draw past the end loses the game, there and then
{
  const s = position(2), c = go(s, 1, { t: "cast", card: idIn(s, 1, "Brainstorm"), from: "hand", targets: [] });
  let d = c;
  for (let i = 0; i < 6 && !d.over; i++) d = go(d, toMove(d), d.pending ? botMove(d, toMove(d), { rng: seeded(i) }) : { t: "pass" });
  check(d.over && d.winner === 0 && d.why === "library", "a Brainstorm with two cards left draws a third from nothing: the caster loses, by the library");
}
// who draws last, by the policy's count, against the engine playing it out with both seats passing
{
  const bySteps = n => { const f = playOut(position(n, { hand: [] })); return f.over && f.why === "library" ? f.winner === 0 ? 1 : 0 : -1; };   // the loser
  let agree = 0, total = 0;
  for (let n = 0; n <= 7; n++) {
    const s = position(n, { hand: [] }), F = facts(s, 1);
    total++;
    if (emptiedBy(n, F.next) === bySteps(n)) agree++; else console.log("   disagrees at", n, "policy says", emptiedBy(n, F.next), "engine", bySteps(n));
  }
  check(agree === total, `with only draw steps left, the policy's loser is the engine's, for every library from 0 to 7 cards (${agree}/${total})`);
}
// what a move does to the library, as the engine does it
{
  const s = position(8, { hand: ["Brainstorm", "Lórien Revealed", "Predict", "Quicken", "Chart a Course"] }), F = facts(s, 1);
  const net = name => { const m = moves(s, 1).find(x => x.t === "cast" && DECK[x.card] === name); let c = go(s, 1, { ...m, hold: true });
    for (let i = 0; i < 8 && (c.stack.length || c.pending) && !c.over; i++) c = go(c, toMove(c), c.pending ? (c.pending.t === "name" ? { t: "name", name: "Island" } : botMove(c, toMove(c), { rng: seeded(i) })) : { t: "pass" });
    return s.lib.length - c.lib.length; };
  for (const [name, want] of [["Brainstorm", 1], ["Lórien Revealed", 3], ["Quicken", 1], ["Chart a Course", 2]]) {
    const m = moves(s, 1).find(x => x.t === "cast" && DECK[x.card] === name);
    check(m && libraryMove(s, F, m).net === want && net(name) === want, `${name} takes ${want} out of the library: the policy's count and the engine's agree`);
  }
}
// Medium never draws itself out, whatever else it rates
for (const n of [0, 1, 2]) {
  const s = position(n, { hand: ["Brainstorm", "Lórien Revealed", "Predict"] });
  const names = n < 2 ? ["Brainstorm", "Lórien Revealed", "Predict"] : ["Brainstorm", "Lórien Revealed"];   // with two left, a Predict (one milled, one drawn) takes them both and is no loss
  const worst = names.map(x => rate(s, 1, x));
  check(worst.every(v => v === undefined || v < -5), `with ${n} cards left, ${names.length === 3 ? "a draw of three or a Predict" : "a draw of three"} scores well below passing: ${worst.map(v => v?.toFixed(1)).join(", ")}`);
}
// the race: the player whose draw it would be loses it, and a move that changes whose that is is worth it, either way
{
  // 3 cards left on the computer's turn: the opponent draws the 1st and 3rd, it the 2nd and the 4th, which finds nothing: it loses unless that changes
  const s = position(3, { hand: ["Brainstorm"] }), F = facts(s, 1);
  check(emptiedBy(3, F.next) === 1, "3 cards left on its own turn: it is the one to draw from the empty library");
  const v = rate(s, 1, "Brainstorm");
  check(v > 1, `…so a Brainstorm, which takes one card out and changes that, is rated above passing (${v?.toFixed(1)})`);
  check(playOut(go(s, 1, { t: "cast", card: idIn(s, 1, "Brainstorm"), from: "hand", targets: [] })).winner === 1 && playOut(s).winner === 0, "…and played out, with Brainstorm the opponent is the one who runs out; passing, the computer");
  const hard = thinkMove(s, 1, { deals: 48, ms: 8000 });
  check(label(hard) === "Brainstorm", `Hard plays it (${label(hard)})`);
  // one card more and the draw steps already favour it: a Brainstorm would spoil that
  const t = position(4, { hand: ["Brainstorm"] }), G = facts(t, 1);
  check(emptiedBy(4, G.next) === 0, "4 cards left on its own turn: the opponent is the one to draw from the empty library");
  const w = rate(t, 1, "Brainstorm");
  check(w < -1, `…so a Brainstorm (which would hand the race back) is rated well below passing (${w?.toFixed(1)})`);
  const hard2 = thinkMove(t, 1, { deals: 48, ms: 8000 });
  check(label(hard2) !== "Brainstorm", `Hard keeps its Brainstorm (${label(hard2)})`);
}
// the race is worth less when the other player holds cards, any of which may be a draw that puts it back (UNDONE)
{
  const few = position(3, { hand: ["Brainstorm"], theirs: ["Dandân"] }), many = position(3, { hand: ["Brainstorm"], theirs: ["Dandân", "Island", "Island", "Island", "Predict"] });
  const a = rate(few, 1, "Brainstorm"), b = rate(many, 1, "Brainstorm");
  check(a > b && b > 0, `the same Brainstorm is rated ${a?.toFixed(1)} against one card in their hand and ${b?.toFixed(1)} against five (still above passing)`);
}
// near the end Hard weighs every move there is at the root, as with a spell on the stack (up to twelve)
{
  const hand = ["Brainstorm", "Lórien Revealed", "Predict", "Quicken", "Take Inventory", "Chart a Course", "Mind Bend", "Piracy Charm", "Repulse"];
  const near = position(5, { hand }), far = position(20, { hand });
  const legal = moves(near, 1).length + 1, n = candidates(near, 1).length, f = candidates(far, 1).length;
  check(n === Math.min(legal, 12) && n > 7 && f <= 7, `with 5 cards left ${n} of ${legal} moves are weighed; with 20, ${f} (at most seven)`);
}
// far from the end, nothing changes
{
  const s = position(RACE + 5, { hand: ["Brainstorm"] }), P = new Player(s, 1);
  check(!P.low && Math.abs(P.libraryTerm({ t: "cast", card: idIn(s, 1, "Brainstorm"), from: "hand", targets: [] })) === 0 || !P.low, `with more than ${RACE} cards left the library term isn't used`);
}
// the look-ahead plays on to the game's end when the library is nearly gone
{
  const a = position(30), b = position(5), c = position(0);
  check(endOfLibrary(a) === 0 && endOfLibrary(b) === 7 && endOfLibrary(c) === 2, `the look-ahead is lengthened only near the end: ${endOfLibrary(a)}, ${endOfLibrary(b)}, ${endOfLibrary(c)} extra turns for 30, 5 and 0 cards left`);
}

process.exit(bad ? 1 : (console.log("library-end: the end of the library is counted, the draw spells that would lose the game are not played, and a race to the last draw is played for"), 0));
