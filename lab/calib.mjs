// How much of a game the deal decides (23 Nov 2026, Fable 08:20Z): over a match's games, the deep search's win chance for the
// nets' seat at its first decision and at its first decision from turn 4 on, in ten bands, against the actual result; with the
// Brier score of each and the share of the result's variance it explains. Read-only.
// usage: node lab/calib.mjs <batch> [part 0] [parts 1]
import { rules } from "../dandan-rules.js";
import { applyMove, seeded } from "../seats.js";
import { recordOf, rngSeedOf } from "./zero/branch-lib.mjs";

const [batch, part = "0", parts = "1"] = process.argv.slice(2), store = await (await import("./lib.mjs")).labStore(), real = Math.random;
const names = (await store.list(`results/${batch}/`)).filter(n => /part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % Number(parts) === Number(part));
const at = { first: [], turn4: [] };
for (const n of names) {
  let t = "";
  try { t = (await store.get(n)) || ""; } catch { continue; }
  const games = [], dec = new Map();
  for (const l of t.split("\n")) {
    if (l.startsWith('{"game"')) games.push(JSON.parse(l));
    else if (l.startsWith('{"g"')) { const d = JSON.parse(l); dec.set(`${d.g}:${d.i}`, d.v); }
  }
  for (const g of games) {
    if (!g.vs || g.branch || g.winner == null) continue;
    const me = 1 - g.vs.seat, y = g.winner === me ? 1 : g.winner < 0 ? 0.5 : 0;
    let G = recordOf(rules, g), first = null, t4 = null;
    for (let i = 0; i < g.moves.length && t4 == null; i++) {
      const [who, m] = g.moves[i], v = dec.get(`${g.seed}:${i}`);
      if (who === me && v != null) { if (first == null) first = v; if (G.state.turn >= 4) t4 = v; }
      Math.random = seeded(rngSeedOf(g, i));
      const r = applyMove(rules, G, who, m, 0);
      Math.random = real;
      if (r.error) break;
      G = r.G;
    }
    if (first != null) at.first.push([first, y]);
    if (t4 != null) at.turn4.push([t4, y]);
  }
}
for (const [k, xs] of Object.entries(at)) {
  const n = xs.length, my = xs.reduce((a, x) => a + x[1], 0) / Math.max(1, n), vy = xs.reduce((a, x) => a + (x[1] - my) ** 2, 0) / Math.max(1, n);
  const brier = xs.reduce((a, x) => a + (x[0] - x[1]) ** 2, 0) / Math.max(1, n);
  console.log(`${k === "first" ? "at its first decision" : "at its first decision from turn 4"}: ${n} games, Brier ${brier.toFixed(4)} against ${vy.toFixed(4)} for knowing nothing: explains ${(100 * (1 - brier / vy)).toFixed(1)}% of the result's variance`);
  for (let b = 0; b < 10; b++) {
    const s = xs.filter(x => Math.min(9, Math.floor(10 * x[0])) === b);
    if (!s.length) continue;
    const mv = s.reduce((a, x) => a + x[0], 0) / s.length, w = s.reduce((a, x) => a + x[1], 0) / s.length, se = Math.sqrt(w * (1 - w) / s.length);
    console.log(`  BAND ${b * 10}-${b * 10 + 10}% ${s.length} ${(100 * mv).toFixed(1)} ${(100 * w).toFixed(1)} ${(100 * se).toFixed(1)}`);
  }
  console.log(`  RAW ${k} ${xs.map(x => `${x[0].toFixed(3)}:${x[1]}`).join(",")}`);
}
