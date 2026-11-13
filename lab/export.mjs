// Stage 1's lessons (monte-plan.md 3.2, 11 November 2026): every recorded search decision of the self-play games, as the
// learned correction to Medium reads them. The games are replayed under the full rules (dandan-rules.js, with the notes
// of each pass), so Medium's reads are the ones it had in play. One line a priority decision with two or more candidates:
//   { g: seed, i: move number, seat, deep: 1 if searched at Deep (every legal move weighed), deals,
//     x: the mover's view (dandan-netpolicy.js stateOf, the other hand's names blanked) and its own squeeze inputs,
//     c: [{ m: the move's marks, s: Medium's score of it, q: the search's mean, se, n: deals it had, out: cut early }],
//     med: Medium's own pick (index in c), pick: the move played, won: 1, ½ or 0 for the mover }
// Passing is a candidate; its Medium score is the bar a move must clear (TUNE.pass, plus ADJ.pass with nothing on the stack).
// Every fifth game (by seed) is the held-out set: a line carries hold: 1.
// usage: node lab/export.mjs <shard> <shards> <out> <self-play job ids, comma-separated>   (result files split by shard, so a
// shard reads only its own files: a Deep self-play file holds one game). A job may be a slice, <job>/<from>-<to> (13 Nov):
// only its result files part-<from> to part-<to>. Decisions of an every-legal-move job (mode hardall) carry every: 1, and
// off: 1 where the move played was off Medium's shortlist.
import fs from "node:fs";
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { Player, PASS, TUNE, ADJ } from "../dandan-policy.js";
import { marksOf, viewOf } from "../dandan-netpolicy.js";

const [shard, shards, out, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m), r3 = v => Math.round(v * 1000) / 1000;
const store = await labStore();
let games = 0, lines = 0, file = 0;
fs.writeFileSync(out, "");
for (const sid of ids.split(",")) {
  const [id, slice] = sid.split("/"), [lo, hi] = slice ? slice.split("-").map(Number) : [0, Infinity];
  const spec = JSON.parse((await store.get(`jobs/${id}.json`)) || (await store.get(`retired/${id}.json`)) || "{}");
  const deals = Number(String(spec.args || "").split(/\s+/)[3]) || 0, every = /\bhardall/.test(spec.args || "");
  const inSlice = n => { const k = Number(n.match(/part-(\d+)\.jsonl$/)[1]); return k >= lo && k <= hi; };
  for (const name of (await store.list(`results/${id}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n) && inSlice(n))) {
    if (file++ % shards !== shard) continue;
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line) continue;
      const rec = JSON.parse(line);
      games++;
      const at = new Map((rec.dec || []).map(d => [d.i, d])), batch = [];
      let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 });
      for (let i = 0; i < rec.moves.length; i++) {
        const [seat, move] = rec.moves[i], d = at.get(i);
        if (d && d.list.length > 1 && !G.state.pending) {
          const s = rules.restore(J(G.state)), P = new Player(s, seat);
          const bar = TUNE.pass + (s.stack.length ? 0 : ADJ.pass);
          const c = d.list.map(([, m, q, se, n, cut]) => ({ m: marksOf(s, seat, m), s: r3(m.t === "pass" ? bar : P.score(m)), q, se, n, out: cut }));
          const won = rec.winner === seat ? 1 : rec.winner < 0 ? 0.5 : 0;
          batch.push(JSON.stringify({ g: rec.seed, i, seat, deep: d.deep ?? (deals >= 1024 ? 1 : 0), deals: d.deep ? 1024 : deals, x: viewOf(s, seat), c, med: d.med, pick: d.pick, won, ...(every ? { every: 1, ...(d.off ? { off: 1 } : {}) } : {}), ...(rec.seed % 5 === 0 ? { hold: 1 } : {}) }));
        }
        const r = applyMove(rules, G, seat, move, 0);
        if (r.error) { console.log(`game ${rec.seed} move ${i}: ${r.error}, rest of the game skipped`); break; }
        G = r.G;
      }
      if (batch.length) { fs.appendFileSync(out, batch.join("\n") + "\n"); lines += batch.length; }
    }
  }
}
console.log(JSON.stringify({ shard, games, decisions: lines }));
