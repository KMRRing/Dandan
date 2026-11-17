// Zero's training loop, AlphaZero's way and on its own (17 Nov 2026, Korbi: "make sure the incremental upgrades as per
// alphazero are in place so dandan can be trained more"). One step a run, from lab/zero/loop.json (its state, kept in the
// repository); .github/workflows/zero-loop.yml runs it every hour, commits what it wrote and dispatches what it asks for.
//
//   play   the filler plays the latest nets against themselves (lab/filler.json); once `games` new games are in, train
//   train  zero-train-ext.yml, warm from the latest nets (training carries on from them: the net grows cumulatively), on
//          the games of this generation and the one before (the window, at most maxWindow games)
//   next   no gate (Korbi, 17 Nov 11:46: "no gates. it will always be the most recent model playing"; AlphaZero's way): once
//          the nets are in, the filler plays them from its next batch and the open batch is closed. No yardstick match
//          (Korbi, 17 Nov 13:09: "matches are for training not for demonstrating competence"; yardEvery 0): each
//          generation is measured for free by Monte's test suite and the null-move rate of its games
//
// The general line (17 Nov 2026, Korbi: "loop on general line … asap"; loop.json line "general"): the filler plays the general
// Monte (zero-play.mjs gen:<nets>), general-train.yml trains warm from it (init) with the Scry 1.2 in loop.json scry, the suite
// runs gen:<nets>. The first general generation may read against the old line's nets (vs=<old>:10): the rival's kind is its own.
//
// Lab only: a crowned net is the lab's champion, never the game's; the game's Monte changes only on Korbi's word.
// It prints what it did; lines "DISPATCH <workflow> <key=value>…" are for the workflow to run.
// usage: node lab/zero/loop.mjs [--dry]    (reads the store as lab/lib.mjs does)
import fs from "node:fs";
import { execSync } from "node:child_process";
import { labStore } from "../lib.mjs";

const here = new URL(".", import.meta.url).pathname, LOOP = `${here}loop.json`, FILLER = `${here}../filler.json`, QUEUE = `${here}../queue/`;
const dry = process.argv.includes("--dry"), now = new Date().toISOString();
const L = JSON.parse(fs.readFileSync(LOOP, "utf8"));
const say = (...a) => console.log(...a), save = () => { if (!dry) fs.writeFileSync(LOOP, JSON.stringify(L, null, 2) + "\n"); };
const log = msg => { L.log = [...(L.log || []).slice(-40), `${now} ${msg}`]; say(msg); };
if (!L.on) { say("the loop is off (lab/zero/loop.json: on false)"); process.exit(0); }

const store = await labStore(), F = JSON.parse(fs.readFileSync(FILLER, "utf8"));
const batch = n => `${F.prefix}${String(n).padStart(3, "0")}`, perShard = F.games / F.shards;
/** Games finished in the filler's batches from number `from` on, by batch (a batch with no part yet ends the list). */
async function games(from) {
  const out = [];
  for (let n = from; ; n++) {
    const parts = (await store.list(`results/${batch(n)}/`)).filter(x => /\/part-\d+\.jsonl$/.test(x)).length;
    if (!parts) break;
    out.push({ id: batch(n), n, games: parts * perShard });
  }
  return out;
}
/** The latest nets' score against the previous ones (Korbi 17 Nov: 1 game in 10 of self-play, zero-play.mjs vs=): the games
 *  of this generation's batches whose line says vs. Every one of them trains as any other. */
