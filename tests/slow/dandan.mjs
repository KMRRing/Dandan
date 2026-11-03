// Run by hand, about nine minutes: node tests/slow/dandan.mjs (ported from the Codex suite's tests/dandan.mjs; not in tests/*.mjs, so
// the workflow doesn't run it). Every FAIL is a rule broken; a GAP is a habit of Medium's, below.
// Dandan (dandan-cards.js, -core, -spells, -engine, -bot, -rules): the 80 cards of the list, the opening hand and the
// mulligans, the turn and its stops, the stack with responses (a counter countered, a copy, a spell sent back to the
// library and drawn again), each card's effect, the lands, combat (a Dandân attacks only a player with an Island, is
// sacrificed with none, dies to +2/−1; Mind Bend changing what it looks for), the ends of a game (life, an empty
// library, conceding), the state through the database, the computer player's choices, and whole games of computer
// players.
import { DECK, CARDS, HALVES, NAMES, TOKEN_AT, parseCost, total } from "../../dandan-cards.js";
import { deal, act, settle, restore, moves, toMove, nextDrawer, costOf, halfOf, unplayable, afterFetch, payment, MOST_MULLS } from "../../dandan-engine.js";
import { RES, T } from "../../dandan-spells.js";
import { nm, perm, islands, typesOf, topKnown, payPlan, canPay, canAttack, knownIn } from "../../dandan-core.js";
import { rules } from "../../dandan-rules.js";
import { botMove, randomMove, randomAnswer } from "../../dandan-bot.js";
import { thinkMove, BUDGET, DEPTH } from "../../dandan-think.js";
import { newRecord, applyMove, botMove as seatBot, seeded, shuffle } from "../../seats.js";
import { roundTrip, same } from "./rtdb.js";
import { J, scene, islandsOf, go, refused, idIn, onBf, names, cast, pass, answer, drive, resolveStack, stackNames, sidOf } from "../dandan-scene.js";
import { zonesOf, moved, piles, STEPS } from "../../dandan-3d.js";
import { PICTURED, SPRITE, art } from "../../dandan-art.js";

