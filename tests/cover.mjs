// The computer's cover (Korbi, 12 November 2026: "timing tell"): against the computer the game stops for it wherever a card you
// can't see would have had it act, so its pace shows nothing of its hand. Checked: a game with the cover plays exactly as one
// without (the same moves made, the same end), only with the computer's extra passes among them; it plays again from its record;
// the stops are where the cover says (the computer to move, nothing it can do, a hidden card); and a game without it is unchanged.
import { shownRules, rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded } from "../seats.js";
import { coverOnly, wants } from "../dandan-engine.js";
import { policyMove } from "../dandan-policy.js";
import { replay } from "../records.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const J = x => JSON.parse(JSON.stringify(x));
/**
 * Medium against Medium; the n-th real decision drawn with seed n. The dice a move rolls (a shuffle) go on into the cover's passes
 * that follow it, so a shuffle that resolves in a cover pass draws what it would have drawn inside the move without the cover (in
 * the page each move rolls its own dice, as random either way).
 */
function play(seed, cover) {
  const G0 = newRecord(shownRules, { seats: 2, seed, options: cover ? { cover: 1 } : {}, now: 0 });
  let s = shownRules.restore(J(G0.state)), n = 0, stops = 0, odd = 0, rng = seeded(seed);
  const made = [], kept = [];
  for (let i = 0; i < 5000 && !s.over; i++) {
    const w = shownRules.toMove(s);
    if (w == null) break;
    let m;
    if (cover && coverOnly(s)) {
      stops++;
      if (w !== 1 || s.pending || wants(s, 1) || !s.hand[1].length) odd++;
      m = { t: "pass" };
    } else { m = policyMove(shownRules.restore(J(s)), w, { rng: seeded(1000 * seed + n++) }); made.push(JSON.stringify([w, m])); rng = seeded(7 * seed + n); }
    kept.push([w, m]);
    const r = shownRules.act(s, w, m, { rng, now: 0 });
    if (typeof r === "string") return { error: r };
    s = r;
  }
  return { s, made, stops, odd };
}
let same = 0, stops = 0, odd = 0, games = 0;
for (let seed = 1; seed <= 8; seed++) {
  const a = play(seed, true), b = play(seed, false);
  if (a.error || b.error) { check(false, `seed ${seed}: ${a.error || b.error}`); continue; }
  games++;
  if (a.made.join() === b.made.join() && a.s.winner === b.s.winner && a.s.turn === b.s.turn) same++;
  stops += a.stops; odd += a.odd;
}
// and through the records, as the page keeps a game (each move its own dice): it plays again from its moves
let replays = 0;
for (let seed = 1; seed <= 4; seed++) {
  let G = newRecord(shownRules, { seats: 2, seed, options: { cover: 1 }, now: 0 });
  for (let i = 0; i < 5000 && !shownRules.over(G.state); i++) {
    const s = G.state, w = shownRules.toMove(s);
    const m = coverOnly(s) ? { t: "pass" } : policyMove(shownRules.restore(J(s)), w, { rng: seeded(i) });
    G = applyMove(shownRules, G, w, m, 0).G;
  }
  const R = replay(shownRules, G);
  if (!R.error && R.n === G.n && R.state.winner === G.state.winner) replays++;
}
check(same === games, `with the cover the games play the same moves to the same end as without (${same} of ${games})`);
check(stops > games * 10 && odd === 0, `the cover stops only the computer, at stops its own hand wouldn't make, with a hidden card in hand (${stops} stops in ${games} games, ${odd} otherwise)`);
check(replays === 4, `a game with the cover plays again from its record (${replays} of 4)`);
check(!("cover" in rules.deal({ rng: seeded(3), prev: null })) && rules.deal({ rng: seeded(3), prev: null, options: { cover: 1 } }).cover === 1, "the cover is on only for a game dealt with it");
if (bad) process.exit(1);
