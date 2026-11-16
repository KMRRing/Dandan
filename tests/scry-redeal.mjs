// Standing test for the belief's record (Fable, 16 Nov 2026): the record must not depend on the cards its seat cannot see.
//
// tests/scry-honest.mjs check 2 moves the engine's stops and keeps the cards. This is the other half, and the rule itself:
// keep the public line, change the hidden cards. At positions of random games every card `me` cannot see is dealt again
// (dandan-think.js determinize); then both seats pass on for two turns, once in the game as it is and once in the re-dealt
// one. The record's whole input for `me` (events, the two windows, the hand's facts) must be the same in both:
//   1. with every priority a stop, where the two worlds stop at the same points by construction;
//   2. with the plain stops, wherever both worlds stop at the same public point (the stops themselves differ with the hand).
// A control shows the test can fail: a record that also keeps the passes a seat made when asked must differ under 2.
//
// Run from the repository: node tests/scry-redeal.mjs   (about 3 s; BUDGET_MS to change the time spent on games)
import { rules } from "../dandan-rules.js";
import { toMove, moves, stopEverywhere } from "../dandan-engine.js";
import { answers } from "../dandan-solve.js";
import { determinize } from "../dandan-think.js";
import { seeded } from "../seats.js";
import { Record12 } from "../lab/zero/scry12.mjs";

const BUDGET = Number(process.env.BUDGET_MS || 2500), TURNS = 2;
const J = x => JSON.parse(JSON.stringify(x));
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };

/** The control: the record as it was before 16 Nov, with a pass event wherever a seat was asked and passed. */
class AskedPasses extends Record12 {
  update(s, who, m, after) { if (m.t === "pass" && !s.pending) this.push(s, who, m); super.update(s, who, m, after); }
}

const row = e => Array.from(e).map(v => +v.toFixed(4)).join(",");
/** The record's whole input for its seat at `s`, as text. */
const input = (R, s) => [R.events.map(row).join("|"), R.recent(s), R.thisTurn(s), row(R.slotFacts(s))].join("#");
/** A public point: what both seats can see of where the game stands. */
const point = s => [s.turn, s.step, s.stack.length, s.prio, s.passes, s.hand[0].length, s.hand[1].length, s.lib.length, s.life.join("/")].join(":");
/** A copy of a record that can go on separately (its events are never changed once made). */
const copyOf = R => { const X = Object.create(Object.getPrototypeOf(R)); for (const k of Object.keys(R)) X[k] = Array.isArray(R[k]) ? R[k].slice() : R[k]; return X; };

/** A random player: keeps most hands, answers questions at random, passes about half the time. */
const randomPick = rng => (s, seat) => {
  if (s.pending?.t === "mull") return { t: rng() < 0.8 ? "keep" : "mull" };
  if (s.pending) { const as = answers(s, seat); return as[Math.floor(rng() * as.length)]; }
  const ms = moves(s, seat);
  return !ms.length || rng() < 0.45 ? { t: "pass" } : ms[Math.floor(rng() * ms.length)];
};

/**
 * Both seats pass on from `s0` until a question is asked, the game ends or TURNS turns have gone by. `stops`: every priority
 * a stop. Returns the record's input at each public point the game stopped at, in order.
 */
function passOn(s0, R0, stops) {
  let s = J(s0);
  const R = copyOf(R0), at = new Map(), order = [];
  stopEverywhere(stops);
  try {
    for (let k = 0; k < 300 && !s.over && !s.pending && s.turn < s0.turn + TURNS; k++) {
      const seat = toMove(s), r = rules.act(J(s), seat, { t: "pass" }, { rng: seeded(7) });
      if (typeof r === "string") throw new Error(`a pass was refused: ${r}`);
      R.update(s, seat, { t: "pass" }, r);
      s = r;
      if (!s.pending && !s.over) { const p = point(s); if (!at.has(p)) { at.set(p, input(R, s)); order.push(p); } }
    }
  } finally { stopEverywhere(false); }
  return { at, order };
}

const tally = () => ({ points: 0, differ: 0, first: "" });
const lock = tally(), plain = tally(), control = tally();
let games = 0, redeals = 0, offLine = 0;
const compare = (T, a, b, where) => { for (const p of a.order) if (b.at.has(p)) { T.points++; if (a.at.get(p) !== b.at.get(p)) { T.differ++; T.first ||= `${where}, at ${p}`; } } };

const t0 = Date.now();
for (let g = 0; g < 40 && Date.now() - t0 < BUDGET; g++) {
  let s = rules.deal({ rng: seeded(3000 + g) });
  const R = [new Record12(0), new Record12(1)], C = [new AskedPasses(0), new AskedPasses(1)];
  const pick = randomPick(seeded(500 + g)), rng = seeded(90 + g), dealer = seeded(7000 + g);
  games++;
  for (let i = 0; i < 240 && !s.over && Date.now() - t0 < BUDGET; i++) {
    const seat = toMove(s);
    if (i % 4 === 0 && !s.pending && s.mull?.done?.[0] && s.mull?.done?.[1]) for (const me of [0, 1]) {
      const other = J(determinize(s, me, dealer, false));   // the same game as `me` sees it, the unseen cards dealt again
      const where = `game ${g}, move ${i}, seat ${me}`;
      redeals++;
      const a = passOn(s, R[me], true), b = passOn(other, R[me], true);
      if (a.order.join() !== b.order.join()) offLine++;
      compare(lock, a, b, where);
      compare(plain, passOn(s, R[me], false), passOn(other, R[me], false), where);
      compare(control, passOn(s, C[me], false), passOn(other, C[me], false), where);
    }
    const m = pick(s, seat), r = rules.act(J(s), seat, m, { rng });
    if (typeof r === "string") throw new Error(`${JSON.stringify(m)} refused: ${r}`);
    for (const X of [...R, ...C]) X.update(s, seat, m, r);
    s = r;
  }
}

check(offLine === 0, `passing on, the re-dealt game follows the same public line (${redeals} re-deals in ${games} games, ${offLine} left it)`);
check(lock.points >= 100 && lock.differ === 0, `every priority a stop: the record is the same with the unseen cards dealt again (${lock.differ} of ${lock.points} public points differ)${lock.first && ": " + lock.first}`);
check(plain.points >= 30 && plain.differ === 0, `the plain stops: the same at every public point both games stop at (${plain.differ} of ${plain.points} differ)${plain.first && ": " + plain.first}`);
check(control.differ > 0, `the control fails as it must: a record that keeps asked passes differs at ${control.differ} of ${control.points} points`);
if (fails) process.exit(1);
