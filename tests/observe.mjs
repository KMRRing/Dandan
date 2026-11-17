// observe(state, seat) (dandan-view.js, 17 Nov 2026, stage 3 step 2): every net input is built from what its seat sees.
//   1. a position and the same position with every hidden card dealt again give the same observation, for both seats
//   2. so do the views built on it (ext, viewInto, seenBy), and they equal what they were before observe() existed
import fs from "node:fs";
import { rules } from "../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../seats.js";
import { observe } from "../dandan-view.js";
import { ext, seenBy } from "../dandan-zeroview.js";
import { viewInto, VIEW_N } from "../dandan-netpolicy.js";
import { knOf, knownIn } from "../dandan-core.js";
import { Scry12 } from "../lab/zero/scry12.mjs";
import { generalView, POOL } from "../dandan-general.js";

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const J = x => JSON.parse(JSON.stringify(x)), key = a => Array.from(a).join(",");
/** The same position with the cards `me` can't see dealt again among the places it can't see (the other hand, the library). */
function redeal(s, me, rng) {
  const c = J(s), opp = 1 - me, bit = 1 << me, kh = new Set(knownIn(c, opp, me));
  const at = [];
  c.hand[opp].forEach((id, i) => { if (!kh.has(id)) at.push(["h", i]); });
  c.lib.forEach((id, i) => { if (!(knOf(c, id) & bit)) at.push(["l", i]); });
  const ids = at.map(([z, i]) => (z === "h" ? c.hand[opp][i] : c.lib[i]));
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  at.forEach(([z, i], k) => { if (z === "h") c.hand[opp][i] = ids[k]; else c.lib[i] = ids[k]; });
  return c;
}
const line = fs.readFileSync(new URL("./fixtures/zero-game-4245.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(JSON.parse).find(o => o.game != null);
let G = newRecord(rules, { seats: 2, seed: line.seed, now: 0 }), n = 0, sameObs = 0, sameViews = 0;
const rng = seeded(17), z = new Float32Array(25);
const obsKey = o => JSON.stringify({ ...o, log: undefined }) + key(o.unseenIds);
for (let i = 0; i < line.moves.length; i++) {
  const s = G.state;
  for (const me of [0, 1]) {
    if (s.pending) continue;   // a question's options may name hidden cards in the state (the observation drops them)
    const t = redeal(s, me, rng);
    n++;
    if (obsKey(observe(s, me)) === obsKey(observe(t, me))) sameObs++;
    const a = seenBy(s, me), b = seenBy(t, me);
    const gz = new Float32Array(POOL.V);
    if (key(generalView(s, me, gz)) === key(generalView(t, me, gz)) && key(ext(s, me, z)) === key(ext(t, me, z)) && key(viewInto(s, me, new Float64Array(VIEW_N))) === key(viewInto(t, me, new Float64Array(VIEW_N))) && key(a.unseen) === key(b.unseen) && a.unknown === b.unknown) sameViews++;
  }
  const [who, m] = line.moves[i];
  Math.random = seeded(mix(line.seed, i + 1));
  G = applyMove(rules, G, who, m, 0).G;
}
check(n > 200 && sameObs === n, `the observation doesn't change when the hidden cards are dealt again (${sameObs} of ${n} positions and seats)`);
check(sameViews === n, `nor do the general view, ext, viewInto and seenBy built on it (${sameViews} of ${n})`);
// 3. Scry 1.2's belief on the honest net, followed through the game: the same counts with the hidden cards dealt again
{
  const net = JSON.parse(fs.readFileSync(new URL("../lab/zero/nets/g12h2-scry12.json", import.meta.url), "utf8").split("\n")[0]);
  let H = newRecord(rules, { seats: 2, seed: line.seed, now: 0 }), m0 = 0, same = 0;
  const F = [new Scry12(0, net, { hands: 32 }), new Scry12(1, net, { hands: 32 })];
  for (let i = 0; i < line.moves.length; i++) {
    const s = H.state;
    if (i % 6 === 0 && !s.pending) for (const me of [0, 1]) {
      const a = F[me].belief(s), b = F[me].belief(redeal(s, me, rng));
      m0++; if (key(a.counts) === key(b.counts) && key(a.any) === key(b.any)) same++;
    }
    const [who, m] = line.moves[i];
    Math.random = seeded(mix(line.seed, i + 1));
    const r = applyMove(rules, H, who, m, 0);
    for (const f of F) f.update(s, who, m, r.G.state);
    H = r.G;
  }
  check(m0 > 20 && same === m0, `Scry 1.2's belief is the same with the hidden cards dealt again (${same} of ${m0})`);
}
process.exit(fails ? 1 : 0);
