// What must hold of every state of a Dandan game, whoever the players: the checks lab/rules-check.mjs runs after each move.
// Each returns a list of what is wrong, in words (empty when all is well). Written from the rules as the cards and the README
// state them, not from the engine's own helpers where those are what is being checked (mana is paid by brute force here,
// the engine pays by a search over lands; a state-based check is recomputed from the table, not from the engine's flags).
import { DECK, TOKEN_AT, CARDS, parseCost } from "../dandan-cards.js";
import { check, moves, hasMove } from "../dandan-engine.js";
import { affords, payPlan, manaAlts, pt, typesOf, needType, isCreature, isLand, nm, other, defOf, poolOf } from "../dandan-core.js";

const HAND = 7;
const N = DECK.length;

/** The whole state: cards, permanents, flags. prev: the state before the move that led here (for what only a move can change). */
export function audit(s, prev = null) {
  const v = [];
  // ----- every one of the 80 cards in exactly one place (tokens only on the battlefield)
  const where = new Map();
  const put = (id, w) => {
    if (!Number.isInteger(id)) { v.push(`${w} holds a non-card ${id}`); return; }
    if (where.has(id)) v.push(`card ${id} ${nm(id)} is in ${where.get(id)} and in ${w}`);
    where.set(id, w);
  };
  s.lib.forEach(id => put(id, "the library"));
  s.yard.forEach(id => put(id, "the graveyard"));
  s.exile.forEach(id => put(id, "exile"));
  s.hand[0].forEach(id => put(id, "hand 0"));
  s.hand[1].forEach(id => put(id, "hand 1"));
  const tokens = new Set(), oids = new Set(), bfIds = new Set();
  for (const p of s.bf) {
    if (p.id >= TOKEN_AT) { if (tokens.has(p.id)) v.push(`token ${p.id} twice`); tokens.add(p.id); } else put(p.id, "the battlefield");
    if (oids.has(p.oid)) v.push(`two permanents with object ${p.oid}`);
    oids.add(p.oid);
    if (bfIds.has(p.id)) v.push(`permanent ${p.id} twice on the battlefield`);
    bfIds.add(p.id);
    if (p.ctl !== 0 && p.ctl !== 1) v.push(`permanent ${p.id} has controller ${p.ctl}`);
  }
  const sids = new Set();
  for (const it of s.stack) {
    if (sids.has(it.sid)) v.push(`stack item ${it.sid} twice`);
    sids.add(it.sid);
    if (it.kind === "spell" && !it.copy) put(it.card, "the stack");
  }
  for (let id = 0; id < N; id++) if (!where.has(id)) v.push(`card ${id} ${DECK[id]} is nowhere`);
  if (v.length > 6) return v.slice(0, 6);

  // ----- turn, priority, flags
  if (s.over) {
    if (s.step !== "over" || s.pending) v.push("a game that is over is still asking");
  } else {
    if (s.prio !== 0 && s.prio !== 1) v.push(`priority is ${s.prio}`);
    if (s.pending && s.pending.seat !== 0 && s.pending.seat !== 1) v.push("a question for no one");
    if (s.passes !== 0 && s.passes !== 1) v.push(`passes is ${s.passes}`);
  }
  if (s.life.some(x => !Number.isInteger(x))) v.push("life is not a whole number");
  if (s.life[0] > 20 || s.life[1] > 20) v.push("life above the starting 20");

  // ----- state-based actions done: the table is settled whenever a player is asked to act (not mid-resolution: Metamorphose
  // asks the player who lost the permanent before the state-based check, as a resolution is one step in Magic)
  if (!s.over && !s.pending) {
    for (const p of s.bf) {
      if (!isCreature(p)) continue;
      const [, t] = pt(p);
      if (t <= 0 || (p.dmg || 0) >= t) v.push(`a ${nm(p.id)} with toughness ${t} and damage ${p.dmg || 0} is still on the battlefield`);
      const has = s.bf.some(l => l.ctl === p.ctl && isLand(l) && typesOf(l).includes(needType(p)));
      if (!has && !p.trig && !s.stack.some(i => i.name === "@dandan" && i.src === p.id)) v.push(`a Dandân of seat ${p.ctl} with no ${needType(p)} and no sacrifice on the stack`);
    }
    if (s.life[0] <= 0 || s.life[1] <= 0 || s.lost[0] || s.lost[1]) v.push("a player has lost and the game goes on");
  }

  // ----- what is known: a note about a card in the library is on a card in the library; one about a hand, on a hand
  const inLib = new Set(s.lib);
  for (const [id, m] of s.kn) { if (!inLib.has(id)) v.push(`a library note on card ${id} ${nm(id)}, which is not in the library`); if (!(m >= 1 && m <= 3)) v.push(`library note mask ${m}`); }
  const inHand = new Set([...s.hand[0], ...s.hand[1]]);
  for (const [id, m] of s.kh || []) { if (!inHand.has(id)) v.push(`a hand note on card ${id} ${nm(id)}, which is in no hand`); if (!(m >= 1 && m <= 3)) v.push(`hand note mask ${m}`); }

  // ----- a turn that has just ended left its player no more than seven cards
  if (prev && !prev.over && s.turn === prev.turn + 1 && prev.turn > 0 && s.hand[prev.active].length > HAND) v.push(`seat ${prev.active} began the next turn with ${s.hand[prev.active].length} cards`);

  // ----- the shared library never grows or shrinks except by what a card says: totals are conserved above; nothing more here
  return v;
}

