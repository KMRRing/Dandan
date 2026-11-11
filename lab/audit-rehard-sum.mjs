// lab/audit-rehard.mjs summed: by the human's tendency (as lab/audit-sum.mjs sorts them, from the original audit's
// disagreements), how often Hard with today's judge and with the other picks the human's move, and the average shortfall
// of the human's move by each search. usage: node lab/audit-rehard-sum.mjs <job id>
import { readParts } from "./lib.mjs";
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
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

const pct = x => `${(100 * x).toFixed(0).padStart(3)}%`, pts = x => `${(100 * x).toFixed(1).padStart(5)}`;
const avg = (a, f) => { const v = a.map(f).filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
console.log(`${"".padEnd(36)}    n   agrees: today  new   short (points): today  new`);
const line = (name, a) => console.log(`${name.padEnd(36)} ${String(a.length).padStart(4)}          ${pct(avg(a, r => +r.today.agrees))} ${pct(avg(a, r => +r.next.agrees))}               ${pts(avg(a, r => r.today.short))} ${pts(avg(a, r => r.next.short))}`);
line("all weighed decisions", rows);
const by = {};
for (const r of rows.filter(r => r.gap >= 0.02)) (by[kind(r)] ??= []).push(r);
for (const [k, a] of Object.entries(by).sort((x, y) => y[1].length - x[1].length)) line(k, a);
