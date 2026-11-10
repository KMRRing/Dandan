// Dandan's look-ahead: Hard's player and the coach's judgement. At a decision it takes each move worth considering
// (the ones Medium, dandan-policy.js, would weigh, and passing) and plays each out to the start of the turn after next
// in many deals of the cards the seat can't see. Below each move the decisions that follow are searched for both
// players (the tree: each picks what has done best for it there, over the deals), and where each line lands is judged by
// dandan-eval.js's chance of winning, which is the rest of the game as these players would play it; the move with the
// best average is played. The deals are the same for every move (and so is the rest of the game's luck), so the moves
// are set against each other on the same footing, and a move clearly behind the best stops being played out early (a
// race). Pure functions; the coach runs them in dandan-worker.js.
//
// A deal (determinize) keeps everything the seat knows where it is: its hand, the table, the graveyard and exile, the
// stack, the library cards it has seen, the cards it knows are in the other hand; the rest of the other hand and of
// the library are the remaining cards in a random order, the other hand weighed by what their play has shown (the hand
// they kept, and every pass they made where a card would clearly have been played: dandan-reads.js, dandan-observe.js).
// What the other player knew of the library stays with the places they knew, whatever card is there now.
import { act, toMove, moves, MOST_MULLS } from "./dandan-engine.js";
import { DECK, NAMES } from "./dandan-cards.js";
import { other, knownIn, knOf } from "./dandan-core.js";
import { Player, policyMove, PASS, unseenOf } from "./dandan-policy.js";
import { readsOf, likelihood } from "./dandan-reads.js";
import { winChance } from "./dandan-eval.js";
import { moveName } from "./dandan-words.js";
import { seeded, mix, shuffle } from "./seats.js";

const J = x => JSON.parse(JSON.stringify(x));
/** How many times a deal is dealt again before the likeliest so far is taken (a hand their play makes unlikely). */
const REDEALS = 24;

// ---------- the cards the seat can't see, dealt ----------
/**
 * The seat's view of the game, with the cards it can't see dealt at random (a copy; the log left behind); weigh: the
 * other hand dealt by what their play has shown (a reading of a pass deals plainly, for speed: dandan-observe.js).
 */
export function determinize(s, seat, rng, weigh = true) {
  const c = { ...s, log: [] };
  c.hand = s.hand.map(h => h.slice());
  c.lib = s.lib.slice();
  c.bf = s.bf.map(p => ({ ...p, ...(p.tc ? { tc: p.tc.map(x => x.slice()) } : {}), ...(p.pump ? { pump: p.pump.slice() } : {}) }));
  c.stack = s.stack.map(it => ({ ...it, targets: it.targets.map(t => ({ ...t })), d: { ...(it.d || {}) } }));
  c.yard = s.yard.slice();
  c.exile = s.exile.slice();
  c.kh = (s.kh || []).map(e => e.slice());
  c.combat = s.combat ? { att: s.combat.att.slice(), blk: s.combat.blk.map(x => x.slice()) } : null;
  c.pending = s.pending ? J(s.pending) : null;
  c.life = s.life.slice(); c.drawn = s.drawn.slice(); c.quick = s.quick.slice(); c.lost = s.lost.slice(); c.pool = (s.pool || ["", ""]).slice();
  c.mull = { n: s.mull.n.slice(), done: s.mull.done.slice() };
  // what the engine counts as it goes (the draws, the tells) is the deal's own: the game weighed is never touched
  c.draws = (s.draws || [0, 0]).slice();
  c.tells = (s.tells || []).map(t => ({ ...t }));
  const opp = other(seat), bit = 1 << seat;
  // what each place in the library is known to be, by whom
  const placeMask = c.lib.map(id => knOf(s, id));
  const pinned = new Set();
  for (let i = 0; i < c.lib.length; i++) if (placeMask[i] & bit) pinned.add(c.lib[i]);
  // a search under way: the seat is looking through the library, so the cards it may find stay there
  if (s.pending?.t === "search" && s.pending.seat === seat) for (const id of s.pending.ids) pinned.add(id);
  for (const id of knownIn(s, opp, seat)) pinned.add(id);
  const pool = [], handSlots = [], libSlots = [];
  c.hand[opp].forEach((id, i) => { if (!pinned.has(id)) { pool.push(id); handSlots.push(i); } });
  c.lib.forEach((id, i) => { if (!pinned.has(id)) { pool.push(id); libSlots.push(i); } });
  // dealt from the cards in a fixed order, so the deal depends on what the seat knows and the seed, not on where the
  // unseen cards really are (which hand, which place in the library); and by what the other player's play has shown
  // (dandan-reads.js): a deal is kept with the chance its hand would have shown the same, else dealt again (the likeliest
  // of the tries when none is kept)
  pool.sort((x, y) => x - y);
  let dealt = shuffle(pool, rng);
  const reads = weigh ? readsOf(s, opp) : [];
  if (reads.length && handSlots.length) {
    const known = c.hand[opp].filter(id => pinned.has(id));
    let best = dealt, top = -1;
    for (let tries = 0; tries < REDEALS; tries++) {
      const d = tries ? shuffle(pool, rng) : dealt;
      const L = likelihood(reads, d.slice(0, handSlots.length), known);
      if (rng() < L) { best = d; break; }
      if (L > top) { top = L; best = d; }
    }
    dealt = best;
  }
  let k = 0;
  for (const i of handSlots) c.hand[opp][i] = dealt[k++];
  for (const i of libSlots) c.lib[i] = dealt[k++];
  c.kn = [];
  for (let i = 0; i < c.lib.length; i++) if (placeMask[i]) c.kn.push([c.lib[i], placeMask[i]]);
  return c;
}

