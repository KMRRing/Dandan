// Zero's self-play, one shard (14 Nov 2026, Fable No. 12, No. 13 points 3-4, No. 17 point 6; Korbi: pure, more compute, Deep).
// Generation 0 (policy and value "-"): uniform random legal play, no search. From generation 1: at every decision with two or
// more options the search weighs all of them (zero-lib.mjs zeroOptions: no Medium), the look-aheads played by Zero's policy (at
// random before one is trained), the tree's options at a decision with priority the policy's focus, the position at the end
// of a look-ahead judged by Zero's value net, hidden cards dealt without tells. 1 decision in `x3` (at most one a game) is played
// by a random other option of the search's list (explore3), and the value net then learns only from positions after it.
// Out, one JSON line each: a searched decision with priority (lab/export.mjs's format, so fetch-ex.mjs / policy_np.py read it),
// then the game's value rows { v: 1, g, seat, turn, f: [mine, theirs], won, x3 } at every turn's start for both seats, then
// { game, seed, winner, turns, moves, explore3 }.
// usage: node lab/zero/zero-play.mjs <shard> <shards> <out> <deals> <games> <first seed> <policy net|-> <value net|-> [x3 400]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { think } from "../../dandan-think.js";
import { zeroOptions, zeroPlayer, netOf, judgeOf, valueRow, decisionLine, PASS } from "./zero-lib.mjs";

const [shard, shards, out, deals, games, seed0] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5]), Number(process.argv[6]), Number(process.argv[7])];
const policy = netOf(process.argv[8]), value = judgeOf(process.argv[9]), X3 = Number(process.argv[10] || 400);
const random = !value;   // generation 0: no value net, no search
const player = zeroPlayer(policy), J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m);
const base = Math.floor(games / shards), extra = games % shards, first = shard * base + Math.min(shard, extra), n = base + (shard < extra ? 1 : 0);
const realRandom = Math.random;
fs.writeFileSync(out, "");
for (let g = first; g < first + n; g++) {
  const seed = seed0 + g, lines = [], rows = [];
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), explored3 = null, lastTurn = -1;
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    const rng = seeded(mix(seed, i + 1));
    Math.random = rng;
    if (s.turn !== lastTurn && !s.pending) { lastTurn = s.turn; for (const me of [0, 1]) rows.push({ i, seat: me, turn: s.turn, f: valueRow(s, me) }); }
    const ms = zeroOptions(s, who);
    let move;
    if (ms.length <= 1) move = ms[0] ?? PASS;
    else if (random) move = ms[Math.floor(rng() * ms.length)];
    else {
      const res = think(s, who, { deals, ms: 1e9, all: true, options: zeroOptions, weigh: false, rollout: player.rollout, judge: value, ...(player.focus ? { focus: player.focus } : {}) });
      move = res.best;
      if (X3 && !explored3 && res.list.length >= 2 && seeded(mix(seed, 9700003 + i))() < 1 / X3) {
        const others = res.list.filter(c => key(c.move) !== key(res.best));
        if (others.length) { move = others[Math.floor(seeded(mix(seed, 9800003 + i))() * others.length)].move; explored3 = { i, seat: who, move }; }
      }
      if (!s.pending && !res.only && res.list.length >= 2) lines.push(decisionLine(s, who, seed, i, res, res.list.findIndex(c => key(c.move) === key(res.best)), deals, seed % 5 === 0, null));
    }
    const r = applyMove(rules, G, who, move, 0);
    if (r.error) throw new Error(`zero game ${seed} move ${i}: ${r.error}`);
    G = r.G;
  }
  Math.random = realRandom;
  const st = G.state, won = seat => (st.winner === seat ? 1 : st.winner == null || st.winner < 0 ? 0.5 : 0);
  // with a random move in the game, every decision and value row says where it stands against it (x3 −1, 0, 1)
  if (explored3) for (const d of lines) d.x3 = Math.sign(d.i - explored3.i);
  const text = [...lines.map(d => JSON.stringify(d)),
    ...rows.map(r => JSON.stringify({ v: 1, g: seed, seat: r.seat, turn: r.turn, f: r.f, won: won(r.seat), ...(seed % 5 === 0 ? { hold: 1 } : {}), ...(explored3 ? { x3: Math.sign(r.i - explored3.i) } : {}) })),
    JSON.stringify({ game: g, seed, winner: st.winner, why: st.why, turns: st.turn, moves: G.moves ?? [], ...(explored3 ? { explore3: explored3 } : {}) })];
  fs.appendFileSync(out, text.join("\n") + "\n");
}
