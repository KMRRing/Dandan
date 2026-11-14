// Monte Scry Zero's scorecard (14 Nov 2026, Korbi 11:33: "cheap tests that measure progress on the 3 modules, so we see when a
// pivot needs to happen"). Every generation's nets scored on the SAME positions: a frozen set of held-out games (every fifth
// seed, never trained on by any generation) from generation 4 of A and C, replayed exactly. No fleet, a few minutes on a runner.
//   Scry   loss a card (nats) of what each unknown card really was, against the unseen pool's odds; the two-or-more-lands
//          Brier score; calibration (ECE: |said − happened| over ten bins of the per-card chances).
//   Value  log loss of the result at each turn's start, both seats; calibration (ECE over ten bins of the chance said).
//   Zero   the policy's move against the search's (the move played, the random explore3 move left out), with priority and
//          for questions.
// usage: node lab/zero-scorecard.mjs <net sets: policy:value[,policy:value…], names without "-policy"/"-value" also take
//        "g4-A" for g4-A-policy:g4-A-value> [games a job 150] [test jobs az-g4-a,az-g4-c]
import { labStore } from "./lib.mjs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { DECK, NAMES } from "../dandan-cards.js";
import { zeroBrain, zeroOptions } from "./zero/zero-lib.mjs";
import { seenBy, unknownSlots, handCounts, scryOf, NN } from "./zero/zero-view.mjs";
import LANDS from "./zero/lands.json" with { type: "json" };

const sets = process.argv[2].split(",").map(x => (x.includes(":") ? x.split(":") : [`${x}-policy`, `${x}-value`]));
const PER = Number(process.argv[3] || 150), JOBS = (process.argv[4] || "az-g4-a,az-g4-c").split(",");
const NAME_AT = new Map(NAMES.map((n, k) => [n, k])), J = x => JSON.parse(JSON.stringify(x)), key = m => JSON.stringify(m), realRandom = Math.random;
const bins = () => Array.from({ length: 10 }, () => [0, 0, 0]);   // per bin: n, sum said, sum happened
const ece = b => { const n = b.reduce((a, x) => a + x[0], 0); return n ? b.reduce((a, [k, p, y]) => a + Math.abs(p - y), 0) / n : 0; };
const put = (b, p, y) => { const i = Math.min(9, Math.floor(p * 10)); b[i][0]++; b[i][1] += p; b[i][2] += y; };
const card = () => ({ scry: { n: 0, loss: 0, cal: bins(), lands: 0, landN: 0 }, value: { n: 0, loss: 0, cal: bins() }, pol: { n: 0, ok: 0 }, q: { n: 0, ok: 0 } });
const brains = sets.map(([p, v]) => ({ name: `${p.replace(/-policy$/, "")}${v.replace(/-value$/, "") === p.replace(/-policy$/, "") ? "" : " + " + v}`, b: zeroBrain(p, v), c: card() }));
const pool = { b: { scry: scryOf(null) }, c: card() };   // the unseen pool's odds: the baseline every Scry is set against

function scoreScry(c, sc, s, me, T) {
  const seen = seenBy(s, me);
  if (seen.unknown <= 0) return;
  const r = sc(s, me, T), ids = unknownSlots(s, me);
  let dist = [1], lands = 0;
  ids.forEach((id, j) => {
    const p = r.slots[j], y = NAME_AT.get(DECK[id]);
    c.scry.n++; c.scry.loss -= Math.log((p?.[y] ?? 1 / NN) + 1e-9);
    for (let k = 0; k < NN; k++) put(c.scry.cal, p[k], k === y ? 1 : 0);
    const pl = LANDS.reduce((a, isL, k) => a + (isL ? p[k] : 0), 0), nd = new Array(dist.length + 1).fill(0);
    dist.forEach((v, k) => { nd[k] += v * (1 - pl); nd[k + 1] += v * pl; }); dist = nd;
    if (LANDS[y]) lands++;
  });
  const p2 = dist.slice(2).reduce((a, b) => a + b, 0);
  c.scry.lands += (p2 - (lands >= 2 ? 1 : 0)) ** 2; c.scry.landN++;
}

