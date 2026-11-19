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
// since (17 Nov 2026, 19:10Z): only parts written after that time, for a batch that held games of older nets too (zps006: its name
// was made again after it was retired, so its results hold gm1's parts and gm2's)
async function games(from, since = 0) {
  const out = [];
  for (let n = from; ; n++) {
    const all = (await store.listAll(`results/${batch(n)}/`)).filter(x => /\/part-\d+\.jsonl$/.test(x.name));
    if (!all.length) break;
    const parts = all.filter(x => !since || x.t >= since).length;
    if (!parts) continue;
    // games a shard from the batch's own spec (17 Nov: 2 a shard from 2,400-game batches on, 4 before), else the filler's now
    let per = perShard;
    try { const spec = JSON.parse((await store.get(`jobs/${batch(n)}.json`)) || (await store.get(`retired/${batch(n)}.json`)) || "null"); const g = Number(spec?.args?.split(" ")[4]); if (spec?.shards && g) per = g / spec.shards; } catch {}
    out.push({ id: batch(n), n, games: parts * per, since });
  }
  return out;
}
/** The latest nets' scores against each rival (Korbi 17 Nov: 1 game in 10 against the previous nets; 18 Nov: 1 in 20 against the
 *  leaky old engine g12r-C, the yardstick the honest line has to beat): { <rival nets>: { n, score } } from this generation's
 *  batches' vs lines. A part is read once: its counts are kept in loop.json (vsParts), so a step reads only new parts (18 Nov:
 *  reading every part each step took 50 minutes and drew B2's SlowDown). */