/** A copy of a dealt game to play a move out on. */
export function fork(c) {
  return {
    ...c, log: [], hand: c.hand.map(h => h.slice()), lib: c.lib.slice(), yard: c.yard.slice(), exile: c.exile.slice(),
    bf: c.bf.map(p => ({ ...p, ...(p.tc ? { tc: p.tc.map(x => x.slice()) } : {}), ...(p.pump ? { pump: p.pump.slice() } : {}) })),
    stack: c.stack.map(it => ({ ...it, targets: it.targets.map(t => ({ ...t })), d: { ...(it.d || {}) } })),
    kn: c.kn.map(e => e.slice()), kh: (c.kh || []).map(e => e.slice()),
    combat: c.combat ? { att: c.combat.att.slice(), blk: c.combat.blk.map(x => x.slice()) } : null,
    pending: c.pending ? J(c.pending) : null, life: c.life.slice(), drawn: c.drawn.slice(), quick: c.quick.slice(), lost: c.lost.slice(),
    pool: (c.pool || ["", ""]).slice(), mull: { n: c.mull.n.slice(), done: c.mull.done.slice() },
    draws: (c.draws || [0, 0]).slice(), tells: (c.tells || []).map(t => ({ ...t })),
  };
}

/** A seed from what the seat sees, so the same position gets the same deals (and the same advice) on any phone. */
export function seedOf(s, seat) {
  let h = 2166136261;
  const eat = x => { h ^= (x & 0xffff) + 1; h = Math.imul(h, 16777619) >>> 0; };
  for (const id of s.hand[seat]) eat(id);
  for (const p of s.bf) { eat(p.id); eat(p.ctl); eat(p.tapped ? 1 : 0); }
  for (const id of s.yard) eat(id + 101);
  for (const it of s.stack) { eat(it.sid); eat(it.card ?? it.src ?? 0); }
  for (const x of [seat, s.turn, s.active, s.prio, s.life[0], s.life[1], s.hand[other(seat)].length, s.lib.length, s.ln || 0]) eat(x);
  eat(STEPS.indexOf(s.step) + 7);
  if (s.pending) eat(s.pending.t.length * 31 + (s.pending.n || 0));
  return h;
}
const STEPS = ["mull", "upkeep", "draw", "main1", "attackers", "blockers", "damage", "main2", "end", "over"];

