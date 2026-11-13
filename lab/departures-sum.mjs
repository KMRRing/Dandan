// Mined cases tabled (lab/departures.mjs, and lab/mine-checks.mjs's control, horizon and flagged lines): by source (Korbi's
// kept games, self-play, both pooled), then by estimated gain (under 2 points, 2-5, 5-10, over 10), by library size (over 20,
// 20 or fewer) and by kind of move (card, mode, whose target), worst realised first (the blunders): cases, the search's
// estimated gain over the move it was weighed against, the gain the play-outs realised with its standard error, and where
// the lines have it (mine-checks horizon) the judge's gain at the look-ahead's horizon.
// 13 Nov (Fable): the same splits for Piracy Charm's discard (mode 2 on their player) and Mind Bend on its own Island; the
// realised gain kept if only moves with est at or above 0, 1, 2, 3 or 5 points were played; how far the kept games got.
// usage: node lab/departures-sum.mjs <file or lab job id…> [--ends <self-play job>: median cards left at the end of its games]
//        (as a lab job: one shard, the table is what it prints)
import fs from "node:fs";
import { readParts, labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";

const argv = process.argv.slice(2), endsAt = argv.indexOf("--ends"), endsJob = endsAt >= 0 ? argv[endsAt + 1] : null;
const inputs = argv.filter((a, k) => endsAt < 0 || (k !== endsAt && k !== endsAt + 1));
const texts = [];
for (const a of inputs) texts.push(...(fs.existsSync(a) ? [fs.readFileSync(a, "utf8")] : await readParts(a)));
const all = texts.flatMap(t => (t || "").split("\n")).filter(l => l.startsWith("{")).map(l => JSON.parse(l)).filter(r => r.src);
const rows = all.filter(r => r.real != null);
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length, pts = x => +(100 * x).toFixed(1);
const show = o => console.log(JSON.stringify(o));
/** A group's line: cases, mean estimated and realised gain in points, the realised gain's standard error, the horizon gain. */
function line(rs) {
  const real = rs.map(r => r.real), m = mean(real), sd = rs.length > 1 ? Math.sqrt(real.reduce((a, x) => a + (x - m) ** 2, 0) / (rs.length - 1)) : null;
  const hz = rs.filter(r => r.horizon != null);
  return { cases: rs.length, est: pts(mean(rs.map(r => r.est))), ...(hz.length && { horizon: pts(mean(hz.map(r => r.horizon))) }), real: pts(m), se: sd == null ? null : pts(sd / Math.sqrt(rs.length)) };
}
const kindName = r => [r.kind.t, r.kind.card, r.kind.mode, r.kind.target].filter(x => x != null).join(" · ");
const GAIN = [["under 2", -Infinity, 0.02], ["2-5", 0.02, 0.05], ["5-10", 0.05, 0.1], ["over 10", 0.1, Infinity]];
const LIB = [["library over 20", r => r.lib > 20], ["library 20 or fewer", r => r.lib <= 20]];
function splits(label, rs0) {
  show({ ...label, ...line(rs0), games: new Set(rs0.map(r => r.src)).size });
  for (const [name, lo, hi] of GAIN) { const rs = rs0.filter(r => r.est >= lo && r.est < hi); if (rs.length) show({ ...label, gain: name, ...line(rs) }); }
  for (const [name, f] of LIB) { const rs = rs0.filter(f); if (rs.length) show({ ...label, library: name, ...line(rs) }); }
}
show({ lines: all.length, withPlayOuts: rows.length, noPlayOuts: all.length - rows.length });
const SOURCES = [["kept games", rows.filter(r => r.src.startsWith("kept:"))], ["self-play", rows.filter(r => !r.src.startsWith("kept:"))], ["pooled", rows]];
for (const [src, rs0] of SOURCES) {
  if (!rs0.length) continue;
  splits({ source: src }, rs0);
  for (const focus of ["cast · Piracy Charm · 2 · their player", "cast · Mind Bend · own"]) {
    const rs = rs0.filter(r => kindName(r) === focus);
    if (rs.length) splits({ source: src, kind: focus }, rs);
  }
  // the realised gain kept if only the moves estimated at or above a threshold were played (the rest replaced by the move they
  // were weighed against, which gains nothing against itself): the sum over the cases kept, in points
  for (const t of [0, 1, 2, 3, 5]) {
    const kept = rs0.filter(r => r.est >= t / 100);
    show({ source: src, estAtLeast: t, cases: kept.length, realSummed: pts(kept.reduce((a, r) => a + r.real, 0)), realMean: kept.length ? pts(mean(kept.map(r => r.real))) : null });
  }
  if (src === "kept games") {
    const last = [...new Set(rs0.map(r => r.src))].map(s => Math.min(...rs0.filter(r => r.src === s).map(r => r.lib)));
    show({ source: src, keptGamesWithACaseAtLibrary20OrFewer: last.filter(l => l <= 20).length, of: last.length });
  }
  if (src !== "pooled") for (const t of [...new Set(rs0.map(kindName))].map(k => ({ kind: k, ...line(rs0.filter(r => kindName(r) === k)) })).sort((a, b) => a.real - b.real)) show({ source: src, ...t });
}
// how many cards are left when self-play games end (Fable: next to the kept games' median of 37), from up to 400 of its games
if (endsJob) {
  const store = await labStore(), left = [];
  for (const n of (await store.list(`results/${endsJob}/`)).filter(n => /\/part-\d+\.jsonl$/.test(n)).sort()) {
    if (left.length >= 400) break;
    for (const l of ((await store.get(n)) || "").split("\n")) {
      if (!l.startsWith("{") || left.length >= 400) continue;
      const g = JSON.parse(l);
      let G = newRecord(rules, { seats: 2, seed: g.seed, now: 0 });
      for (const [seat, move] of g.moves) { const r = applyMove(rules, G, seat, move, 0); if (r.error) break; G = r.G; }
      left.push(G.state.lib.length);
    }
  }
  left.sort((a, b) => a - b);
  show({ selfPlayEnds: endsJob, games: left.length, medianCardsLeft: left[left.length >> 1] ?? null, at20OrFewer: left.filter(x => x <= 20).length });
}
