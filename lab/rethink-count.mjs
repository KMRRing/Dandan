// How often Zero searches again a position it already searched, after its own pass in the same turn (Korbi, 16 Nov: Monte thinks
// at main 1, passes, then thinks the same position through again at main 2 or the end step). Zero's games replayed exactly; a
// re-think is a search by the seat whose last search, this turn, picked pass, with nothing changed since but the step: hands,
// table (tapped included), stack, graveyards, exile, library sizes, life, mana pool, land played, what is pending, what is shown.
// For each: does the mover then act, is that act the earlier search's best option other than pass, and had that option exactly
// pass's value at the earlier search (the look-ahead playing it one step later, the tie going to pass). Held-out games only
// (every fifth seed); needs the decision lines with each option's move (zps003 on).
// usage: node lab/rethink-count.mjs <shard> <shards> <out> <zero-play jobs, comma-separated | file:<output>>
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";

const [SH, SHS, OUT, ids] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const J = x => JSON.parse(JSON.stringify(x)), key = x => JSON.stringify(x), real = Math.random;
const isPass = mv => mv && mv.t === "pass";
const seen = s => key([s.turn, s.active, s.lib.length, s.yard, s.exile, s.hand, s.bf, s.stack, s.life, s.pool, s.played, s.pending, s.shown, s.reveal]);
const T = { searches: 0, games: 0, broken: 0, old: 0, again: 0, acted: 0, same: 0, checked: 0, tie: 0, byStep: {} };

function replay(game, decisions) {
  if (game.seed % 5 !== 0) return;
  let G = newRecord(rules, { seats: 2, seed: game.seed, now: 0 });
  const last = [null, null];   // per seat: the last search this turn {turn, fp, pick, best non-pass option}
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = G.state;
    for (const d of decisions.get(i) || []) {
      if (d.seat !== who || !d.c || d.c.length < 2) continue;
      T.searches++;
      if (d.c.some(c => !c.mv)) { T.old++; continue; }
      const fp = seen(s), L = last[who];
      if (!d.qd && L && L.turn === s.turn && isPass(L.pick) && L.fp === fp) {
        T.again++; const k = `${L.step} → ${s.step}`; T.byStep[k] = (T.byStep[k] || 0) + 1;
        if (!isPass(m)) {
          T.acted++;
          if (L.best) { T.checked++; if (key(L.best.mv) === key(m)) T.same++; }
        }
        if (L.best && L.passC && L.best.q === L.passC.q && L.best.se === L.passC.se) T.tie++;
      }
      if (!d.qd) {
        const pick = d.c[d.pick]?.mv, rest = d.c.filter(c => !isPass(c.mv)).sort((a, b) => b.q - a.q);
        last[who] = { turn: s.turn, step: s.step, fp, pick, best: rest[0] || null, passC: d.c.find(c => isPass(c.mv)) || null };
      }
    }
    Math.random = seeded(mix(game.seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = real;
    if (r.error) { T.broken++; return; }
    G = r.G;
    for (const k of [0, 1]) if (last[k] && last[k].turn !== G.state.turn) last[k] = null;
  }
  T.games++;
}

const local = ids.startsWith("file:");
const store = local ? null : await (await import("./lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % SHS === SH);
for (const name of parts) {
  const decisions = new Map();
  for (const line of ((local ? fs.readFileSync(name, "utf8") : await store.get(name)) || "").split("\n")) {
    if (!line || line.startsWith('{"v":1')) continue;
    const o = JSON.parse(line);
    if (o.game != null) { replay(o, decisions.get(o.seed) || new Map()); decisions.delete(o.seed); continue; }
    if (o.g % 5 !== 0) continue;
    const g = decisions.get(o.g) || new Map(); decisions.set(o.g, g);
    const at = g.get(o.i) || []; at.push(o); g.set(o.i, at);
  }
}
const pc = (a, b) => `${a} of ${b} (${(100 * a / Math.max(1, b)).toFixed(1)}%)`;
console.log([`${T.games} held-out games (${T.broken} not the same, ${T.old} searches from before moves were stored, skipped)`,
  `  re-thinks of an unchanged position after the mover's own pass this turn: ${pc(T.again, T.searches)} of all searches`,
  `  the mover then acted: ${pc(T.acted, T.again)}; that act the earlier search's best non-pass option: ${pc(T.same, T.checked)}`,
  `  at the earlier search that option had exactly pass's value (mean and se): ${pc(T.tie, T.again)}`,
  `  by step: ${Object.entries(T.byStep).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`].join("\n"));
if (OUT && OUT !== "-") fs.writeFileSync(OUT, JSON.stringify(T) + "\n");
