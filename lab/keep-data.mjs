// The first sevens with their results (13 Nov 2026, Fable: a keep net trained on results), for lab/keep_net.py: one line a seat
// and game, tab-separated: seed, play (1 on the play), kept (Medium kept its first seven: 1), won (1, ½ or 0), explored (the
// seven's decision was a coin, -explore self-play), lands, good spells (Medium's six), then the seven's card names joined by "|".
// Read-only on the bucket.
// usage: node lab/keep-data.mjs <self-play jobs or ranges, comma-separated> > rows.tsv
import { labStore } from "./lib.mjs";
import { DECK } from "../dandan-cards.js";
import { isLandId } from "../dandan-core.js";
const GOOD = new Set(["Memory Lapse", "Dandân", "Piracy Charm", "Mind Bend", "Brainstorm", "Predict"]);
import { rules } from "../dandan-rules.js";
import { newRecord } from "../seats.js";

const expand = t => { const m = t.match(/^([a-z]+)(\d+)-(\d+)$/); if (!m) return [t]; const out = []; for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(m[1] + String(n).padStart(m[2].length, "0")); return out; };
const store = await labStore();
let n = 0;
for (const id of process.argv[2].split(",").flatMap(expand)) {
  for (const name of (await store.list(`results/${id}/`)).filter(x => /\/part-\d+\.jsonl$/.test(x))) {
    const out = [];
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line) continue;
      const g = JSON.parse(line);
      if (g.winner == null || !g.moves?.length) continue;
      const st = newRecord(rules, { seats: 2, seed: g.seed, now: 0 }).state;
      for (const seat of [0, 1]) {
        const first = g.moves.find(([who]) => who === seat)?.[1], won = g.winner === seat ? 1 : g.winner < 0 ? 0.5 : 0;
        const coin = (g.explore || []).some(x => x.seat === seat) ? 1 : 0;
        const h = st.hand[seat], lands = h.filter(isLandId).length, good = h.filter(i => !isLandId(i) && GOOD.has(DECK[i])).length;
        out.push([g.seed, seat === st.first ? 1 : 0, first?.t === "keep" ? 1 : 0, won, coin, lands, good, h.map(i => DECK[i]).join("|")].join("\t"));
      }
    }
    if (out.length) { process.stdout.write(out.join("\n") + "\n"); n += out.length; }
  }
}
process.stderr.write(`${n} first sevens\n`);
