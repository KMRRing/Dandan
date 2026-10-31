// Dandan's reading of a player's hand from their play, at every decision that can show something: a pass with an
// opposing spell on the stack, at the end of one's own main phases, at the end of the other player's turn, with an
// attack about to be damaged (the engine's passPoints, kept whether the player was asked there or had nothing to do).
// A card is ruled out of the hand they held then when a player holding it would clearly have played it: for each card
// they might hold (one the other player hasn't seen), a hand with it is dealt as the other player would deal it, the
// best move it gives (by Medium's scores) is set against the pass, and if it looks worth more, both are played out in
// a few deals, from the passing player's side (the other hand dealt as they would deal it, so nothing they couldn't
// know decides it), and judged; a card is ruled out when its move comes out clearly ahead. Moves that come out alike
// show nothing: a player may have had a reason. dandan-reads.js reads what this rules out (a card drawn since may be
// one of them, and a person may hold a card back anyway: the slip). Pure functions, run once per move of a real game by
// dandan-rules.js.
import { act, moves } from "./dandan-engine.js";
import { CARDS, DECK, NAMES, HALVES, parseCost, total } from "./dandan-cards.js";
import { other } from "./dandan-core.js";
import { Player, PASS, facts, unseenOf, openMana } from "./dandan-policy.js";
import { determinize, fork, playOut } from "./dandan-think.js";
import { seeded, mix } from "./seats.js";

/** What a card's move must score over passing (Medium's cards) to be played out; how far ahead (the judge's chance) to rule the card out. */
const PREFILTER = 0.4, MARGIN = 0.05;
/**
 * Deals each card is played out in. How far, and how many cards at most: a pass with a spell on the stack to the start
 * of the turn after next (a counter's worth shows when the card it put on top is drawn), the one Medium likes most;
 * the rest to the start of the next turn (a card cast at the end of the main phases, or not, is plain by then), two.
 */
const DEALS = 6;
const horizon = s => (s.stack.length ? 2 : 1), played = s => (s.stack.length ? 1 : 2);
/** The lands are one card here: any of them would have been played. */
const LAND = new Set(NAMES.filter(n => CARDS[n]?.type === "land"));
const GROUPS = [[...LAND], ...NAMES.filter(n => !LAND.has(n)).map(n => [n])];

/** A seed from the game and the seat, so the same pass is read the same way on any phone. */
const seedOf = (s, seat) => mix((s.ln || 0) * 131 + (s.nid || 0) * 7 + seat, (s.turn || 0) * 977 + s.lib.length);

/**
 * The dealt game `c` with the card `id` in `seat`'s hand: dealt there already, or swapped in from the library for a
 * hidden card of the hand at random. null when it can't be (no hand to swap into).
 */
function holding(c, seat, id, rng) {
  if (c.hand[seat].includes(id)) return c;
  const at = c.lib.indexOf(id);
  if (at < 0 || !c.hand[seat].length) return null;
  const j = Math.floor(rng() * c.hand[seat].length);
  [c.hand[seat][j], c.lib[at]] = [id, c.hand[seat][j]];
  return c;
}
/** The other copies of a group the reader hasn't seen: card ids in the library or the hidden hand (where they may be). */
function unseenIds(s, seat, names) {
  const out = [], reader = other(seat);
  const seen = id => (s.kh?.find(e => e[0] === id)?.[1] ?? 0) & (1 << reader);
  for (const id of s.hand[seat]) if (names.includes(DECK[id]) && !seen(id)) out.push(id);
  for (const id of s.lib) if (names.includes(DECK[id]) && !((s.kn.find(e => e[0] === id)?.[1] ?? 0) & (1 << reader))) out.push(id);
  return out.sort((a, b) => a - b);
}

/**
 * What a pass by `seat` at `pre` (the game as it stood) rules out of its hand: the names, or none. Read from the other
 * seat's side: what it knows, and the rest dealt.
 */
