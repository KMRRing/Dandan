// What Scry is worth at a few decisions of a traced game (lab/explain/trace.mjs): the same position weighed twice, by the live
// engine and by the same engine with its Scry net taken out (the other hand's cards dealt from the unseen pool at even odds, and
// the policy reading those even odds as its estimate of the other hand). Both brains follow the whole game move by move, so
// each sees the same record; only the belief differs. One fixed seed per decision, the same for both, so the deals line up.
// usage: node lab/explain/without-scry.mjs <trace.json> <deals> <out.json> <step i> <step i>…
import fs from "node:fs";
import { rules } from "../../dandan-rules.js";
import { newRecord, applyMove, seeded, mix } from "../../seats.js";
import { makeZero } from "../../dandan-zero.js";
import { moveName } from "../../dandan-words.js";

const load = k => JSON.parse(fs.readFileSync(new URL(`../../judges/zero-g9x-C-${k}.json`, import.meta.url), "utf8").split("\n")[0]);
const NETS = { policy: load("policy"), qpolicy: load("qpolicy"), scry: load("scry"), value: load("value") };
const J = x => JSON.parse(JSON.stringify(x)), r3 = v => Math.round(v * 1000) / 1000;
const [file, deals, out, ...at] = process.argv.slice(2);
const trace = JSON.parse(fs.readFileSync(file, "utf8")), want = new Set(at.map(Number));
const live = makeZero(NETS), blind = makeZero({ ...NETS, scry: null });
live.reset(); blind.reset();
let G = newRecord(rules, { seats: 2, seed: trace.seed, now: 0 });
const res = [];
for (const st of trace.steps) {
  const s = rules.restore(J(G.state));
  if (want.has(st.i)) {
    const weigh = brain => { Math.random = seeded(mix(trace.seed, 77000 + st.i)); return brain.think(s, st.who, Number(deals), { deeper: { gap: 0.03 } }); };
    const a = weigh(live), b = weigh(blind);
    const list = r => r.list.slice(0, 6).map(c => ({ move: moveName(c.move, s, st.who), mean: r3(c.mean), se: r3(c.se ?? 0) }));
    res.push({ i: st.i, who: st.who, played: st.move, live: { best: moveName(a.best, s, st.who), list: list(a) }, blind: { best: moveName(b.best, s, st.who), list: list(b) } });
    console.log(`#${st.i}: live ${moveName(a.best, s, st.who)} | without Scry ${moveName(b.best, s, st.who)}`);
  }
  const r = applyMove(rules, G, st.who, st.m, 0);
  if (r.error) throw new Error(`step ${st.i}: ${r.error}`);
  live.seen(s, st.who, st.m, r.G.state); blind.seen(s, st.who, st.m, r.G.state);
  G = r.G;
  if (st.i >= Math.max(...want)) break;
}
fs.writeFileSync(out, JSON.stringify(res));
