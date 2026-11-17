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
const nets = name => fs.existsSync(`${here}nets/${name}-policy.json`) && fs.existsSync(`${here}nets/${name}-value.json`);
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
  if (total >= L.games) {
    L.challenger = `${L.prefix}${L.gen}`;
    // the window: this generation's games and the one before's, at most maxWindow games (the oldest batches go first)
    const all = await games(L.windowFrom);
    while (all.length > 1 && all.reduce((x, b) => x + b.games, 0) - all[0].games >= L.maxWindow) all.shift();
    const window = all.map(b => b.id);
    L.trained = { from: window, at: now };
    L.phase = "train";
    log(`generation ${L.gen}: training ${L.challenger} warm from ${L.champion} on ${window.join(",")}`);
    say(`DISPATCH zero-train-ext.yml games=${window.join(",")} name=${L.challenger} init=${L.champion} value=${L.value}${L.trainArgs ? " " + L.trainArgs : ""}`);
    L.nextFrom = got.length ? got[got.length - 1].n + 1 : L.genFrom;   // the next generation's first batch
  }
} else if (L.phase === "train") {
  if (nets(L.challenger)) {
    const prev = L.champion;
    L.champion = L.challenger;
    F.args = F.args.replace(/\S+-policy \S+-value/, `${L.champion}-policy ${L.champion}-value`);
    F.purpose = `Filler: Zero's loop (lab/zero/loop.mjs) plays the latest nets ${L.champion} against themselves; games for the next generation. ${F.purpose.replace(/^Filler[^.]*\.\s*/, "")}`.slice(0, 1500);
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
    try { const t = execSync(`node ${here}../suite.mjs ${L.champion} 256 ${L.flags} --json`, { encoding: "utf8", timeout: 20 * 60e3 }); suite = JSON.parse(t.trim().split("\n").pop()); say(`suite: ${suite.passed} of ${suite.of} passed`); }
    catch (e) { say(`suite: did not run (${String(e.message).slice(0, 120)})`); }
    L.history = [...(L.history || []), { gen: L.gen, nets: L.champion, from: prev, window: L.trained.from, at: now, ...(suite ? { suite: `${suite.passed}/${suite.of}`, failed: suite.positions.filter(x => !x.pass).map(x => x.id) } : {}) }];
    L.windowFrom = L.genFrom;   // the window: the generation just played and the next
    L.genFrom = open.length ? open[open.length - 1].n + 1 : L.nextFrom;
    L.gen++; L.phase = "play"; delete L.challenger;
  } else if (Date.now() - Date.parse(L.trained.at) > 12 * 3600e3) log(`generation ${L.gen}: no nets for ${L.challenger} 12 hours after training began: look at zero-train-ext.yml's runs`);
  else say(`generation ${L.gen}: ${L.challenger} still training (since ${L.trained.at})`);
}
save();