// ---------- the moves worth weighing ----------
const key = m => JSON.stringify(m);
/** Every subset of a list (a short one). */
const subsets = a => a.reduce((acc, x) => [...acc, ...acc.map(s => [...s, x])], [[]]);
/** The orders of a few cards. */
function orders(a) {
  if (a.length <= 1) return [a.slice()];
  const out = [];
  a.forEach((x, i) => { for (const r of orders([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...r]); });
  return out;
}

/**
 * The moves Hard weighs at a decision: Medium's own choice always, and the others it would consider (a question's
 * reasonable answers; with priority, passing and the best-scored moves), at most `wide`.
 */
export function candidates(s, seat, { wide = 7 } = {}) {
  const P = new Player(s, seat), p = s.pending;
  // with priority, Medium's move is the first of its scored moves worth more than passing (priority()'s, scored once)
  const scored = p ? null : P.scored();
  const mine = p ? P.answer() : scored.length && scored[0].v > 0.05 ? scored[0].m : PASS;
  const out = [mine], seen = new Set([key(mine)]);
  const add = m => { const k = key(m); if (!seen.has(k)) { seen.add(k); out.push(m); } };
  if (!p) {
    add(PASS);
    // with something on the stack, every move there is (at the root, up to STACK_WIDE): which spell to counter or copy, or whether to
    // draw in answer, turns on what the others do, which Medium's score doesn't see, and the search does (audited on 1,277
    // decisions with two or more spells on the stack, every legal move valued: the best was outside the shortlist in 6.5%, and
    // by two points or more in 2.7%, worth ten or more where it happened: README, The stack and the end of the library)
    const stacked = (s.stack.length > 0 || endOfLibrary(s) > 0) && wide >= 7;
    for (const { m, v } of scored) if (v > -0.8 || stacked) add(m);
    return out.slice(0, stacked ? STACK_WIDE : wide);
  }
  switch (p.t) {
    case "attack": {
      const subs = p.ids.length <= 3 ? subsets(p.ids) : [[], p.ids, ...p.ids.map(x => p.ids.filter(y => y !== x))];
      for (const ids of subs) add({ t: "attack", ids });
      break;
    }
    case "block": {
      add({ t: "block", pairs: [] });
      for (const a of p.attackers) for (const b of p.blockers.slice(0, 2)) add({ t: "block", pairs: [[b, a]] });
      if (p.attackers.length > 1) add({ t: "block", pairs: p.blockers.slice(0, p.attackers.length).map((b, i) => [b, p.attackers[i]]) });
      break;
    }
    case "order": for (const o of orders(p.cards)) add({ t: "order", cards: o }); break;
    case "surveil": add({ t: "surveil", yard: true }); add({ t: "surveil", yard: false }); break;
    case "search": {
      const byName = new Map();
      for (const id of p.ids) if (!byName.has(DECK[id])) byName.set(DECK[id], id);
      for (const id of byName.values()) add({ t: "search", card: id });
      break;
    }
    case "pick": {
      const byName = new Map();
      for (const id of p.ids) { const k = p.for === "boil" ? id : DECK[id]; if (!byName.has(k)) byName.set(k, id); }
      for (const id of byName.values()) add({ t: "pick", card: id });
      if (p.optional) add({ t: "pick", card: null });
      break;
    }
    case "owner": add({ t: "owner", bottom: true }); add({ t: "owner", bottom: false }); break;
    case "bend": for (const from of p.froms) for (const to of ["Island", "Swamp", "Mountain", "Plains", "Forest"]) if (to !== from) add({ t: "bend", from, to }); break;
    case "retarget": add({ t: "retarget" }); for (const o of p.options) add({ t: "retarget", targets: o }); break;
    case "putback": case "discard": {
      // the cards Medium would least miss, two by two (in both orders for a putback), and the few after them
      const hand = s.hand[seat], n = p.n;
      const ranked = P.worst(hand, Math.min(hand.length, n + 2));
      if (n === 1) for (const id of ranked) add({ t: p.t, cards: [id] });
      else for (const a of ranked) for (const b of ranked) if (a !== b && (p.t === "putback" || a < b)) add({ t: p.t, cards: [a, b] });
      break;
    }
    case "mull":
      add({ t: "keep" });
      if (p.free || p.taken < MOST_MULLS) add({ t: "mull" });
      break;
    case "bottom": {
      const ranked = P.worst(s.hand[seat], Math.min(s.hand[seat].length, p.n + 2));
      if (p.n === 1) for (const id of ranked) add({ t: "bottom", cards: [id] });
      else for (const a of ranked) for (const b of ranked) if (a < b && p.n === 2) add({ t: "bottom", cards: [a, b] });
      break;
    }
    case "name": {
      // the card it knows is on top, and the names with the most copies it hasn't seen
      const F = P.F, names = [...NAMES].sort((a, b) => unseenOf(F, b) - unseenOf(F, a)).slice(0, 3);
      if (F.known != null) add({ t: "name", name: DECK[F.known] });
      for (const n of names) add({ t: "name", name: n });
      break;
    }
    default: break;
  }
  return out;
}

// ---------- playing a move out ----------
/** Plays a dealt game on with Medium moving both seats until the turn `to` begins (or the game ends); the seat's chance there. */
export function playOut(c, seat, to, rng, judge = winChance) {
  for (let i = 0; i < 4000 && !c.over; i++) {
    if (c.turn >= to && !c.stack.length) break;
    const who = toMove(c);
    if (who == null) break;
    if (typeof act(c, who, policyMove(c, who, { rng }), { rng, quiet: true }) === "string") break;
  }
  return judge(c, seat);
}
// ---------- the tree: each player's choices searched ----------
// Below a move weighed, the decisions that follow it in the next turns are a tree shared by all its deals (information-
// set Monte Carlo tree search): at each, the player to move picks among its likeliest moves (Medium's own first, then
// passing and the best-scored others) by how they have done for that player so far (UCB, counting a move only in the
// deals where it was there to make), so each side comes to play what is best for it there, not only Medium's habit; a
// node's choices widen as it's visited, and each deal grows the tree by one decision, Medium playing on from there.
const WIDTH = 4, EXPLORE = 0.3;
/**
 * How many turns a look-ahead needs to see the game out when the library is nearly gone: the judge never saw a game end by
 * drawing from an empty library (the games it learned from hardly ever got there), so two turns ahead says nothing of who
 * will draw last. With RACE_TURNS cards or fewer left each draw step takes one, so the library is out within that many turns
 * and the game ends within two more; the look-ahead plays on that far (the position's own result, not the judge's guess).
 */
const RACE_TURNS = 8;
export const endOfLibrary = s => (s.lib.length <= RACE_TURNS ? s.lib.length + 2 : 0);
/** The most moves weighed at the root with something on the stack (otherwise `wide`, 7). */
const STACK_WIDE = 12;
/**
 * A move as the seat sees it, so a decision's children are the same in every deal: cards by name, permanents by
 * controller and name, the other player's hidden choices (cards put back, put on the bottom, their order) by kind only.
 */
function sigOf(m, c, seat, who) {
  const mine = who === seat;
  const card = id => (id == null ? "-" : DECK[id] ?? id);
  const tgt = t => {
    if (t.k === "c") { const p = c.bf.find(x => x.id === t.id); return `c${p ? p.ctl : "?"}${p ? DECK[p.id] ?? "Clue" : t.id}${p?.tapped ? "t" : ""}`; }
    if (t.k === "s") { const x = c.stack.find(y => y.sid === t.sid); return `s${x ? x.ctl + x.name : t.sid}`; }
    if (t.k === "g") return `g${card(t.id)}`;
    return `p${t.seat}`;
  };
  switch (m.t) {
    case "pass": return "p";
    case "land": return `l${card(m.card)}`;
    case "cast": return `c${card(m.card)}${m.from}${m.mode ?? ""}:${(m.targets || []).map(tgt).join(",")}`;
    case "cycle": return `y${card(m.card)}`;
    case "ability": { const p = c.bf.find(x => x.id === m.id); return `a${p ? DECK[p.id] ?? "Clue" : m.id}`; }
    case "attack": return `A${m.ids.length}`;
    case "block": return `B${m.pairs.length}`;
    case "discard": return `D${m.cards.map(card).sort().join(",")}`;
    case "putback": case "order": return mine ? `${m.t}${m.cards.map(card).join(",")}` : m.t;
    case "bottom": return mine ? `bottom${m.cards.map(card).sort().join(",")}` : "bottom";
    case "search": return `F${card(m.card)}`;
    case "pick": return `P${card(m.card)}`;
    case "name": return `N${m.name}`;
    case "bend": return `b${m.from}${m.to}`;
    case "retarget": return `R${(m.targets || []).map(tgt).join(",")}`;
    default: return JSON.stringify(m);
  }
}
const newNode = () => ({ n: 0, kids: new Map() });
/** The child to follow at a node: unvisited ones in Medium's order, then by UCB over the deals each was there; returns { k, m }. */
function choose(node, ms, c, seat, who, at, explore = EXPLORE) {
  node.n++;
  const allow = Math.min(ms.length, 1 + Math.floor(Math.sqrt(node.n - 1)));
  let best = null, m = null, top = -Infinity;
  for (let i = 0; i < allow; i++) {
    const sig = at + sigOf(ms[i], c, seat, who);
    let k = node.kids.get(sig);
    if (!k) { k = { n: 0, w: 0, avail: 0, node: null }; node.kids.set(sig, k); }
    k.avail++;
    const v = k.n ? k.w / k.n + explore * Math.sqrt(Math.log(k.avail) / k.n) : 2 - i / 100;
    if (v > top) { top = v; best = k; m = ms[i]; }
  }
  return { k: best, m };
}
/**
 * One deal of a move weighed, down its tree: each player's decisions searched (choose) until a new one is reached,
 * Medium moving both seats from there until the turn `to` begins; the seat's chance there (the judge), counted back up
 * the path for each player at its own decisions. The tree may reach as far as the play does: how deep it grows is
 * the deals'. seen: where it was left, and the other player's first choice on the way (their answer, for the coach's
 * words).
 */
export function treePlay(c, seat, root, to, rng, judge = winChance, seen = null, explore = EXPLORE) {
  const opp = other(seat), path = [];
  let node = root, growing = true;
  for (let i = 0; i < 4000 && !c.over; i++) {
    if (c.turn >= to && !c.stack.length) break;
    const who = toMove(c);
    if (who == null) break;
    let m = null;
    if (growing && c.turn < to) {
      const ms = candidates(c, who, { wide: WIDTH });
      if (ms.length > 1) {
        // a decision's children are keyed by who decides and where, as well as by the move: in other deals the same
        // line can reach another seat's decision first (a hand with nothing to do there is passed over)
        const pick = choose(node, ms, c, seat, who, `${who}${c.step}${c.stack.length}${c.pending?.t ?? ""}:`, explore);
        m = pick.m;
        path.push([pick.k, who]);
        if (pick.k.node) node = pick.k.node;
        else { pick.k.node = newNode(); growing = false; }
      } else m = ms[0];
    } else m = policyMove(c, who, { rng });
    // their answer, for the coach: what they do first in their own main phase (their turn's plan), else first at all
    // (a land is no answer)
    if (seen && who === opp && m.t !== "pass" && m.t !== "land" && !seen.main && c.turn < to) {
      const main = c.active === opp && /^main/.test(c.step) && !c.stack.length;
      if (main || seen.a == null) { seen.a = moveName(m, c, seat); seen.main = main; }
    }
    if (typeof act(c, who, m, { rng, quiet: true }) === "string") break;
  }
  const v = judge(c, seat);
  for (const [k, who] of path) { k.n++; k.w += who === seat ? v : 1 - v; }
  if (seen) Object.assign(seen, where(c, seat));
  return v;
}

/** What the coach can say of where a game was left, for the seat: a Dandân of its own on the table and one of theirs, both lives and hands. */
function where(c, seat) {
  const opp = other(seat);
  let d = 0, D = 0;
  for (const p of c.bf) if (DECK[p.id] === "Dandân") { if (p.ctl === seat) d = 1; else D = 1; }
  return { d, D, l: c.life[seat], L: c.life[opp], h: c.hand[seat].length, H: c.hand[opp].length };
}

/**
 * Weighs a decision: { best, list: [{ move, mean, se, n, seen }] (the best first; seen: where its deals left the game, on
 * average, for the coach's words), deals, only }. Each move is played out in the same deals, down its own tree; one
 * clearly behind the best (by the gap's standard error, deal by deal) is dropped as the deals go, at a look when the
 * deals reach a power of two from `first` on (prune, below).
 * opts: deals (most), first (deals before the first look), turns (how far ahead: the turn after next, 2; the tree
 * may reach as far), wide (moves weighed), must (a move to keep to the end: the coach's check), ms (a backstop on the
 * time), judge (the chance of winning where a game is left), explore (the tree's: how much benefit of the doubt a
 * choice tried less gets).
 */
export function think(s, seat, { deals = 48, first = LOOK_FROM, turns = 2, wide = 7, must = null, ms = 4000, judge = winChance, explore = EXPLORE } = {}) {
  const t0 = Date.now();
  const cands = candidates(s, seat, { wide });
  if (must && !cands.some(m => key(m) === key(must))) cands.push(must);
  const n = cands.length;
  if (n === 1) return { best: cands[0], list: [{ move: cands[0], mean: NaN, se: 0, n: 0 }], deals: 0, only: true };
  const to = s.turn + Math.max(turns, endOfLibrary(s)), seed = seedOf(s, seat);
  const vals = cands.map(() => []), seen = cands.map(() => []), roots = cands.map(newNode);
  let alive = cands.map((_, i) => i), d = 0;
  while (d < deals && alive.length > 1) {
    const rng = seeded(mix(seed, d + 1));
    const base = determinize(s, seat, rng), runSeed = mix(seed ^ 0x5eed, d + 7);
    for (const i of alive) {
      const c = fork(base), r = seeded(runSeed);
      const res = act(c, seat, cands[i], { rng: r, quiet: true });
      const at = {};
      if (typeof res === "string") vals[i].push(-1);
      else vals[i].push(treePlay(c, seat, roots[i], to, r, judge, at, explore));
      seen[i].push(at);
    }
    d++;
    if (d >= first && (d & (d - 1)) === 0) alive = prune(alive, vals, cands, must);   // a look at 128, 256, 512...
    if (Date.now() - t0 > ms) break;
  }
  const list = cands.map((move, i) => {
    const v = vals[i], k = v.length, mean = k ? v.reduce((a, b) => a + b, 0) / k : -1;
    const sd = k > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (k - 1)) : 0;
    // where the deals left it, on average (the coach's evidence): the share with a Dandân of ours, of theirs, the lives
    // and hands; and the other player's answer that hurt most, the one most often so, with how often (of n)
    const avg = f => { let t = 0, n = 0; for (const x of seen[i]) if (x[f] != null) { t += x[f]; n++; } return n ? t / n : null; };
    const answers = new Map();
    for (const x of seen[i]) if (x.a) answers.set(x.a, (answers.get(x.a) || 0) + 1);
    const top = [...answers].sort((p, q) => q[1] - p[1])[0];
    return {
      move, mean, se: k ? sd / Math.sqrt(k) : 0, n: k, i,
      seen: { d: avg("d"), D: avg("D"), l: avg("l"), L: avg("L"), h: avg("h"), H: avg("H"), a: top?.[0] ?? null, an: top?.[1] ?? 0 },
    };
  });
  // the best of the moves still in the race, by their average over the same deals (a move dropped on a few deals keeps
  // the average of those, which may be lucky: it was clearly behind when it went, and stays behind). Medium's own move
  // stands unless another beats it by more than the deals can explain (a standard error of the gap, deal by deal, and
  // half a point): what two turns can't show, a land drop kept for nothing above all (the judge counts a land in hand
  // nearly as one down), is in Medium's habits, and a gap that is mostly chance would otherwise decide it
  const byMean = (a, b) => b.mean - a.mean;
  const ranked = [...list.filter(c => alive.includes(c.i)).sort(byMean), ...list.filter(c => !alive.includes(c.i)).sort(byMean)];
  for (const c of list) c.out = !alive.includes(c.i);
  let best = ranked[0];
  if (best.i !== 0 && alive.includes(0) && vals[0].length) {
    const k = Math.min(vals[0].length, vals[best.i].length);
    const diffs = vals[best.i].slice(0, k).map((x, j) => x - vals[0][j]);
    const m = diffs.reduce((a, b) => a + b, 0) / k;
    const sd = Math.sqrt(diffs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, k - 1));
    if (m < sd / Math.sqrt(k) + 0.005) best = list[0];
  }
  // nor does a pass at the end of the main phases outweigh the land Medium would play: it loses the drop for good, which
  // the look can't see past (the judge counts a land in hand nearly as one down: the search kept one back now and
  // then, by a point or two in its favour at any depth), and nothing is gained by it, as the reads take it of the other
  // player (dandan-observe.js). A land kept back at the first main phase may still go down after combat.
  if (s.step === "main2" && !s.stack.length && best.move.t === "pass" && list[0].move.t === "land") best = list[0];
  // each other move against the chosen one, deal by deal over the deals they share: how often the chosen one came out
  // ahead (better), and behind (worse); what's left were even
  for (const c of list) {
    if (c === best) continue;
    const k = Math.min(vals[c.i].length, vals[best.i].length);
    let better = 0, worse = 0;
    for (let j = 0; j < k; j++) { const g = vals[best.i][j] - vals[c.i][j]; if (g > 1e-6) better++; else if (g < -1e-6) worse++; }
    Object.assign(c, { vs: k, better, worse });
  }
  return { best: best.move, list: [best, ...ranked.filter(c => c !== best)], deals: d, only: false };
}
/**
 * The moves still in the race: one goes when, over the deals they share, it trails the leader by more than three times
 * the gap's standard error and a little. The spread is taken as at least SPREAD: over the first few deals two moves can
 * come out alike by chance, and a gap that looks certain there may not be.
 * Looked at only when the deals double (at LOOK_FROM, twice that, and so on), not every second deal: a move that is really the
 * best trails by chance now and then, and a look every other deal over thousands of deals is a thousand chances for it
 * to go for good (measured on 200 positions at 4096 deals, the old way, twice the standard error every second deal,
 * dropped the best move in 6% of the searches that had one, against 2% at doublings; and gave away more, not less, the
 * longer the search ran). The same rule makes the 2048-deal search better and quicker than the 4096-deal one it replaces.
 */
