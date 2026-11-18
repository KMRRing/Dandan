// View version 3 (dandan-general.js, 18 Nov 2026): hand-built positions with known open mana, land types, clock and counter window.
import { rules } from "../dandan-rules.js";
import { newRecord } from "../seats.js";
import { DECK } from "../dandan-cards.js";
import { generalView, viewSize, answers, POOL } from "../dandan-general.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const P = POOL, B = viewSize(P, 2), at = n => DECK.indexOf(n), ids = n => DECK.map((x, i) => (x === n ? i : -1)).filter(i => i >= 0);
const near = (a, b) => Math.abs(a - b) < 1e-4;

const s = JSON.parse(JSON.stringify(newRecord(rules, { seats: 2, seed: 7, now: 0 }).state));
const isl = ids("Island"), dd = ids("Dandân"), lapse = ids("Memory Lapse");
s.turn = 5; s.active = 0; s.step = "main1"; s.prio = 0; s.stack = []; s.pending = null; s.mull = null; s.life = [20, 8];
// seat 0: three Islands (one tapped) and a Dandân; seat 1: two untapped Islands, no creature
let oid = 100;
const put = (id, ctl, tapped = false) => s.bf.push({ id, ctl, tapped, ent: 1, oid: oid++ });
s.bf = [];
put(isl[0], 0); put(isl[1], 0); put(isl[2], 0, true); put(dd[0], 0); put(isl[3], 1); put(isl[4], 1);
s.hand[0] = [lapse[0]];
const theirHand = new Float32Array(P.V), theirAny = new Float32Array(P.V);
theirHand[P.at.get("Memory Lapse")] = 0.8; theirAny[P.at.get("Memory Lapse")] = 0.6;
const x = generalView(s, 0, theirHand, theirAny), U = 1, ISL = 9 + 1;
check(x.length === viewSize(P, 3), `the view is version 3's size (${x.length})`);
check(near(x[B + U], 2 / 4), "seat 0: two untapped blue sources");
check(near(x[B + 6], 2 / 4) && near(x[B + 7], 3 / 8), "seat 0: 2 mana untapped, 3 in all");
check(near(x[B + ISL], 3 / 4), "seat 0: three Islands");
check(near(x[B + 14], 4 / 8) && near(x[B + 15], 4 / 8) && near(x[B + 16], 2 / 16), "seat 0: 4 power that could and can attack now, 2 turns to lethal at 8 life");
check(near(x[B + 17], 3 / 4), "seat 0: its Dandân three Islands from being sacrificed");
check(near(x[B + 19 + U], 2 / 4) && near(x[B + 19 + 14], 0) && x[B + 19 + 17] === 1, "seat 1: two blue sources, no power, no creature at risk");
const W = B + 38;
check(near(x[W], 0.6) && near(x[W + 1], 0.6) && x[W + 2] === 1, "the window: 60% they hold an answer, castable, two lands open");
check(near(x[W + 3], 1 / 4) && near(x[W + 4], 1 / 4), "my answer in hand, castable");
const y = generalView(s, 0, theirHand, theirAny, P, undefined, 0.9);
check(near(y[W], 0.9) && near(y[W + 1], 0.6), "the dealer's whole-hand chance replaces the card-by-card one; castable stays ≤ it");
// tap their lands: the answer is held but can't be cast
s.bf.filter(p => p.ctl === 1).forEach(p => { p.tapped = true; });
const z = generalView(s, 0, theirHand, theirAny);
check(near(z[W], 0.6) && near(z[W + 1], 0) && z[W + 2] === 0, "their lands tapped: no castable answer");
// no Island for seat 0: the Dandân must go
s.bf = s.bf.filter(p => !(p.ctl === 0 && isl.includes(p.id)));
const w = generalView(s, 0, theirHand, theirAny);
check(near(w[B + 17], 0) && near(w[B + 14], 4 / 8), "seat 0 without an Island: its Dandân at zero (to be sacrificed), still able to attack them");
// a Dandân that came in this turn: it could attack later, not now
s.bf.push({ id: dd[1], ctl: 0, tapped: false, ent: 5, oid: 999 }); s.bf.push({ id: isl[0], ctl: 0, tapped: false, ent: 1, oid: 998 });
const v = generalView(s, 0, theirHand, theirAny);
check(near(v[B + 14], 8 / 8) && near(v[B + 15], 4 / 8), "a new Dandân: 8 power could attack, 4 can now");
check([...answers(P)].reduce((a, b) => a + b, 0) === 3, "three answers in the pool: Memory Lapse, Commit // Memory, Narset's Reversal");
process.exit(bad ? 1 : 0);
