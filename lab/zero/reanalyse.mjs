// Reanalyse (19 Nov 2026, Korbi: "let's test it now"; MuZero's Reanalyse): stored self-play games replayed exactly, and a share of
// the positions the value net learns from searched again at deep with the latest nets, so the value net's search half can come
// from a deep search while the games stay quick. The positions are the packer's value rows (lab/zero/replay-pack2.mjs: every
// turn's start and one position with priority in three besides, after any random move), a share `every` of them, training seeds
// only (seed % 5 > 0). One line a position: { g: seed, i: move index, seat: who has priority, v: the deep search's value of its
// pick for that seat }; replay-pack2.mjs REAN=<job ids> reads them.
// usage: node lab/zero/reanalyse.mjs <shard> <shards> <out> <batches, comma-separated> <every 0.25> <nets gen:zl19> <deals 1024> [flags deeper=0.03~deepmax=4]
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { generalBrain } from "./zero-lib.mjs";
import { labStore } from "../lib.mjs";

const [shard, shards, out, batches, every = "0.25", nets = "gen:zl19", deals = "1024", flags = "deeper=0.03~deepmax=4"] = process.argv.slice(2);
const fl = flags.split("~").filter(Boolean), num = k => { const f = fl.find(x => x.startsWith(`${k}=`)); return f ? Number(f.slice(k.length + 1)) : null; };
const opts = num("deeper") != null ? { deeper: { gap: num("deeper"), ...(num("deepmax") ? { max: num("deepmax") } : {}) } } : {};
const local = batches.startsWith("file:"), store = local ? null : await labStore(), J = x => JSON.parse(JSON.stringify(x)), realRandom = Math.random, EVERY = Number(every);
const parts = local ? [batches.slice(5)] : (await Promise.all(batches.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort()
  .filter((_, k) => k % Number(shards) === Number(shard));
const brain = await generalBrain(nets.replace(/^gen:/, "")), lines = [];
let games = 0, searched = 0;
const t0 = Date.now();
for (const name of parts) {
  for (const line of ((local ? fs.readFileSync(name, "utf8") : await store.get(name)) || "").split("\n")) {
    if (!line.startsWith('{"game"')) continue;
    const g = JSON.parse(line), seed = g.seed, x3 = g.explore3 ? g.explore3.i : null;
    if (seed % 5 === 0) continue;   // held-out seeds: never trained on, so never reanalysed
    brain.reset();
    let G = newRecord(rules, { seats: 2, seed, now: 0 }), lastTurn = -1;
    for (let i = 0; i < g.moves.length; i++) {
      const [who, m] = g.moves[i], st = G.state;
      // the packer's choice of value rows, exactly (replay-pack2.mjs), then this job's share of them
      const turnStart = st.turn !== lastTurn && !st.pending;
      if (turnStart) lastTurn = st.turn;
      if (!st.pending && (turnStart || seeded(mix(seed, 4242 + i))() < 1 / 3) && !(x3 != null && i <= x3) && seeded(mix(seed, 7373 + i))() < EVERY) {
        Math.random = seeded(mix(seed, 8080 + i));
        const r = brain.think(rules.restore(J(st)), who, Number(deals), opts);
        Math.random = realRandom;
        if (!r.only) { lines.push(JSON.stringify({ g: seed, i, seat: who, v: Math.round(1e4 * r.list[0].mean) / 1e4 })); searched++; }
      }
      Math.random = seeded(mix(seed, i + 1));
      const res = applyMove(rules, G, who, m, 0);
      Math.random = realRandom;
      if (res.error) break;
      brain.seen(st, who, m, res.G.state);
      G = res.G;
    }
    games++;
  }
}
fs.writeFileSync(out, lines.join("\n") + (lines.length ? "\n" : ""));
console.log(`reanalyse: ${parts.length} parts, ${games} games, ${searched} positions searched at ${deals} deals (${flags}) with ${nets} in ${Math.round((Date.now() - t0) / 1000)} s`);