const LOOK_FROM = 128;
const SPREAD = 0.06;
function prune(alive, vals, cands, must) {
  const k = Math.min(...alive.map(i => vals[i].length));
  const mean = i => vals[i].slice(0, k).reduce((a, b) => a + b, 0) / k;
  const lead = alive.reduce((b, i) => (mean(i) > mean(b) ? i : b), alive[0]);
  return alive.filter(i => {
    if (i === lead || (must && key(cands[i]) === key(must))) return true;
    const diffs = vals[i].slice(0, k).map((x, j) => vals[lead][j] - x);
    const m = diffs.reduce((a, b) => a + b, 0) / k;
    const sd = Math.sqrt(diffs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, k - 1));
    return m < 3 * Math.max(sd, SPREAD) / Math.sqrt(k) + 0.01;
  });
}

/**
 * How much weighing each use gets: Hard's move; the coach's weighing (a Hint, Always) and its check of a move of
 * yours, wider and in more deals; and the same on the page's own thread, where a browser has no worker.
 * The deals decide; the time is a backstop for a slow phone, 10 s since 10 November 2026 (Korbi: a recent iPhone is
 * far quicker than the 2.5 s allowed for, and the late game, played to its end, needs the room).
 */
export const BUDGET = {
  move: { deals: 64, ms: 10000 },
  think: { deals: 96, wide: 9, ms: 10000 },
  check: { deals: 96, wide: 9, ms: 10000 },
  here: { deals: 32, wide: 7, ms: 1500 },
};