/** The moves a seat could make with priority (or the answers it could give), against the rules that check them. */
export function auditMoves(s, seat) {
  const v = [];
  if (s.pending) {
    if (s.pending.seat !== seat) v.push("the question is put to another seat than the one to move");
    return v;
  }
  if (s.prio !== seat) { v.push(`toMove is ${seat} but priority is ${s.prio}`); return v; }
  const ms = moves(s, seat);
  for (const m of ms) {
    const r = check(s, seat, m);
    if (typeof r === "string") v.push(`moves() offers ${JSON.stringify(m)} which check() refuses: ${r}`);
  }
  if (hasMove(s, seat) !== ms.length > 0) v.push("hasMove and moves() disagree");
  // land drop: offered exactly when it is the seat's main phase with nothing on the stack and no land played yet
  const landOk = seat === s.active && /^main/.test(s.step) && !s.stack.length && s.played < 1;
  const offered = ms.some(m => m.t === "land");
  if (offered && !landOk) v.push("a land drop is offered out of turn");
  if (!offered && landOk && s.hand[seat].some(id => defOf(id).type === "land")) v.push("a land in hand is not offered in the main phase");
  // sorcery-speed cards are cast only in the seat's own main phase with the stack empty (Quicken aside)
  for (const m of ms) {
    if (m.t !== "cast") continue;
    const half = m.from === "yard" ? (DECK[m.card] === "Commit // Memory" ? "Memory" : DECK[m.card]) : (DECK[m.card] === "Commit // Memory" ? "Commit" : DECK[m.card]);
    const type = CARDS[half]?.type;
    if ((type === "sorcery" || type === "creature") && !s.quick[seat] && !(seat === s.active && /^main/.test(s.step) && !s.stack.length)) v.push(`${half} is offered outside the main phase`);
  }
  v.push(...auditMana(s, seat));
  return v;
}

/** The mana a seat can make, by brute force over every way its lands tap, against the engine's affords() and payPlan(). */
export function auditMana(s, seat) {
  const v = [];
  const pool = poolOf(s, seat);
  let states = new Set([`${[...pool].filter(c => c === "U").length},${[...pool].filter(c => c === "R").length},${pool.length}`]);
  for (const p of s.bf) {
    if (p.ctl !== seat || p.tapped || !isLand(p)) continue;
    const alts = manaAlts(p);
    if (!alts.length) continue;
    const next = new Set(states);
    for (const st of states) {
      const [u, r, t] = st.split(",").map(Number);
      for (const a of alts) next.add(`${u + a.filter(c => c === "U").length},${r + a.filter(c => c === "R").length},${t + a.length}`);
    }
    states = next;
  }
  const all = [...states].map(x => x.split(",").map(Number));
  for (let g = 0; g <= 6; g++) for (let U = 0; U <= 2; U++) for (const R of [0, 1]) {
    if ((!g && !U && !R) || (U && R)) continue;     // no card asks for both blue and red, which is all affords() promises to get right
    const cost = { g, U, R }, need = g + U + R;
    const truth = all.some(([u, r, t]) => u >= U && r >= R && t >= need);
    if (affords(s, seat, cost) !== truth) v.push(`affords(${g},${U},${R}) says ${!truth} for seat ${seat}, brute force ${truth}`);
    if (!!payPlan(s, seat, cost) !== truth) v.push(`payPlan(${g},${U},${R}) says ${!truth} for seat ${seat}, brute force ${truth}`);
    if (v.length > 3) return v;
  }
  return v;
}

/** A finished game's result against the life totals and the library. */
export function auditEnd(s) {
  const v = [];
  const dead = i => s.life[i] <= 0 || s.lost[i];
  if (s.why === "conceded") return v;
  if (s.winner === -1) {
    if (!(dead(0) && dead(1))) v.push("a draw, though only one player had lost");
    return v;
  }
  const loser = other(s.winner);
  if (!dead(loser)) v.push("the game was awarded to a player while the other still stood");
  if (dead(s.winner)) v.push("the winner is dead");
  if (s.why === "life" && s.life[loser] > 0) v.push("won on life with the loser above 0");
  // (not "and the library is empty": a Brainstorm that drew from a short library puts two cards back before the check that ends the game)
  if (s.why === "library" && !s.lost[loser]) v.push("won by the library but the loser did not draw from an empty one");
  return v;
}
