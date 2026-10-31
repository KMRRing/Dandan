// For Dandan's tests: a game set up at a chosen point (hands, battlefield, graveyard, the top of the library), and the
// moves made on it the way the runner makes them: on a copy, with the move's own random stream.
import { DECK, TOKEN_AT } from "../dandan-cards.js";
import { deal, act, restore, toMove } from "../dandan-engine.js";
import { nm, perm } from "../dandan-core.js";
import { botMove } from "../dandan-bot.js";
import { seeded, shuffle } from "../seats.js";

export const J = x => JSON.parse(JSON.stringify(x));

/**
 * A game at a chosen point: hand: [[names], [names]], bf: [[seat, name, { tapped, ent, tc }]…], yard, exile, lib (names
 * on top of the library, the rest of the deck shuffled under them unless bare), active, step, life, turn, hold (a seat).
 */
export function scene(o = {}) {
  const s = restore(J(deal({ rng: seeded(o.seed ?? 1) })));
  const used = new Set();
  const take = name => {
    const i = DECK.findIndex((n, k) => n === name && !used.has(k));
    if (i < 0) throw new Error(`no ${name} left in the deck`);
    used.add(i);
    return i;
  };
  Object.assign(s, {
    turn: o.turn ?? 5, active: o.active ?? 0, step: o.step ?? "main1", passes: o.passes ?? 0, res: 0, played: 0, attacked: false,
    quick: [false, false], combat: null, pending: null, reveal: null, over: false, winner: -1, why: "", lost: [false, false],
    drawn: o.drawn ?? [0, 0], life: o.life ?? [20, 20], nid: 1, nt: 0, kn: [], log: [], stack: [], mull: { n: [0, 0], done: [true, true] },
  });
  s.prio = o.prio ?? s.active;
  // hold: a seat given a Brainstorm and a spare Island, so it always has something to do and the game stops at it
  // (a game runs on by itself past every point where nobody could act)
  s.hand = [0, 1].map(i => [...(o.hand?.[i] ?? []), ...(o.hold === i ? ["Brainstorm"] : [])].map(take));
  s.bf = [...(o.bf ?? []), ...(o.hold != null ? [[o.hold, "Island"]] : [])].map(([seat, name, x = {}]) => ({
    id: name === "Clue" ? TOKEN_AT + ++s.nt : take(name), ctl: seat, tapped: !!x.tapped, ent: x.ent ?? 1, oid: s.nid++, ...(x.tc ? { tc: x.tc } : {}),
  }));
  s.yard = (o.yard ?? []).map(take);
  s.exile = (o.exile ?? []).map(take);
  const top = (o.lib ?? []).map(take);
  const rest = o.bare ? [] : shuffle(DECK.map((_, i) => i).filter(i => !used.has(i)), seeded(77));
  s.lib = [...top, ...rest];
  return s;
}
export const islandsOf = (seat, n) => Array.from({ length: n }, () => [seat, "Island"]);

/** A move made on a copy of the game: the game after it, or a thrown reason. */
export function go(s, seat, m) {
  const c = J(s), r = act(c, seat, m, { rng: seeded(5) });
  if (typeof r === "string") throw new Error(`${JSON.stringify(m)} refused: ${r}`);
  return restore(J(r));
}
export const refused = (s, seat, m) => { const r = act(J(s), seat, m, { rng: seeded(5) }); return typeof r === "string" ? r : null; };
export const idIn = (s, seat, name) => s.hand[seat].find(i => DECK[i] === name);
export const onBf = (s, seat, name) => s.bf.find(p => p.ctl === seat && nm(p.id) === name)?.id;
export const names = ids => ids.map(i => DECK[i]);
export const cast = (s, seat, name, targets = [], mode) => go(s, seat, { t: "cast", card: idIn(s, seat, name), from: "hand", targets, ...(mode != null ? { mode } : {}) });
export const pass = (s, seat = toMove(s)) => go(s, seat, { t: "pass" });
export const answer = (s, m) => go(s, s.pending.seat, m);
/** Passing (and answering any question as the computer would) until the test's point is reached. */
export function drive(s, until, limit = 600) {
  let c = s;
  for (let i = 0; i < limit && !until(c) && !c.over; i++) {
    const who = toMove(c);
    c = go(c, who, c.pending ? botMove(c, who, { rng: seeded(i) }) : { t: "pass" });
  }
  return c;
}
/** Both seats passing until the stack is empty, or a question stops it (a seat holding priority keeps the stack waiting). */
export function resolveStack(s) {
  let c = s;
  for (let i = 0; i < 50 && c.stack.length && !c.pending && !c.over; i++) c = go(c, toMove(c), { t: "pass" });
  return c;
}
export const stackNames = s => s.stack.map(i => i.name);
export const sidOf = (s, name) => s.stack.find(i => i.name === name)?.sid;
export { perm };
