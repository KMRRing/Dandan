// Monte's test suite (17 Nov 2026, Korbi: "flag this dandan play as one of the first and main entries to our test suite"):
// each position of lab/suite.json replayed from its game on the game-records branch and searched by Zero with the given nets
// and search flags; it passes when the pick is not the bad move. Prints a line a position and the score; with --json, a line
// of JSON last (Zero's loop keeps it in its history).
// usage: node lab/suite.mjs [nets g9x-C] [deals 256 | policy] [flags "deeper=0.03~deepmax=4"] [--json]
// deals "policy" (19 Nov 2026, Korbi: "always make it clear whether we're comparing quick or deep or just policy or full"): the
// policy net's own pick, no search; its chances stand where the search's means do (a general net only)
import fs from "node:fs";
import { execSync } from "node:child_process";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { DECK } from "../dandan-core.js";
import { zeroBrain, generalBrain } from "./zero/zero-lib.mjs";
import { isNull } from "./null-move.mjs";
import { seeded } from "../seats.js";
import { zeroOptions } from "../dandan-zero.js";

const args = process.argv.slice(2).filter(a => !a.startsWith("--")), asJson = process.argv.includes("--json");
const [nets = "g9x-C", deals = "256", flags = "deeper=0.03"] = args;
const suite = JSON.parse(fs.readFileSync(new URL("./suite.json", import.meta.url), "utf8"));
const extraOf = f => {
  // as lab/hard-match.mjs reads a side's flags: deeper=<gap>, turns=<n>, and the switches (twins, qtree, qall, keepFirst…)
  const fl = f.split("~").filter(Boolean), d = fl.find(x => x.startsWith("deeper=")), t = fl.find(x => x.startsWith("turns=")), dm = fl.find(x => x.startsWith("deepmax=")), pr = fl.find(x => x.startsWith("prior="));
  return { ...(pr ? { prior: Number(pr.slice(6)) } : {}), ...(d ? { deeper: { gap: Number(d.slice(7)), ...(dm ? { max: Number(dm.slice(8)) } : {}) } } : {}), ...(t ? { turns: Number(t.slice(6)) } : {}), ...Object.fromEntries(fl.filter(x => !x.includes("=")).map(x => [x === "keepfirst" ? "keepFirst" : x, true])) };
};
execSync("git fetch -q origin game-records", { stdio: "ignore" });
const name = m => `${m.t}${m.card != null ? " " + DECK[m.card] : ""}`;
const out = [];
// the policy alone: its chances of every option, sorted, in the search's result shape
function policyPick(brain, s, who) {
  if (!brain.player?.probs) throw new Error("deals=policy needs a general net (gen:<name>)");
  const ms = zeroOptions(s, who), pr = brain.player.probs(s, who, ms);
  const list = ms.map((move, k) => ({ move, mean: pr[k] })).sort((a, b) => b.mean - a.mean);
  return { best: list[0].move, list };
}
// SUITE_ONLY=<id,id>: just those positions (a quick look at a new flag)
const only = process.env.SUITE_ONLY?.split(",");
for (const p of suite.positions.filter(p => !only || only.includes(p.id))) {
  const rec = JSON.parse(execSync(`git show FETCH_HEAD:games/${p.game}.json`, { encoding: "utf8", maxBuffer: 1 << 28 })), g = rec.game, moves = JSON.parse(g.moves);
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  // "gen:<name>": the general Monte (lab/zero/general.mjs), its nets <name>-gpolicy, -gvalue, -scry12
  const brain = nets.startsWith("gen:") ? await generalBrain(nets.slice(4)) : zeroBrain(`${nets}-policy`, `${nets}-value`);
  for (let i = 0; i < p.move; i++) { const st = G.state, [who, m] = moves[i]; const r = applyMove(shownRules, G, who, m, g.started); if (r.error) throw new Error(`${p.id}: move ${i}: ${r.error}`); brain.seen(st, who, m, r.G.state); G = r.G; }
  const s = shownRules.restore(JSON.parse(JSON.stringify(G.state))), who = moves[p.move][0];
  const r = deals === "policy" ? policyPick(brain, s, who) : brain.think(s, who, Number(deals), extraOf(flags)), pick = r.best;
  const isBad = m => m.t === p.bad.t && DECK[m.card] === p.bad.name, bad = isBad(pick);
  // the margin (Fable 10:50Z): the best other option less the bad move, in points, all at the first look's depth (the deeper
  // look reweighs only the best two, so final means mix depths); a pass by a hair says little
  const v = o => o.score ?? o.first ?? o.mean,   // with prior=: the score the pick was made on
   badO = r.list.find(o => isBad(o.move)), other = r.list.filter(o => !isBad(o.move)).sort((a, b) => v(b) - v(a))[0];
  const margin = badO && other ? Math.round(1000 * (v(other) - v(badO))) / 10 : null;
  // and whether the pick is a null move (lab/null-move.mjs: the measure Korbi asked for, never a rule)
  const nul = isNull(s, who, pick, seeded(7));
  out.push({ id: p.id, pass: !bad, margin, null: nul, pick: name(pick), top: r.list.slice(0, 4).map(o => [name(o.move), Math.round(1000 * o.mean) / 10]) });
  console.log(`${bad ? "FAIL" : "pass"}  ${p.id}: picks ${name(pick)}${nul ? " (a null move)" : ""}, margin ${margin ?? "-"} points; ${r.list.slice(0, 4).map(o => `${name(o.move)} ${(100 * o.mean).toFixed(1)}${o.prior != null ? ` (policy ${(100 * o.prior).toFixed(0)}%)` : ""}`).join(", ")}`);
  // the group lift (22 Nov 2026, Fable): one card's several ways, measured deal by deal (dandan-think.js groupLifts)
  const lifts = r.list.filter(o => o.groupLift > 0);
  if (lifts.length) console.log(`      group lift: ${[...new Map(lifts.map(o => [`${name(o.move)} x${o.groupN}`, (100 * o.groupLift).toFixed(2)])).entries()].map(([k, v]) => `${k} ${v} points`).join(", ")}`);
}
const passed = out.filter(x => x.pass).length, margins = out.map(x => x.margin).filter(x => x != null);
console.log(`suite: ${passed} of ${out.length} passed, mean margin ${(margins.reduce((a, b) => a + b, 0) / Math.max(1, margins.length)).toFixed(1)} points, ${out.filter(x => x.null).length} null picks (nets ${nets}, ${deals === "policy" ? "policy alone, no search; numbers are its chances, margins in points of probability" : `${deals} deals, ${flags || "no flags"}`})`);
if (asJson) console.log(JSON.stringify({ nets, deals: Number(deals), flags, passed, of: out.length, positions: out }));
