// The ending census (19 Nov 2026, Korbi: branch games for the endings the training data under-represents; zero/branch-lib.mjs):
// how and when a set of batches' self-play games end, from the never-resign share (the 10% that always play out) (the rules' reason, st.why, and the length in turns), with the weights the
// branch games use (inverse frequency, 1 to 8) and the zero-play flag carrying them (bw=). Read-only; nothing Dandan-specific.
// usage: node lab/endings.mjs <batches, comma-separated> [branch]   (branch: the branch games' endings instead, by kind, to set
// against the census)
import { labStore } from "./lib.mjs";
import { endingOf, weightsOf, neverResign } from "./zero/branch-lib.mjs";

const store = await labStore(), census = {};
let games = 0;
for (const id of process.argv[2].split(","))
  for (const n of (await store.list(`results/${id}/`)).filter(x => /\/part-\d+\.jsonl$/.test(x)))
    for (const l of ((await store.get(n)) || "").split("\n")) {
      if (!l.startsWith('{"game"')) continue;
      const g = JSON.parse(l);
      if (process.argv[3] === "branch" ? !g.branch : !neverResign(g)) continue;   // the never-resign share only (Fable): conceded games hide the true ending
      const k = process.argv[3] === "branch" ? `${g.branch.kind} ${endingOf(g)}` : endingOf(g);
      census[k] = (census[k] || 0) + 1; games++;
    }
const w = weightsOf(census);
console.log(`${games} self-play games`);
for (const [k, c] of Object.entries(census).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${c} (${(100 * c / games).toFixed(1)}%), weight ${w[k].toFixed(2)}`);
console.log(`bw=${encodeURIComponent(JSON.stringify(Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +v.toFixed(2)]))))}`);
