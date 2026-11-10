// Does the judge ever think a seat is better off without a card it holds? (Korbi, 10 November 2026: Monte Mind Bent a
// Halimar Depths, and the judge put Monte 3 points higher with the Mind Bend gone than in hand.) A card in hand can be
// left unplayed, so having it is never worse than not: any position where taking it away raises the holder's chance is
// the judge's mistake. At the start of every turn of the games given, each card in each hand is taken out (put at the
// bottom of the library, so the deck's count stays) and the holder's chance compared. Prints, per card, how often and by
// how much its going helps by more than a point, and the worst positions.
// usage: node lab/judge-hand.mjs <self-play job ids> [judge job (a jt run's weights), else the game's judge]
import { readParts } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { winChance, makeJudge } from "../dandan-eval.js";
import { DECK } from "../dandan-cards.js";

const ids = process.argv[2], judgeJob = process.argv[3];
const judge = judgeJob ? makeJudge(JSON.parse((await readParts(judgeJob))[0].split("\n")[0]).layers) : winChance;
const J = x => JSON.parse(JSON.stringify(x));
const by = new Map(), worst = [];
let positions = 0;
for (const id of ids.split(",")) for (const text of await readParts(id)) for (const line of text.split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line);
  let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 }), last = -1;
  for (let i = 0; i < rec.moves.length; i++) {
    const st = G.state;
    if (st.turn !== last && st.step === "main1" && !st.stack.length && !st.pending) {
      last = st.turn; positions++;
      for (const seat of [0, 1]) {
        const base = judge(rules.restore(J(st)), seat);
        st.hand[seat].forEach((id, k) => {
          const t = rules.restore(J(st));
          t.hand[seat].splice(k, 1); t.lib.push(id);
          const d = judge(t, seat) - base, name = DECK[id] ?? "Clue";
          const e = by.get(name) || by.set(name, { n: 0, bad: 0, sum: 0, max: 0 }).get(name);
          e.n++; if (d > 0.01) { e.bad++; e.sum += d; e.max = Math.max(e.max, d); }
          if (d > 0.02) worst.push({ d: +d.toFixed(3), card: name, seed: rec.seed, i, seat, turn: st.turn, life: st.life, hand: st.hand[seat].length, base: +base.toFixed(3) });
        });
      }
    }
    const r = applyMove(rules, G, rec.moves[i][0], rec.moves[i][1], 0);
    if (r.error) break;
    G = r.G;
  }
}
const all = [...by.values()].reduce((a, e) => ({ n: a.n + e.n, bad: a.bad + e.bad }), { n: 0, bad: 0 });
console.log(JSON.stringify({ positions, cardsTried: all.n, betterWithout: all.bad, share: +(all.bad / all.n).toFixed(4) }));
for (const [name, e] of [...by].sort((a, b) => b[1].bad / b[1].n - a[1].bad / a[1].n))
  console.log(JSON.stringify({ card: name, held: e.n, betterWithout: +(e.bad / e.n).toFixed(3), meanWhenSo: e.bad ? +(e.sum / e.bad).toFixed(3) : 0, worst: +e.max.toFixed(3) }));
for (const w of worst.sort((a, b) => b.d - a.d).slice(0, 10)) console.log(JSON.stringify(w));