/**
 * How long Hard and the coach think, chosen in the menu: Quick is Hard's move above (the one the tests measure); each
 * deeper setting plays four times the deals, and so grows the tree further down the lines that matter (a decision a
 * deal), its time on a slow phone held by the backstop.
 */
export const DEPTH = {
  quick: BUDGET.move,
  long: { deals: 256, ms: 12000 },
  deep: { deals: 1024, ms: 40000 },
  deepest: { deals: 2048, ms: 120000 },
};
/**
 * The coach's weighing ("think", "check") at a thinking setting: as deep and as long as Hard's there, never less than
 * its own (at Quick its 96 deals stand, so it is never the weaker), and wider, nine moves, for the list Why? shows.
 */
export function coachBudget(kind, depth) {
  const own = BUDGET[kind === "check" ? "check" : "think"], d = DEPTH[depth] || DEPTH.quick;
  return { ...own, ...(d.turns ? { turns: d.turns } : {}), deals: Math.max(own.deals, d.deals), ms: Math.max(own.ms, d.ms) };
}

/** Hard's move: Medium's answer to a question it doesn't weigh (the mulligan, a name), else the look-ahead's best. */
export function thinkMove(s, seat, budget = BUDGET.move) {
  const p = s.pending;
  if (p && ["mull", "bottom", "name"].includes(p.t)) return policyMove(s, seat);
  if (!p && !moves(s, seat, true).length) return PASS;
  return think(s, seat, budget).best;
}
