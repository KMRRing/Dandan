// Standing tests for the belief (16 Nov 2026, Fable's review, items 1, 2 and 6, and his note on the honest record):
//   1. dealt hands follow Scry's odds, slot by slot (the fixed dealer: within 1.5 points on 20,000 deals; the old one was 26 off)
//   2. Scry 1.2's whole input (events, windows, the hand's facts) is the same however the engine's stops fall: the same games
//      replayed with every priority point a stop and each extra stop answered with a pass, over every position of both
//   3. Fable's three cases: one public line, the other hand once holding an instant (asked) and once not (passed over)
// The Tracker (Scry 1's history, live) is put through 2 as well and its count shown; it fails it and goes when Scry 1.2 replaces it.
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { act, toMove, moves, wants, stopEverywhere } from "../dandan-engine.js";
import { botMove } from "../dandan-bot.js";
import { answers } from "../dandan-solve.js";
import { DECK, NAMES } from "../dandan-cards.js";
import { knOf } from "../dandan-core.js";
import { seeded } from "../seats.js";
import { scryOf, dealBy, unknownSlots, Tracker } from "../dandan-zeroview.js";
import { Record12 } from "../lab/zero/scry12.mjs";
import { scene, islandsOf, J, idIn } from "./dandan-scene.js";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const AT = new Map(NAMES.map((n, k) => [n, k]));
const rows = a => Array.from(a, v => v.toFixed(4)).join(",");

// 1. the deal follows the belief, slot by slot
{
  const net = JSON.parse(fs.readFileSync(new URL("../judges/zero-g9x-C-scry.json", import.meta.url), "utf8").split("\n")[0]), scry = scryOf(net);
  const s = scene({ active: 1, step: "main1", turn: 6, prio: 0, hand: [["Island", "Predict"], ["Memory Lapse", "Dandân", "Island", "Brainstorm", "Quicken"]], bf: [...islandsOf(0, 4), ...islandsOf(1, 4)] });
  const ids = unknownSlots(s, 0), b = scry(s, 0, null), pool = [...ids, ...s.lib.filter(id => !(knOf(s, id) & 1))].sort((x, y) => x - y);
  const N = 20000, rng = seeded(11);
  for (const fix of [true, false]) {
    const got = ids.map(() => new Float32Array(NAMES.length)), deal = dealBy(b.slots, fix);
    for (let d = 0; d < N; d++) deal(pool, ids.length, rng).slice(0, ids.length).forEach((id, j) => { got[j][AT.get(DECK[id])] += 1 / N; });
    let gap = 0;
    got.forEach((g, j) => g.forEach((v, k) => { gap = Math.max(gap, Math.abs(v - b.slots[j][k])); }));
    if (fix) check(gap < 0.015, `the fixed dealer follows Scry slot by slot (largest gap ${(100 * gap).toFixed(2)} points, bar 1.5)`);
    else console.log(`     (the old dealer: largest gap ${(100 * gap).toFixed(1)} points)`);
  }
}

/** Scry 1.2's whole input for `me` at `s`, as text: the events so far, the two windows, the hand's facts. The record only grows,
 *  so `full` false gives its length in place of its events (the last position's full text checks them all). */
const input = (R, s, full = true) => [full ? R.events.map(rows).join("|") : R.events.length, R.recent(s), R.thisTurn(s), rows(R.slotFacts(s))].join("#");
/** The Tracker's input for `me` at `s`: its counters and each unknown card's history. */
const tracked = (T, me, s) => [rows(T.of(me, s)), ...unknownSlots(s, me).map(id => rows(T.slotOf(me, s, id, new Float32Array(40))))].join("#");

/**
 * A game played on: `pick(s, seat, rng)` the seat's move at each decision of the plain rules. With `stops` on, the same moves are
 * replayed with every priority a stop, each extra one answered with a pass. The inputs at every position where the plain game
 * stopped, for both seats: { r12: [...], tr: [...] }. `moves` given: replay those instead of picking.
 */