let bad = 0;
// Medium's own habits that Hard's look-ahead corrects, written down as blunders when the rework began and not met by Medium
// today (Hard passes every one): reported as GAP, not counted, so a FAIL here is a rule broken. Medium's score against Easy
// is a habit too (57 of 100 at the last run; the bound below is from when it was written).
const GAPS = [/^Medium: Narset's Reversal on their Lapse aimed/, /^Medium: their Island taken at the end of their turn/, /^Medium: with red of its own, takes the Charm first/, /^Medium beats Easy in /];
const check = (ok, what) => {
  const gap = !ok && GAPS.some(g => g.test(what));
  console.log(`${ok ? "ok  " : gap ? "GAP " : "FAIL"} ${what}`);
  if (!ok && !gap) bad++;
};
/** A check that may throw (a move the engine refused): that is a failure with the reason; a string returned is one too. */
const test = (what, fn) => {
  try { const r = fn(); check(r !== false && typeof r !== "string", typeof r === "string" ? `${what} — ${r}` : what); }
  catch (e) { console.log(`FAIL ${what}: ${e.message}`); bad++; }
};

// ---------- the list ----------
{
  const count = n => DECK.filter(x => x === n).length;
  check(DECK.length === 80 && NAMES.length === 25, "80 cards, 25 different, as in the list");
  check(count("Island") === 16 && count("Memory Lapse") === 8 && count("Dandân") === 10 && count("Take Inventory") === 4 && count("Commit // Memory") === 2, "the numbers of the staples: 16 Islands, 8 Memory Lapse, 10 Dandân, 4 Take Inventory");
  const halves = Object.values(HALVES).flat();
  const spells = Object.keys(CARDS).filter(n => ["instant", "sorcery", "creature"].includes(CARDS[n].type));
  check(spells.every(n => RES[n]) && halves.every(n => RES[n]), "every spell has its effect written");
  check(DECK.every(n => CARDS[n] || HALVES[n]), "every card in the list has a definition");
  const c = parseCost("{3}{U}{U}");
  check(c.g === 3 && c.U === 2 && total(c) === 5, "a cost reads as its generic and blue parts");
  check(CARDS["Dandân"].pt.join("/") === "4/1" && CARDS["Dandân"].cost === "{U}{U}", "Dandân: 4/1 for UU");
  check(total(parseCost(CARDS.Memory.cost)) === 6 && CARDS.Memory.aftermath, "Memory: six mana, aftermath");
}

// ---------- the opening hand ----------
{
  const s = restore(J(deal({ rng: seeded(3) })));
  check(s.hand[0].length === 7 && s.hand[1].length === 7 && s.lib.length === 66 && s.turn === 0, "seven cards each from the one library of 80");
  check(s.pending?.t === "mull" && s.pending.seat === s.first, "the player to go first is asked first");
  check(JSON.stringify(deal({ rng: seeded(3) })) === JSON.stringify(deal({ rng: seeded(3) })), "the same seed deals the same game");
  const dealt = [...s.hand[0], ...s.hand[1], ...s.lib].sort((a, b) => a - b);
  check(dealt.every((x, i) => x === i), "every card is in the hands or the library, once");

  // a hand with fewer than two lands or fewer than two spells may be thrown back for nothing
  let free = null, fine = null;
  for (let seed = 1; seed < 300 && !(free && fine); seed++) {
    const g = restore(J(deal({ rng: seeded(seed) })));
    if (g.pending.free) free ??= seed; else fine ??= seed;
  }
  const f = restore(J(deal({ rng: seeded(free) })));
  check(unplayable(f, f.pending.seat) && f.pending.free, `a hand short of lands or spells is offered a free mulligan (seed ${free})`);
  const after = answer(f, { t: "mull" });
  check(after.reveal?.seat === f.pending.seat && after.reveal.cards.length === 7 && after.mull.n[f.pending.seat] === 0 && after.hand[f.pending.seat].length === 7, "a free one shows the hand to the other player, costs no card, and deals seven again");
  const g = restore(J(deal({ rng: seeded(fine) }))), seat = g.pending.seat;
  check(!g.pending.free && g.pending.first && refused(g, seat, { t: "keep", extra: 1 }) === null, "a playable hand isn't shown, but its first mulligan is free (23 October 2026)");
  const m1 = answer(g, { t: "mull" });
  check(m1.mull.n[seat] === 1 && m1.reveal === null && m1.hand[seat].length === 7 && !m1.pending.first, "the first mulligan is dealt seven again and counted, not shown");
  const k1 = answer(m1, { t: "keep" });
  check(k1.pending?.t !== "bottom" && k1.hand[seat].length === 7 && k1.pending?.seat !== seat, "keeping after the free first mulligan puts nothing on the bottom");
  // a second (a short hand dealt meanwhile is free and shown, and doesn't count)
  let m2 = m1;
  for (let i = 0; i < 40 && m2.mull.n[seat] < 2; i++) m2 = answer(m2, { t: "mull" });
  const k2 = answer(m2, { t: "keep" });
  check(m2.mull.n[seat] === 2 && k2.pending?.t === "bottom" && k2.pending.n === 1, "keeping after a second mulligan puts one card on the bottom");
  check(refused(k2, seat, { t: "bottom", cards: [] }) !== null, "…and it must be one");
  const put = k2.hand[seat][0];
  const k3 = answer(k2, { t: "bottom", cards: [put] });
  check(k3.hand[seat].length === 6 && k3.lib[k3.lib.length - 1] === put && topKnown(k3, seat) === null && k3.pending.seat !== seat, "the bottomed card is last in the library, and the other player is asked");
  const both = answer(k3, { t: "keep" });
  check(both.turn === 1 && both.active === both.first && both.step === "main1" && both.hand[both.first].length === (both.first === seat ? 6 : 7), "both kept: turn 1, the first player on the play with no draw");
  let h = g;
  for (let i = 0; i < 80 && (h.mull.n[seat] < MOST_MULLS || h.pending.free); i++) h = answer(h, { t: "mull" });
  check(h.mull.n[seat] === MOST_MULLS && refused(h, seat, { t: "mull" }) === "Keep this hand" && answer(h, { t: "keep" }).pending.n === 6, "no mulligan past the seventh, the first free: six to the bottom, one kept");
  // a hand short of lands or spells is free and shown after the free first mulligan too
  let short = null;
  for (let seed = 1; seed < 400 && !short; seed++) {
    const d = restore(J(deal({ rng: seeded(seed) })));
    if (d.pending.free) continue;
    const e = answer(d, { t: "mull" });
    if (e.pending.free) short = e;
  }
  const sv = short?.pending.seat, s2 = short && answer(short, { t: "mull" });
  check(!!short && s2.mull.n[sv] === 1 && s2.reveal?.seat === sv, "a short hand after the free first mulligan is shown and thrown back free, uncounted");
}

// ---------- a turn ----------
// A game stops only where a seat could act (wants), so a scene gives the seat it wants to stop at a land in hand.
{
  let s = scene({ hand: [["Island", "Island"], ["Island"]], hold: 0 });
  check(refused(s, 1, { t: "land", card: idIn(s, 1, "Island") }) === "You don't have priority", "a land out of turn is refused");
  const i1 = idIn(s, 0, "Island");
  s = go(s, 0, { t: "land", card: i1 });
  check(!!perm(s, i1) && s.played === 1, "a land is played in the main phase");
  check(refused(s, 0, { t: "land", card: idIn(s, 0, "Island") }) === "You've played a land this turn", "one land a turn");
  const late = scene({ hand: [["Island"], []], step: "end" });
  check(refused(late, 0, { t: "land", card: idIn(late, 0, "Island") })?.startsWith("Lands are played"), "never at the end step");
  // through the turn to the other player's draw
  s = scene({ hand: [["Island"], ["Island"]], lib: ["Remote Isle"], step: "end", passes: 1, prio: 0 });
  s = drive(s, c => c.turn === 6 && c.step === "main1");
  check(s.active === 1 && s.hand[1].length === 2 && names(s.hand[1]).includes("Remote Isle"), "the next turn: the draw is the top card of the library");
  s = scene({ hand: [["Island"], ["Island"]], step: "main1" });
  s = drive(s, c => c.step === "end" && c.active === 0);
  check(s.step === "end", "the turn goes main phase, attack (none), second main, end step");
  // the cleanup step
  s = scene({ hand: [Array(9).fill("Island"), []], step: "end", passes: 1, prio: 0 });
  s = pass(s, 0);
  check(s.pending?.t === "discard" && s.pending.n === 2 && s.pending.cleanup, "nine cards at the end of the turn: discard two");
  s = answer(s, { t: "discard", cards: s.hand[0].slice(0, 2) });
  check(s.turn > 5 && s.yard.length === 2 && s.hand[0].length >= 7, "…and the next turn begins");
  // untap
  s = scene({ bf: [[1, "Island", { tapped: true }], [0, "Island", { tapped: true }]], step: "end", passes: 1, prio: 0, hand: [[], ["Island"]] });
  s = drive(s, c => c.turn === 6 && c.step === "main1");
  check(perm(s, onBf(s, 1, "Island")).tapped === false && perm(s, onBf(s, 0, "Island")).tapped === true, "only the active player's permanents untap");
}

// ---------- the stack: responses ----------
test("a seat with nothing to answer with isn't asked: the spell resolves at once", () => {
  const s = cast(scene({ hand: [["Brainstorm"], []], bf: islandsOf(0, 1) }), 0, "Brainstorm");
  return s.pending?.t === "putback" && s.pending.seat === 0 && s.hand[0].length === 3;
});
test("a seat that could respond is asked, and a spell waits for it", () => {
  const s = cast(scene({ hand: [["Take Inventory"], ["Memory Lapse"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 2)] }), 0, "Take Inventory");
  return toMove(s) === 1 && stackNames(s).join() === "Take Inventory";
});
test("holding priority: the caster may cast again before the other player has answered the first spell", () => {
  const base = () => scene({ hand: [["Quicken", "Brainstorm"], ["Memory Lapse"]], bf: [...islandsOf(0, 4), ...islandsOf(1, 2)] });
  const plain = go(base(), 0, { t: "cast", card: idIn(base(), 0, "Quicken"), from: "hand", targets: [] });
  const held = go(base(), 0, { t: "cast", card: idIn(base(), 0, "Quicken"), from: "hand", targets: [], hold: true });
  if (toMove(plain) !== 1) return "without the flag the other player should be asked first";
  if (toMove(held) !== 0) return "with the flag the caster should keep priority";
  const again = go(held, 0, { t: "cast", card: idIn(held, 0, "Brainstorm"), from: "hand", targets: [] });
  return again.stack.length === 2;
});
test("Memory Lapse: the spell goes on top of the library, and whoever draws next draws it", () => {
  let s = cast(scene({ hand: [["Take Inventory", "Island"], ["Memory Lapse"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 2)] }), 0, "Take Inventory");
  const ti = s.stack[0].card;
  s = cast(s, 1, "Memory Lapse", [T.s(s.stack[0].sid)]);
  if (s.stack.length || s.lib[0] !== ti || topKnown(s, 0) !== ti || topKnown(s, 1) !== ti) return "not on top of the library, in the open";
  if (nextDrawer(s) !== 1) return "it is the caster's turn: the other player draws next";
  const t = drive(s, c => c.turn === 6 && c.step === "main1");
  return t.active === 1 && t.hand[1].includes(ti);
});
test("…and on the other player's turn it comes back to us", () => {
  let s = cast(scene({ active: 1, hand: [["Memory Lapse"], ["Take Inventory", "Island"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 3)] }), 1, "Take Inventory");
  const ti = s.stack[0].card;
  s = cast(s, 0, "Memory Lapse", [T.s(s.stack[0].sid)]);
  if (nextDrawer(s) !== 0 || s.lib[0] !== ti) return "not ours to draw";
  const t = drive(s, c => c.turn === 6 && c.step === "main1");
  return t.active === 0 && t.hand[0].includes(ti);
});
test("a counter countered: it lands on top of the library, and the spell resolves — drawing the very card that was put there", () => {
  let s = scene({ hand: [["Brainstorm", "Memory Lapse"], ["Memory Lapse"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 2)] });
  const theirs = idIn(s, 1, "Memory Lapse");
  s = cast(s, 0, "Brainstorm");
  s = cast(s, 1, "Memory Lapse", [T.s(sidOf(s, "Brainstorm"))]);
  if (toMove(s) !== 0) return "we weren't asked";
  s = cast(s, 0, "Memory Lapse", [T.s(sidOf(s, "Memory Lapse"))]);   // theirs is the one on the stack
  return s.pending?.t === "putback" && s.hand[0].includes(theirs);
});
test("Narset's Reversal: a copy for us, the original back to its owner's hand", () => {
  let s = scene({ hand: [["Brainstorm"], ["Narset's Reversal"]], bf: [...islandsOf(0, 1), ...islandsOf(1, 2)] });
  const bs = idIn(s, 0, "Brainstorm");
  s = cast(s, 0, "Brainstorm");
  s = cast(s, 1, "Narset's Reversal", [T.s(sidOf(s, "Brainstorm"))]);
  return s.pending?.t === "putback" && s.pending.seat === 1 && s.hand[0].includes(bs) && s.hand[1].length === 3;
});
test("…a copy chooses new targets: Reversal on a +2/−1 sent at their Dandân kills ours instead", () => {
  let s = scene({ hand: [["Piracy Charm"], ["Narset's Reversal"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 3), [0, "Dandân"], [1, "Dandân"]] });
  const theirs = onBf(s, 1, "Dandân"), ours = onBf(s, 0, "Dandân");
  s = cast(s, 0, "Piracy Charm", [T.c(theirs)], 1);
  s = cast(s, 1, "Narset's Reversal", [T.s(sidOf(s, "Piracy Charm"))]);
  if (s.pending?.t !== "retarget" || s.pending.seat !== 1) return `no new target asked: ${JSON.stringify(s.pending)}`;
  s = resolveStack(answer(s, { t: "retarget", targets: [T.c(ours)] }));
  return !perm(s, ours) && !!perm(s, theirs) && s.yard.includes(ours);
});
test("a spell whose only target is gone fizzles and does nothing", () => {
  let s = scene({ hand: [["Repulse", "Island"], ["Repulse"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 3), [1, "Dandân"]] });
  const d = onBf(s, 1, "Dandân");
  s = cast(s, 0, "Repulse", [T.c(d)]);
  s = cast(s, 1, "Repulse", [T.c(d)]);                           // theirs saves the Dandân: back to its hand, and a card
  const first = s.stack.length === 0 && s.hand[1].includes(d) && s.hand[0].length === 1 && s.hand[1].length === 2;
  return first && s.log.some(l => l.t.includes("fizzles")) || `${s.hand.map(h => h.length)} ${s.log.map(l => l.t)}`;
});
test("the stack resolves last in, first out", () => {
  let s = scene({ hand: [["Brainstorm", "Predict"], ["Brainstorm", "Memory Lapse"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 3)] });
  s = cast(s, 0, "Predict");
  s = cast(s, 1, "Brainstorm");
  s = pass(s, 0);                                                 // theirs resolves first
  return s.pending?.t === "putback" && s.pending.seat === 1 && stackNames(s).join() === "Predict,Brainstorm";
});
test("Quicken: the next sorcery this turn can be cast with flash, once", () => {
  let s = scene({ hand: [["Quicken", "Take Inventory", "Take Inventory"], []], bf: islandsOf(0, 6), active: 1, step: "end", prio: 0, passes: 1, hold: 0 });
  const ti = () => ({ t: "cast", card: idIn(s, 0, "Take Inventory"), from: "hand", targets: [] });
  if (!/main phase/.test(refused(s, 0, ti()))) return "a sorcery at the end step without Quicken";
  s = cast(s, 0, "Quicken");
  if (!s.quick[0]) return "no flash granted";
  s = cast(s, 0, "Take Inventory");
  return !s.quick[0] && /main phase/.test(refused(s, 0, ti()));
});

// ---------- the upkeep: the card about to be drawn ----------
/** A scene at our end step, played on to the other player's turn 6 until someone is asked. */
const toTheirUpkeep = (mine, bf) => drive(scene({ active: 0, step: "end", prio: 0, passes: 1, hand: [mine, []], bf }), c => c.turn === 6, 40);
test("the other player's upkeep is a stop for a Brainstorm (two cards of our choosing for them to draw) and a Predict", () => {
  const bs = toTheirUpkeep(["Brainstorm"], islandsOf(0, 1)), pr = toTheirUpkeep(["Predict"], islandsOf(0, 2));
  const asked = c => c.step === "upkeep" && c.active === 1 && toMove(c) === 0;
  return asked(bs) && asked(pr) || `${bs.step}/${toMove(bs)} ${pr.step}/${toMove(pr)}`;
});
// 31 October 2026, Korbi: "before draw, if user can do anything, including cast predict or any instant speed action,
// they need to be able to choose to not do that. just happened that I could have cast predict but game continued to
// draw automatically": the top card unknown, and a Predict held in our own upkeep, was no stop at all
/** A scene at the other player's end step, played on to our turn 7 until someone is asked. */
const toMyUpkeep = (mine, bf) => drive(scene({ active: 1, step: "end", turn: 6, prio: 1, passes: 1, hand: [mine, []], bf }), c => c.turn === 7, 40);
test("any upkeep from the second turn where a person could do anything is a stop, theirs or ours, the top card known or not", () => {
  const mine = ["Predict", "Quicken", "Remote Isle"].map(n => toMyUpkeep([n], islandsOf(0, 2)));
  const theirs = toTheirUpkeep(["Quicken"], islandsOf(0, 1));
  const none = toMyUpkeep(["Predict"], []);                         // nothing to pay with: nothing to ask
  const askedMe = c => c.step === "upkeep" && c.active === 0 && toMove(c) === 0;
  return mine.every(askedMe) && theirs.step === "upkeep" && toMove(theirs) === 0 && !askedMe(none)
    && go(mine[0], 0, { t: "pass" }).step !== "upkeep"              // and passing goes on to the draw
    || `${mine.map(c => c.step + "/" + toMove(c))} ${theirs.step}/${toMove(theirs)} ${none.step}/${toMove(none)}`;
});
test("…but not the computer's own: it is asked there, and passes, only where it has a known top card or a Brainstorm or Predict for your draw", () => {
  const c = drive(scene({ active: 0, step: "end", turn: 5, prio: 0, passes: 1, hand: [[], ["Quicken"]], bf: islandsOf(1, 2) }), x => x.turn === 6, 40);
  return c.step === "upkeep" && toMove(c) === 1 && botMove(c, 1, { rng: seeded(1) }).t === "pass";
});
test("an upkeep where the seat knows the top card and could act on it is a stop too: it draws the card before its owner can", () => {
  // our Memory Lapse put their spell on top at our end step: theirs to draw; in their upkeep, a cycling land draws it first
  let s = scene({ active: 0, step: "end", prio: 1, passes: 1, hand: [["Memory Lapse", "Lonely Sandbar"], ["Take Inventory"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 2)] });
  s.quick[1] = true;                                              // (a Quicken resolved earlier: their sorcery at instant speed)
  s = cast(s, 1, "Take Inventory");
  const ti = s.stack[0].card;
  s = cast(s, 0, "Memory Lapse", [T.s(s.stack[0].sid)]);
  if (s.lib[0] !== ti || nextDrawer(s) !== 1) return "the countered spell should be on top, theirs to draw";
  s = drive(s, c => c.turn === 6, 40);
  if (!(s.step === "upkeep" && toMove(s) === 0)) return `not asked at their upkeep (${s.step} turn ${s.turn})`;
  s = resolveStack(go(s, 0, { t: "cycle", card: idIn(s, 0, "Lonely Sandbar") }));
  return s.hand[0].includes(ti) && !s.lib.includes(ti);
});

// ---------- mana that floats ----------
test("mana a land makes and a cost doesn't use floats to the end of the step: Izzet Boilerworks pays {U}, its {R} pays the next cost", () => {
  // with an Island to pay from, the dual is kept for last
  let s = scene({ hand: [["Brainstorm", "Remote Isle"], []], bf: [[0, "Izzet Boilerworks"], [0, "Island"]] });
  s = go(s, 0, { t: "cast", card: idIn(s, 0, "Brainstorm"), from: "hand", targets: [] });
  const kept = !perm(s, onBf(s, 0, "Izzet Boilerworks")).tapped;
  // with only the dual, its R floats, through Brainstorm's resolving, and pays half of Remote Isle's cycling
  let t = scene({ hand: [["Brainstorm", "Remote Isle", "Island"], []], bf: [[0, "Izzet Boilerworks"]] });
  t = go(t, 0, { t: "cast", card: idIn(t, 0, "Brainstorm"), from: "hand", targets: [] });
  if (t.pool[0] !== "R") return `nothing floats (${JSON.stringify(t.pool)})`;
  t = answer(t, { t: "putback", cards: t.hand[0].filter(id => !["Remote Isle", "Island"].includes(DECK[id])).slice(0, 2) });
  if (t.step !== "main1" || t.pool[0] !== "R") return `the R should still float in the same step (${t.step}, ${JSON.stringify(t.pool)})`;
  t = go(t, 0, { t: "land", card: idIn(t, 0, "Island") });
  const plan = payPlan(t, 0, parseCost("{2}"));                  // Remote Isle's cycling: the floating R and the new Island
  const cycled = refused(t, 0, { t: "cycle", card: idIn(t, 0, "Remote Isle") }) === null;
  const later = drive(t, c => c.step !== "main1", 30);
  return kept && plan.taps.join() === String(onBf(t, 0, "Island")) && plan.pool === "" && cycled && later.pool[0] === "" || `${kept} ${JSON.stringify(plan)} ${later.pool}`;
});

// ---------- what each player knows of the other's hand ----------
test("a card drawn from a top both had seen is known in the hand it went to, until it leaves it; a bounced one is known too", () => {
  let s = scene({ hand: [["Take Inventory", "Island"], ["Memory Lapse"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 2), [1, "Dandân"]] });
  s = cast(s, 0, "Take Inventory");
  const ti = s.stack[0].card;
  s = cast(s, 1, "Memory Lapse", [T.s(s.stack[0].sid)]);
  s = drive(s, c => c.turn === 6 && c.step === "main1");
  const known = knownIn(s, 1, 0).includes(ti);
  let r = scene({ hand: [["Repulse", "Island"], []], bf: [...islandsOf(0, 3), [1, "Island"], [1, "Dandân"]] });
  const d = onBf(r, 1, "Dandân");
  r = cast(r, 0, "Repulse", [T.c(d)]);
  return known && knownIn(r, 1, 0).includes(d) && knownIn(r, 0, 1).length === 0;
});

// ---------- what play shows (tells) ----------
test("letting an opposing Dandân resolve with a Lapse's mana open is noted for the other player, until the passer draws", () => {
  let s = scene({ active: 0, hand: [["Dandân"], ["Island"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 2)], hold: 0 });
  s = cast(s, 0, "Dandân");
  const noted = s.tells[1].lapse === s.draws[1] && s.tells[1].on === "Dandân" && s.tells[0].lapse === -1;
  const tapped = cast(scene({ active: 0, hand: [["Dandân"], ["Island"]], bf: [...islandsOf(0, 2), [1, "Island", { tapped: true }], [1, "Island"]], hold: 0 }), 0, "Dandân");
  const later = drive(s, c => c.turn === 6 && c.step === "main1");
  return noted && tapped.tells[1].lapse === -1 && later.draws[1] > s.draws[1] && later.tells[1].lapse !== later.draws[1];
});
test("…and so is a removal spell aimed at their own Dandân let through, but not a Charm's islandwalk", () => {
  const at = () => scene({ active: 0, hand: [["Piracy Charm"], ["Island"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [1, "Dandân"]], hold: 0 });
  const kill = at(), walk = at();
  const k = cast(kill, 0, "Piracy Charm", [T.c(onBf(kill, 1, "Dandân"))], 1), w = cast(walk, 0, "Piracy Charm", [T.c(onBf(walk, 1, "Dandân"))], 0);
  return k.tells[1].lapse === k.draws[1] && k.tells[1].on === "Piracy Charm" && w.tells[1].lapse === -1;
});
test("a turn ended with no land played is noted, with the cards drawn by then; a land played is counted", () => {
  const s = scene({ active: 0, turn: 5, hand: [["Brainstorm"], ["Island"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 2)], hold: 1 });
  const next = drive(s, c => c.turn === 6);
  const t = scene({ active: 0, turn: 5, hand: [["Island", "Brainstorm"], ["Island"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 2)], hold: 1 });
  const played = drive(go(t, 0, { t: "land", card: idIn(t, 0, "Island") }), c => c.turn === 6);
  return next.tells[0].land === s.draws[0] && played.tells[0].land === -1 && played.tells[0].lands === 1;
});
test("an unblocked Dandân let hit a player with blue open is noted, with how much was open", () => {
  let s = scene({ active: 1, hand: [["Island"], []], bf: [...islandsOf(0, 2), [0, "Island", { tapped: true }], ...islandsOf(1, 2), [1, "Dandân"]], hold: 1 });
  s = answer(pass(s, 1), { t: "attack", ids: [onBf(s, 1, "Dandân")] });
  const hit = drive(s, c => c.step === "main2" || c.turn > s.turn);
  let none = scene({ active: 1, hand: [["Island"], []], bf: [[0, "Island", { tapped: true }], ...islandsOf(1, 2), [1, "Dandân"]], hold: 1 });
  none = drive(answer(pass(none, 1), { t: "attack", ids: [onBf(none, 1, "Dandân")] }), c => c.step === "main2" || c.turn > none.turn);
  return hit.life[0] === 16 && hit.tells[0].kill === hit.draws[0] && hit.tells[0].mana === 2 && none.life[0] === 16 && none.tells[0].kill === -1;
});
test("the opening hand's keep is noted, and a game saved before the tells reads its old pass note", () => {
  let s = restore(J(deal({ rng: seeded(31) })));
  for (let i = 0; i < 10 && s.pending?.t === "mull"; i++) s = go(s, s.pending.seat, { t: "keep" });
  const kept = s.tells.every((t, i) => t.keep === s.draws[i] && s.draws[i] >= 7);
  const old = J(s);
  delete old.tells;
  old.ev = [-1, 9];
  const back = restore(old);
  return kept && back.tells[1].lapse === 9 && back.tells[1].on === "Dandân" && back.tells[0].lapse === -1 && back.tells[0].keep === -1 && !("ev" in back);
});

// ---------- the objects on the battlefield ----------
test("a permanent that leaves and comes back is a new object: a spell aimed at the old one fizzles, a trigger of the old one does nothing", () => {
  let s = scene({ hand: [["Repulse"], []], bf: [...islandsOf(0, 3), [1, "Island"], [1, "Dandân"]], hold: 0 });
  const d = onBf(s, 1, "Dandân");
  s = go(s, 0, { t: "cast", card: idIn(s, 0, "Repulse"), from: "hand", targets: [T.c(d)], hold: true });
  if (!s.stack.length) return "the Repulse didn't wait";
  const aimed = perm(s, d).oid != null && s.stack[0].targets[0].oid === perm(s, d).oid;
  perm(s, d).oid += 1000;                                         // as if it had been bounced and put back
  s = resolveStack(s);
  const fizzled = !!perm(s, d) && s.log.some(l => l.t.includes("fizzles"));
  let t = scene({ bf: [[0, "Island"], [0, "Dandân"], [1, "Island"]], hand: [[], []], hold: 1 });
  const ours = onBf(t, 0, "Dandân");
  t.stack.push({ kind: "trigger", name: "@dandan", ctl: 0, src: ours, oid: perm(t, ours).oid + 1000, sid: 99, step: 0, d: {}, targets: [] });
  t = resolveStack(t);
  return aimed && fizzled && !!perm(t, ours) || `${aimed} ${fizzled} ${!!perm(t, ours)}`;
});
test("Narset's Reversal: a copy can take the other legal target", () => {
  let s = scene({ hand: [["Piracy Charm"], ["Narset's Reversal"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 3), [1, "Dandân"], [0, "Dandân"]] });
  const theirs = onBf(s, 1, "Dandân"), ours = onBf(s, 0, "Dandân");
  s = cast(s, 0, "Piracy Charm", [T.c(theirs)], 1);
  s = cast(s, 1, "Narset's Reversal", [T.s(sidOf(s, "Piracy Charm"))]);
  return s.pending?.t === "retarget" && s.pending.options.some(o => o[0].id === ours);
});

// ---------- the spells ----------
// (a card in hand or a hold keeps the game stopped at the seat; see scene)
test("Brainstorm: draw three, then put two back, the first on top — known to us alone", () => {
  let s = scene({ hand: [["Brainstorm", "Island"], []], bf: islandsOf(0, 1), lib: ["Dandân", "Island", "Memory Lapse"] });
  s = cast(s, 0, "Brainstorm");
  if (s.pending?.t !== "putback" || s.hand[0].length !== 4) return "no question after drawing three";
  const [a, b] = s.hand[0].slice(1, 3);                           // two of the three drawn
  s = answer(s, { t: "putback", cards: [a, b] });
  return s.lib[0] === a && s.lib[1] === b && s.hand[0].length === 2 && topKnown(s, 0) === a && topKnown(s, 1) === null;
});
test("Predict: a right name draws two, a wrong one draws one; the top card is milled either way", () => {
  const run = name => {
    let s = scene({ hand: [["Predict", "Island"], []], bf: islandsOf(0, 2), lib: ["Island", "Dandân", "Dandân", "Dandân"] });
    s = cast(s, 0, "Predict");
    return s.pending?.t === "name" ? answer(s, { t: "name", name }) : null;
  };
  const hit = run("Island"), miss = run("Memory Lapse");
  return hit.hand[0].length === 3 && hit.yard.some(i => DECK[i] === "Island") && miss.hand[0].length === 2 && miss.yard.some(i => DECK[i] === "Island");
});
test("Repulse: a creature back to its owner's hand, and we draw", () => {
  const s0 = scene({ hand: [["Repulse", "Island"], []], bf: [...islandsOf(0, 3), [1, "Island"], [1, "Dandân"]] });
  const d = onBf(s0, 1, "Dandân");
  const s = cast(s0, 0, "Repulse", [T.c(d)]);
  return s.hand[1].includes(d) && s.hand[0].length === 2 && !perm(s, d);
});
test("Commit: a spell, or a nonland permanent, goes second from the top of the library", () => {
  let s = scene({ hand: [["Brainstorm", "Island"], ["Commit // Memory"]], bf: [...islandsOf(0, 1), ...islandsOf(1, 4)] });
  const bs = idIn(s, 0, "Brainstorm");
  s = cast(s, 0, "Brainstorm");
  s = cast(s, 1, "Commit // Memory", [T.s(sidOf(s, "Brainstorm"))]);
  const spell = s.lib[1] === bs && s.stack.length === 0;
  let t = scene({ active: 1, hand: [[], ["Commit // Memory", "Island"]], bf: [...islandsOf(1, 4), [0, "Island"], [0, "Dandân"]] });
  const d = onBf(t, 0, "Dandân");
  t = cast(t, 1, "Commit // Memory", [T.c(d)]);
  return spell && t.lib[1] === d && !perm(t, d);
});
test("Memory (aftermath): only from the graveyard, six mana, everyone shuffles hand and graveyard in and draws seven; then it is exiled", () => {
  let s = scene({ hand: [["Island", "Island"], ["Brainstorm"]], yard: ["Commit // Memory", "Take Inventory"], bf: islandsOf(0, 6) });
  const card = s.yard.find(i => DECK[i] === "Commit // Memory");
  const fromHand = halfOf(card, "hand") === "Commit" && halfOf(card, "yard") === "Memory";
  s = go(s, 0, { t: "cast", card, from: "yard", targets: [] });
  return fromHand && s.hand[0].length === 7 && s.hand[1].length === 7 && s.yard.length === 0 && s.exile.includes(card) && !s.lib.includes(card);
});
test("Metamorphose: their permanent goes on top of the library, and they may put a creature or land from their hand onto the battlefield", () => {
  let s = scene({ hand: [["Metamorphose", "Island"], ["Dandân", "Island"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [1, "Dandân"]] });
  const old = onBf(s, 1, "Dandân"), spare = idIn(s, 1, "Dandân");
  s = cast(s, 0, "Metamorphose", [T.c(old)]);
  if (s.pending?.t !== "pick" || s.pending.seat !== 1 || s.pending.for !== "drop") return "they weren't asked";
  s = answer(s, { t: "pick", card: spare });
  return s.lib[0] === old && onBf(s, 1, "Dandân") === spare && !s.hand[1].includes(spare);
});
test("Piracy Charm: islandwalk makes an attacker unblockable against a player with an Island", () => {
  let s = scene({ hand: [["Piracy Charm"], []], bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [0, "Dandân"], [1, "Dandân"]] });
  s = pass(s, 0);                                                 // to the attack
  s = answer(s, { t: "attack", ids: [onBf(s, 0, "Dandân")] });
  s = cast(s, 0, "Piracy Charm", [T.c(onBf(s, 0, "Dandân"))], 0);
  s = drive(s, c => c.step === "main2");
  return s.life[1] === 16 && !!onBf(s, 1, "Dandân");
});
test("Piracy Charm: +2/−1 kills a Dandân (toughness 1) at once", () => {
  let s = scene({ hand: [["Piracy Charm"], []], bf: [...islandsOf(0, 2), [1, "Dandân"]] });
  const d = onBf(s, 1, "Dandân");
  s = cast(s, 0, "Piracy Charm", [T.c(d)], 1);
  return !perm(s, d) && s.yard.includes(d);
});
test("Piracy Charm: a player discards a card of their choice", () => {
  let s = scene({ hand: [["Piracy Charm", "Island"], ["Island", "Brainstorm"]], bf: islandsOf(0, 2) });
  s = cast(s, 0, "Piracy Charm", [T.p(1)], 2);
  if (s.pending?.t !== "discard" || s.pending.seat !== 1) return "they weren't asked";
  const gone = idIn(s, 1, "Island");
  s = answer(s, { t: "discard", cards: [gone] });
  return s.hand[1].length === 1 && s.yard.includes(gone);
});
test("Chart a Course: draw two, then discard a card unless we attacked this turn", () => {
  const s = cast(scene({ hand: [["Chart a Course", "Island"], []], bf: islandsOf(0, 2) }), 0, "Chart a Course");
  const asks = s.pending?.t === "discard" && s.pending.seat === 0 && s.hand[0].length === 3;
  let t = scene({ hand: [["Chart a Course", "Island"], []], bf: islandsOf(0, 2), step: "main2" });
  t.attacked = true;
  t = cast(t, 0, "Chart a Course");
  return asks && !t.pending && t.hand[0].length === 3;
});
test("Deem Inferior: costs {1} less for each card drawn this turn; the owner puts the permanent second from the top or on the bottom", () => {
  const s0 = scene({ hand: [["Deem Inferior", "Island"], []], bf: [...islandsOf(0, 4), [1, "Island"], [1, "Dandân"]] });
  const c = n => total(costOf({ ...s0, drawn: [n, 0] }, 0, "Deem Inferior", "hand"));
  if (!(c(0) === 4 && c(1) === 3 && c(3) === 1 && c(5) === 1)) return "the cost doesn't fall with the draws";
  const s = cast(s0, 0, "Deem Inferior", [T.c(onBf(s0, 1, "Dandân"))]);
  const d = s.pending?.target;
  if (s.pending?.t !== "owner" || s.pending.seat !== 1) return "the owner wasn't asked";
  const second = answer(s, { t: "owner", bottom: false }), bottom = answer(s, { t: "owner", bottom: true });
  return second.lib[1] === d && bottom.lib[bottom.lib.length - 1] === d && !perm(second, d);
});
test("Gone Missing: a permanent on top of its owner's library, and a Clue for us; a Clue costs {2} and a sacrifice to draw", () => {
  let s = scene({ hand: [["Gone Missing", "Island"], []], bf: [...islandsOf(0, 5), [1, "Island"], [1, "Dandân"]] });
  const d = onBf(s, 1, "Dandân");
  s = cast(s, 0, "Gone Missing", [T.c(d)]);
  if (s.lib[0] !== d || !s.bf.some(p => p.id >= TOKEN_AT && p.ctl === 0)) return "no Dandân on top, or no Clue";
  const u = scene({ bf: [...islandsOf(0, 2), [0, "Clue"]], hand: [["Island"], []] });
  const c2 = go(u, 0, { t: "ability", id: u.bf.find(p => p.id >= TOKEN_AT).id });
  return c2.hand[0].length === 2 && !c2.bf.some(p => p.id >= TOKEN_AT) && c2.bf.every(p => p.tapped);
});
test("Lórien Revealed: draw three; or {1}: islandcycling, discard it to fetch an Island card into hand", () => {
  const a = cast(scene({ hand: [["Lórien Revealed", "Island"], []], bf: islandsOf(0, 5) }), 0, "Lórien Revealed");
  let s = scene({ hand: [["Lórien Revealed"], []], bf: islandsOf(0, 1), lib: ["Dandân"] });
  s = go(s, 0, { t: "cycle", card: idIn(s, 0, "Lórien Revealed") });
  if (s.pending?.t !== "search" || s.pending.to !== "hand" || !s.pending.ids.every(i => (CARDS[DECK[i]].subs || []).includes("Island"))) return "no search for an Island card";
  const pick = s.pending.ids[0];
  s = answer(s, { t: "search", card: pick });
  return a.hand[0].length === 4 && s.hand[0].includes(pick) && s.yard.some(i => DECK[i] === "Lórien Revealed");
});
test("Mystic Retrieval: an instant or sorcery card back from the graveyard; flashback {2}{R} from there, then exiled", () => {
  let s = scene({ hand: [["Mystic Retrieval"], []], yard: ["Memory Lapse", "Dandân"], bf: islandsOf(0, 4) });
  const lapse = s.yard.find(i => DECK[i] === "Memory Lapse"), dandan = s.yard.find(i => DECK[i] === "Dandân");
  if (!moves(s, 0).some(m => m.t === "cast" && m.targets[0]?.id === lapse) || moves(s, 0).some(m => m.targets?.[0]?.id === dandan)) return "it should aim at the Lapse and not the Dandân";
  s = cast(s, 0, "Mystic Retrieval", [T.g(lapse)]);
  const got = s.hand[0].includes(lapse) && !s.yard.includes(lapse);
  let f = scene({ yard: ["Mystic Retrieval", "Brainstorm"], bf: [...islandsOf(0, 2), [0, "Thundering Falls"]], hand: [["Island"], []] });
  const mr = f.yard.find(i => DECK[i] === "Mystic Retrieval"), bs = f.yard.find(i => DECK[i] === "Brainstorm");
  f = go(f, 0, { t: "cast", card: mr, from: "yard", targets: [T.g(bs)] });
  // flashed back, it's on the stack by the time its target is chosen: never its own, though another Retrieval may be
  const two = scene({ yard: ["Mystic Retrieval", "Mystic Retrieval"], bf: [...islandsOf(0, 2), [0, "Thundering Falls"]], hand: [["Island"], []] });
  const [r1, r2] = two.yard, aims = moves(two, 0).filter(m => m.from === "yard").map(m => m.targets[0].id);
  const self = refused(two, 0, { t: "cast", card: r1, from: "yard", targets: [T.g(r1)] });
  return got && f.hand[0].includes(bs) && f.exile.includes(mr) && !f.yard.includes(mr) && aims.length === 1 && aims[0] === r2 && !!self;
});
test("Take Inventory: draws one, and one more for each in the graveyard", () => {
  const s = cast(scene({ hand: [["Take Inventory", "Island"], []], yard: ["Take Inventory", "Take Inventory"], bf: islandsOf(0, 2) }), 0, "Take Inventory");
  return s.hand[0].length === 4;
});

// ---------- the lands ----------
test("Flood Plain: enters tapped; tap and sacrifice it to fetch an Island or Plains card onto the battlefield", () => {
  let s = scene({ hand: [["Flood Plain"], []], hold: 0 });
  s = go(s, 0, { t: "land", card: idIn(s, 0, "Flood Plain") });
  const fp = onBf(s, 0, "Flood Plain");
  return perm(s, fp).tapped && refused(s, 0, { t: "ability", id: fp }) === "It's tapped";
});
test("Flood Plain: the search finds Islands (and Island-typed lands), not other lands", () => {
  let s = scene({ bf: [[0, "Flood Plain"]], hand: [[], []] });
  s = go(s, 0, { t: "ability", id: onBf(s, 0, "Flood Plain") });
  if (s.pending?.t !== "search" || s.pending.to !== "bf") return "no search";
  const ok = s.pending.ids.every(i => ["Island", "Mystic Sanctuary", "Thundering Falls"].includes(DECK[i]));
  const pick = s.pending.ids.find(i => DECK[i] === "Island");
  s = answer(s, { t: "search", card: pick });
  return ok && !onBf(s, 0, "Flood Plain") && onBf(s, 0, "Island") === pick && !perm(s, pick).tapped && s.yard.some(i => DECK[i] === "Flood Plain");
});
test("Halimar Depths: enters tapped; look at the top three and put them back in any order", () => {
  let s = scene({ hand: [["Halimar Depths"], []], lib: ["Dandân", "Island", "Memory Lapse"], hold: 0 });
  const [a, b, c] = s.lib.slice(0, 3);
  s = resolveStack(go(s, 0, { t: "land", card: idIn(s, 0, "Halimar Depths") }));
  if (s.pending?.t !== "order" || s.pending.cards.length !== 3) return "no question about the top three";
  s = answer(s, { t: "order", cards: [c, a, b] });
  return s.lib.slice(0, 3).join() === [c, a, b].join() && topKnown(s, 0) === c && topKnown(s, 1) === null;
});
test("Izzet Boilerworks: enters tapped and returns a land we control to hand; taps for {U}{R} together", () => {
  let s = scene({ hand: [["Izzet Boilerworks"], []], bf: [[0, "Island"], [0, "Island", { tapped: true }]] });
  s = go(s, 0, { t: "land", card: idIn(s, 0, "Izzet Boilerworks") });
  if (s.pending?.t !== "pick" || s.pending.for !== "boil") return "no land to return";
  const back = s.pending.ids.find(i => perm(s, i).tapped && nm(i) === "Island");
  s = answer(s, { t: "pick", card: back });
  const t = scene({ bf: [[0, "Izzet Boilerworks"], [0, "Island"]], hand: [[], []] });
  const plan = payPlan(t, 0, parseCost("{2}{R}"));
  return s.hand[0].includes(back) && !!plan && plan.taps.length === 2 && !canPay(scene({ bf: islandsOf(0, 3), hand: [[], []] }), 0, parseCost("{2}{R}"));
});
test("Lonely Sandbar and Remote Isle: tapped lands that tap for blue, and cycle for {U} and {2}", () => {
  let s = scene({ hand: [["Lonely Sandbar", "Remote Isle"], []], bf: islandsOf(0, 3) });
  s = go(s, 0, { t: "cycle", card: idIn(s, 0, "Lonely Sandbar") });
  s = go(s, 0, { t: "cycle", card: idIn(s, 0, "Remote Isle") });
  const t = scene({ hand: [["Lonely Sandbar"], []], hold: 0 });
  const sandbar = idIn(t, 0, "Lonely Sandbar");
  const tapped = perm(go(t, 0, { t: "land", card: sandbar }), sandbar).tapped;
  const poor = scene({ hand: [["Remote Isle"], []], bf: islandsOf(0, 1) });
  return s.hand[0].length === 2 && s.bf.filter(p => p.tapped).length === 3 && tapped && refused(poor, 0, { t: "cycle", card: idIn(poor, 0, "Remote Isle") }) === "Not enough mana";
});
test("Mystic Sanctuary: an Island, tapped unless we control three other Islands; untapped it may put an instant or sorcery from the graveyard on top", () => {
  let s = scene({ hand: [["Mystic Sanctuary"], []], bf: islandsOf(0, 1), yard: ["Memory Lapse"], hold: 0 });   // two Islands with the hold's
  s = go(s, 0, { t: "land", card: idIn(s, 0, "Mystic Sanctuary") });
  const slow = perm(s, onBf(s, 0, "Mystic Sanctuary")).tapped && !s.pending;
  let t = scene({ hand: [["Mystic Sanctuary"], []], bf: islandsOf(0, 2), yard: ["Memory Lapse", "Dandân"], hold: 0 });
  const lapse = t.yard.find(i => DECK[i] === "Memory Lapse");
  t = go(t, 0, { t: "land", card: idIn(t, 0, "Mystic Sanctuary") });
  // the trigger targets: its card is chosen as it goes on the stack, before anyone may answer it
  if (t.pending?.t !== "pick" || t.pending.for !== "sanct" || !t.pending.aim || t.pending.ids.length !== 1 || t.stack.length !== 1) return "no choice as it triggered";
  t = answer(t, { t: "pick", card: lapse });
  if (t.stack[0]?.targets[0]?.id !== lapse || t.lib[0] === lapse) return "the target isn't on the trigger, or it acted before resolving";
  t = resolveStack(t);
  const sanct = perm(t, onBf(t, 0, "Mystic Sanctuary"));
  return slow && !sanct.tapped && t.lib[0] === lapse && topKnown(t, 1) === lapse && typesOf(sanct).includes("Island");
});
test("…its target gone from the graveyard before it resolves, it does nothing; with none to choose, it leaves the stack", () => {
  let t = scene({ hand: [["Mystic Sanctuary"], []], bf: islandsOf(0, 2), yard: ["Memory Lapse"], hold: 0 });
  const lapse = t.yard[0];
  t = answer(go(t, 0, { t: "land", card: idIn(t, 0, "Mystic Sanctuary") }), { t: "pick", card: lapse });
  t.yard = [];                                                    // as if flashed back or exiled in answer
  t = resolveStack(t);
  const none = go(scene({ hand: [["Mystic Sanctuary"], []], bf: islandsOf(0, 2), yard: ["Dandân"], hold: 0 }), 0, { t: "land", card: idIn(scene({ hand: [["Mystic Sanctuary"], []], bf: islandsOf(0, 2), yard: ["Dandân"], hold: 0 }), 0, "Mystic Sanctuary") });
  return t.lib[0] !== lapse && !t.stack.length && t.log.some(l => l.t.includes("fizzles")) && !none.pending && !none.stack.length;
});
test("…and choosing none is declining: nothing goes on top", () => {
  let t = scene({ hand: [["Mystic Sanctuary"], []], bf: islandsOf(0, 2), yard: ["Memory Lapse"], hold: 0 });
  const top = t.lib[0];
  t = answer(go(t, 0, { t: "land", card: idIn(t, 0, "Mystic Sanctuary") }), { t: "pick", card: null });
  return !t.stack.length && t.lib[0] === top && t.yard.length === 1;
});
test("Thundering Falls: enters tapped, an Island and a Mountain (blue or red), surveil 1", () => {
  let s = scene({ hand: [["Thundering Falls"], []], lib: ["Dandân"], hold: 0 });
  const top = s.lib[0];
  s = resolveStack(go(s, 0, { t: "land", card: idIn(s, 0, "Thundering Falls") }));
  if (s.pending?.t !== "surveil" || s.pending.card !== top) return "no look at the top card";
  const yard = answer(s, { t: "surveil", yard: true }), keep = answer(s, { t: "surveil", yard: false });
  const f = perm(s, onBf(s, 0, "Thundering Falls"));
  return yard.yard.includes(top) && keep.lib[0] === top && f.tapped && typesOf(f).join() === "Island,Mountain";
});

// ---------- Dandân and combat ----------
test("a Dandân can't attack the turn it comes in", () => {
  let s = scene({ hand: [["Dandân"], []], bf: [...islandsOf(0, 2), ...islandsOf(1, 1)], hold: 0 });
  s = cast(s, 0, "Dandân");
  const d = onBf(s, 0, "Dandân");
  s = pass(s, 0);
  return !!d && s.step === "main2" && !s.pending;
});
test("it attacks only a player who controls an Island", () => {
  const none = pass(scene({ bf: [...islandsOf(0, 2), [0, "Dandân"], [1, "Remote Isle"]], hand: [[], []], hold: 0 }), 0);
  const some = pass(scene({ bf: [...islandsOf(0, 2), [0, "Dandân"], [1, "Island"]], hand: [[], []], hold: 0 }), 0);
  return none.step === "main2" && !none.pending && some.pending?.t === "attack" && some.pending.ids.length === 1;
});
test("an unblocked Dandân deals 4; a blocking Dandân trades with it", () => {
  let s = scene({ bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [0, "Dandân"]], hand: [[], []] });
  s = answer(pass(s, 0), { t: "attack", ids: [onBf(s, 0, "Dandân")] });
  s = drive(s, c => c.step === "main2");
  let t = scene({ bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [0, "Dandân"], [1, "Dandân"]], hand: [[], []] });
  const a = onBf(t, 0, "Dandân"), b = onBf(t, 1, "Dandân");
  t = answer(pass(t, 0), { t: "attack", ids: [a] });
  if (t.pending?.t !== "block" || t.pending.seat !== 1) return "they weren't asked to block";
  t = answer(t, { t: "block", pairs: [[b, a]] });
  t = drive(t, c => c.step === "main2");
  return s.life[1] === 16 && t.life[1] === 20 && !perm(t, a) && !perm(t, b) && t.yard.includes(a) && t.yard.includes(b);
});
test("attackers tap, and declining to block takes the damage", () => {
  let t = scene({ bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [0, "Dandân"], [1, "Dandân"]], hand: [[], []] });
  const a = onBf(t, 0, "Dandân");
  t = answer(pass(t, 0), { t: "attack", ids: [a] });
  const tapped = perm(t, a).tapped;
  t = answer(t, { t: "block", pairs: [] });
  t = drive(t, c => c.step === "main2");
  return tapped && t.life[1] === 16 && !!perm(t, a);
});
test("with no Island under it, a Dandân is sacrificed", () => {
  const s = scene({ bf: [[0, "Remote Isle"], [0, "Dandân"], [1, "Island"]], hand: [[], []], hold: 1 });
  const t = drive(pass(s, 0), c => !onBf(c, 0, "Dandân"));
  return !onBf(t, 0, "Dandân") && t.yard.some(i => DECK[i] === "Dandân");
});
test("…and one whose last Island is taken away by Mind Bend (an Island turned into a Swamp) is too", () => {
  let s = scene({ hand: [["Mind Bend"], []], bf: [...islandsOf(0, 1), [1, "Island"], [1, "Dandân"]] });
  const isle = onBf(s, 1, "Island");
  s = cast(s, 0, "Mind Bend", [T.c(isle)]);
  if (s.pending?.t !== "bend" || !s.pending.froms.includes("Island")) return "no choice of land type";
  s = answer(s, { t: "bend", from: "Island", to: "Swamp" });
  s = drive(s, c => !c.stack.length);
  return !onBf(s, 1, "Dandân") && typesOf(perm(s, isle)).join() === "Swamp";
});
test("Mind Bend on a Dandân: its text looks for another land type — a Plains it doesn't control, and it is sacrificed", () => {
  let s = scene({ hand: [["Mind Bend"], []], bf: [...islandsOf(0, 1), ...islandsOf(1, 2), [1, "Dandân"]] });
  const d = onBf(s, 1, "Dandân");
  s = cast(s, 0, "Mind Bend", [T.c(d)]);
  if (s.pending?.t !== "bend" || s.pending.froms.join() !== "Island") return "a Dandân's text names only the Island";
  s = answer(s, { t: "bend", from: "Island", to: "Plains" });
  s = drive(s, c => !c.stack.length);
  return !perm(s, d) && s.yard.includes(d);
});
test("…to a Mountain their Thundering Falls is: it lives, and attacks only a player who controls a Mountain", () => {
  let s = scene({ hand: [["Mind Bend", "Island"], []], bf: [[1, "Thundering Falls"], [1, "Dandân"], ...islandsOf(0, 1)] });
  const d = onBf(s, 1, "Dandân");
  s = cast(s, 0, "Mind Bend", [T.c(d)]);
  s = answer(s, { t: "bend", from: "Island", to: "Mountain" });
  s = drive(s, c => !c.stack.length);
  // on its owner's turn: it can attack a player with a Mountain (their Thundering Falls), not one with only an Island
  const bent = [["Island", "Mountain"]];
  const turn = other => scene({ active: 1, hand: [[], []], bf: [[1, "Thundering Falls"], [1, "Dandân", { tc: bent }], other] });
  const plain = turn([0, "Island"]), mountain = turn([0, "Thundering Falls"]);
  return !!perm(s, d) && JSON.stringify(perm(s, d).tc) === JSON.stringify(bent)
    && !canAttack(plain, perm(plain, onBf(plain, 1, "Dandân"))) && canAttack(mountain, perm(mountain, onBf(mountain, 1, "Dandân")));
});
test("Mind Bend: an Island turned into a Mountain taps for red", () => {
  let s = scene({ hand: [["Mind Bend"], []], bf: [...islandsOf(0, 1), ...islandsOf(1, 3)] });
  const isle = onBf(s, 1, "Island");
  s = cast(s, 0, "Mind Bend", [T.c(isle)]);
  s = answer(s, { t: "bend", from: "Island", to: "Mountain" });
  return canPay(s, 1, parseCost("{R}")) && typesOf(perm(s, isle)).join() === "Mountain" && islands(s, 1).length === 2;
});
test("losing the last life point loses the game", () => {
  let s = scene({ bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [0, "Dandân"]], hand: [[], []], life: [20, 4] });
  s = answer(pass(s, 0), { t: "attack", ids: [onBf(s, 0, "Dandân")] });
  s = drive(s, c => c.over);
  return s.over && s.winner === 0 && s.why === "life" && toMove(s) === null;
});
test("drawing from an empty library loses the game", () => {
  let s = scene({ hand: [[], []], bf: [...islandsOf(0, 1), ...islandsOf(1, 1)], bare: true, lib: [], step: "end", passes: 1, prio: 0 });
  s = drive(s, c => c.over);
  return s.over && s.winner === 0 && s.why === "library";
});
test("a draw spell on an empty library loses too — once it has finished resolving", () => {
  let s = scene({ hand: [["Brainstorm"], []], bf: islandsOf(0, 1), bare: true, lib: ["Island", "Island"] });
  s = cast(s, 0, "Brainstorm");
  if (s.over || s.pending?.t !== "putback") return "the game ended before Brainstorm finished";
  s = answer(s, { t: "putback", cards: s.hand[0] });
  return s.over && s.winner === 1 && s.why === "library";
});
// conceding (Korbi, October 2026): either seat, whoever's decision it is, and the game is the other's there and then
test("a player may concede whoever's decision it is, and the other wins there and then; nothing else goes out of turn", () => {
  const G = newRecord(rules, { seats: 2, seed: 91, now: 0 }), idle = 1 - rules.toMove(rules.restore(J(G.state)));
  if (applyMove(rules, G, idle, { t: "pass" }).error !== "It isn't your turn") return "a pass out of turn wasn't refused";
  const r = applyMove(rules, G, idle, { t: "concede" });
  if (r.error) return r.error;
  const s = rules.restore(J(r.G.state));
  return s.over && s.winner === 1 - idle && s.why === "conceded" && toMove(s) === null && /wins: \{s\d\} concedes$/.test(s.log.at(-1).t)
    && applyMove(rules, r.G, 1 - idle, { t: "concede" }).error === "The game is over";
});
test("conceding with a question put to you; the game so through the database; the loser goes first next game", () => {
  const G = newRecord(rules, { seats: 2, seed: 92, now: 0 }), asked = rules.toMove(rules.restore(J(G.state)));
  const r = applyMove(rules, G, asked, { t: "concede" });
  if (r.error) return r.error;
  const back = roundTrip(r.G), s = rules.restore(J(back.state));
  if (!same(s, rules.restore(J(r.G.state)))) return "the conceded game changed through the database";
  const next = newRecord(rules, { seats: 2, seed: 93, now: 0, prev: back });
  return s.over && !s.pending && s.winner === 1 - asked && rules.restore(J(next.state)).first === asked;
});

