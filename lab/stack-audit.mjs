// How Medium handles the stack (Korbi, 11 November 2026: "they literally try to make their own memory lapse fizzle"). Plays
// Medium against Medium (tempo against squeeze, both seats) and, at every decision with a spell on the stack, sorts the move:
//   wasted: a counter at a spell already countered or fizzling, or a removal at a permanent our own spell below already takes
//           (the card for nothing: passing keeps it, and we get priority again before anything resolves);
//   unprotected: our spell is about to be countered, we can answer the counter, and we pass;
//   their counter on our counter: what we do (counter theirs, counter the original again, pass);
//   their spell resolving while we could counter it: how often we let it, by spell.
// The stack's fate is worked out here independently of the policy's own (stackFate), so it checks it too.
// usage: node lab/stack-audit.mjs [games 200] [dir .]   (dir: another checkout, to compare with the code before a change)
import path from "node:path";
import { J } from "./lib.mjs";
const [games = 200, dir = "."] = process.argv.slice(2).map((x, i) => i === 1 ? x : Number(x));
const root = path.resolve(dir);
const { rules } = await import(`${root}/dandan-rules.js`), { newRecord, applyMove, seeded, mix } = await import(`${root}/seats.js`);
const { policyMove } = await import(`${root}/dandan-policy.js`), { moves } = await import(`${root}/dandan-engine.js`);
const { DECK } = await import(`${root}/dandan-cards.js`), { moveName } = await import(`${root}/dandan-words.js`);

const COUNTERS = new Set(["Memory Lapse", "Commit", "Narset's Reversal"]);
const TAKES = new Set(["Repulse", "Commit", "Metamorphose", "Gone Missing", "Deem Inferior"]);
const half = m => (m.t === "cast" ? (m.from === "yard" ? "Memory" : DECK[m.card].split(" // ")[0]) : null);
/** Top first: which spells are taken off (gone), which fizzle, which permanents are taken by whom. */
function fate(s) {
  const gone = new Set(), fizzle = new Set(), taken = new Map(), on = new Set(s.stack.map(y => y.sid));
  for (let i = s.stack.length - 1; i >= 0; i--) {
    const y = s.stack[i], ts = y.targets || [];
    if (gone.has(y.sid)) continue;
    if (ts.length && ts.every(t => (t.k === "s" && (!on.has(t.sid) || gone.has(t.sid))) || (t.k === "c" && taken.has(t.id)))) { fizzle.add(y.sid); continue; }
    const st = ts.find(t => t.k === "s");
    if (COUNTERS.has(y.name) && st) gone.add(st.sid);
    if (TAKES.has(y.name) || (y.name === "Piracy Charm" && y.mode === 1)) for (const t of ts) if (t.k === "c") taken.set(t.id, y.ctl);
  }
  return { gone, fizzle, taken };
}
const tally = {}, examples = {};
const note = (k, ex) => { tally[k] = (tally[k] || 0) + 1; if (ex && (examples[k] ||= []).length < 4) examples[k].push(ex); };

function look(s, seat, m) {
  if (!s.stack.length || s.pending) return;
  note("stack decisions");
  const F = fate(s), me = seat, h = half(m), say = () => `${s.stack.map(y => `${y.ctl === me ? "ours" : "theirs"}:${y.name}`).join(" < ")}  →  ${moveName(m, s, seat) || "pass"}`;
  const legal = moves(s, seat, true);
  const aimsAt = (mv, sid) => mv.targets?.some(t => t.k === "s" && t.sid === sid);
  // wasted
  if (h && COUNTERS.has(h) && h !== "Narset's Reversal") {
    const t = m.targets?.find(t => t.k === "s"), x = t && s.stack.find(y => y.sid === t.sid);
    if (x && (F.gone.has(x.sid) || F.fizzle.has(x.sid))) note("wasted: counter at a spell already countered or fizzling", say());
  }
  for (const t of m.targets || []) if (t.k === "c" && F.taken.get(t.id) === me && s.bf.find(p => p.id === t.id)?.ctl !== me) note("wasted: removal at a permanent our own spell already takes", say());
  // our spells about to be countered
  for (const x of s.stack) if (x.ctl === me && F.gone.has(x.sid)) {
    const killer = s.stack.find(y => y.ctl !== me && !F.gone.has(y.sid) && y.targets?.some(t => t.k === "s" && t.sid === x.sid));
    if (!killer) continue;
    const canAnswer = legal.some(mv => aimsAt(mv, killer.sid) && COUNTERS.has(half(mv)));
    if (!canAnswer) continue;
    note("ours about to be countered, answer in hand");
    const ourCounter = COUNTERS.has(x.name);
    if (m.t === "pass") note(`  ...passed (${ourCounter ? "our counter" : "our " + x.name})`, say());
    else if (aimsAt(m, killer.sid)) note("  ...countered their counter");
    else if (ourCounter && aimsAt(m, x.targets?.find(t => t.k === "s")?.sid)) note("  ...countered the original again", say());
    else note("  ...did something else", say());
  }
  // their spell resolving, ours to counter
  const top = s.stack[s.stack.length - 1];
  if (top.ctl !== me && !F.gone.has(top.sid) && !F.fizzle.has(top.sid) && top.kind === "spell") {
    const can = legal.some(mv => aimsAt(mv, top.sid) && half(mv) === "Memory Lapse");
    if (can) { note(`their ${top.name} on top, Lapse in hand`); if (m.t === "pass") note(`  ...let ${top.name} resolve`); }
  }
}

const realRandom = Math.random;
for (let g = 0; g < games; g++) {
  const seed = 31000 + g, styles = g % 2 ? ["tempo", "squeeze"] : ["squeeze", "tempo"];
  let G = newRecord(rules, { seats: 2, seed, now: 0 });
  for (let i = 0; i < 4000 && !rules.over(G.state); i++) {
    const who = rules.toMove(G.state), s = rules.restore(J(G.state));
    Math.random = seeded(mix(seed, i + 1));
    const m = policyMove(s, who, { style: styles[who], rng: Math.random });
    Math.random = realRandom;
    look(s, who, m);
    G = applyMove(rules, G, who, m, 0).G;
  }
}
console.log(JSON.stringify({ games, dir }, null, 0));
for (const [k, v] of Object.entries(tally)) console.log(`${String(v).padStart(6)}  ${k}`);
for (const [k, v] of Object.entries(examples)) { console.log(`\n${k}:`); for (const e of v) console.log(`   ${e}`); }
