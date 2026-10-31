// Dandan's window before the draw (dandan-engine.js wants / fetchWindow): an untapped Flood Plain is a reason to stop at an
// upkeep, so its owner is asked, before the draw, whether to fetch (Korbi, 30 October 2026). The computer players
// and the look-ahead pass through it as they always did.
import { act, wants, toMove, upkeepStop, fetchWindow } from "../dandan-engine.js";
import { botMove } from "../dandan-bot.js";
import { rules } from "../dandan-rules.js";
import { seeded } from "../seats.js";
import { scene, islandsOf, go, onBf, drive, resolveStack, answer, J } from "./dandan-scene.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const test = (what, fn) => {
  try { const r = fn(); check(r !== false && typeof r !== "string", typeof r === "string" ? `${what} — ${r}` : what); }
  catch (e) { console.log(`FAIL ${what}: ${e.message}`); bad++; }
};

/** The game at the turn after a seat's end step, played on to the first seat asked. */
const toUpkeep = (active, bf, hand = [[], []]) => drive(scene({ active, step: "end", prio: active, passes: 1, turn: 5, hand, bf }), c => c.turn === 6, 40);
const plain = seat => [seat, "Flood Plain"];

// ---------- who is asked ----------
test("the other player's upkeep asks a seat with an untapped Flood Plain, before the draw", () => {
  const s = toUpkeep(0, [plain(0), ...islandsOf(0, 2)]);
  return (s.step === "upkeep" && s.active === 1 && toMove(s) === 0 && !s.stack.length) || `${s.step} turn ${s.turn} asked ${toMove(s)}`;
});
test("…and so does its own: the active player is asked first, and the other player after it", () => {
  const s = toUpkeep(1, [plain(0), plain(1), ...islandsOf(0, 2)]);
  if (!(s.step === "upkeep" && s.active === 0 && toMove(s) === 0)) return `own upkeep not asked (${s.step} ${toMove(s)})`;
  const next = go(s, 0, { t: "pass" });
  if (!(next.step === "upkeep" && toMove(next) === 1)) return `the other seat wasn't asked next (${next.step} ${toMove(next)})`;
  return go(next, 1, { t: "pass" }).step !== "upkeep" || "the draw should follow both passes";
});
test("nothing to ask when the Flood Plain is tapped, there is no land of its kind to fetch, or it is the first turn", () => {
  const base = { active: 1, step: "upkeep", turn: 6, prio: 1, hand: [[], []] };
  const asked = o => wants(scene({ ...base, ...o }), 0);
  const withPlain = { bf: [plain(0), ...islandsOf(0, 1)] };
  return asked(withPlain) && !asked({ bf: [[0, "Flood Plain", { tapped: true }], ...islandsOf(0, 1)] })
    && !asked({ ...withPlain, turn: 1 }) && !asked({ bf: islandsOf(0, 3) })
    // a library with no Island or Plains card left, and one with an Island
    && !asked({ ...withPlain, bare: true, lib: ["Dandân", "Memory Lapse"] }) && asked({ ...withPlain, bare: true, lib: ["Dandân", "Island"] })
    || "a stop where there should be none, or none where there should be";
});
test("the stop is for whoever holds the Flood Plain, and says nothing about what the library holds on top", () => {
  const s = scene({ active: 1, step: "upkeep", turn: 6, prio: 0, bf: [plain(0)], hand: [[], []] });
  const known = scene({ active: 1, step: "upkeep", turn: 6, prio: 0, bf: [plain(0)], hand: [[], []], lib: ["Memory Lapse"] });
  return wants(s, 0) && !wants(s, 1) && wants(known, 0) && !wants(known, 1);
});

// ---------- what a pass and a fetch do ----------
test("passing it goes on to the draw: the top card is drawn, and the turn runs on", () => {
  const s = toUpkeep(0, [plain(0), ...islandsOf(0, 2)]), top = s.lib[0];
  const next = go(s, 0, { t: "pass" });
  return next.step !== "upkeep" && next.hand[1].includes(top) || `${next.step}`;
});
test("cracking it is before the draw: the search is made at the upkeep, the library is shuffled, and then the draw follows", () => {
  let s = toUpkeep(0, [plain(0), ...islandsOf(0, 2)]);
  s = go(s, 0, { t: "ability", id: onBf(s, 0, "Flood Plain") });
  s = resolveStack(s);
  if (s.pending?.t !== "search" || s.step !== "upkeep") return `no search at the upkeep (${s.pending?.t}, ${s.step})`;
  const before = s.lib.slice(), pick = s.pending.ids[0], drawn = s.draws[1], handed = s.hand[1].length;
  s = answer(s, { t: "search", card: pick });
  if (onBf(s, 0, "Flood Plain") != null || s.bf.filter(p => p.ctl === 0 && p.id === pick).length !== 1) return "the Flood Plain should be gone and the Island there";
  // nothing is left to crack and no hand to play, so the game goes on from the fetch to the draw (and past it): from a shuffled library
  if (s.draws[1] <= drawn || s.hand[1].length <= handed) return `the draw didn't follow (${s.step}, drew ${s.draws[1] - drawn})`;
  const left = s.lib.slice(), was = before.filter(i => i !== pick && s.lib.includes(i));
  return left.join() !== was.join() || "the library wasn't shuffled before the draw";
});

// ---------- who is not asked ----------
test("the computer passes it without a thought, at every level; a stop it always took is still its own", () => {
  const s = scene({ active: 1, step: "upkeep", turn: 6, prio: 0, bf: [plain(0)], hand: [[], []] });
  const passes = ["easy", "medium", "hard"].every(level => botMove(s, 0, { rng: seeded(3), level }).t === "pass");
  // a Brainstorm in the other player's upkeep is still a stop for the computer's thought, and not a window-only one
  const bs = scene({ active: 1, step: "upkeep", turn: 6, prio: 0, bf: islandsOf(0, 1), hand: [["Brainstorm"], []] });
  return passes && !upkeepStop(s, 0) && fetchWindow(s, 0) && upkeepStop(bs, 0) && wants(bs, 0) || "the computer should pass the window and think at the other";
});
test("a game played out in the head (quiet) doesn't stop there", () => {
  const s = scene({ active: 0, step: "end", prio: 0, passes: 1, turn: 5, bf: [plain(0), ...islandsOf(0, 2)], hand: [[], []] });
  const loud = act(J(s), 0, { t: "pass" }, { rng: seeded(2) }), quiet = act(J(s), 0, { t: "pass" }, { rng: seeded(2), quiet: true });
  return typeof loud !== "string" && loud.step === "upkeep" && typeof quiet !== "string" && quiet.step !== "upkeep" || `${loud.step} / ${quiet.step}`;
});
test("two computers playing on with Flood Plains in play pass every window (and the game keeps moving)", () => {
  let s = scene({ active: 0, step: "main1", turn: 2, hand: [["Island", "Island"], ["Island"]], bf: [plain(0), plain(1)] });
  let windows = 0, fetched = 0;
  for (let i = 0; i < 400 && !s.over; i++) {
    const who = toMove(s), m = rules.bot(s, who, { rng: seeded(i), level: "medium" });
    if (s.step === "upkeep" && !s.stack.length && !s.pending && fetchWindow(s, who) && !upkeepStop(s, who)) { windows++; if (m.t !== "pass") fetched++; }
    s = go(s, who, m);
  }
  return (s.over || s.turn > 12) && fetched === 0 || `turn ${s.turn}, over ${s.over}, fetched in a window ${fetched} of ${windows}`;
});

process.exit(bad ? 1 : 0);
