// Match sets read together (11 November 2026): each set's score with its 99% range, by deal pair, the sets that played the
// same deals set against the best of them pair by pair, and what the gate rule says of each. Rows as lab/hard-match.mjs
// writes them ({ pair, a }). An argument is a lab job id, or several joined by "+" (a set and its extension, read as one).
//
// The gate (a challenger against the champion at Deep, one deal pair a shard):
//   (a look reads pairs 0 to L-1, once all of them are in)
//   at 300 pairs  DROP if the top of the 99% range is below 50% (a clear loser; else play on)
//   at 600 pairs  CROWN if the bottom of the 99% range is above 50%; DROP if the score is below 51.5%; else EXTEND (600 more)
//   at 1,200      CROWN if the bottom of the 99% range is above 50%; else DROP
// Played out on made-up matches, pairs split two times in three as the Deep ones are (200,000 a line): a challenger no
// better is crowned 8 times in 1,000, one truly 2 points better 42 in 100, 3 points 82 in 100, 5 points always, for 630 to
// 900 pairs on average. (400 pairs with "at least 53% and the 99% range above 50%" crowned a true 3 points 30 times in 100,
// a true 5 points 82.)
// usage: node lab/gate-sum.mjs [--screen] <job id or id+id…>…     (as a lab job: one shard, the table is what it prints)
//   --screen: a screen, not a gate (many nets against one champion on the same deals): the scores and ranges without the gate's word
//   --upto=<n> (13 Nov, the three-look rule): only pairs 0 to n-1, so a screen is read at its look (2,000 / 5,000 / 10,000) and
//   not at whatever has come in; a set missing any of those pairs says how many it lacks
import { readParts } from "./lib.mjs";

const Z99 = 2.576, pc = x => (100 * x).toFixed(1);
/** A set's rows by pair (a pair played twice counts once), from one job or several joined by "+". */
async function rowsOf(arg) {
  const byPair = new Map();
  for (const id of arg.split("+")) {
    const shift = id.endsWith("-b") ? 600 : 0;   // an extension (…-b) plays the next 600 deals from its own first seed, numbered from 0 again
    for (const t of await readParts(id)) for (const l of (t || "").split("\n")) if (l) { const r = JSON.parse(l); byPair.set(r.pair + shift, { pair: r.pair + shift, a: r.a }); }
  }
  return [...byPair.values()];
}
const stats = xs => {
  const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, half: Z99 * sd / Math.sqrt(Math.max(1, n)) };
};
/**
 * The gate's word at the furthest look whose pairs are all in. A look reads pairs 0 to L-1 and waits for every one of them:
 * the pairs that finish first are the short games, and a look at "the first 300 to finish" would favour whoever wins quickly.
 */
export function gate(byPair) {
  let word = "", at = 0;
  for (const L of [300, 600, 1200]) {
    const xs = [];
    for (let p = 0; p < L && byPair.has(p); p++) xs.push(byPair.get(p));
    if (xs.length < L) break;
    const { mean, half } = stats(xs);
    at = L;
    word = L === 300 ? (mean + half < 0.5 ? "DROP" : "play on") : mean - half > 0.5 ? "CROWN" : L === 1200 || mean < 0.515 ? "DROP" : "EXTEND";
    if (word === "DROP" || word === "CROWN") break;
  }
  return at ? `${word} at the ${at}-pair look` : "running (the first look is at pairs 0 to 299, all in)";
}

const upto = Number((process.argv.find(a => a.startsWith("--upto=")) || "").slice(7)) || Infinity;
const screen = process.argv.includes("--screen"), args = process.argv.slice(2).filter(a => /^[a-z@]/i.test(a) && !a.includes("/"));
const sets = [];
for (const arg of args) {
  const rows = (await rowsOf(arg)).filter(r => r.pair < upto);
  if (upto < Infinity && rows.length < upto) console.log(`${arg}: ${upto - rows.length} of pairs 0 to ${upto - 1} not in yet`);
  sets.push({ arg, rows, byPair: new Map(rows.map(r => [r.pair, r.a])), ...stats(rows.map(r => r.a)) });
}
sets.sort((a, b) => b.mean - a.mean);
const best = sets[0];
for (const s of sets) {
  if (!s.n) { console.log(`${s.arg}: no rows yet`); continue; }
  const swept = s.rows.filter(r => r.a === 1).length, lost = s.rows.filter(r => r.a === 0).length;
  // against the best set, on the pairs both have played (the same deals when the seeds are the same)
  const shared = [...s.byPair].filter(([p]) => best.byPair.has(p)).map(([p, a]) => a - best.byPair.get(p)), d = stats(shared);
  const vs = s === best || shared.length < 30 ? "" : `; ${pc(d.mean)} ± ${pc(d.half)} against ${best.arg} on ${d.n} shared pairs`;
  console.log(`${s.arg}: ${pc(s.mean)}% ± ${pc(s.half)} (99%: ${pc(s.mean - s.half)} to ${pc(s.mean + s.half)}) over ${s.n} pairs, ${swept} swept, ${lost} lost, ${s.n - swept - lost} split${screen ? "" : `; gate: ${gate(s.byPair)}`}${vs}`);
}
