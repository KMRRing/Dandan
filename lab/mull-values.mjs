// The value of a mulligan, for Medium's opening hands (dandan-policy.js: MULL). By Bellman's rule, worked back from the last
// mulligan: W[n] is the worth, by the judge, of a hand just dealt after n mulligans, played well from there (kept if
// keeping it is worth at least W[n+1], else sent back), the average over hands drawn at random; for the seat on the
// play and the one on the draw. The hands are sampled, so a count of hands is a count of sampling error: the
// standard error of each W is printed with it.
// usage: node lab/mull-values.mjs [hands for each count, 3000]
import { DECK } from "../dandan-cards.js";
import { keepValue } from "../dandan-policy.js";
import { seeded, shuffle } from "../seats.js";
import { bottomFor, MOST_MULLS } from "../dandan-engine.js";

const HANDS = Number(process.argv[2] || 3000);
const ALL = DECK.map((_, i) => i);
const rng = seeded(12345), out = {};
for (const play of [true, false]) {
  const ks = [];
  for (let n = 0; n <= MOST_MULLS; n++) {
    const b = bottomFor(n), vals = [], hands = n > 4 ? Math.max(300, HANDS / 6) : HANDS;
    for (let i = 0; i < hands; i++) vals.push(keepValue(shuffle(ALL, rng).slice(0, 7), b, play).v);
    ks.push(vals);
  }
  const W = Array(MOST_MULLS + 1).fill(0), se = [];
  for (let n = MOST_MULLS; n >= 0; n--) {
    const next = n === MOST_MULLS ? -Infinity : W[n + 1], d = ks[n].map(v => Math.max(v, next));
    W[n] = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, x) => a + (x - W[n]) ** 2, 0) / d.length);
    se[n] = sd / Math.sqrt(d.length);
  }
  out[play ? "play" : "draw"] = W.map(x => +x.toFixed(4));
  console.log(play ? "play" : "draw", JSON.stringify(W.map(x => +x.toFixed(4))), "se", se.map(x => x.toFixed(4)).join(" "));
}
console.log("MULL =", JSON.stringify(out));