function play(s0, { pick, list = null, stops = false, seed = 5, limit = 400 }) {
  let s = J(s0);
  const rng = seeded(seed), R = [new Record12(0), new Record12(1)], T = new Tracker(), out = { r12: [], tr: [], moves: [], states: [] };
  stopEverywhere(stops);
  try {
    for (let i = 0; i < limit && !s.over; i++) {
      const seat = toMove(s);
      const extra = stops && !s.pending && !wants(s, seat);
      let m;
      if (extra) m = { t: "pass" };
      else {
        for (const me of [0, 1]) { out.r12.push(input(R[me], s, false)); out.tr.push(tracked(T, me, s)); }
        out.states.push(`${s.turn}|${s.step}|${s.hand.join("/")}|${s.lib.length}|${s.stack.length}`);
        if (list && out.moves.length >= list.length) break;
        m = list ? list[out.moves.length] : pick(s, seat);
        out.moves.push(m);
      }
      const r = rules.act(J(s), seat, m, { rng });
      if (typeof r === "string") throw new Error(`${JSON.stringify(m)} refused: ${r}`);
      for (const X of R) X.update(s, seat, m, r);
      T.update(s, seat, m, r);
      s = r;
    }
  } finally { stopEverywhere(false); }
  out.whole = R.map(X => X.events.map(rows).join("|"));
  return out;
}
const randomPick = rng => (s, seat) => {
  if (s.pending?.t === "mull") return { t: rng() < 0.8 ? "keep" : "mull" };
  if (s.pending) { const as = answers(s, seat); return as[Math.floor(rng() * as.length)]; }
  const ms = moves(s, seat);
  return !ms.length || rng() < 0.45 ? { t: "pass" } : ms[Math.floor(rng() * ms.length)];
};

// 2. the same however the stops fall, over real games
{
  let pos = 0, bad = 0, badT = 0, desync = 0, games = 0;
  const t0 = Date.now();
  for (let g = 0; g < 12 && Date.now() - t0 < 2500; g++) {
    const s0 = rules.deal({ rng: seeded(900 + g) }), plain = play(s0, { pick: randomPick(seeded(40 + g)), seed: 70 + g, limit: 240 });
    const stopped = play(s0, { list: plain.moves, stops: true, seed: 70 + g, limit: 4000 });
    games++;
    const n = Math.min(plain.r12.length, stopped.r12.length);
    if (plain.states.join() !== stopped.states.slice(0, plain.states.length).join()) desync++;
    for (let k = 0; k < n; k++) { pos++; if (plain.r12[k] !== stopped.r12[k]) bad++; if (plain.tr[k] !== stopped.tr[k]) badT++; }
    if (plain.whole.join() !== stopped.whole.join()) bad++;
  }
  check(desync === 0, `the replay with every priority a stop reaches the same positions (${games} games)`);
  check(pos >= 300 && bad === 0, `Scry 1.2's whole input is the same however the stops fall (${bad} of ${pos} position-seats differ)`);
  console.log(`     (Scry 1's Tracker: ${badT} of ${pos} differ; it goes when Scry 1.2 replaces it)`);
}

// 3. Fable's cases: three open Islands a side, the other seat passing wherever asked; its hand with an instant or without
{
  const run = (o, first, until) => {
    let s = scene(o);
    const R = new Record12(0);
    const step = (seat, m) => { const r = rules.act(J(s), seat, m, { rng: seeded(5) }); if (typeof r === "string") throw new Error(r); R.update(s, seat, m, r); s = r; };
    step(0, first(s));
    for (let i = 0; i < 400 && !s.over && !until(s); i++) step(toMove(s), s.pending ? botMove(J(s), s.pending.seat, { rng: seeded(6) }) : { t: "pass" });
    return input(R, s);
  };
  const bf = [...islandsOf(0, 3), ...islandsOf(1, 3)], open = (theirs, extra = {}) => ({ active: 0, step: "main1", turn: 6, prio: 0, hand: [["Brainstorm", "Island"], theirs], bf, ...extra });
  const brainstorm = s => ({ t: "cast", card: idIn(s, 0, "Brainstorm"), from: "hand", targets: [] });
  const resolved = s => !s.stack.length && !s.pending && s.hand[0].length !== 1;
  check(run(open(["Memory Lapse", "Island"]), brainstorm, resolved) === run(open(["Island", "Island"]), brainstorm, resolved), "(a) a Brainstorm's record is the same whether they held a Memory Lapse or not");
  const land = s => ({ t: "land", card: idIn(s, 0, "Island") });
  const b = theirs => ({ active: 0, step: "main2", turn: 6, prio: 0, hand: [["Island", "Island"], theirs], bf });
  const t7 = s => s.turn === 7 && s.step === "main1" && toMove(s) === 1;
  check(run(b(["Brainstorm", "Island"]), land, t7) === run(b(["Island", "Island"]), land, t7), "(b) the hand's facts on their next turn are the same with a Brainstorm or without");
  const c = theirs => ({ ...b(theirs), lib: ["Memory Lapse", "Island", "Memory Lapse", "Island"] });
  const t8 = s => s.turn === 8 && s.step === "main1" && toMove(s) === 0;
  check(run(c(["Brainstorm"]), land, t8) === run(c(["Memory Lapse"]), land, t8), "(c) the turn windows are the same whether they held a Brainstorm or a Memory Lapse");
}
if (fails) process.exit(1);
