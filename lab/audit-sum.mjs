// Ranks a self-audit job (lab/audit.mjs). Two lists:
//   the human's moves Hard disagreed with most, in contested positions (the judge between 15% and 85% for the human before
//     the move), the games the human won from behind first: where the human may know better than Monte (or erred);
//   Monte's moves after which the judge jumped most towards the human: where Monte was caught off guard by its own play.
// Each with its context (turn, step, cards left, life, hands, lands). usage: node lab/audit-sum.mjs <job id> [top 100]
import { readParts } from "./lib.mjs";
const top = Number(process.argv[3] ?? 100);
const rows = (await readParts(process.argv[2])).flatMap(t => t.split("\n").filter(Boolean).map(l => JSON.parse(l)));
const ctx = r => `${r.file.replace(".json", "")} t${r.turn} ${r.step} lib ${r.lib} life ${r.life.join("/")} hands ${r.hands.join("/")} lands ${r.lands.join("/")} judge ${(100 * r.jBefore).toFixed(0)}→${(100 * r.jAfter).toFixed(0)}`;
const human = rows.filter(r => r.seat === 0 && r.gap != null && r.jBefore > 0.15 && r.jBefore < 0.85 && r.gap >= 0.02)
  .sort((a, b) => (b.behind - a.behind) || (b.won - a.won) || (b.gap - a.gap)).slice(0, top);
console.log(`decisions ${rows.length}; the human's moves Hard disagreed with (contested positions, gap 2+ points), ${human.length} shown`);
console.log("from-behind win / won / gap / played / Hard's choice / context");
for (const r of human) console.log(`${r.behind ? "B" : " "} ${r.won ? "W" : "L"} ${(100 * r.gap).toFixed(1).padStart(5)}  ${r.played}  ||  ${r.best}  ||  ${ctx(r)}`);
const monte = rows.filter(r => r.seat === 1 && r.jAfter - r.jBefore >= 0.1).sort((a, b) => (b.jAfter - b.jBefore) - (a.jAfter - a.jBefore)).slice(0, top);
console.log(`\nMonte's moves after which the judge jumped 10+ points towards the human, ${monte.length} shown`);
for (const r of monte) console.log(`${r.won ? "W" : "L"} +${(100 * (r.jAfter - r.jBefore)).toFixed(1).padStart(4)}  ${r.played}  ||  ${ctx(r)}`);