function replay(game) {
  const seed = game.seed, x3 = game.explore3?.i, won = seat => (game.winner === seat ? 1 : game.winner == null || game.winner < 0 ? 0.5 : 0);
  let G = newRecord(rules, { seats: 2, seed, now: 0 }), lastTurn = -1;
  for (const x of brains) x.b.reset();
  for (let i = 0; i < game.moves.length; i++) {
    const [who, m] = game.moves[i], s = rules.restore(J(G.state)), rng = seeded(mix(seed, 777 + i));
    const sample = rng() < 1 / 6;
    if (sample) for (const me of [0, 1]) { scoreScry(pool.c, pool.b.scry, s, me, null); for (const x of brains) if (x.b.scry) scoreScry(x.c, x.b.scry, s, me, x.b.tracker()); }
    if (s.turn !== lastTurn && !s.pending) {
      lastTurn = s.turn;
      if (x3 == null || i > x3) for (const x of brains) if (x.b.judge) for (const me of [0, 1]) {
        const p = Math.min(1 - 1e-6, Math.max(1e-6, x.b.judge(s, me))), y = won(me);
        x.c.value.n++; x.c.value.loss -= y * Math.log(p) + (1 - y) * Math.log(1 - p); put(x.c.value.cal, p, y);
      }
    }
    if (i !== x3 && zeroOptions(s, who).length >= 2) for (const x of brains) {
      x.b.root(s, who);
      const pick = x.b.player.rollout(s, who, rng), t = s.pending ? x.c.q : x.c.pol;
      t.n++; if (key(pick) === key(m)) t.ok++;
    }
    Math.random = seeded(mix(seed, i + 1));
    const r = applyMove(rules, G, who, m, 0);
    Math.random = realRandom;
    if (r.error) throw new Error(`game ${seed} move ${i}: ${r.error}`);
    for (const x of brains) x.b.seen(s, who, m, r.G.state);
    G = r.G;
  }
}

// "file:<path>": a local zero-play output (a quick test)
const fs = await import("node:fs"), local = JOBS[0].startsWith("file:");
const store = local ? { list: async () => [JOBS[0].slice(5)], get: async n => fs.readFileSync(n, "utf8") } : await labStore();
let games = 0;
for (const id of JOBS) {
  let n = 0;
  for (const name of local ? [id.slice(5)] : (await store.list(`results/${id}/`)).filter(o => /\/part-\d+\.jsonl$/.test(o)).sort()) {
    if (n >= PER) break;
    for (const line of ((await store.get(name)) || "").split("\n")) {
      if (!line.startsWith('{"game"')) continue;
      const g = JSON.parse(line);
      if (!local && g.seed % 5 !== 0) continue;   // held out: no generation ever trains on these
      replay(g); n++; games++;
      if (n >= PER) break;
    }
  }
}
const f = (v, d = 4) => v.toFixed(d), pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : "-");
console.log(`Scorecard on ${games} held-out games of ${JOBS.join(", ")} (the same positions every generation)`);
console.log(`Scry (nats a card, lower better | two-or-more-lands Brier | calibration error), the pool's odds: ${f(pool.c.scry.loss / pool.c.scry.n)} | ${f(pool.c.scry.lands / pool.c.scry.landN)} | ${f(ece(pool.c.scry.cal))}`);
for (const { name, c } of brains) {
  const s = c.scry.n ? `${f(c.scry.loss / c.scry.n)} | ${f(c.scry.lands / c.scry.landN)} | ${f(ece(c.scry.cal))}` : "none (the pool's odds)";
  console.log(`${name}: Scry ${s}; value ${c.value.n ? `${f(c.value.loss / c.value.n)} loss, ${f(ece(c.value.cal))} calibration error` : "none"}; policy ${pct(c.pol.ok, c.pol.n)} of ${c.pol.n}, questions ${pct(c.q.ok, c.q.n)} of ${c.q.n}`);
}
