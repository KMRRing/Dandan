// Zero's training loop, AlphaZero's way and on its own (17 Nov 2026, Korbi: "make sure the incremental upgrades as per
// alphazero are in place so dandan can be trained more"). One step a run, from lab/zero/loop.json (its state, kept in the
// repository); .github/workflows/zero-loop.yml runs it every hour, commits what it wrote and dispatches what it asks for.
//
//   play   the filler plays the champion against itself (lab/filler.json); once `games` new games are in, train
//   train  zero-train-ext.yml, warm from the champion, on the games of this generation and the one before (the window)
//   gate   the new nets against the champion, 600 pairs (lab/gate.mjs: the 99% rule at 300, 600 and 1,200 pairs)
//          CROWN: the new nets are champion; the filler plays them from its next batch, and the open batch is closed
//          DROP: the champion stays; the next generation trains on a wider window (this one's games stay in it)
//          EXTEND: pairs 600 to 1,199 are queued and the gate looks again
//
// Lab only: a crowned net is the lab's champion, never the game's; the game's Monte changes only on Korbi's word.
// It prints what it did; lines "DISPATCH <workflow> <key=value>…" are for the workflow to run.
// usage: node lab/zero/loop.mjs [--dry]    (reads the store as lab/lib.mjs does)
import fs from "node:fs";
import { labStore } from "../lib.mjs";
import { gate } from "../gate.mjs";

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
function queueGate(id, pairs, from) {
  const spec = { id, script: "hard-match.mjs", args: `{shard} {shards} {out} ${side(L.challenger)} ${side(L.champion)} ${L.deals} ${pairs} ${L.gateSeed + 1000 * L.gen} ${from}`, shards: (pairs - from) / 5, timeoutMin: 200,
    purpose: `Zero's loop (lab/zero/loop.mjs), generation ${L.gen}'s gate: ${L.challenger} (warm from ${L.champion}) against the champion ${L.champion}, pairs ${from} to ${pairs - 1}, ${L.deals} deals; lab/gate.mjs's 99% rule. Lab only: the game's Monte changes on Korbi's word` };
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
    L.gateId = `zl-${L.challenger}`;
    queueGate(L.gateId, 600, 0);
    L.phase = "gate";
    log(`generation ${L.gen}: ${L.challenger} trained; gate ${L.gateId} queued`);
  } else if (Date.now() - Date.parse(L.trained.at) > 12 * 3600e3) log(`generation ${L.gen}: no nets for ${L.challenger} 12 hours after training began: look at zero-train-ext.yml's runs`);
  else say(`generation ${L.gen}: ${L.challenger} still training (since ${L.trained.at})`);
} else if (L.phase === "gate") {
  const byPair = new Map();
  for (const id of [L.gateId, `${L.gateId}x`]) for (const name of (await store.list(`results/${id}/`)).filter(x => /\/part-\d+\.jsonl$/.test(x)))
    for (const l of ((await store.get(name)) || "").split("\n")) if (l) { const r = JSON.parse(l); byPair.set(r.pair, r.a); }
  const word = gate(byPair), w = word.split(" ")[0];
  say(`generation ${L.gen}: ${L.challenger} against ${L.champion}: ${byPair.size} pairs in, ${word}`);
  if (w === "EXTEND" && !L.extended) { queueGate(`${L.gateId}x`, 1200, 600); L.extended = true; log(`generation ${L.gen}: gate extended to 1,200 pairs`); }
  else if (w === "CROWN" || w === "DROP") {
    const score = [...byPair.values()].reduce((a, b) => a + b, 0) / byPair.size;
    L.history = [...(L.history || []), { gen: L.gen, challenger: L.challenger, champion: L.champion, word, pairs: byPair.size, score: Math.round(1e4 * score) / 1e4, at: now }];
    if (w === "CROWN") {
      log(`generation ${L.gen}: ${L.challenger} CROWNED over ${L.champion} (${(100 * score).toFixed(1)}%); the filler plays it from its next batch`);
      L.champion = L.challenger;
      F.args = F.args.replace(/\S+-policy \S+-value/, `${L.champion}-policy ${L.champion}-value`);
      F.purpose = `Filler: Zero's loop (lab/zero/loop.mjs) plays the lab's champion ${L.champion} against itself; games for the next generation. ${F.purpose.replace(/^Filler[^.]*\.\s*/, "")}`.slice(0, 1500);
      if (!dry) fs.writeFileSync(FILLER, JSON.stringify(F, null, 2) + "\n");
      // the rule (Fable, 16 Nov): when anything goes live, close the open filler batch: it was made with the old nets
      const open = await games(L.nextFrom), ids = open.map(b => b.id);
      if (ids.length && !dry) fs.appendFileSync(`${QUEUE}retire.txt`, ids.map(id => `${id}  # ${now} Zero's loop: made with the old champion's nets\n`).join(""));
      if (ids.length) say(`RETIRE ${ids.join(" ")}`);
      L.windowFrom = L.genFrom;   // the window: the generation just played and the next
      L.genFrom = open.length ? open[open.length - 1].n + 1 : L.nextFrom;
    } else {
      log(`generation ${L.gen}: ${L.challenger} dropped against ${L.champion} (${(100 * score).toFixed(1)}%); the window widens`);
      L.genFrom = L.nextFrom;   // the window keeps its start: the next challenger learns from this generation's games too
    }
    L.gen++; L.phase = "play"; delete L.extended; delete L.gateId; delete L.challenger;
  }
}
save();
