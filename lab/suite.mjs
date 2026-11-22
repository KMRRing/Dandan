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
// --only=<id,id> and --seeds=<n> as arguments too, for runs on a GitHub runner (lab-read takes arguments, not env)
const argOf = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const only = (argOf("only") || process.env.SUITE_ONLY)?.split(",");
for (const p of suite.positions.filter(p => !only || only.includes(p.id))) {
  const rec = JSON.parse(execSync(`git show FETCH_HEAD:games/${p.game}.json`, { encoding: "utf8", maxBuffer: 1 << 28 })), g = rec.game, moves = JSON.parse(g.moves);
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  // "gen:<name>": the general Monte (lab/zero/general.mjs), its nets <name>-gpolicy, -gvalue, -scry12
  const brain = nets.startsWith("gen:") ? await generalBrain(nets.slice(4)) : zeroBrain(`${nets}-policy`, `${nets}-value`);
  for (let i = 0; i < p.move; i++) { const st = G.state, [who, m] = moves[i]; const r = applyMove(shownRules, G, who, m, g.started); if (r.error) throw new Error(`${p.id}: move ${i}: ${r.error}`); brain.seen(st, who, m, r.G.state); G = r.G; }
  const s = shownRules.restore(JSON.parse(JSON.stringify(G.state))), who = moves[p.move][0];
  // SUITE_SEEDS=<n> (22 Nov 2026, Fable: a seed freezes one draw of the noise, it doesn't remove it): the search n times with
  // fresh salts, its verdict read as the mean margin over them with its standard error, and how many of the n pass
  const isBad = m => m.t === p.bad.t && DECK[m.card] === p.bad.name;
  const SEEDS = deals === "policy" ? 1 : Number(argOf("seeds") || process.env.SUITE_SEEDS || 1), per = [];
  for (let k = 1; k < SEEDS; k++) {
    const rk = brain.think(s, who, Number(deals), { ...extraOf(flags), salt: 0x5eed + k }), vk = o => o.score ?? o.first ?? o.mean;
    // the bad card's best way against the best of everything else: a card with several ways (Mind Bend, Predict) is one move here
    const top = (xs, f) => xs.sort((x, y) => f(y) - f(x))[0], badK = rk.list.filter(o => isBad(o.move)), okK = rk.list.filter(o => !isBad(o.move));
    const bk = top([...badK], vk), ok = top([...okK], vk);
    const rm = o => o.first ?? o.mean, rbk = top([...badK], rm), rok = top([...okK], rm);   // raw: the search's own means, no prior, no lift
    // rawFinal (Fable 15:57Z): at the pick's own depth (the means after the deeper looks), so scored less rawFinal is the prior and lift alone
    const fm = o => o.mean, fbk = top([...badK], fm), fok = top([...okK], fm);
    per.push({ bad: isBad(rk.best), margin: bk && ok ? 100 * (vk(ok) - vk(bk)) : null, raw: rbk && rok ? 100 * (rm(rok) - rm(rbk)) : null, rawFinal: fbk && fok ? 100 * (fm(fok) - fm(fbk)) : null });
  }
  // --watch=1 (22 Nov 2026, Fable 17:00Z: inside the look-ahead): each leaf counts the bad card's copies still in the seat's hand
  const WATCHING = process.argv.includes("--watch=1");
  const r = deals === "policy" ? policyPick(brain, s, who) : brain.think(s, who, Number(deals), { ...extraOf(flags), ...(WATCHING ? { watch: p.bad.name } : {}) }), pick = r.best;
  if (WATCHING && r.list[0]?.watch) {
    const root = s.hand[who].filter(id => DECK[id] === p.bad.name).length, best = (xs, f) => [...xs].sort((x, y) => f(y) - f(x))[0];
    const hold = best(r.list.filter(o => !isBad(o.move)), o => o.mean), spend = best(r.list.filter(o => isBad(o.move)), o => o.mean);
    for (const [tag, o] of [["hold", hold], ["spend", spend]]) {
      if (!o?.watch) continue;
      const w = o.watch.filter(x => x[0] != null && x[1] >= 0), kept = w.filter(x => x[0] >= root), gone = w.filter(x => x[0] < root);
      const mv = xs => (xs.length ? (100 * xs.reduce((a, x) => a + x[1], 0) / xs.length).toFixed(1) : "-");
      console.log(`      look-ahead, ${tag} (${name(o.move)}): ${w.length} leaves; the ${p.bad.name} still in hand at the horizon in ${kept.length} (${w.length ? (100 * kept.length / w.length).toFixed(0) : "-"}%), leaf value ${mv(kept)}; gone from hand in ${gone.length}, leaf value ${mv(gone)}`);
      // the opponent's reply to the cast (Fable 17:32Z: does the modelled opponent spend an answer on a doomed cast?)
      if (tag === "spend" && o.move.t === "cast") {
        const by = [0, 1, 2].map(r => w.filter(x => x[2] === r)), none = w.filter(x => x[2] == null);
        console.log(`      replies to the cast: ${["let it resolve", "aimed at it", "another play"].map((t, r) => `${t} ${by[r].length} (${w.length ? (100 * by[r].length / w.length).toFixed(0) : "-"}%), leaf ${mv(by[r])}`).join("; ")}; unknown ${none.length}`);
      }
    }
  }
  const bad = isBad(pick);
  // the margin (Fable 10:50Z): the best other option less the bad move, in points, all at the first look's depth (the deeper
  // look reweighs only the best two, so final means mix depths); a pass by a hair says little
  const v = o => o.score ?? o.first ?? o.mean,   // with prior=: the score the pick was made on
   badO = r.list.filter(o => isBad(o.move)).sort((a, b) => v(b) - v(a))[0], other = r.list.filter(o => !isBad(o.move)).sort((a, b) => v(b) - v(a))[0];
  const margin = badO && other ? Math.round(1000 * (v(other) - v(badO))) / 10 : null;
  // and whether the pick is a null move (lab/null-move.mjs: the measure Korbi asked for, never a rule)
  const nul = isNull(s, who, pick, seeded(7));
  out.push({ id: p.id, pass: !bad, margin, null: nul, pick: name(pick), top: r.list.slice(0, 4).map(o => [name(o.move), Math.round(1000 * o.mean) / 10]) });
  console.log(`${bad ? "FAIL" : "pass"}  ${p.id}: picks ${name(pick)}${nul ? " (a null move)" : ""}, margin ${margin ?? "-"} points; ${r.list.slice(0, 4).map(o => `${name(o.move)} ${(100 * o.mean).toFixed(1)}${o.prior != null ? ` (policy ${(100 * o.prior).toFixed(0)}%)` : ""}`).join(", ")}`);
  const rm0 = o => o.first ?? o.mean, best0 = (xs, f) => [...xs].sort((x, y) => f(y) - f(x))[0];
  const rbad0 = best0(r.list.filter(o => isBad(o.move)), rm0), rok0 = best0(r.list.filter(o => !isBad(o.move)), rm0), raw = rbad0 && rok0 ? 100 * (rm0(rok0) - rm0(rbad0)) : null;
  const fm0 = o => o.mean, fbad0 = best0(r.list.filter(o => isBad(o.move)), fm0), fok0 = best0(r.list.filter(o => !isBad(o.move)), fm0), rawFinal = fbad0 && fok0 ? 100 * (fm0(fok0) - fm0(fbad0)) : null;
  if (SEEDS > 1) {
    const all = [{ bad, margin, raw, rawFinal }, ...per], ms = all.map(x => x.margin).filter(x => x != null), m = ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length);
    const se = ms.length > 1 ? Math.sqrt(ms.reduce((a, x) => a + (x - m) ** 2, 0) / (ms.length - 1) / ms.length) : null;
    Object.assign(out[out.length - 1], { seeds: all.length, passes: all.filter(x => !x.bad).length, meanMargin: m, marginSe: se });
    const rs = all.map(x => x.raw).filter(x => x != null), rmn = rs.reduce((a, b) => a + b, 0) / Math.max(1, rs.length), rse = rs.length > 1 ? Math.sqrt(rs.reduce((a, x) => a + (x - rmn) ** 2, 0) / (rs.length - 1) / rs.length) : null;
    const fs5 = all.map(x => x.rawFinal).filter(x => x != null), fmn = fs5.reduce((a, b) => a + b, 0) / Math.max(1, fs5.length), fse = fs5.length > 1 ? Math.sqrt(fs5.reduce((a, x) => a + (x - fmn) ** 2, 0) / (fs5.length - 1) / fs5.length) : null;
    Object.assign(out[out.length - 1], { rawMargin: rmn, rawSe: rse, rawFinal: fmn, rawFinalSe: fse });
    console.log(`      over ${all.length} seeds: passes ${all.filter(x => !x.bad).length}, margin ${m.toFixed(2)} ± ${se?.toFixed(2) ?? "-"} points; raw at the first look ${rmn.toFixed(2)} ± ${rse?.toFixed(2) ?? "-"}, raw at the pick's depth ${fmn.toFixed(2)} ± ${fse?.toFixed(2) ?? "-"} (no prior, no lift)`);
  }
  // the group lift (22 Nov 2026, Fable): one card's several ways, measured deal by deal (dandan-think.js groupLifts)
  const lifts = r.list.filter(o => o.groupLift > 0);
  if (lifts.length) console.log(`      group lift: ${[...new Map(lifts.map(o => [`${name(o.move)} x${o.groupN}`, (100 * o.groupLift).toFixed(2)])).entries()].map(([k, v]) => `${k} ${v} points`).join(", ")}`);
}
const passed = out.filter(x => x.pass).length, margins = out.map(x => x.meanMargin ?? x.margin).filter(x => x != null);
if (out.some(x => x.seeds)) console.log(`suite over seeds: ${out.reduce((a, x) => a + (x.passes ?? 0), 0)} of ${out.reduce((a, x) => a + (x.seeds ?? 0), 0)} searches passed; by position, margin ± se: ${out.map(x => `${x.id} ${x.meanMargin?.toFixed(1)} ± ${x.marginSe?.toFixed(1)}`).join(", ")}`);
console.log(`suite: ${passed} of ${out.length} passed, mean margin ${(margins.reduce((a, b) => a + b, 0) / Math.max(1, margins.length)).toFixed(1)} points, ${out.filter(x => x.null).length} null picks (nets ${nets}, ${deals === "policy" ? "policy alone, no search; numbers are its chances, margins in points of probability" : `${deals} deals, ${flags || "no flags"}`})`);
if (asJson) console.log(JSON.stringify({ nets, deals: Number(deals), flags, passed, of: out.length, positions: out }));