async function vsScore(from) {
  let n = 0, won = 0;
  for (const b of await games(from)) for (const name of (await store.list(`results/${b.id}/`)).filter(x => /\/part-\d+\.jsonl$/.test(x))) {
    const t = (await store.get(name)) || "";
    for (const l of t.split("\n")) {
      if (!l.includes('"vs":')) continue;
      const o = JSON.parse(l);
      if (o.game == null || !o.vs) continue;
      n++; won += o.winner === 1 - o.vs.seat ? 1 : o.winner === o.vs.seat ? 0 : 0.5;
    }
  }
  return { n, score: n ? won / n : null };
}
const GEN = L.line === "general", ref = name => (GEN ? `gen:${name}` : name);
// the belief (loop.json belief): "scry12" goes with the nets as packed; "scryg", the general dealer, trains every generation too
// (scryg-train.yml, warm from the latest: Korbi 17 Nov 17:27, "go full general"), and a generation is ready when all three are in
const BELIEF = L.belief || "scry12";
const nets = name => (GEN ? ["gpolicy", "gvalue", BELIEF] : ["policy", "value"]).every(k => fs.existsSync(`${here}nets/${name}-${k}.json`));
const side = name => `zero~${name}-value~${name}-policy~${L.flags}`;
function queueYard(id) {
  const spec = { id, script: "hard-match.mjs", args: `{shard} {shards} {out} ${side(L.champion)} ${side(L.yard)} ${L.deals} ${L.yardPairs} ${L.yardSeed} 0`, shards: L.yardPairs / 5, timeoutMin: 200,
    purpose: `Zero's loop (lab/zero/loop.mjs) yardstick, generation ${L.gen}: the latest nets ${L.champion} against the fixed ${L.yard}, ${L.yardPairs} pairs, ${L.deals} deals, the same deals every time. It decides nothing (no gates: Korbi, 17 Nov): it shows whether the line climbs. Lab only: the game's Monte changes on Korbi's word` };
  if (!dry) fs.writeFileSync(`${QUEUE}${id}.json`, JSON.stringify(spec) + "\n");
  say(`QUEUE ${id}`);
}

