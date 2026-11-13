// Flaws (dandan-flaws.js: the moves Korbi has called wrong on their face) in a match's kept games, per side and per kind,
// per 1,000 decisions (13 Nov, Fable: with the estimated-gain table, decides the margin rule against every legal move).
// A match keeps each game as a line of its shard's stdout (lab/hard-match.mjs: { pair, seed, aSeat, winner, moves }); the
// games replay from their seed and moves under the plain rules. Side A is the match's first engine.
// usage: node lab/match-flaws.mjs <lab job id…>   (as a lab job: one shard, the table is what it prints)
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { flawAt } from "../dandan-flaws.js";

const store = await labStore(), J = x => JSON.parse(JSON.stringify(x));
for (const id of process.argv.slice(2)) {
  const names = (await store.list(`results/${id}/`)).filter(n => /\/stdout-\d+\.txt$/.test(n));
  const dec = [0, 0], count = [new Map(), new Map()], seen = new Set();
  let games = 0, broken = 0;
  for (const n of names) for (const l of ((await store.get(n)) || "").split("\n")) {
    if (!l.startsWith('{"pair"')) continue;
    const g = JSON.parse(l), key = `${g.seed}:${g.aSeat}`;
    if (seen.has(key)) continue;   // a shard run twice keeps its games twice
    seen.add(key); games++;
    let G = newRecord(rules, { seats: 2, seed: g.seed, now: 0 });
    try {
      for (const [seat, move] of g.moves) {
        const side = seat === g.aSeat ? 0 : 1, f = flawAt(rules.restore(J(G.state)), seat, move);
        dec[side]++;
        if (f) { const k = `${f.kind} · ${f.card}`; count[side].set(k, (count[side].get(k) || 0) + 1); }
        const r = applyMove(rules, G, seat, move, 0);
        if (r.error) throw new Error(r.error);
        G = r.G;
      }
    } catch { broken++; }
  }
  const per = (k, side) => +((1000 * (count[side].get(k) || 0)) / Math.max(1, dec[side])).toFixed(2);
  console.log(JSON.stringify({ job: id, games, broken, moves: dec }));
  for (const k of new Set([...count[0].keys(), ...count[1].keys()]))
    console.log(JSON.stringify({ job: id, kind: k, A: count[0].get(k) || 0, B: count[1].get(k) || 0, Aper1000: per(k, 0), Bper1000: per(k, 1) }));
}
