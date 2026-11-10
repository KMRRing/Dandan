// Ranks a self-audit job (lab/audit.mjs).
//   1. The human's tendencies where Hard disagreed (contested positions: the judge between 15% and 85% for the human; a gap
//      of 2+ points), by kind: how many, in how many games, the judge's chance for the human, Hard's with its own move and
//      with the human's, and how often the human went on to win; beside the same for all the human's weighed decisions (the
//      human's usual shortfall against the judge, the baseline to read a tendency against).
//   2. The human's moves Hard disagreed with most, the games won from behind first.
//   3. Monte's moves the judge moved most towards the human over, from the last quiet position before to the first after.
// usage: node lab/audit-sum.mjs <job id> [top 100]
import { readParts } from "./lib.mjs";
const top = Number(process.argv[3] ?? 100);
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
const pct = x => (x == null || Number.isNaN(x) ? "  -" : `${(100 * x).toFixed(0).padStart(3)}%`);
const avg = (a, f) => { const v = a.map(f).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const ctx = r => `${r.file.replace(".json", "")} t${r.turn} ${r.step} lib ${r.lib} life ${r.life.join("/")} hands ${r.hands.join("/")} lands ${r.lands.join("/")}`;

/** The kind of a disagreement: what the human did against what Hard would have. */
const kind = r => {
  const p = r.played, b = r.best, idle = /^(pass|let it resolve)$/.test(p);
  if (/sacrifice Flood Plain/.test(b)) return "Hard: sacrifice Flood Plain";
  if (idle && /(Quicken|Brainstorm|cycle|Clue|Predict|Chart|Lórien|Take Inventory)/.test(b)) return "held mana; Hard would draw/cycle";
  if (idle && /(Memory Lapse|Narset|Metamorphose|Commit|Piracy|Mind Bend|Repulse|Deem|Gone Missing)/.test(b)) return "let it resolve; Hard would answer";
  if (idle && /Dandân/.test(b)) return "held a Dandân; Hard would cast it";
  if (/(Memory Lapse|Narset|Commit)/.test(p)) return "counter choices";
  if (/Dandân/.test(p) && !/Dandân/.test(b)) return "cast a Dandân; Hard would not";
  if (/block|attack/.test(p)) return "combat";
  if (/^(play|fetch) /.test(p)) return "land choice";
  if (/(Quicken|Brainstorm|cycle|Clue|Predict|Chart|Lórien|Take Inventory|Retrieval)/.test(p)) return "drew/dug differently";
  if (/(Mind Bend|Piracy|Metamorphose|Repulse|Deem|Gone Missing)/.test(p)) return "answer choice";
  return "other";
};
const weighed = rows.filter(r => r.seat === 0 && r.gap != null && r.jBefore > 0.15 && r.jBefore < 0.85);
const differ = weighed.filter(r => r.gap >= 0.02);
const line = (name, a) => {
  const games = new Map(a.map(r => [r.file, r.won]));
  console.log(`${name.padEnd(36)} ${String(a.length).padStart(4)} ${String(games.size).padStart(5)}   ${pct(avg(a, r => r.jBefore))}   ${pct(avg(a, r => r.hardBest))}   ${pct(avg(a, r => r.hardPlayed))}   ${pct(avg(a, r => r.won))}`);
};
console.log(`decisions ${rows.length}; the human's weighed decisions in contested positions ${weighed.length}, Hard disagreeing by 2+ points ${differ.length}`);
console.log(`${"".padEnd(36)}    n games  judge  Hard own  Hard yours  won`);
line("all weighed decisions (baseline)", weighed);
line("  where Hard agreed", weighed.filter(r => r.gap < 0.02));
const by = {};
for (const r of differ) (by[kind(r)] ??= []).push(r);
for (const [k, a] of Object.entries(by).sort((x, y) => y[1].length - x[1].length)) line(k, a);

const ranked = differ.slice().sort((a, b) => (b.behind - a.behind) || (b.won - a.won) || (b.gap - a.gap)).slice(0, top);
console.log(`\nthe human's moves Hard disagreed with most (B: a game won from behind; W/L the result), ${ranked.length} shown: gap / played / Hard's choice / context / judge, Hard`);
for (const r of ranked) console.log(`${r.behind ? "B" : " "} ${r.won ? "W" : "L"} ${(100 * r.gap).toFixed(1).padStart(5)}  ${r.played}  ||  ${r.best}  ||  ${ctx(r)}  judge ${pct(r.jBefore)} Hard ${pct(r.hardBest)}/${pct(r.hardPlayed)}`);

const monte = rows.filter(r => r.seat === 1 && r.qBefore != null && r.qAfter - r.qBefore >= 0.1).sort((a, b) => (b.qAfter - b.qBefore) - (a.qAfter - a.qBefore)).slice(0, top);
console.log(`\nMonte's moves after which the judge (quiet position to quiet position) moved 10+ points towards the human, ${monte.length} shown`);
for (const r of monte) console.log(`${r.won ? "W" : "L"} +${(100 * (r.qAfter - r.qBefore)).toFixed(1).padStart(4)}  ${r.played}  ||  ${ctx(r)}  judge ${pct(r.qBefore)}→${pct(r.qAfter)}`);
