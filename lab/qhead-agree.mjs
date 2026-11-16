// How often the look-ahead's quick answer to a question differs from what a search picks there (16 Nov 2026, Fable on Korbi's
// game: inside a look-ahead the mover's own later questions are answered by the question head's top pick, never searched; in that
// game "pass" was valued with the wrong cleanup discard, so Monte cast a Dandân with no Island instead). Zero's games replayed
// exactly with the nets that played them; at every searched question (a decision line with qd) the question head's top answer, as
// the look-ahead's player gives it (dandan-zero.js zeroPlayer rollout), set against the search's pick, by the old marks (twins
// alike in them count as agreeing). Held-out games only (every fifth seed). By question kind: discard, putback, bottom, order…
// usage: node lab/qhead-agree.mjs <shard> <shards> <out> <zero-play jobs, comma-separated | file:<output>> <nets name, e.g. g11w-C>
//        (a lab job or a lab-read run: the table is what it prints)
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { zeroBrain, qMarksOf } from "./zero/zero-lib.mjs";

const [SH, SHS, OUT, ids, nets] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6] || "g11w-C"];
const J = x => JSON.parse(JSON.stringify(x)), key = x => JSON.stringify(x), real = Math.random;
const brain = zeroBrain(`${nets}-policy`, `${nets}-value`);
const by = {}, row = k => (by[k] ||= { n: 0, agree: 0, gap: 0 });
let games = 0, broken = 0;

function replay(game, decisions) {
  const seed = game.seed;
  if (seed % 5 !== 0) return;
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  brain.reset();
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = rules.restore(J(G.state));
    for (const d of decisions.get(i) || []) {
      if (!d.qd || d.seat !== who || !s.pending || d.pick == null || d.pick < 0) continue;
      brain.root(s, who);   // the beliefs the look-ahead's player reads, as at this decision
      const quick = brain.player.rollout(s, who, seeded(mix(seed, 777 + i))), mine = key(qMarksOf(s, who, quick));
      const r = row(s.pending.t), j = d.c.findIndex(c => key(c.m) === mine);
      r.n++;
      if (key(d.c[d.pick].m) === mine) r.agree++;
      else if (j >= 0) r.gap += d.c[d.pick].q - d.c[j].q;   // what the quick answer costs, in the search's own values
    }
    Math.random = seeded(mix(seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = real;
    if (r.error) { broken++; return; }
    brain.seen(s, who, m, r.G.state);
    G = r.G;
  }
  games++;
}

const local = ids.startsWith("file:");
const store = local ? null : await (await import("./lib.mjs")).labStore();
const parts = local ? [ids.slice(5)] : (await Promise.all(ids.split(",").map(id => store.list(`results/${id}/`)))).flat().filter(n => /\/part-\d+\.jsonl$/.test(n)).sort().filter((_, k) => k % SHS === SH);
for (const name of parts) {
  const decisions = new Map();
  for (const line of ((local ? fs.readFileSync(name, "utf8") : await store.get(name)) || "").split("\n")) {
    if (!line || line.startsWith('{"v":1')) continue;
    const o = JSON.parse(line);
    if (o.game != null) { replay(o, decisions.get(o.seed) || new Map()); decisions.delete(o.seed); continue; }
    if (o.g % 5 !== 0) continue;
    const g = decisions.get(o.g) || new Map(); decisions.set(o.g, g);
    const at = g.get(o.i) || []; at.push(o); g.set(o.i, at);
  }
}
const lines = [`${games} held-out games (${broken} not the same); the question head's top answer against the search's pick, by question kind:`];
let N = 0, A = 0;
for (const [k, r] of Object.entries(by).sort((a, b) => b[1].n - a[1].n)) {
  N += r.n; A += r.agree;
  lines.push(`  ${k.padEnd(10)} ${String(r.n).padStart(7)} questions, the same ${(100 * r.agree / r.n).toFixed(1).padStart(5)}%, differing ${(100 * (1 - r.agree / r.n)).toFixed(1).padStart(5)}%; mean loss where it differs ${(r.n - r.agree ? (100 * r.gap) / (r.n - r.agree) : 0).toFixed(1)} points`);
}
lines.push(`  all        ${String(N).padStart(7)} questions, the same ${(100 * A / Math.max(1, N)).toFixed(1)}%`);
console.log(lines.join("\n"));
if (OUT && OUT !== "-") fs.writeFileSync(OUT, JSON.stringify({ games, broken, by }) + "\n");
