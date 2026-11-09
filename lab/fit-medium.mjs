// Fits additions to Medium's constants so that the move Medium plays is the one the search values (9 November 2026). Data:
// lab/fit-medium-data.mjs (every priority decision the search weighed in Hard-against-Hard games, each candidate with Medium's
// score and the search's mean win chance). A parameter is a number added to a move's score: for a cast by the card, a cast in
// the second main phase with an empty stack by the card (`hold`), a land drop, a cycling and an ability by the card, and to
// what a move must beat to be played rather than passing, with and without a spell on the stack. The choice is replayed with
// the new scores among the moves the search weighed, and its value is that move's mean win chance. Coordinate descent on one
// half of the games (even or odd), checked on the other; what both fits agree on is the answer, as for the first TUNE.
// usage: node lab/fit-medium.mjs <data.json> [min support 120]
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), MINSUP = Number(process.argv[3] || 120);
const GRID = []; for (let x = -3; x <= 3.001; x += 0.25) GRID.push(+x.toFixed(2));
// parameter names and where they apply
const pname = (d, c) => {
  if (c.k === "pass") return d.stack ? ["passStack"] : ["pass"];
  const base = `${c.k}:${c.n}`, out = [base];
  if (c.k === "cast" && d.step === "main2" && !d.stack) out.push(`hold:${c.n}`);
  return out;
};
const count = new Map();
for (const d of data) for (const c of d.cands) for (const p of pname(d, c)) count.set(p, (count.get(p) || 0) + 1);
const params = [...count].filter(([p, n]) => p === "pass" || p === "passStack" || n >= MINSUP).map(([p]) => p);
const idx = new Map(params.map((p, i) => [p, i]));
// compile: for each decision, candidate -> parameter indices
const dec = data.map(d => ({ g: d.g, base: d.cands[d.medium].m, v: d.cands.map(c => c.v), m: d.cands.map(c => c.m), k: d.cands.map(c => c.k), ps: d.cands.map(c => pname(d, c).map(p => idx.get(p)).filter(i => i !== undefined)), medium: d.medium }));
const byParam = params.map(() => []);
dec.forEach((d, j) => { const seen = new Set(); for (const ps of d.ps) for (const p of ps) if (!seen.has(p)) { seen.add(p); byParam[p].push(j); } });
const GATE = -0.9;
function choose(d, theta) {
  let best = -1, top = -Infinity, pass = -1, passV = 0;
  for (let j = 0; j < d.v.length; j++) {
    let v = d.v[j];
    if (d.k[j] === "pass") { pass = j; for (const p of d.ps[j]) v += theta[p]; passV = v; continue; }
    if (v > GATE) for (const p of d.ps[j]) v += theta[p];
    if (v > top) { top = v; best = j; }
  }
  return best >= 0 && top > passV ? best : pass;
}
const value = (idxs, theta) => { let s = 0; for (const j of idxs) { const d = dec[j]; s += d.m[choose(d, theta)]; } return s; };
function fit(sel) {
  const mine = dec.map((d, j) => j).filter(j => sel(dec[j]));
  const inFit = new Set(mine), theta = new Float64Array(params.length);
  const touching = byParam.map(a => a.filter(j => inFit.has(j)));
  for (let pass = 0; pass < 4; pass++) {
    let moved = 0;
    for (let p = 0; p < params.length; p++) {
      if (touching[p].length < 40) continue;
      const keep = theta[p];
      let bestX = keep, bestV = -Infinity;
      for (const x of GRID) { theta[p] = x; const v = value(touching[p], theta) - 0.0005 * Math.abs(x) * touching[p].length; if (v > bestV + 1e-9 || (Math.abs(v - bestV) <= 1e-9 && Math.abs(x) < Math.abs(bestX))) { bestV = v; bestX = x; } }
      theta[p] = keep; const cur = value(touching[p], theta) - 0.0005 * Math.abs(keep) * touching[p].length;
      if (bestV > cur + 0.5) { theta[p] = bestX; moved++; }          // a move must be worth half a win-chance point summed over its decisions
    }
    if (!moved) break;
  }
  return theta;
}
const gain = (theta, sel) => { let s = 0, n = 0; for (const d of dec) if (sel(d)) { s += d.m[choose(d, theta)] - d.base; n++; } return { pts: 100 * s / n, n }; };
const even = d => d.g % 2 === 0, odd = d => d.g % 2 === 1, all = () => true;
const zero = new Float64Array(params.length);
console.log("decisions", dec.length, "| parameters", params.length, "| Medium now: search value of its move minus itself = 0 by definition");
const tE = fit(even), tO = fit(odd);
console.log("fit on even games: gain on even (fitted) %s pts, on odd (held out) %s pts", gain(tE, even).pts.toFixed(2), gain(tE, odd).pts.toFixed(2));
console.log("fit on odd games:  gain on odd (fitted)  %s pts, on even (held out) %s pts", gain(tO, odd).pts.toFixed(2), gain(tO, even).pts.toFixed(2));
// the stable part: both fits move it the same way, the smaller of the two kept
const stable = new Float64Array(params.length);
for (let p = 0; p < params.length; p++) if (tE[p] * tO[p] > 0) stable[p] = Math.sign(tE[p]) * Math.min(Math.abs(tE[p]), Math.abs(tO[p]));
console.log("stable part (both fits, smaller): gain on even %s pts, on odd %s pts, on all %s pts (both halves were seen by one of the two fits, so a little optimistic)", gain(stable, even).pts.toFixed(2), gain(stable, odd).pts.toFixed(2), gain(stable, all).pts.toFixed(2));
console.log("\nparameter                       even   odd  stable   decisions");
const rows = params.map((p, i) => ({ p, e: tE[i], o: tO[i], s: stable[i], n: byParam[i].length })).filter(r => r.s !== 0 || r.e !== 0 || r.o !== 0).sort((a, b) => Math.abs(b.s) * b.n - Math.abs(a.s) * a.n);
for (const r of rows) console.log(r.p.padEnd(30), String(r.e).padStart(6), String(r.o).padStart(6), String(r.s).padStart(7), String(r.n).padStart(9));
fs.writeFileSync(process.argv[2].replace(/\.json$/, "") + ".theta.json", JSON.stringify({ stable: Object.fromEntries(params.map((p, i) => [p, stable[i]]).filter(([, v]) => v)), even: Object.fromEntries(params.map((p, i) => [p, tE[i]]).filter(([, v]) => v)), odd: Object.fromEntries(params.map((p, i) => [p, tO[i]]).filter(([, v]) => v)) }, null, 1));
