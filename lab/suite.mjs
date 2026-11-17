// Monte's test suite (17 Nov 2026, Korbi: "flag this dandan play as one of the first and main entries to our test suite"):
// each position of lab/suite.json replayed from its game on the game-records branch and searched by Zero with the given nets
// and search flags; it passes when the pick is not the bad move. Prints a line a position and the score; with --json, a line
// of JSON last (Zero's loop keeps it in its history).
// usage: node lab/suite.mjs [nets g9x-C] [deals 256] [flags "deeper=0.03"] [--json]
import fs from "node:fs";
import { execSync } from "node:child_process";
import { shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { DECK } from "../dandan-core.js";
import { zeroBrain } from "./zero/zero-lib.mjs";

const args = process.argv.slice(2).filter(a => !a.startsWith("--")), asJson = process.argv.includes("--json");
const [nets = "g9x-C", deals = "256", flags = "deeper=0.03"] = args;
const suite = JSON.parse(fs.readFileSync(new URL("./suite.json", import.meta.url), "utf8"));
const extraOf = f => {
  // as lab/hard-match.mjs reads a side's flags: deeper=<gap>, turns=<n>, and the switches (twins, qtree, qall, keepFirst…)
  const fl = f.split("~").filter(Boolean), d = fl.find(x => x.startsWith("deeper=")), t = fl.find(x => x.startsWith("turns="));
  return { ...(d ? { deeper: { gap: Number(d.slice(7)) } } : {}), ...(t ? { turns: Number(t.slice(6)) } : {}), ...Object.fromEntries(fl.filter(x => !x.includes("=")).map(x => [x === "keepfirst" ? "keepFirst" : x, true])) };
};
execSync("git fetch -q origin game-records", { stdio: "ignore" });
const name = m => `${m.t}${m.card != null ? " " + DECK[m.card] : ""}`;
const out = [];
for (const p of suite.positions) {
  const rec = JSON.parse(execSync(`git show FETCH_HEAD:games/${p.game}.json`, { encoding: "utf8", maxBuffer: 1 << 28 })), g = rec.game, moves = JSON.parse(g.moves);
  let G = newRecord(shownRules, { seats: 2, seed: g.seed, seq: g.seq, options: g.options || {}, now: g.started, prev: { state: { over: true, winner: 1 - g.state.first } } });
  const brain = zeroBrain(`${nets}-policy`, `${nets}-value`);
  for (let i = 0; i < p.move; i++) { const st = G.state, [who, m] = moves[i]; const r = applyMove(shownRules, G, who, m, g.started); if (r.error) throw new Error(`${p.id}: move ${i}: ${r.error}`); brain.seen(st, who, m, r.G.state); G = r.G; }
  const s = shownRules.restore(JSON.parse(JSON.stringify(G.state))), who = moves[p.move][0];
  const r = brain.think(s, who, Number(deals), extraOf(flags)), pick = r.best;
  const bad = pick.t === p.bad.t && DECK[pick.card] === p.bad.name;
  out.push({ id: p.id, pass: !bad, pick: name(pick), top: r.list.slice(0, 4).map(o => [name(o.move), Math.round(1000 * o.mean) / 10]) });
  console.log(`${bad ? "FAIL" : "pass"}  ${p.id}: picks ${name(pick)}; ${r.list.slice(0, 4).map(o => `${name(o.move)} ${(100 * o.mean).toFixed(1)}`).join(", ")}`);
}
const passed = out.filter(x => x.pass).length;
console.log(`suite: ${passed} of ${out.length} passed (nets ${nets}, ${deals} deals, ${flags || "no flags"})`);
if (asJson) console.log(JSON.stringify({ nets, deals: Number(deals), flags, passed, of: out.length, positions: out }));