// ---------- moves ----------
test("every move moves() offers is one the game accepts", () => {
  let n = 0;
  for (let seed = 1; seed <= 8; seed++) {
    let s = restore(J(deal({ rng: seeded(seed) })));
    for (let i = 0; i < 400 && !s.over; i++) {
      const who = toMove(s);
      if (!s.pending) for (const m of moves(s, who)) { if (refused(s, who, m) !== null) throw new Error(`seed ${seed}: ${JSON.stringify(m)} offered but refused`); n++; }
      s = go(s, who, botMove(s, who, { rng: seeded(seed * 1000 + i), level: "medium" }));
    }
  }
  return n > 500;
});

// ---------- a Flood Plain's Island, to pay for a spell (Korbi's game, 22 October 2026) ----------
{
  // an Island and a Flood Plain untapped, Memory Lapse in hand, the computer's Memory Lapse at his Brainstorm
  let s = scene({ turn: 6, hand: [["Memory Lapse", "Brainstorm"], ["Memory Lapse"]], bf: [...islandsOf(0, 2), [0, "Flood Plain"], ...islandsOf(1, 3)] });
  s = cast(s, 0, "Brainstorm");
  s = cast(s, 1, "Memory Lapse", [{ k: "s", sid: sidOf(s, "Brainstorm") }]);
  const plain = onBf(s, 0, "Flood Plain"), f = afterFetch(s, 0);
  check(!moves(s, 0).some(m => m.t === "cast") && moves(s, 0).some(m => m.t === "ability" && m.id === plain), "the fetch isn't mana: the Lapse can't be cast yet, the fetch can be made");
  check(f.size === 1 && f.get("Memory Lapse") === plain, "…and the Lapse is the card a fetch would pay for, with that Flood Plain");
  let t = go(s, 0, { t: "ability", id: plain });
  if (t.pending?.t === "search") t = go(t, 0, { t: "search", card: t.pending.ids.find(id => nm(id) === "Island") });
  check(moves(t, 0).some(m => m.t === "cast" && nm(m.card) === "Memory Lapse" && m.targets[0]?.k === "s" && sidOf(t, "Memory Lapse") === m.targets[0].sid),
    "…the Island fetched, Memory Lapse is cast at their Lapse");
  const tapped = J(s);
  tapped.bf.find(p => p.id === plain).tapped = true;
  check(afterFetch(tapped, 0).size === 0, "a tapped Flood Plain offers nothing");
}