if (L.phase === "play") {
  const got = await games(L.genFrom), total = got.reduce((a, b) => a + b.games, 0);
  say(`generation ${L.gen}: ${total} of ${L.games} games in (${got.map(b => `${b.id} ${b.games}`).join(", ") || "none yet"})`);
  // the Fleet page's Loop view reads this: games in now, and the pace (the last 24 readings, one a step)
  const pace = (L.progress?.gen === L.gen ? L.progress.pace || [] : []).concat([[now, total]]).slice(-24);
  L.progress = { gen: L.gen, games: total, of: L.games, at: now, nets: L.champion, pace };
  if (total >= L.games) {
    // the reading: the nets that played this generation against the ones before them
    if (L.vsEvery) { const v = await vsScore(L.genFrom); if (v.n) { log(`generation ${L.gen}: ${L.champion} against ${L.previous || "?"}: ${(100 * v.score).toFixed(1)}% over ${v.n} games`); L.reading = { nets: L.champion, against: L.previous, ...v }; } }
    L.challenger = `${L.prefix}${L.gen}`;
    // the window: this generation's games and the one before's, at most maxWindow games (the oldest batches go first)
    const all = await games(L.windowFrom);
    while (all.length > 1 && all.reduce((x, b) => x + b.games, 0) - all[0].games >= L.maxWindow) all.shift();
    const window = all.map(b => b.id);
    L.trained = { from: window, at: now };
    L.phase = "train";
    log(`generation ${L.gen}: training ${L.challenger} warm from ${L.champion} on ${window.join(",")}`);
    if (GEN && BELIEF === "scryg") {
      // the policy and value packed with the latest dealer's beliefs; the dealer trained on the same games, warm from the latest
      say(`DISPATCH general-train.yml games=${window.join(",")} name=${L.challenger} init=${L.champion} scry=${L.champion} belief=scryg value=${L.value}${L.trainArgs ? " " + L.trainArgs : ""}`);
      say(`DISPATCH scryg-train.yml games=${window.join(",")} name=${L.challenger} init=${L.champion}${L.beliefArgs ? " " + L.beliefArgs : ""}`);
    } else if (GEN) say(`DISPATCH general-train.yml games=${window.join(",")} name=${L.challenger} init=${L.champion} scry=${L.scry} value=${L.value}${L.trainArgs ? " " + L.trainArgs : ""}`);
    else say(`DISPATCH zero-train-ext.yml games=${window.join(",")} name=${L.challenger} init=${L.champion} value=${L.value}${L.trainArgs ? " " + L.trainArgs : ""}`);
    L.nextFrom = got.length ? got[got.length - 1].n + 1 : L.genFrom;   // the next generation's first batch
  }
} else if (L.phase === "train") {
  if (nets(L.challenger)) {
    const prev = L.champion;
    L.champion = L.challenger;
    // the nets the filler plays: "<name>-policy <name>-value" on the old line, "gen:<name> -" on the general
    F.args = F.args.replace(/(\{seed\} )\S+ \S+/, GEN ? `$1gen:${L.champion} -` : `$1${L.champion}-policy ${L.champion}-value`);
    // 1 game in vsEvery against the nets just replaced (Korbi 17 Nov): the next generation's reading, its games training as any
    if (L.vsEvery) F.args = `${F.args.replace(/ vs=\S+/, "")} vs=${L.prevLine === "old" ? prev : ref(prev)}:${L.vsEvery}`;
    L.previous = prev; delete L.prevLine;
    F.purpose = `Filler: Zero's loop (lab/zero/loop.mjs) plays the latest nets ${L.champion} against themselves; games for the next generation. ${F.purpose.replace(/^Filler:.*?games for the next generation\.\s*/, "").replace(/^mjs\) plays .*?games for the next generation\.\s*/, "").replace(/^\d*\), 1 decision in/, "1 decision in")}`.slice(0, 1500);
    if (!dry) fs.writeFileSync(FILLER, JSON.stringify(F, null, 2) + "\n");
    // the rule (Fable, 16 Nov): when anything goes live, close the open filler batch: it was made with the old nets
    const open = await games(L.nextFrom), ids = open.map(b => b.id);
    if (ids.length && !dry) fs.appendFileSync(`${QUEUE}retire.txt`, ids.map(id => `${id}  # ${now} Zero's loop: made with the nets before ${L.champion}\n`).join(""));
    if (ids.length) say(`RETIRE ${ids.join(" ")}`);
    log(`generation ${L.gen}: ${L.champion} (warm from ${prev}) plays from the filler's next batch`);
    if (L.yardEvery && L.gen % L.yardEvery === 0) queueYard(`zy-${L.champion}`);
    // the null-move rate of the generation just played (lab/null-count.mjs; Korbi: a measure, never a rule), read on GitHub
    say(`DISPATCH lab-read.yml script=null-count.mjs args=0_1_-_${L.trained.from.join(",")}`);
    // Monte's test suite on the new nets (lab/suite.json: the positions Korbi flagged), kept with the generation
    let suite = null;
    try { const t = execSync(`node ${here}../suite.mjs ${ref(L.champion)} 256 ${L.flags} --json`, { encoding: "utf8", timeout: 20 * 60e3 }); suite = JSON.parse(t.trim().split("\n").pop()); say(`suite: ${suite.passed} of ${suite.of} passed`); }
    catch (e) { say(`suite: did not run (${String(e.message).slice(0, 120)})`); }
    L.history = [...(L.history || []), { gen: L.gen, nets: L.champion, from: prev, window: L.trained.from, at: now, ...(L.reading ? { reading: L.reading } : {}), ...(suite ? { suite: `${suite.passed}/${suite.of}`, failed: suite.positions.filter(x => !x.pass).map(x => x.id) } : {}) }];
    L.windowFrom = L.genFrom;   // the window: the generation just played and the next
    L.genFrom = open.length ? open[open.length - 1].n + 1 : L.nextFrom;
    L.gen++; L.phase = "play"; delete L.challenger;
  } else if (Date.now() - Date.parse(L.trained.at) > 12 * 3600e3) log(`generation ${L.gen}: no nets for ${L.challenger} 12 hours after training began: look at zero-train-ext.yml's runs`);
  else say(`generation ${L.gen}: ${L.challenger} still training (since ${L.trained.at})`);
}
save();
