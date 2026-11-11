// The game lab (lab.html, dandan-lab.js, dandan-engines.js): the registry's shape, the settings kept, a move shown as rings, the line that
// tells the player their coaches disagree, and an engine asked at a real decision (a Medium, and a Hard of a few deals with each of
// its judges). Quick: a few deals only. The page itself is driven by hand in a browser (README).
import fs from "fs";
import { ENGINES, engineOf, seatable, decide, judgeOf, JUDGES, DEFAULT_ENGINE } from "../dandan-engines.js";
import { ringsOf, disagreement, loadSettings, DEFAULTS, activeCoaches } from "../dandan-lab.js";
import { rules, shownRules } from "../dandan-rules.js";
import { newRecord, applyMove } from "../seats.js";
import { moves } from "../dandan-engine.js";
import { moveName } from "../dandan-words.js";
import { policyMove } from "../dandan-policy.js";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };
const load = url => Promise.resolve(JSON.parse(fs.readFileSync(new URL(url), "utf8")));

// ---------- the registry ----------
check(ENGINES.every(e => e.id && e.name && e.short && ["medium", "hard"].includes(e.kind) && e.description.length > 40 && e.expect && typeof e.available === "boolean"), "every engine has an id, names, a kind, a description and what to expect");
check(new Set(ENGINES.map(e => e.id)).size === ENGINES.length && new Set(ENGINES.map(e => e.short)).size === ENGINES.length, "ids and short names are unique (the strip names a coach by its short name)");
check(["medium-tempo", "medium-squeeze", "medium-deckout", "hard-today", "hard-jh2"].every(id => engineOf(id)), "the five engines are listed");
check(!engineOf("medium-deckout").available && /not built yet/i.test(engineOf("medium-deckout").description) && !seatable().some(e => e.id === "medium-deckout"), "the deckout Medium is listed but cannot be seated");
check(ENGINES.filter(e => e.judge).every(e => JUDGES[e.judge] && fs.existsSync(new URL(JUDGES[e.judge], new URL("../dandan-engines.js", import.meta.url)))), "every retrained judge named has its file");
check(engineOf(DEFAULT_ENGINE).kind === "hard" && engineOf(DEFAULT_ENGINE).judge === null, "Monte starts as today's Hard, with the game's own judge");

// ---------- the settings ----------
check(loadSettings(() => null).engine === DEFAULT_ENGINE && activeCoaches(loadSettings(() => null)).length === 2, "no saved choice: the live opponent, the two Mediums as coaches");
{
  const s = loadSettings(() => ({ engine: "medium-deckout", coach: { "hard-jh2": true, gone: true, "medium-deckout": true }, hide: { "hard-jh2": true }, oppDepth: "nope" }));
  check(s.engine === DEFAULT_ENGINE && !("gone" in s.coach) && !s.coach["medium-deckout"] && s.oppDepth === DEFAULTS.oppDepth, "a saved engine that is not built, or unknown, is dropped");
  check(activeCoaches(s).length === 0, "a hidden coach is not active");
}

// ---------- rings and the disagreement line ----------
const s0 = rules.restore(JSON.parse(JSON.stringify(newRecord(rules, { seats: 2, seed: 7, now: 0 }).state)));
check(ringsOf({ t: "keep" }, s0, 0).join() === "b:Keep" && ringsOf({ t: "pass" }, s0, 0).join() === "b:Pass", "keep and pass ring their buttons");
check(ringsOf({ t: "discard", cards: [3, 5] }, s0, 0).join() === "c:3,c:5" && ringsOf({ t: "attack", ids: [] }, s0, 0).join() === "b:No attack" && ringsOf({ t: "attack", ids: [9] }, s0, 0).join() === "t:c:9", "cards, no attack, an attacker");
check(ringsOf({ t: "cast", card: 1, from: "yard", targets: [{ k: "p", seat: 1 }] }, s0, 0).join() === "pile:yard,t:p:1", "a cast from the graveyard rings the pile and its target");
check(disagreement([{ short: "Hard", text: "pass" }, { short: "Tempo", text: "pass" }]) === null && disagreement([{ short: "Hard", text: "pass" }]) === null, "coaches that agree, or one coach, are not a disagreement");
check(disagreement([{ short: "Hard", text: "cast Dandân" }, { short: "Tempo", text: "pass" }, { short: "Squeeze", text: "pass" }]) === "Coaches disagree: Hard: cast Dandân · Tempo + Squeeze: pass", "the line names who picked what, the same picks together");

// ---------- an engine asked at a real decision ----------
{
  // a game played on with Medium till it is the first seat's turn to act in a main phase
  let G = newRecord(rules, { seats: 2, seed: 11, now: 0 });
  for (let i = 0; i < 400 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), st = rules.restore(JSON.parse(JSON.stringify(G.state)));
    if (who === 0 && !st.pending && st.step === "main1" && st.turn >= 3 && moves(st, 0).length > 2) break;
    G = applyMove(shownRules, G, who, policyMove(st, who), 0).G;
  }
  const st = rules.restore(JSON.parse(JSON.stringify(G.state))), seatNo = rules.toMove(st);
  const legal = m => !applyMove(shownRules, G, seatNo, m, 0).error;      // the rules themselves say whether a move is allowed
  const before = JSON.stringify(st);
  for (const e of ENGINES.filter(e => e.available)) {
    const r = await decide(e, JSON.parse(before), seatNo, { budget: { deals: 4, ms: 3000 }, load });
    check(r.move && legal(r.move) && !!moveName(r.move, st, seatNo), `${e.short} picks a legal move at a decision: ${moveName(r.move, st, seatNo)}${r.chance != null ? ` (${Math.round(r.chance * 100)}%)` : ""}`);
    check(e.kind === "hard" ? r.chance != null && r.list.length > 0 : r.chance === null, `${e.short} gives ${e.kind === "hard" ? "a win chance and the moves weighed" : "no win chance"}`);
  }
  const t0 = JSON.stringify(st), m1 = await decide(engineOf("medium-squeeze"), st, seatNo);
  check(JSON.stringify(st) === t0 && !!m1.move, "a Medium leaves the state it is given as it was");
  const j1 = await judgeOf(engineOf("hard-jh2"), load), j0 = await judgeOf(engineOf("hard-today"), load);
  check(j0 === undefined && typeof j1 === "function" && j1(st, seatNo) > 0 && j1(st, seatNo) < 1, "today's Hard has no judge of its own (the game's); jh2's is a function giving a chance");
}
process.exit(bad ? 1 : (console.log("lab: the registry, the settings, the rings, the disagreement line, and each engine at a decision"), 0));