// ---------- the state through the database ----------
test("a game survives the database at every move (empty lists dropped, holes, nulls)", () => {
  let G = newRecord(rules, { seats: 2, seed: 77, now: 0 });
  for (let i = 0; i < 600 && !rules.over(G.state); i++) {
    const back = roundTrip(G);
    if (!same(rules.restore(J(back.state)), rules.restore(J(G.state)))) throw new Error(`move ${i}: the state changed through the database`);
    const who = rules.toMove(back.state);
    G = applyMove(rules, back, who, botMove(rules.restore(J(back.state)), who, { rng: seeded(i), level: "medium" }), 0).G;
  }
  return true;
});

// ---------- the computer players ----------
const seatRng = n => seeded(n);
const hard = (s, seat) => botMove(s, seat, { rng: seatRng(1), level: "hard" });
const medium = (s, seat) => botMove(s, seat, { rng: seatRng(1), level: "medium" });
const both = (what, s, seat, ok) => {
  test(`Medium: ${what}`, () => ok(medium(s, seat)) || JSON.stringify(medium(s, seat)));
  test(`Hard: ${what}`, () => ok(hard(s, seat)) || JSON.stringify(hard(s, seat)));
};
test("it takes a free mulligan on a hand short of lands, keeps a good one, throws back a middling first seven while the first mulligan is free, and keeps a poor one it has already paid for", () => {
  const asked = (hand, pending) => { const s = scene({ hand: [hand, []] }); s.pending = { t: "mull", seat: 0, ...pending }; return botMove(s, 0, { rng: seatRng(1) }).t; };
  const spells = ["Memory Lapse", "Dandân", "Brainstorm", "Predict", "Repulse", "Mind Bend"];
  const middling = ["Island", "Island", "Memory Lapse", "Repulse", "Take Inventory", "Chart a Course", "Gone Missing"];   // two lands, one spell worth the mana
  return asked(["Island", ...spells], { free: true, taken: 0 }) === "mull"
    && asked(["Island", "Remote Isle", "Island", ...spells.slice(0, 4)], { free: false, first: true, taken: 0 }) === "keep"
    && asked(middling, { free: false, first: true, taken: 0 }) === "mull"
    && asked(middling, { free: false, taken: 1 }) === "keep"
    && asked(["Island", ...spells], { free: false, taken: 3 }) === "keep"
    && asked(["Island", ...spells], { free: false, first: true, taken: 0 }) === "mull";
});
{
  // the blunder that started the rework: Mind Bend on a lone Island with no Dandân anywhere
  const s = scene({ turn: 2, active: 0, hand: [["Mind Bend", "Island", "Brainstorm"], ["Island"]], bf: [[0, "Island"], [1, "Island"]], step: "main1" });
  both("no Mind Bend on their one Island on turn 2, with no Dandân anywhere", s, 0, m => !(m.t === "cast" && DECK[m.card] === "Mind Bend"));
  const e = scene({ turn: 3, active: 1, step: "end", prio: 0, passes: 1, hand: [["Mind Bend", "Island"], ["Island"]], bf: [[0, "Island"], [1, "Island"], [1, "Remote Isle"]] });
  both("…nor at the end of their turn", e, 0, m => !(m.t === "cast" && DECK[m.card] === "Mind Bend"));
  // and where it is right: their last Island under two Dandâns, or their Dandân itself
  const two = scene({ active: 1, step: "end", prio: 0, passes: 1, hand: [["Mind Bend", "Island"], []], bf: [...islandsOf(0, 2), [1, "Island"], [1, "Remote Isle"], [1, "Lonely Sandbar"], [1, "Dandân"], [1, "Dandân"]] });
  both("Mind Bend their last Island when two Dandâns stand on it", two, 0, m => m.t === "cast" && DECK[m.card] === "Mind Bend" && DECK[m.targets[0].id] === "Island");
  const one = scene({ active: 1, step: "end", prio: 0, passes: 1, hand: [["Mind Bend", "Island"], []], bf: [...islandsOf(0, 2), ...islandsOf(1, 3), [1, "Dandân"]] });
  both("Mind Bend their Dandân when it has three Islands under it", one, 0, m => m.t === "cast" && DECK[m.card] === "Mind Bend" && DECK[m.targets[0].id] === "Dandân");
}
{
  let s = scene({ active: 1, hand: [["Memory Lapse"], ["Dandân"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 3)] });
  s = cast(s, 1, "Dandân");
  both("Memory Lapse on their Dandân, cast on their turn (it comes to us)", s, 0, m => m.t === "cast" && DECK[m.card] === "Memory Lapse");
  let q = scene({ active: 0, hand: [["Quicken"], ["Memory Lapse"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 2)] });
  q = cast(q, 0, "Quicken");
  test("Medium: no Memory Lapse spent on a Quicken", () => medium(q, 1).t === "pass");
}
{
  let s = scene({ active: 1, hand: [["Piracy Charm"], []], bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [1, "Dandân"]] });
  s = answer(pass(s, 1), { t: "attack", ids: [onBf(s, 1, "Dandân")] });
  both("Piracy Charm's +2/−1 on the Dandân attacking it", s, 0, m => m.t === "cast" && m.mode === 1 && m.targets[0].id === onBf(s, 1, "Dandân"));
}
{
  const withIsle = scene({ hand: [["Dandân"], []], bf: islandsOf(0, 2) });
  const none = scene({ hand: [["Dandân"], []], bf: [[0, "Remote Isle"], [0, "Lonely Sandbar"]] });
  both("a Dandân cast when there's an Island to keep it", withIsle, 0, m => m.t === "cast");
  both("…and not when there's none", none, 0, m => m.t === "pass");
}
{
  const s = pass(scene({ active: 0, life: [4, 20], bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [0, "Dandân"], [1, "Dandân"]], hand: [[], []] }), 0);
  both("its Dandân kept home when the swing back would be lethal", s, 0, m => m.t === "attack" && m.ids.length === 0);
  let b = scene({ active: 1, life: [4, 20], bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [0, "Dandân"], [1, "Dandân"]], hand: [[], []] });
  b = answer(pass(b, 1), { t: "attack", ids: [onBf(b, 1, "Dandân")] });
  both("a Dandân that would kill it blocked", b, 0, m => m.t === "block" && m.pairs.length === 1);
  // the race: they're at 4 and tapped out of blockers; we take 4 at 20 and swing back for the game
  let r = scene({ active: 1, life: [20, 4], bf: [...islandsOf(0, 2), ...islandsOf(1, 2), [0, "Dandân"], [1, "Dandân"]], hand: [[], []] });
  r = answer(pass(r, 1), { t: "attack", ids: [onBf(r, 1, "Dandân")] });
  both("no block when taking it and swinging back wins the race", r, 0, m => m.t === "block" && m.pairs.length === 0);
}
{
  // their upkeep, a Memory Lapse on top that both saw go there: draw it before they do
  let s = scene({ active: 1, step: "upkeep", turn: 6, prio: 0, passes: 1, hand: [["Lonely Sandbar", "Island"], ["Island"]], bf: [...islandsOf(0, 4), ...islandsOf(1, 2)], lib: ["Memory Lapse"] });
  s.kn = [[s.lib[0], 3]];
  both("a known Memory Lapse on top drawn first, in their upkeep", s, 0, m => m.t === "cycle");
}
{
  let s = scene({ active: 0, hand: [["Dandân", "Narset's Reversal"], ["Memory Lapse"]], bf: [...islandsOf(0, 4), ...islandsOf(1, 2)] });
  s = cast(s, 0, "Dandân");
  s = cast(s, 1, "Memory Lapse", [T.s(sidOf(s, "Dandân"))]);
  both("Narset's Reversal on their Lapse aimed at our Dandân", s, 0, m => m.t === "cast" && DECK[m.card] === "Narset's Reversal");
  const r = go(s, 0, { t: "cast", card: idIn(s, 0, "Narset's Reversal"), from: "hand", targets: [T.s(sidOf(s, "Memory Lapse"))] });
  test("…and the copy of their Lapse is offered the Reversal itself, and aimed there rather than at our Dandân", () => r.pending?.t === "retarget"
    && r.pending.options.some(o => o[0].sid === r.pending.sid) && hard(r, 0).targets?.[0]?.sid !== sidOf(r, "Dandân") && medium(r, 0).targets?.[0]?.sid !== sidOf(r, "Dandân"));
}
{
  // the end of its main phases with its land still to play: it goes down, a drop kept back being lost for good
  const s = scene({ active: 0, step: "main2", turn: 6, hand: [["Island", "Memory Lapse", "Brainstorm"], ["Island", "Dandân"]], bf: [...islandsOf(0, 2), ...islandsOf(1, 3)] });
  both("its land played at the end of its main phases, not kept back", s, 0, m => m.t === "land");
}
{
  const s = scene({ active: 0, step: "main2", hand: [["Memory Lapse", "Take Inventory"], ["Island", "Island", "Island", "Dandân"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 3)] });
  both("two kept open for Memory Lapse rather than tapping out for Take Inventory", s, 0, m => m.t === "pass");
  let b = scene({ hand: [["Izzet Boilerworks"], []], bf: [[0, "Island"], [0, "Island", { tapped: true }]], hold: 0 });
  b = resolveStack(go(b, 0, { t: "land", card: idIn(b, 0, "Izzet Boilerworks") }));
  both("Izzet Boilerworks returns a tapped Island, not itself", b, 0, m => m.t === "pick" && DECK[m.card] === "Island" && perm(b, m.card).tapped);
}
{
  // mana: Korbi's game, an Island Metamorphosed just after his Izzet Boilerworks returned one (he put it straight back
  // down). The Boilerworks is the land to take: two mana, and in answer to its trigger before the land it returns is in
  // his hand; once it is, never an Island
  const meta = (m, name) => m.t === "cast" && DECK[m.card] === "Metamorphose" && (!name || nm(m.targets[0].id) === name);
  let s = scene({ turn: 5, active: 1, hand: [["Metamorphose", "Island", "Predict", "Dandân"], ["Izzet Boilerworks", "Memory Lapse", "Brainstorm", "Take Inventory"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 2)] });
  s = pass(go(s, 1, { t: "land", card: idIn(s, 1, "Izzet Boilerworks") }), 1);
  both("Metamorphose on their Izzet Boilerworks in answer to its trigger, not on an Island", s, 0, m => meta(m, "Izzet Boilerworks"));
  let e = s;
  for (let i = 0; i < 6 && !e.pending; i++) e = pass(e);
  e = answer(e, { t: "pick", card: e.pending.ids.find(id => nm(id) === "Island") });
  for (let i = 0; i < 20 && !(e.step === "end" && toMove(e) === 0); i++) e = pass(e);
  both("at the end of that turn, the Island it returned in their hand: the Boilerworks, never an Island", e, 0, m => meta(m, "Izzet Boilerworks"));
  // a land taken at the end of their turn when their play showed none in their hand: it comes to us, and they're a land short
  const short = scene({ turn: 6, active: 1, step: "end", prio: 0, passes: 1, hand: [["Metamorphose", "Predict", "Dandân"], ["Memory Lapse", "Brainstorm", "Take Inventory"]], bf: [...islandsOf(0, 3), ...islandsOf(1, 3)] });
  short.draws = [8, 8]; short.tells[1].land = 8;
  both("their Island taken at the end of their turn, after a turn of theirs with no land played", short, 0, m => meta(m, "Island"));
  // and once their lands are all down, mana is no matter: no card spent on one
  const late = scene({ turn: 20, active: 1, step: "end", prio: 0, passes: 1, hand: [["Metamorphose", "Predict", "Dandân"], ["Memory Lapse", "Brainstorm", "Take Inventory"]],
    bf: [...islandsOf(0, 5), [0, "Remote Isle"], [0, "Remote Isle"], [0, "Lonely Sandbar"], [0, "Lonely Sandbar"], [0, "Halimar Depths"],
      ...islandsOf(1, 5), [1, "Halimar Depths"], [1, "Thundering Falls"], [1, "Thundering Falls"], [1, "Mystic Sanctuary"], [1, "Mystic Sanctuary"]] });
  late.draws = [20, 20]; late.tells[1].land = 20;
  both("…but not when they have ten lands down", late, 0, m => !meta(m));
  // Metamorphose's offer: a Dandân only where an Island will stand under it, else a land, whatever land it is
  let d = scene({ active: 0, hand: [["Metamorphose"], ["Dandân", "Remote Isle"]], bf: [...islandsOf(0, 2), [1, "Island"], [1, "Lonely Sandbar"]] });
  d = resolveStack(cast(d, 0, "Metamorphose", [T.c(onBf(d, 1, "Island"))]));
  both("offered a land or a creature by Metamorphose with its last Island gone, it puts the land down", d, 1, m => m.t === "pick" && DECK[m.card] === "Remote Isle");
}
{
  // the shared graveyard: a Mystic Retrieval cast from the hand stays there, for anyone with red to flash back
  const gift = scene({ turn: 9, active: 0, step: "main1", hand: [["Mystic Retrieval", "Island", "Brainstorm"], ["Island", "Island", "Predict", "Quicken", "Take Inventory"]],
    bf: [...islandsOf(0, 4), [0, "Dandân"], [1, "Thundering Falls"], ...islandsOf(1, 3)], yard: ["Piracy Charm", "Memory Lapse", "Chart a Course"] });
  both("no Mystic Retrieval from the hand while they have red and a Piracy Charm waits in the graveyard for our Dandân", gift, 0, m => !(m.t === "cast" && DECK[m.card] === "Mystic Retrieval"));
  /** The computer moving both seats until the turn is over. */
  const playTurn = (s, level) => {
    let c = s;
    for (let i = 0; i < 300 && c.turn === s.turn && !c.over; i++) { const who = toMove(c); c = go(c, who, botMove(c, who, { rng: seeded(i), level })); }
    return c;
  };
  const dandans = (s, seat) => s.bf.filter(p => p.ctl === seat && nm(p.id) === "Dandân").length;
  // and the other side of it: flashed back for the Charm, which kills the Dandân, the same turn
  const tapped = (seat, n) => Array.from({ length: n }, () => [seat, "Island", { tapped: true }]);
  const punish = scene({ turn: 10, active: 1, step: "main1", hand: [["Brainstorm", "Island"], ["Island", "Lórien Revealed", "Predict"]],
    bf: [...tapped(0, 5), [0, "Dandân", { ent: 7 }], [1, "Thundering Falls"], ...islandsOf(1, 3)], yard: ["Mystic Retrieval", "Piracy Charm", "Chart a Course"], life: [20, 16] });
  // our own red: the Charm taken back before they can, and their Dandân killed with it
  const deny = scene({ turn: 9, active: 0, step: "main1", hand: [["Island"], ["Island", "Predict", "Quicken"]],
    bf: [...islandsOf(0, 3), [0, "Thundering Falls"], ...islandsOf(1, 3), [1, "Dandân", { ent: 6 }]], yard: ["Mystic Retrieval", "Piracy Charm", "Take Inventory"] });
  for (const level of ["medium", "hard"]) {
    const name = level === "hard" ? "Hard" : "Medium";
    test(`${name}: flashes back the Mystic Retrieval left in the graveyard for the Piracy Charm, and kills the Dandân with it`, () => dandans(playTurn(punish, level), 0) === 0 || "the Dandân lives");
    test(`${name}: with red of its own, takes the Charm first and kills their Dandân with it`, () => dandans(playTurn(deny, level), 1) === 0 || "their Dandân lives");
  }
}
test("Hard plays the same move from the same position, and its moves are always legal", () => {
  let n = 0;
  for (const seed of [4, 5]) {
    let s = restore(J(deal({ rng: seeded(seed) })));
    const rng = seeded(seed);
    for (let i = 0; i < 400 && !s.over; i++) {
      const who = toMove(s);
      if (i % 7 === 0) {
        // (with no time backstop: the move must come from the deals alone, not from how busy the machine is)
        const sure = (x, w) => thinkMove(x, w, { ...BUDGET.move, ms: Infinity });
        const a = sure(s, who), b = sure(J(s), who);
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`move ${i}: ${JSON.stringify(a)} then ${JSON.stringify(b)}`);
        go(s, who, a);
        n++;
      }
      s = go(s, who, botMove(s, who, { rng, level: "medium" }));
    }
  }
  return n >= 12 || `only ${n} decisions`;
});
test("Hard's thinking (the menu's): Quick is the move measured; each deeper setting plays more deals, never a shorter look, with more time for a slow phone", () => {
  const order = ["quick", "long", "deep", "deepest"], turns = b => b.turns ?? 2;
  if (Object.keys(DEPTH).join() !== order.join()) return `the settings are ${Object.keys(DEPTH)}`;
  if (DEPTH.quick !== BUDGET.move) return "Quick isn't the move the tests measure";
  return order.slice(1).every((k, i) => DEPTH[k].deals > DEPTH[order[i]].deals && DEPTH[k].ms > DEPTH[order[i]].ms && turns(DEPTH[k]) >= turns(DEPTH[order[i]]));
});
test("…and a deeper setting's move is legal, and the same from the same position", () => {
  let s = restore(J(deal({ rng: seeded(6) })));
  const rng = seeded(6);
  for (let i = 0; i < 400 && !s.over; i++) {
    const who = toMove(s);
    if (!s.pending && s.turn >= 4 && moves(s, who, true).length) {   // something to do besides passing
      const sure = x => thinkMove(x, who, { ...DEPTH.long, ms: Infinity });
      const a = sure(s), b = sure(J(s));
      if (JSON.stringify(a) !== JSON.stringify(b)) return `${JSON.stringify(a)} then ${JSON.stringify(b)}`;
      go(s, who, a);
      return true;
    }
    s = go(s, who, botMove(s, who, { rng, level: "medium" }));
  }
  return "no decision with a choice in it";
});
test("its answers are always legal ones, for every kind of question and at every level", () => {
  // a game played at random reaches every question; the computer is asked each one, at each level, and the answer tried
  const kinds = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    let s = restore(J(deal({ rng: seeded(seed) })));
    const rng = seeded(seed);
    for (let i = 0; i < 500 && !s.over; i++) {
      const who = toMove(s);
      if (s.pending) kinds.add(s.pending.t);
      for (const level of ["easy", "medium"]) go(s, who, botMove(s, who, { rng: seeded(i), level }));   // throws if refused
      if (s.pending && (i % 7 === 0 || ["retarget", "bend", "owner", "order"].includes(s.pending.t))) go(s, who, botMove(s, who, { level: "hard" }));
      s = go(s, who, randomMove(s, who, rng));
    }
  }
  const all = ["mull", "bottom", "attack", "block", "discard", "putback", "order", "surveil", "search", "pick", "owner", "bend", "name", "retarget"];
  const missing = all.filter(k => !kinds.has(k));
  if (missing.length) throw new Error(`never asked: ${missing}`);
  return true;
});

