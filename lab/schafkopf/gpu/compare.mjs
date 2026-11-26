// Positions for the GPU search's check against the JS search (gpu/compare.py): deals played by Codex Hard to a random decision,
// each with the JS search's options, means and deal counts (bareThink, as Monte zero runs it, with the given net).
// usage: node lab/schafkopf/gpu/compare.mjs <positions> <seed> <net from the repo root> [deals=256] [biddeals=256] [salt=n] > positions.jsonl
import { schafkopf as G, codexMove } from "../sk-rules.js";
import { think } from "../../../dandan-think.js";
import { judgeOf } from "../sk-monte.js";
import { loadNet, policyRollout } from "../sk-net.js";
import { actionOf, id0 } from "../sk-view.js";
import { seeded, mix } from "../../../seats.js";

const [n, seed0] = process.argv.slice(2, 4).map(Number), netFile = process.argv[4];
const arg = k => Number((process.argv.find(a => a.startsWith(`${k}=`)) || "").split("=")[1]) || 256;
const SALT = arg("salt") === 256 ? 0 : arg("salt");   // salt=<n>: the same positions searched afresh (the JS-against-JS baseline)
const rollout = policyRollout(loadNet(new URL(`../../../${netFile}`, import.meta.url)), true);
let got = 0;
for (let d = 0; got < n; d++) {
  const seed = mix(seed0, d), rng = seeded(seed), s = G.deal({ rng }), hands = s.hands.map(h => h.map(id0)), dealer = s.dealer;
  const stop = Math.floor(rng() * 36), log = [];
  for (let i = 0; !G.over(s); i++) {
    const w = G.toMove(s), ops = G.options(s, w);
    if (i >= stop && ops.length > 1) {
      const t0 = Date.now(), r = think(s, w, { deals: s.step === "bid" ? arg("biddeals") : arg("deals"), ms: 1e9, all: true, options: G.options, rollout, judge: judgeOf(), game: G, hold: false, salt: SALT });
      process.stdout.write(JSON.stringify({ hands, dealer, log, seat: w, step: s.step, ms: Date.now() - t0, best: actionOf(r.best), opts: r.list.map(c => [actionOf(c.move), c.mean, c.n, c.se]) }) + "\n");
      got++;
      break;
    }
    const m = codexMove(s, w, "hard", seeded(mix(seed, i + 1)));
    log.push(actionOf(m));
    G.act(s, w, m, seeded(mix(seed, 0x51)));
  }
}