export function readPass(pre, seat, { deals = DEALS } = {}) {
  const reader = other(seat), F = facts(pre, reader), seed = seedOf(pre, seat);
  const open = openMana(pre, seat), main = pre.active === seat && /^main/.test(pre.step) && !pre.stack.length;
  const out = [], worth = [];
  for (const names of GROUPS) {
    if (!names.some(n => unseenOf(F, n) > 0) || !possible(names[0], pre, open, main)) continue;
    const ids = unseenIds(pre, seat, names);
    if (!ids.length) continue;
    // the lands' card: a basic Island where there's one to be had (any land would be played; a Boilerworks may not)
    const id = ids.find(i => DECK[i] === "Island") ?? ids[0], rng = seeded(mix(seed, id + 1));
    // a hand with the card, as the reader would deal it: is there a move with it Medium would rather make than pass?
    const h = holding(determinize(pre, reader, rng, false), seat, id, rng);
    if (!h) continue;
    const P = new Player(h, seat);
    let best = null, top = 0.05 + PREFILTER;
    for (const m of moves(h, seat)) {
      if (m.card !== id || m.from === "yard") continue;
      const v = P.score(m);
      if (v > top) { top = v; best = m; }
    }
    if (!best) continue;
    // a land not played by the end of the turn's main phases: the drop is lost for good, which no look a turn or two
    // ahead shows (a land in hand counts nearly as much as one down), and nothing is ever gained by keeping it back
    if (best.t === "land" && pre.step === "main2") { out.push(...names); continue; }
    worth.push({ names, id, best, v: top });
  }
  // played out: the cards whose moves Medium likes most, a few (a pass is read on the page's own thread)
  worth.sort((a, b) => b.v - a.v);
  for (const { names, id, best } of worth.slice(0, played(pre))) if (clearlyBetter(pre, seat, id, best, deals, mix(seed, id + 77))) out.push(...names);
  return out;
}
/** Whether a card of the name could be played here at all: a land or sorcery-speed card in one's own main phase (a land not played yet), anything with the mana for it (cycling's, a discount's, by their least). */
function possible(name, s, open, main) {
  const d = CARDS[HALVES[name]?.[0] ?? name];
  if (d.type === "land") return main && !s.played;
  if ((d.type === "sorcery" || d.type === "creature") && !main) return false;
  const least = d.cycling || name === "Deem Inferior" ? 1 : total(parseCost(d.cost));
  return open.n >= least && (open.u > 0 || !/U/.test(d.cost));
}
/**
 * Whether making `m` (with the card `id` in hand) beats passing, played out from `seat`'s side in deals of what it
 * couldn't see (the reader's hand dealt as `seat` would deal it), Medium moving both seats on (horizon), by more than
 * MARGIN and the deals' standard error.
 */
function clearlyBetter(pre, seat, id, m, deals, seed) {
  const reader = other(seat), to = pre.turn + horizon(pre), diffs = [];
  for (let k = 0; k < deals; k++) {
    const rng = seeded(mix(seed, k + 1));
    const h = holding(determinize(pre, reader, rng, false), seat, id, rng);
    if (!h) return false;
    const d = determinize(h, seat, rng, false), runSeed = mix(seed, k + 1001);
    const a = fork(d), b = fork(d);
    if (typeof act(a, seat, PASS, { rng: seeded(runSeed), quiet: true }) === "string") return false;
    if (typeof act(b, seat, m, { rng: seeded(runSeed), quiet: true }) === "string") return false;
    diffs.push(playOut(b, seat, to, seeded(runSeed)) - playOut(a, seat, to, seeded(runSeed)));
    // stop early once it can't be clear
    if (k === 2 && diffs.reduce((x, y) => x + y, 0) / diffs.length < MARGIN / 2) return false;
  }
  const n = diffs.length, mean = diffs.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(diffs.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, n - 1));
  return mean - sd / Math.sqrt(n) > MARGIN;
}

/**
 * The reads of the passes a move led to (the engine's passPoints), added to the game: { s (the seat), d (the cards it
 * had drawn then), out (the names ruled out), at, on }, the ones that no longer say anything (drawn past) dropped.
 */
export function notePasses(s, points) {
  const obs = (s.obs || []).filter(o => (s.draws?.[o.s] ?? 0) - o.d < 8);
  for (const { seat, s: pre } of points) {
    const out = readPass(pre, seat);
    // at: where the pass was (a spell on the stack, the end of the main phases, of their turn, an attack), and on: the
    // spell it let by, for the coach's words
    const top = pre.stack[pre.stack.length - 1];
    const at = top ? "stack" : pre.step === "blockers" ? "attack" : pre.step;
    if (out.length) obs.push({ s: seat, d: pre.draws?.[seat] ?? 0, out, at, ...(top ? { on: top.name } : {}) });
  }
  s.obs = obs;
}