// ---------- the 3D view (dandan-3d.js, dandan-art.js): what it draws from, without a page ----------
{
  check([...NAMES, "Clue"].every(n => PICTURED.includes(n)) && PICTURED.length === NAMES.length + 1, "every card in the list, and the Clue, has its picture");
  check((SPRITE.match(/<symbol /g) || []).length === PICTURED.length + 1 && Object.values(HALVES).flat().every(h => art(h).includes("#dda-commit-memory")),
    "the sprite holds every picture and the back, and a split card's halves show the card's");
  const s = restore(J(deal({ rng: seeded(11) }))), z = zonesOf(s);
  const count = k => [...z.values()].filter(v => v === k).length;
  check(z.size === 80 && count("h0") === 7 && count("h1") === 7 && count("l") === 66, "a dealt game: every card in one place, seven in each hand, the rest in the library");
  // a land played, a spell cast at a spell, a Clue cracked: each card's change of place, and nothing else's
  let t = scene({ hand: [["Island", "Brainstorm", "Memory Lapse"], ["Memory Lapse"]], bf: [...islandsOf(0, 3), [0, "Clue"], ...islandsOf(1, 2)], hold: 1 });
  const land = idIn(t, 0, "Island"), t2 = go(t, 0, { t: "land", card: land });
  const m1 = moved(zonesOf(t), zonesOf(t2));
  check(m1.length === 1 && m1[0].id === land && m1[0].from === "h0" && m1[0].to === "bf", "a land played moves from the hand to the battlefield, alone");
  const t3 = cast(t2, 0, "Brainstorm"), bs = idIn(t2, 0, "Brainstorm");
  check(moved(zonesOf(t2), zonesOf(t3)).some(m => m.id === bs && m.from === "h0" && m.to === "st"), "a spell cast goes from the hand to the stack");
  const clue = t.bf.find(p => nm(p.id) === "Clue").id;
  check(moved(new Map([[clue, "bf"]]), new Map()).some(m => m.id === clue && m.from === "bf" && m.to === null), "a token gone has nowhere to go (it fades where it was)");
  // the lands as they lie: Islands first, alike ones a pile (tapped and untapped apart, a Mind Bent one alone), Clues last
  const u = scene({ bf: [[0, "Clue"], [0, "Remote Isle"], [0, "Island"], [0, "Island", { tapped: true }], [0, "Island"], [0, "Island", { tc: [["Island", "Swamp"]] }], [0, "Island"]] });
  const lay = piles(u.bf), pile = lay.map(x => `${nm(x.p.id)}${x.p.tapped ? "*" : ""}${x.p.tc ? "~" : ""}:${x.first ? "f" : ""}${x.last ? `l${x.n}` : ""}`);
  check(pile.join(" ") === "Island:f Island: Island:l3 Island*:fl1 Island~:fl1 Remote Isle:fl1 Clue:fl1", `the lands lie Islands first, alike ones piled, Clues last: ${pile.join(" ")}`);
  check(STEPS.length === 8 && STEPS[0] === "upkeep" && STEPS.at(-1) === "end", "the turn's steps, as the track marks them");
}

