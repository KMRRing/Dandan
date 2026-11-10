// The GPU spike's cut-down Dandan, one game at a time on a CPU core, written the way the real engine is (branching,
// one game's state in plain numbers). lab/gpu/mini.py plays the same game as array maths on many games at once; both must
// give the same games from the same seeds (lab/GPU-SPIKE.md).
//
// The game: one shared library of 60 (26 Islands, 12 Dandân, 10 Memory Lapse, 12 Chart, "draw two"). Each player draws
// seven. A turn: untap, draw (an empty library loses), play an Island if one is in hand, then up to three times cast a
// Dandân or a Chart (two mana each) or stop, chosen at random; the other player counters it with Memory Lapse (two mana,
// seven times in ten when able), which puts the spell on top of the library. Then the Dandâns that were there at the
// start of the turn attack for 4 each. 60 turns without a winner is a draw.
// Randomness: xorshift32 per game, and every turn draws exactly six numbers whatever happens, so the batched version,
// which draws them for every game at once, keeps in step.
//
// usage: node lab/gpu/mini.mjs [games 20000] [check-out.jsonl]

export const I = 0, D = 1, L = 2, C = 3;
export const MAX_TURNS = 60;

const next = g => { let x = g.x; x ^= (x << 13) >>> 0; x >>>= 0; x ^= x >>> 17; x ^= (x << 5) >>> 0; x >>>= 0; g.x = x; return x; };

export function deal(seed) {
  const lib = [];
  for (const [card, n] of [[I, 26], [D, 12], [L, 10], [C, 12]]) for (let k = 0; k < n; k++) lib.push(card);
  const g = { x: (seed * 2654435761 >>> 0) || 1, lib, p: 60, hand: [[0, 0, 0, 0], [0, 0, 0, 0]], lands: [0, 0], mana: [0, 0], dan: [0, 0], sick: [0, 0], life: [20, 20], winner: -1, turn: 0, over: false };
  // shuffled with the game's own numbers (Fisher–Yates from the top)
  for (let a = 59; a > 0; a--) { const b = next(g) % (a + 1); [g.lib[a], g.lib[b]] = [g.lib[b], g.lib[a]]; }
  for (let k = 0; k < 7; k++) for (const s of [0, 1]) g.hand[s][g.lib[--g.p]]++;
  return g;
}

/** One card off the top for seat s; false (and the game lost) when there is none. */
function draw(g, s) {
  if (g.p === 0) { g.over = true; g.winner = 1 - s; return false; }
  g.hand[s][g.lib[--g.p]]++;
  return true;
}

export function turn(g) {
  const a = g.turn % 2, o = 1 - a;
  g.mana[a] = g.lands[a]; g.dan[a] += g.sick[a]; g.sick[a] = 0;
  if (!draw(g, a)) return;
  if (g.hand[a][I] > 0) { g.hand[a][I]--; g.lands[a]++; g.mana[a]++; }
  let stopped = false;
  for (let k = 0; k < 3; k++) {
    const r1 = next(g), r2 = next(g);
    if (stopped || g.over) continue;
    const opts = [];
    if (g.mana[a] >= 2 && g.hand[a][D] > 0) opts.push(D);
    if (g.mana[a] >= 2 && g.hand[a][C] > 0) opts.push(C);
    const pick = r1 % (opts.length + 1);
    if (pick === opts.length) { stopped = true; continue; }
    const card = opts[pick];
    g.mana[a] -= 2; g.hand[a][card]--;
    if (g.hand[o][L] > 0 && g.mana[o] >= 2 && r2 % 10 < 7) { g.hand[o][L]--; g.mana[o] -= 2; g.lib[g.p++] = card; continue; }
    if (card === D) g.sick[a]++;
    else { if (!draw(g, a)) return; if (!draw(g, a)) return; }
  }
  if (g.over) return;
  if (g.dan[a] > 0 && g.lands[o] > 0) { g.life[o] -= 4 * g.dan[a]; if (g.life[o] <= 0) { g.over = true; g.winner = a; return; } }
  g.turn++;
  if (g.turn >= MAX_TURNS) { g.over = true; g.winner = 2; }
}

export function play(seed) {
  const g = deal(seed);
  while (!g.over) turn(g);
  return { seed, winner: g.winner, turns: g.turn, life: g.life };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2] ?? 20000), out = process.argv[3];
  const t0 = process.hrtime.bigint(), rows = [];
  for (let s = 1; s <= n; s++) rows.push(play(s));
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  if (out) (await import("node:fs")).writeFileSync(out, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
  const wins = [0, 0, 0]; for (const r of rows) wins[r.winner]++;
  console.log(JSON.stringify({ engine: "js, one core", games: n, seconds: +sec.toFixed(3), gamesPerSec: Math.round(n / sec), wins }));
}
