// What one seat sees (17 Nov 2026, stage 3 step 2 of the plan to a general engine: "observe(state, seat)"). Every net input is
// built from this and from nothing else, so no input can read a card its seat could not see: honesty by construction, not by
// test. The observation keeps the state's shape (the views read it as they read a state), with every hidden card replaced:
//   - the other hand: each card the seat doesn't know is there (dandan-core.js knownIn) becomes HIDDEN, the size kept;
//   - the library: each card the seat doesn't know (knOf) becomes HIDDEN, the size and the known positions kept;
//   - another seat's pending question keeps only its kind and whose it is (its options can name hidden cards);
//   - the engine's own reads of hidden play (Medium's tells, reading, the coach's advice) and the log go.
// What the hidden cards could be is public (every card less those seen): `unseenIds`, the ids in no particular order.
import { knownIn } from "./dandan-core.js";

export const HIDDEN = -1;
const other = x => 1 - x;

export function observe(s, me) {
  if (s.observer === me) return s;
  const opp = other(me), bit = 1 << me, kh = new Set(knownIn(s, opp, me)), unseen = [];
  const hand = [];
  hand[me] = s.hand[me].slice();
  hand[opp] = s.hand[opp].map(id => (kh.has(id) ? id : (unseen.push(id), HIDDEN)));
  const kn = new Map(s.kn);   // knOf, once for the whole library
  const lib = s.lib.map(id => ((kn.get(id) || 0) & bit ? id : (unseen.push(id), HIDDEN)));
  const o = { ...s, hand, lib, observer: me };
  // sorted, so where each hidden card is (hand or library) doesn't show; made only when asked for
  let sorted = null;
  Object.defineProperty(o, "unseenIds", { get: () => (sorted ||= unseen.sort((a, b) => a - b)), enumerable: false });
  if (s.pending && s.pending.seat !== me) o.pending = { t: s.pending.t, seat: s.pending.seat };
  delete o.tells; delete o.reading; delete o.adv;
  o.log = [];   // its lines are written for people, some for one seat only; no view reads them
  return o;
}
