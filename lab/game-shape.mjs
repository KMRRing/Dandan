// How far games get (12 November 2026, Korbi: "playing around decking out is still a major weakness; does the share of late
// game in the training data rise as the engines get better?"). Each game of the sources named is played again and measured:
// the smallest library it reached, its turns, and how it ended (a player drew from an empty library, ran out of life, or a
// draw). One line a source: how many games, the share that reached a library of 30, 20, 12 and 6 cards, the share ended by
// decking, and the mean turns. Sources: self-play batches (spb01, a range spb01-446), or a match job's games with "!" in front
// (!aa-g9-tjt130v14b: hard-match prints every game to its stdout). Sources are split over the shards.
// usage (a lab job): node lab/game-shape.mjs <shard> <shards> <out> <sources, comma-separated> [most games a source, all]
import fs from "node:fs";
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";

const [shard, shards, out, list] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const cap = Number(process.argv[6]) || Infinity;
const expand = t => { const m = t.match(/^(!?[a-z]+)(\d+)-(\d+)$/); if (!m) return [t]; const r = []; for (let n = Number(m[2]); n <= Number(m[3]); n++) r.push(m[1] + String(n).padStart(m[2].length, "0")); return r; };
const sources = list.split(",").flatMap(expand).filter((_, i) => i % shards === shard);
const store = await labStore();
fs.writeFileSync(out, "");
for (const src of sources) {
  const match = src.startsWith("!"), id = src.replace(/^!/, "");
  const names = (await store.list(`results/${id}/`)).filter(n => (match ? /\/stdout-\d+\.txt$/ : /\/part-\d+\.jsonl$/).test(n));
  const t = { games: 0, lib30: 0, lib20: 0, lib12: 0, lib6: 0, decked: 0, life: 0, draw: 0, turns: 0 };
  outer: for (const n of names) for (const line of ((await store.get(n)) || "").split("\n")) {
    if (!line.startsWith("{")) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(rec.moves) || rec.seed == null) continue;
    let G = newRecord(rules, { seats: 2, seed: rec.seed, now: 0 }), min = G.state.lib.length;
    for (const [seat, move] of rec.moves) {
      const r = applyMove(rules, G, seat, move, 0);
      if (r.error) break;
      G = r.G; min = Math.min(min, G.state.lib.length);
    }
    const s = G.state;
    if (!s.over) continue;
    t.games++; t.turns += s.turn;
    if (min <= 30) t.lib30++; if (min <= 20) t.lib20++; if (min <= 12) t.lib12++; if (min <= 6) t.lib6++;
    if (s.winner < 0) t.draw++; else if (s.why === "library") t.decked++; else t.life++;
    if (t.games >= cap) break outer;
  }
  const f = k => (t.games ? +(t[k] / t.games).toFixed(3) : null);
  fs.appendFileSync(out, JSON.stringify({ source: src, games: t.games, reached30: f("lib30"), reached20: f("lib20"), reached12: f("lib12"), reached6: f("lib6"), decked: f("decked"), life: f("life"), draw: f("draw"), turns: t.games ? +(t.turns / t.games).toFixed(1) : null }) + "\n");
}
