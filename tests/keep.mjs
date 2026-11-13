// The keep by the value net (dandan-keep.js): a hand the net rates under the redraw is thrown back, one over it kept; the
// bottoms are the right number of the hand's cards; with no redraw table Hard still asks Medium. Under 5 seconds.
import assert from "node:assert/strict";
import fs from "node:fs";
import { deal, act } from "./../dandan-engine.js";
import { makeJudge } from "./../dandan-eval.js";
import { seeded } from "./../seats.js";
import { keepMove, handWorth } from "./../dandan-keep.js";
import { thinkMoveOff } from "./../dandan-think.js";

const judge = makeJudge(JSON.parse(fs.readFileSync(new URL("../judges/s4d.json", import.meta.url), "utf8")).layers);
const s = deal({ rng: seeded(5) }), seat = s.pending.seat;
const worth = handWorth(s, seat, s.hand[seat], judge, { deals: 8 });
assert.ok(worth > 0 && worth < 1, "a hand's worth is a chance");
// a redraw table just above or below this hand decides the keep
judge.mull = { play: Array(8).fill(worth + 0.05), draw: Array(8).fill(worth + 0.05) };
assert.equal(keepMove(s, seat, judge, { deals: 8 }).move.t, "mull", "worse than a redraw: mulligan");
judge.mull = { play: Array(8).fill(worth - 0.05), draw: Array(8).fill(worth - 0.05) };
assert.equal(keepMove(s, seat, judge, { deals: 8 }).move.t, "keep", "better than a redraw: keep");
// after two counted mulligans a keep puts one card on the bottom: one of the hand's own
const t = deal({ rng: seeded(9) }), who = t.pending.seat;
t.mull.n[who] = 2; t.pending = { t: "bottom", seat: who, n: 1 };
const b = keepMove(t, who, judge, { deals: 8 }).move;
assert.equal(b.t, "bottom"); assert.equal(b.cards.length, 1); assert.ok(t.hand[who].includes(b.cards[0]));
assert.ok(!act(JSON.parse(JSON.stringify(t)), who, b).error, "the bottom is a legal answer");
// no table, or not asked: Medium answers as before
delete judge.mull;
assert.equal(keepMove(s, seat, judge), null);
assert.ok(["keep", "mull"].includes(thinkMoveOff(s, seat, { deals: 16, judge, keep: true }).move.t));
console.log("keep: ok");
