// Korbi's father's two points, valued among our own players (Fable, 25 Nov 2026 16:20Z, step 0). Positions come from deals played
// by four Codex Hard; at each one the deal is finished twice from the same true hands, once with the questioned lead and once
// with the best other lead (each the best of its kind by Monte zero's own search there), every later decision by Monte zero
// in every seat. The questioned leads (Codex Hard measured them in the father's games; never rules, only meters):
//   A: a defender leads trump into a Solo or Wenz whose declarer plays last to the trick;
//   B: a Sauspiel's declarer, on lead in tricks 2 to 4 with the called ace still out, leads the called suit himself.
// One line per position: the declarer side's payoff each way, the trick the called ace fell in each way (B), and whether
// Monte zero's own choice was the questioned lead (the meter).
// usage: node lab/schafkopf/sk-dad.mjs <shard> <shards> <out> <A|B> <positions per shard> <first seed> [deals=256]
//   [rollout=<net file from the repo root>] [greedy=1] [only=<shard,...>]
import fs from "node:fs";
import { schafkopf as G, codexMove } from "./sk-rules.js";
import { bareThink } from "./sk-monte.js";
import { loadNet, policyRollout } from "./sk-net.js";
import { cid } from "./codex/trumps-cards.js";
import { questioned as ofKind, aceFell } from "./sk-leads.js";
import { seeded, mix } from "../../seats.js";

const [shard0, , out, kind, per, seed0] = process.argv.slice(2).map((x, i) => (i === 2 || i === 3 ? x : Number(x)));
const arg = name => (process.argv.find(a => a.startsWith(`${name}=`)) || "").slice(name.length + 1);
const ONLY = arg("only").split(",").filter(Boolean).map(Number), shard = ONLY.length ? ONLY[shard0] : shard0;
const DEALS = Number(arg("deals")) || 256;
const rollout = arg("rollout") ? policyRollout(loadNet(new URL(`../../${arg("rollout")}`, import.meta.url)), process.argv.includes("greedy=1")) : undefined;
const think = (s, w) => bareThink(s, w, { deals: DEALS, rollout });

/** The deal finished by Monte zero in every seat after `card`; the declarer side's payoff and the trick the called ace fell in. */
function finish(s0, w, card, seed) {
  const s = G.fork(s0), c = s.contract, ace = c.type === "sau" ? cid(c.ace, "A") : null;
  let fell = null;
  const step = (who, m, i) => {
    if (typeof G.act(s, who, m, seeded(mix(seed, 0x51 + i))) === "string") throw new Error(`refused ${JSON.stringify(m)}`);
    if (ace != null && fell == null && aceFell(s, ace)) fell = s.tricks.length + (s.trick.length ? 1 : 0);
  };
  step(w, { t: "card", card }, 0);
  for (let i = 1; !G.over(s); i++) {
    const who = G.toMove(s), ops = G.options(s, who);
    step(who, ops.length > 1 ? think(s, who).best : ops[0], i);
  }
  return { pay: G.payoff(s)[c.declarer], fell };
}

const lines = [];
for (let d = 0; lines.length < per && d < 400; d++) {
  const seed = mix(seed0, shard * 100003 + d), s = G.deal({ rng: seeded(seed) });
  for (let i = 0; !G.over(s); i++) {
    const w = G.toMove(s), q = ofKind(s, w, kind);
    if (q) {
      const r = think(s, w), cards = r.list.map(x => x.move.card), a = cards.find(x => q.includes(x)), b = cards.find(x => !q.includes(x));
      const pa = finish(s, w, a, seed), pb = finish(s, w, b, seed);
      lines.push({ seed, kind, trick: s.tricks.length + 1, type: s.contract.type, chose: q.includes(r.best.card) ? 1 : 0, a, b, pa: pa.pay, pb: pb.pay, fa: pa.fell, fb: pb.fell });
      fs.writeFileSync(out, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
      break;
    }
    if (typeof G.act(s, w, codexMove(s, w, "hard", seeded(mix(mix(seed, w + 1), i + 1))), seeded(mix(seed, 0x51))) === "string") break;
  }
}
console.log(`sk-dad ${kind}: ${lines.length} positions`);
