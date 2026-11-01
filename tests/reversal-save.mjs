// Narset's Reversal on the computer's own spell whose target is about to be taken away (Korbi, 1 November 2026; game 3 of Dave's,
// turn 31): its Deem Inferior is aimed at his Dandân, he answers with a Repulse on that Dandân, and the computer passed, so
// the Repulse resolved first and the Deem Inferior found nothing. A Reversal then would have gone on top of the Repulse: its
// copy of the Deem Inferior resolves first, the Dandân goes to the library, the Repulse fizzles (no card drawn) and the
// original comes back to the computer's hand. Medium scored that Reversal as a plain copy of its own spell (worth nothing, and
// a card and two mana spent), which with a Memory Lapse in hand or little mana came out below the search's cut-off, so Hard
// never weighed it and passed. Checked: Medium now rates it first, the search plays it where it was never weighed, the engine
// resolves it as described, and only a spell that really takes the permanent away (and is above the computer's) counts.
import { moves, toMove } from "../dandan-engine.js";
import { DECK } from "../dandan-cards.js";
import { Player } from "../dandan-policy.js";
import { candidates, thinkMove } from "../dandan-think.js";
import { scene, islandsOf, cast, answer, onBf, names, stackNames, sidOf, go, J } from "./dandan-scene.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const key = m => JSON.stringify(m);

/** The computer's Deem Inferior on his Dandân and his Repulse on top of it, the computer to answer. */
function position({ lands = 6, mine = ["Narset's Reversal", "Dandân", "Island"], theirs = ["Repulse", "Dandân"] } = {}) {
  let s = scene({
    active: 1, step: "main1", prio: 1, turn: 31, drawn: [0, 1], yard: ["Memory Lapse"],
    hand: [theirs, [...mine, "Deem Inferior"]],
    bf: [[0, "Dandân"], [0, "Dandân"], ...islandsOf(0, 4), ...islandsOf(1, lands)],
  });
  const [dandan] = s.bf.filter(p => p.ctl === 0 && DECK[p.id] === "Dandân").map(p => p.id);
  s = cast(s, 1, "Deem Inferior", [{ k: "c", id: dandan }]);
  return { s: cast(s, 0, "Repulse", [{ k: "c", id: dandan }]), dandan };
}
const reversalOn = (s, name) => moves(s, 1).find(m => m.t === "cast" && DECK[m.card] === "Narset's Reversal" && m.targets[0].sid === sidOf(s, name));

// the position as it stood
{
  const { s } = position();
  check(toMove(s) === 1 && stackNames(s).join() === "Deem Inferior,Repulse", "the Repulse is on top of the Deem Inferior, the computer to answer");
  const top = new Player(s, 1).scored()[0];
  check(key(top.m) === key(reversalOn(s, "Deem Inferior")) && top.v > 1, `Medium rates the Reversal on its own Deem Inferior first, well above passing (${top.v.toFixed(2)})`);
}
// what used to go wrong: a Memory Lapse in hand, and little mana, put it below the cut-off, so it was never a candidate
for (const [what, o] of [["five lands and a Memory Lapse in hand", { lands: 5, mine: ["Narset's Reversal", "Dandân", "Island", "Memory Lapse"] }], ["six lands and a Memory Lapse", { lands: 6, mine: ["Narset's Reversal", "Dandân", "Island", "Memory Lapse"] }]]) {
  const { s } = position(o), want = reversalOn(s, "Deem Inferior");
  check(key(candidates(s, 1)[0]) === key(want), `with ${what}, it is the first move the search weighs`);
  check(key(thinkMove(s, 1, { deals: 64, ms: 8000 })) === key(want), `…and with ${what} Hard plays it (it passed)`);
}
// the engine resolves it as it should
{
  const { s, dandan } = position({ theirs: ["Repulse", "Dandân"] });
  let c = go(s, 1, reversalOn(s, "Deem Inferior"));
  for (let i = 0; i < 20 && !c.over && (c.stack.length || c.pending); i++) c = c.pending ? answer(c, c.pending.t === "owner" ? { t: "owner", bottom: true } : { t: "retarget" }) : go(c, toMove(c), { t: "pass" });
  check(!c.bf.some(p => p.id === dandan), "the copy resolves first: his Dandân is off the table");
  check(c.log.some(e => /Repulse fizzles/.test(e.t)) && names(c.hand[0]).join() === "Dandân", "his Repulse fizzles and draws him nothing");
  check(names(c.hand[1]).includes("Deem Inferior") && names(c.yard).includes("Narset's Reversal"), "the Deem Inferior is back in the computer's hand");
  // against passing: the Repulse resolves, his Dandân is back in his hand and he has drawn a card
  const passed = (() => { let d = J(s); for (let i = 0; i < 20 && !d.over && (d.stack.length || d.pending); i++) d = d.pending ? answer(d, { t: "retarget" }) : go(d, toMove(d), { t: "pass" }); return d; })();
  check(names(passed.hand[0]).filter(n => n === "Dandân").length >= 2 && passed.bf.some(p => p.id === dandan) === false && !names(passed.hand[1]).includes("Deem Inferior"), "passing, it is his Dandân saved to his hand with a card drawn, and the Deem Inferior wasted");
}
// only a spell that takes the permanent away, above the computer's, aimed at it, counts
{
  const { s, dandan } = position();
  const x = () => s.stack.find(i => i.name === "Deem Inferior");
  const taken = c => new Player(c, 1).takenAway(c.stack.find(i => i.name === "Deem Inferior"));
  const fresh = () => J(s);
  check(taken(fresh()) === true, "a Repulse above, on the same Dandân: it is taken away");
  { const c = fresh(); c.stack.reverse(); check(taken(c) === false, "a Repulse below it would resolve after it: not a threat"); }
  { const c = fresh(); c.stack[1].targets = [{ k: "c", id: c.bf.find(p => p.ctl === 0 && DECK[p.id] === "Dandân" && p.id !== dandan).id }]; check(taken(c) === false, "on his other Dandân: not what it is aimed at"); }
  { const c = fresh(); c.stack[1].name = "Mind Bend"; check(taken(c) === false, "a Mind Bend only changes what the Dandân looks for: it stays to be hit"); }
  { const c = fresh(); c.stack[1].name = "Piracy Charm"; c.stack[1].mode = 0; check(taken(c) === false, "Piracy Charm's islandwalk takes nothing away"); }
  { const c = fresh(); c.stack[1].name = "Piracy Charm"; c.stack[1].mode = 1; check(taken(c) === true, "its +2/−1 kills the Dandân: it does"); }
  { const c = fresh(); c.stack[1].name = "Gone Missing"; check(taken(c) === true, "so does a Gone Missing"); }
  { const c = fresh(); c.stack[1].ctl = 1; check(taken(c) === false, "one of the computer's own above it is not a threat to it"); }
  // and with no threat the Reversal on its own spell is no better than before: not worth a card and two mana
  { const c = fresh(); c.stack.reverse(); const v = new Player(c, 1).scored().find(r => r.m.t === "cast" && DECK[r.m.card] === "Narset's Reversal" && r.m.targets[0].sid === c.stack.find(i => i.name === "Deem Inferior").sid)?.v; check(v < 0, `with nothing above it, a Reversal on its own Deem Inferior stays unrated (${v?.toFixed(2)})`); }
}

process.exit(bad ? 1 : (console.log("reversal-save: a Reversal on its own spell, when the target is about to be taken away, is rated, weighed and played"), 0));
