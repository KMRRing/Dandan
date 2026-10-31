// When a match may stop (Korbi, 31 October 2026: at least 30 deals, and more while the candidate isn't yet shown better,
// even at 48% after 30, as the true rate may still be 55%). The candidate's score is its mean over deals (a deal is
// two games, one from each seat; a win is 1, a draw a half). A look is taken at 30 deals, then each time the deals so
// far have doubled (30, 60, 120, 240, 480), and the match stops when
//   adopt   the candidate is better than even:  (mean - 0.5) / se  >= z_k
//   reject  it can no longer reach the gain worth having (`aim`, 55%):  (mean - aim) / se  <= -z_k
//   cap     `max` deals are played and neither holds (undecided; the mean and its interval say how near)
// and otherwise plays on, as many deals again as it has played. z_k is the normal quantile for the share alpha / 2^k
// of the error spent on look k: those shares add up to alpha however many looks there are, so looking again and again
// can't make the chance of adopting a candidate that is no better exceed alpha (5%). Stopping the first time a plain
// 95% interval clears 50% would adopt an equal candidate in about one match in five. The price is a stricter bar at each
// later look, and that a real gain of 5 points needs some 500 deals to be shown beyond doubt (tests/sequential.mjs
// plays made-up matches to show what the rule does at 45%, 50%, 55% and 60%).
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** The normal quantile (Acklam's rational approximation, error under 1e-8). */
export function quantile(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) return -quantile(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export const DEFAULTS = { min: 30, max: 480, aim: 0.55, alpha: 0.05 };

/** The candidate's score on each deal played from both seats. games: rows of match.mjs ({ pair, aSeat, aWon }, A the champion). */
export function dealScores(games) {
  const seen = new Map();
  for (const r of games) seen.set(r.pair * 2 + r.aSeat, r);          // a game played twice counts once
  const byPair = new Map();
  for (const r of seen.values()) (byPair.get(r.pair) || byPair.set(r.pair, []).get(r.pair)).push(r);
  return [...byPair.values()].filter(g => g.length === 2).map(g => 1 - (g[0].aWon + g[1].aWon) / 2);
}

/** What the games so far say, and whether to stop; `next` is how many deals to play before the next look (0: stop). */
export function decide(scores, o = {}) {
  const { min, max, aim, alpha } = { ...DEFAULTS, ...o };
  const n = scores.length, mean = n ? scores.reduce((a, b) => a + b, 0) / n : 0.5;
  // a floor on the spread: a handful of deals can agree by luck, and an interval of zero width is never believed
  const sd = Math.max(0.2, Math.sqrt(scores.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1)));
  const se = sd / Math.sqrt(Math.max(1, n));
  const look = n < min ? 0 : Math.floor(Math.log2(n / min) + 1e-9) + 1;
  const z = look ? quantile(1 - alpha / 2 ** look) : Infinity;
  const out = { n, games: 2 * n, mean, se, look, z, ci95: [mean - 1.96 * se, mean + 1.96 * se] };
  out.verdict = !look ? "continue" : (mean - 0.5) / se >= z ? "adopt" : (mean - aim) / se <= -z ? "reject" : n >= max ? "cap" : "continue";
  out.next = out.verdict !== "continue" ? 0 : n < min ? min - n : Math.min(n, max - n);
  return out;
}

export function describe(r, o = {}) {
  const { aim } = { ...DEFAULTS, ...o }, pc = x => (100 * x).toFixed(1) + "%";
  const bar = r.look ? `look ${r.look} (z ${r.z.toFixed(2)}): adopt above ${pc(0.5 + r.z * r.se)}, reject below ${pc(aim - r.z * r.se)}${r.next ? `, ${r.next} more deals` : ""}` : `first look at ${o.min ?? DEFAULTS.min} deals`;
  return `${r.verdict.toUpperCase()}: the candidate scores ${pc(r.mean)} over ${r.n} deals (${r.games} games), 95% interval ${pc(r.ci95[0])} to ${pc(r.ci95[1])}; ${bar}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), opt = {}, files = [];
  for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? (opt[args[i].slice(2)] = Number(args[++i])) : files.push(args[i]);
  const rows = files.flatMap(f => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
  const r = decide(dealScores(rows), opt);
  console.log(JSON.stringify({ ...r, text: describe(r, opt) }));
}