async function vsScores(from) {
  const since = L.genSince ? Date.parse(L.genSince) : 0, cache = (L.vsParts ||= {}), out = {};
  const keep = new Set();
  for (const b of await games(from, since)) for (const name of (await store.listAll(`results/${b.id}/`)).filter(x => /\/part-\d+\.jsonl$/.test(x.name) && (!since || x.t >= since)).map(x => x.name)) {
    keep.add(name);
    if (!cache[name]) {
      const c = {};
      for (const l of ((await store.get(name)) || "").split("\n")) {
        if (!l.includes('"vs":')) continue;
        const o = JSON.parse(l);
        if (o.game == null || !o.vs) continue;
        const r = (c[o.vs.nets] ||= [0, 0]); r[0]++; r[1] += o.winner === 1 - o.vs.seat ? 1 : o.winner === o.vs.seat ? 0 : 0.5;
      }
      cache[name] = c;
    }
    for (const [nets, [n, w]] of Object.entries(cache[name])) { const r = (out[nets] ||= { n: 0, won: 0 }); r.n += n; r.won += w; }
  }
  for (const k of Object.keys(cache)) if (!keep.has(k)) delete cache[k];
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.n, score: v.n ? v.won / v.n : null }]));
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
  const got = await games(L.genFrom, L.genSince ? Date.parse(L.genSince) : 0), total = got.reduce((a, b) => a + b.games, 0);
  say(`generation ${L.gen}: ${total} of ${L.games} games in (${got.map(b => `${b.id} ${b.games}`).join(", ") || "none yet"})`);
  // the Fleet page's Loop view reads this: games in now, and the pace (the last 24 readings, one a step)
  const pace = (L.progress?.gen === L.gen ? L.progress.pace || [] : []).concat([[now, total]]).slice(-24);
  L.progress = { gen: L.gen, games: total, of: L.games, at: now, nets: L.champion, pace };
  if (total >= L.games) {
    // the reading: the nets that played this generation against the ones before them
    if (L.vsEvery || L.yardVs) {
      const all = await vsScores(L.genFrom), prevKey = ref(L.previous || ""), v = all[prevKey] || all[L.previous] || null;
      if (v?.n) { log(`generation ${L.gen}: ${L.champion} against ${L.previous || "?"}: ${(100 * v.score).toFixed(1)}% over ${v.n} games`); L.reading = { nets: L.champion, against: L.previous, ...v }; }
      const y = L.yardVs ? all[L.yardVs.split(":")[0]] : null;
      if (y?.n) { log(`generation ${L.gen}: ${L.champion} against the leaky ${L.yardVs.split(":")[0]}: ${(100 * y.score).toFixed(1)}% over ${y.n} games`); L.yardReading = { nets: L.champion, against: L.yardVs.split(":")[0], ...y }; }
    }
    L.challenger = `${L.prefix}${L.gen}`;
    // the window: every game since windowFrom, at most maxWindow games (the oldest batches go first); 18 Nov 2026: windowFrom no
    // longer moves at the crown, so the window is the last maxWindow games (about three generations): the policy trained on
    // 8 batches gave up 0.783 points against 0.820 on 4
    const all = await games(L.windowFrom);
    while (all.length > 1 && all.reduce((x, b) => x + b.games, 0) - all[0].games >= L.maxWindow) all.shift();
    // batches from outside the filler's numbering kept in the window (18 Nov 2026: zpq001, the quick test batch) until it moves past them
    const window = [...(L.extraWindow || []), ...all.map(b => b.id)];
    L.trained = { from: window, at: now };
    L.phase = "train";
    log(`generation ${L.gen}: training ${L.challenger} (${/policy_init=fresh/.test(L.trainArgs || "") ? "policy fresh, value and dealer" : ""} warm from ${L.champion}) on ${window.join(",")}`);
    if (GEN && BELIEF === "scryg") {
      // the policy and value packed with the latest dealer's beliefs; the dealer trained on the same games, warm from the latest
      // the dealer first (18 Nov 2026): the policy and value then pack with the new dealer's beliefs, the ones they play with;
      // the general training is asked for once the dealer's net is in (the train phase below)
      L.trained.dispatch = [`scryg-train.yml games=${window.join(",")} name=${L.challenger} init=${L.champion}${L.beliefArgs ? " " + L.beliefArgs : ""}`];
      // the refinement (19 Nov 2026, Korbi: deep games refine what the quick games set): the window's batches from refineFrom on
      // (the deep ones) trained again alone after the main stage, refineArgs = <epochs>:<policy lr>:<value lr>
      const deepIds = L.refineFrom ? window.filter(id => Number(id.slice(-3)) >= L.refineFrom) : [];
      const refine = deepIds.length ? ` refine=${deepIds.join("+")}:${L.refineArgs || "3:1e-4:3e-5"}` : "";
      L.trained.next = `general-train.yml games=${window.join(",")} name=${L.challenger} init=${L.champion} scry=${L.challenger} belief=scryg value=${L.value}${L.trainArgs ? " " + L.trainArgs : ""}${refine}`;
      for (const d of L.trained.dispatch) say(`DISPATCH ${d}`);
    } else if (GEN) say(`DISPATCH general-train.yml games=${window.join(",")} name=${L.challenger} init=${L.champion} scry=${L.scry} value=${L.value}${L.trainArgs ? " " + L.trainArgs : ""}`);
    else say(`DISPATCH zero-train-ext.yml games=${window.join(",")} name=${L.challenger} init=${L.champion} value=${L.value}${L.trainArgs ? " " + L.trainArgs : ""}`);
    L.nextFrom = got.length ? got[got.length - 1].n + 1 : L.genFrom;   // the next generation's first batch
  }
} else if (L.phase === "train") {
  const hasNet = k => fs.existsSync(new URL(`./nets/${L.challenger}-${k}.json`, import.meta.url));
  if (L.trained.next && hasNet(BELIEF)) {
    log(`generation ${L.gen}: ${L.challenger}'s dealer is in: its policy and value nets asked for`);
    L.trained.dispatch.push(L.trained.next); say(`DISPATCH ${L.trained.next}`);
    delete L.trained.next; L.trained.asked = new Date().toISOString(); L.trained.retries = 0;
  } else if (nets(L.challenger)) {
    const prev = L.champion;
    L.champion = L.challenger;
    // the nets the filler plays: "<name>-policy <name>-value" on the old line, "gen:<name> -" on the general
    F.args = F.args.replace(/(\{seed\} )\S+ \S+/, GEN ? `$1gen:${L.champion} -` : `$1${L.champion}-policy ${L.champion}-value`);
    // 1 game in vsEvery against the nets just replaced (Korbi 17 Nov): the next generation's reading, its games training as any
    // vsExtra (19 Nov 2026): further rivals kept across crowns, e.g. "noprior:4" (the prior head-to-head, Korbi)
    if (L.vsEvery) F.args = `${F.args.replace(/ vs=\S+/, "")} vs=${L.prevLine === "old" ? prev : ref(prev)}:${L.vsEvery}${L.yardVs ? "," + L.yardVs : ""}${L.vsExtra ? "," + L.vsExtra : ""}`;
    L.previous = prev; delete L.prevLine;
    // deep self-play from generation deepFrom on (19 Nov 2026, Korbi: quick sets the direction, deep refines it): the filler plays
    // deep (deepDeals a move, deepFlags) and deepGames a generation, 8 a shard; F.games stays as it was, as it spaces the seeds;
    // those batches are trained again alone after the main stage (refineFrom)
    if (L.deepFrom && L.gen + 1 >= L.deepFrom && !L.deepOn) {
      F.args = F.args.replace(/(\{out\} )\d+ \d+/, `$1${L.deepDeals || 1024} ${L.deepGames || 2400}`);
      for (const f of (L.deepFlags || "deepmax=4 early=256:0.03:6,512:0.02").split(" ")) { const k = f.split("=")[0]; F.args = F.args.includes(` ${k}=`) ? F.args.replace(new RegExp(` ${k}=\\S+`), ` ${f}`) : `${F.args} ${f}`; }
      F.shards = Math.ceil((L.deepGames || 2400) / 8); L.games = L.deepGames || 2400; L.deepOn = true; L.refinePending = true;
      log(`generation ${L.gen + 1}: deep self-play from here (${L.deepDeals || 1024} deals, ${L.games} games)`);
    }
    F.purpose = `Filler: Zero's loop (lab/zero/loop.mjs) plays the latest nets ${L.champion} against themselves; games for the next generation. ${F.purpose.replace(/^Filler:.*?games for the next generation\.\s*/, "").replace(/^mjs\) plays .*?games for the next generation\.\s*/, "").replace(/^\d*\), 1 decision in/, "1 decision in")}`.slice(0, 1500);
    if (!dry) fs.writeFileSync(FILLER, JSON.stringify(F, null, 2) + "\n");
    // the rule (Fable, 16 Nov): when anything goes live, close the open filler batch: it was made with the old nets
    // every batch of the finished generation still being played is closed (18 Nov 2026, 01:30Z: from nextFrom only, the batch the
    // fleet was on when training began, zps008, stayed open, and the fleet played the old nets for hours after the crown); a
    // finished one moves to retired/ too, harmlessly
    const open = await games(L.genFrom), ids = open.map(b => b.id);
    if (ids.length && !dry) fs.appendFileSync(`${QUEUE}retire.txt`, ids.map(id => `${id}  # ${now} Zero's loop: made with the nets before ${L.champion}\n`).join(""));
    if (ids.length) say(`RETIRE ${ids.join(" ")}`);
    log(`generation ${L.gen}: ${L.champion} (warm from ${prev}) plays from the filler's next batch`);
    if (L.yardEvery && L.gen % L.yardEvery === 0) queueYard(`zy-${L.champion}`);
    // the null-move rate of the generation just played (lab/null-count.mjs; Korbi: a measure, never a rule), read on GitHub
    say(`DISPATCH lab-read.yml script=null-count.mjs args=0_1_-_${L.trained.from.join(",")}`);
    // a net that came out as its warm start (18 Nov 2026: gm2's policy went unchanged through zl15 and zl16, zl16's value
    // through zl17, unseen for three generations) is said loudly
    for (const k of GEN ? ["gpolicy", "gvalue"] : []) {
      try { const m = JSON.parse(fs.readFileSync(new URL(`./nets/${L.champion}-${k}.json`, import.meta.url))).metrics || {};
        if (m.epoch === 0) say(`WARNING: ${L.champion}-${k} is its warm start unchanged (no epoch beat it on the held-out games)`); } catch {}
    }
    // the nets' scorecard (18 Nov 2026, Korbi 14:11 local): the new nets beside the last two on the newest games' held-out seeds
    if (GEN) { const names = [...new Set([...(L.history || []).map(h => h.nets), L.previous, L.champion].filter(Boolean))].slice(-3)
        .concat(fs.existsSync(new URL(`./nets/${L.champion}m-gpolicy.json`, import.meta.url)) ? [`${L.champion}m`] : []).join(",");   // a refined generation's main-stage nets too (19 Nov: Fable)   // L.previous too (19 Nov: zl18b, crowned by hand, was missing from history, so zl19 was scored beside zl16 and zl17)
      say(`DISPATCH net-scorecard.yml nets=${names} games=${L.trained.from.slice(-2).join(",")}`); }
    // Monte's test suite on the new nets (lab/suite.json: the positions Korbi flagged), kept with the generation
    let suite = null;
    try { const t = execSync(`node ${here}../suite.mjs ${ref(L.champion)} 256 ${L.flags} --json`, { encoding: "utf8", timeout: 20 * 60e3 }); suite = JSON.parse(t.trim().split("\n").pop()); say(`suite: ${suite.passed} of ${suite.of} passed`); }
    catch (e) { say(`suite: did not run (${String(e.message).slice(0, 120)})`); }
    L.history = [...(L.history || []), { gen: L.gen, nets: L.champion, from: prev, window: L.trained.from, at: now, ...(L.reading ? { reading: L.reading } : {}), ...(L.yardReading ? { yard: L.yardReading } : {}), ...(suite ? { suite: `${suite.passed}/${suite.of}`, failed: suite.positions.filter(x => !x.pass).map(x => x.id) } : {}) }];
    // windowFrom stays (the window is trimmed to maxWindow games instead); the batches outside the filler's numbering train
    // one generation only
    delete L.extraWindow;
    L.genFrom = open.length ? open[open.length - 1].n + 1 : L.nextFrom;
    if (L.refinePending) { L.refineFrom = L.genFrom; delete L.refinePending; }
    L.gen++; L.phase = "play"; delete L.challenger; delete L.genSince; delete L.reading; delete L.yardReading;
  } else if (Date.now() - Date.parse(L.trained.at) > 12 * 3600e3) log(`generation ${L.gen}: no nets for ${L.challenger} 12 hours after training began: look at zero-train-ext.yml's runs`);
  // the training asked for again when its nets are 150 minutes late (19 Nov: 100 until then; the fresh policy on the long window
  // takes about 100 minutes, so a needless second run started at 08:43Z, two minutes before zl19's nets landed) (18 Nov: a refused dispatch left generation 16 waiting two
  // hours); twice at most, the nets that are already in are kept (the runs commit only their own files)
  // the clock runs from the last request (18 Nov: a request by hand at 07:20Z was followed by a needless second one at 07:28Z)
  else if (L.trained.dispatch && Date.now() - Date.parse(L.trained.asked || L.trained.at) > 150 * 60e3 && (L.trained.retries || 0) < 2) {
    L.trained.retries = (L.trained.retries || 0) + 1; L.trained.asked = new Date().toISOString();
    log(`generation ${L.gen}: ${L.challenger}'s nets are late: training asked for again (${L.trained.retries})`);
    const have = n => fs.existsSync(new URL(`./nets/${L.challenger}-${n}.json`, import.meta.url));
    for (const d of L.trained.dispatch) if (d.startsWith("general") ? !(have("gpolicy") && have("gvalue")) : !have("scryg")) say(`DISPATCH ${d}`);
  }
  else say(`generation ${L.gen}: ${L.challenger} still training (since ${L.trained.at})`);
}
save();