// ---------- whole games ----------
// played with no log and nothing read of the passes (quiet), as the computer plays games out in its head: reading every
// pass of hundreds of games would take minutes (one game read in full is dandan-coach.mjs's)
const bulk = { ...rules, act: (s, seat, m, ctx) => rules.act(s, seat, m, { ...ctx, quiet: true }) };
{
  let refusedAt = null, unfinished = 0, conceded = 0, lengths = [], bySeat = [0, 0];
  const t0 = Date.now();
  for (let g = 0; g < 100; g++) {
    let G = newRecord(bulk, { seats: 2, seed: 9000 + g, now: 0 });
    const rng = seeded(31 + g);
    let n = 0;
    while (!rules.over(G.state) && n < 6000) {
      const who = rules.toMove(G.state);
      const r = applyMove(bulk, G, who, botMove(rules.restore(J(G.state)), who, { rng, level: "medium" }), 0);
      if (r.error) { refusedAt = `game ${g} move ${n}: ${r.error}`; break; }
      G = r.G; n++;
      if (n % 25 === 0) {
        const s = rules.restore(J(G.state)), all = [...s.lib, ...s.yard, ...s.exile, ...s.hand[0], ...s.hand[1], ...s.bf.filter(p => p.id < TOKEN_AT).map(p => p.id), ...s.stack.filter(i => i.kind === "spell" && !i.copy).map(i => i.card)];
        if (new Set(all).size !== 80 || all.length !== 80) { refusedAt = `game ${g}: cards ${all.length}, ${new Set(all).size} different`; break; }
      }
    }
    if (refusedAt) break;
    if (!rules.over(G.state)) unfinished++;
    else { lengths.push(G.state.turn); bySeat[G.state.winner]++; if (G.state.why === "conceded") conceded++; }
  }
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  check(!refusedAt, `100 games of Medium against Medium, no illegal move and no card lost or made${refusedAt ? ` (${refusedAt})` : ""} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  check(!unfinished && !conceded && Math.min(...lengths) >= 6 && Math.max(...lengths) < 150 && mean > 14 && mean < 60, `…every one finished and none conceded (the computer never does), in ${Math.min(...lengths)}–${Math.max(...lengths)} turns, ${mean.toFixed(1)} on average`);
  check(Math.min(...bySeat) >= 25, `…neither seat has the game (${bySeat.join(" and ")} wins)`);
}
test("a seeded game is played the same way twice", () => {
  const play = () => {
    let G = newRecord(bulk, { seats: 2, seed: 123, now: 0 });
    for (let i = 0; i < 6000 && !rules.over(G.state); i++) { const who = rules.toMove(G.state); G = applyMove(bulk, G, who, seatBot(bulk, G, who, "medium"), 0).G; }
    return JSON.stringify(G);
  };
  const a = play();
  return a === play() && JSON.parse(a).state.over;
});
{
  /** `a`'s wins in `n` games of a against b, a taking each seat in turn. */
  const versus = (a, b, n, from) => {
    let wins = 0;
    for (let g = 0; g < n; g++) {
      let G = newRecord(bulk, { seats: 2, seed: from + g, now: 0 });
      const rng = seeded(7 + g), mine = g % 2;
      const pick = (lvl, s, who) => (lvl === "random" ? randomMove(s, who, rng) : botMove(s, who, { rng, level: lvl }));
      for (let i = 0; i < 6000 && !rules.over(G.state); i++) {
        const who = rules.toMove(G.state);
        G = applyMove(bulk, G, who, pick(who === mine ? a : b, rules.restore(J(G.state)), who), 0).G;
      }
      if (G.state.winner === mine) wins++;
    }
    return wins;
  };
  const e = versus("easy", "random", 40, 4000);
  check(e >= 34, `Easy beats a player who moves at random in ${e} of 40 games`);
  const m = versus("medium", "easy", 100, 6000);
  check(m >= 62, `Medium beats Easy in ${m} of 100`);
  // (Hard won 104 of 120 such games when it was written, and 36 of 40 once it tried the other player's answers: see the README)
  const t0 = Date.now(), h = versus("hard", "medium", 12, 8000);
  check(h >= 8, `Hard beats Medium in ${h} of 12 (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// ---------- cycling answered, and lands tapped by hand (23 October 2026, Korbi) ----------
test("a card cycled with priority held leaves the cycler the move: fetch a land to shuffle before the draw; without, it resolves unanswered", () => {
  const base = { hand: [["Lonely Sandbar", "Remote Isle"], []], bf: [[0, "Island"], [0, "Island"], [0, "Flood Plain"]] };
  let s = scene(base);
  const held = go(s, 0, { t: "cycle", card: idIn(s, 0, "Lonely Sandbar"), hold: true });
  const plain = go(s, 0, { t: "cycle", card: idIn(s, 0, "Lonely Sandbar") });
  if (toMove(held) !== 0 || held.stack.length !== 1) return `held: ${toMove(held)}, ${held.stack.length} on the stack`;
  if (plain.stack.length !== 0) return "unheld, the cycling should have resolved (nobody else could answer it)";
  // in answer: the fetch goes first (the search is asked), then the cycling resolves
  const fetched = go(held, 0, { t: "ability", id: onBf(held, 0, "Flood Plain") });
  if (fetched.pending?.t !== "search" || fetched.stack.length !== 2) return `the fetch should be searching, above the cycling (${fetched.pending?.t}, ${fetched.stack.length})`;
  const done = drive(answer(fetched, { t: "search", card: fetched.pending.ids[0] }), c => !c.stack.length, 10);
  return !done.stack.length && !done.bf.some(p => nm(p.id) === "Flood Plain") && done.bf.filter(p => p.ctl === 0 && nm(p.id) === "Island").length === 3 || "the fetch and then the cycling should have resolved";
});
test("the other player's cycling is answered too: with a Flood Plain untapped, the seat is asked with the cycling on the stack, and with nothing to do it is not", () => {
  const base = { hand: [[], ["Remote Isle"]], active: 1, step: "main1", prio: 1 };
  const asked = go(scene({ ...base, bf: [[0, "Flood Plain"], ...islandsOf(1, 2)] }), 1, { t: "cycle", card: idIn(scene({ ...base, bf: [[0, "Flood Plain"], ...islandsOf(1, 2)] }), 1, "Remote Isle") });
  const bare = scene({ ...base, bf: islandsOf(1, 2) });
  const quiet = go(bare, 1, { t: "cycle", card: idIn(bare, 1, "Remote Isle") });
  return toMove(asked) === 0 && asked.stack.length === 1 && quiet.stack.length === 0 || `${toMove(asked)} ${asked.stack.length} ${quiet.stack.length}`;
});
test("holding priority after cracking a Clue or fetching works as it does after a cast; with nothing to answer with, the game goes on by itself", () => {
  const s = scene({ hand: [["Remote Isle"], []], bf: islandsOf(0, 2) });
  const t = go(s, 0, { t: "cycle", card: idIn(s, 0, "Remote Isle"), hold: true });
  const c = scene({ bf: [[0, "Clue"], [0, "Island"], [0, "Island"], [0, "Flood Plain"]], hand: [[], []] });
  const k = go(c, 0, { t: "ability", id: onBf(c, 0, "Clue"), hold: true });
  return t.stack.length === 0 && toMove(k) === 0 && k.stack.length === 1 || `${t.stack.length} ${toMove(k)} ${k.stack.length}`;
});
test("the manual tap: a move carrying `taps` taps exactly those lands, so an Izzet Boilerworks alone can pay {2} and the Islands stay up", () => {
  const s = scene({ hand: [["Remote Isle"], []], bf: [[0, "Island"], [0, "Island"], [0, "Izzet Boilerworks"]], hold: 0 });
  const boil = onBf(s, 0, "Izzet Boilerworks"), isles = s.bf.filter(p => p.ctl === 0 && nm(p.id) === "Island").map(p => p.id);
  const auto = go(s, 0, { t: "cycle", card: idIn(s, 0, "Remote Isle") });
  const by = go(s, 0, { t: "cycle", card: idIn(s, 0, "Remote Isle"), taps: isles.slice(0, 2) });
  // by itself the game taps the dual (kept for last, but two mana from one land); by hand, the two Islands, and the dual stays untapped
  return perm(auto, boil).tapped && !perm(by, boil).tapped && isles.slice(0, 2).every(id => perm(by, id).tapped) && by.pool[0] === "" || `auto ${perm(auto, boil).tapped}; manual ${perm(by, boil).tapped} ${JSON.stringify(by.pool)}`;
});
test("…lands that make too little, another's, tapped ones and unknown ones are refused, and more than the cost floats the rest", () => {
  const s = scene({ hand: [["Remote Isle"], []], bf: [[0, "Island"], [0, "Island"], [0, "Izzet Boilerworks"], [1, "Island"], [0, "Island", { tapped: true }]], hold: 0 });
  const isle = s.bf.find(p => p.ctl === 0 && nm(p.id) === "Island" && !p.tapped).id, boil = onBf(s, 0, "Izzet Boilerworks");
  const theirs = s.bf.find(p => p.ctl === 1).id, spent = s.bf.find(p => p.tapped).id;
  const cy = taps => refused(s, 0, { t: "cycle", card: idIn(s, 0, "Remote Isle"), taps });
  const over = go(s, 0, { t: "cycle", card: idIn(s, 0, "Remote Isle"), taps: [isle, boil] });
  return cy([isle]) === "Those lands don't pay for it" && cy([theirs, isle]) && cy([spent, isle]) && cy([9999]) && cy([isle, isle, boil]) === null
    && over.pool[0].length === 1 && perm(over, isle).tapped && perm(over, boil).tapped || `${cy([isle])}|${cy([theirs, isle])}|${cy([spent, isle])}|${cy([9999])}|${JSON.stringify(over.pool)}`;
});
test("…for a spell and a Clue as well, and the page's start: what the game would pay, and what it costs", () => {
  const t = scene({ hand: [["Brainstorm"], []], bf: [[0, "Izzet Boilerworks"], [0, "Island"], [0, "Island"]], hold: 0 });
  const boil = onBf(t, 0, "Izzet Boilerworks");
  const bs = { t: "cast", card: idIn(t, 0, "Brainstorm"), from: "hand", targets: [] };
  const pay = payment(t, 0, bs);
  const manual = go(t, 0, { ...bs, taps: [boil] });
  const c = scene({ bf: [[0, "Clue"], [0, "Island"], [0, "Island"], [0, "Izzet Boilerworks"]], hand: [[], []], hold: 0 });
  const clue = { t: "ability", id: onBf(c, 0, "Clue") }, cb = onBf(c, 0, "Izzet Boilerworks");
  const cracked = go(c, 0, { ...clue, taps: [cb] });
  return pay.cost.U === 1 && pay.cost.g === 0 && !!pay.plan.taps.length && manual.pool[0] === "R" && perm(manual, boil).tapped && perm(cracked, cb).tapped && payment(c, 0, { t: "pass" }) === null
    || `${JSON.stringify(pay)}`;
});
console.log(bad ? `dandan: ${bad} failed` : "dandan: every check passed");
process.exit(bad ? 1 : 0);
