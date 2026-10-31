// What each Dandan card does: its targets, and its resolution step by step. A resolution that needs a decision from a
// player (which two cards go back, which land to return) asks (core's ask) and waits on the stack; the answer is
// applied by dandan-engine.js and the resolution carries on at the step it was given. Texts checked against
// dandan-cards.js's sources; the places the rules were simplified are named in the README.
import { CARDS, DECK, BASICS, TOKEN_AT } from "./dandan-cards.js";
import {
  defOf, nm, isToken, isLand, isCreature, isSpellCard, perm, typesOf, needType, fetchTypes, other,
  draw, mill, fromYard, shuffleLib, say, knSet, knOf, pushItem, itemOf, leaveStack, enterBf, leaveBf, toGrave, bounce,
  permToLib, ask, toLib, toHandOpen, handToLib, BOTH,
} from "./dandan-core.js";

// ---------- targets ----------
/**
 * A target: a spell on the stack (s), a permanent (c, with the object it is: oid), a player (p), a card in the
 * graveyard (g). Two are the same by what they point at; the oid is checked as a spell resolves (stillLegal).
 */
export const T = { s: sid => ({ k: "s", sid }), c: (id, oid) => (oid == null ? { k: "c", id } : { k: "c", id, oid }), p: seat => ({ k: "p", seat }), g: id => ({ k: "g", id }) };
export const same = (a, b) => a.k === b.k && a.sid === b.sid && a.id === b.id && a.seat === b.seat;
const C = p => T.c(p.id, p.oid);

const spellsOnStack = (s, not) => s.stack.filter(i => i.kind === "spell" && !not.includes(i.sid));
/** What type a spell on the stack is (the half it was cast as). */
const typeOfItem = i => CARDS[i.name]?.type;

/**
 * The legal targets of a spell as lists (one list of one target each, or [[]] for a spell with none); [] if it can't be
 * cast. self: the card being cast from the graveyard, which is on the stack by the time its targets are chosen (a
 * Mystic Retrieval flashed back can't return itself).
 */
export function targetLists(s, ctl, name, mode = 0, not = [], self = null) {
  const one = ts => ts.map(t => [t]);
  switch (name) {
    case "Memory Lapse": return one(spellsOnStack(s, not).map(i => T.s(i.sid)));
    case "Narset's Reversal": return one(spellsOnStack(s, not).filter(i => ["instant", "sorcery"].includes(typeOfItem(i))).map(i => T.s(i.sid)));
    case "Commit": return one([...spellsOnStack(s, not).map(i => T.s(i.sid)), ...s.bf.filter(p => !isLand(p)).map(C)]);
    case "Mind Bend": return one(s.bf.map(C));
    case "Gone Missing": return one(s.bf.map(C));
    case "Repulse": return one(s.bf.filter(isCreature).map(C));
    case "Metamorphose": return one(s.bf.filter(p => p.ctl !== ctl).map(C));
    case "Deem Inferior": return one(s.bf.filter(p => !isLand(p)).map(C));
    case "Mystic Retrieval": case "@sanct": return one(s.yard.filter(id => id !== self && isSpellCard(id)).map(T.g));
    case "Piracy Charm": return mode === 2 ? one([T.p(0), T.p(1)]) : one(s.bf.filter(isCreature).map(C));
    default: return [[]];
  }
}
/** How many modes a spell has (Piracy Charm three; the rest one). */
export const modesOf = name => CARDS[name]?.modes?.length || 1;

/**
 * Whether a spell's (or a targeted trigger's) targets are still legal as it resolves: one with none always is; one whose
 * targets are all gone fizzles. A permanent that left and came back is a new object, and not the one aimed at.
 */
export function stillLegal(s, it) {
  if (!it.targets.length || (it.kind !== "spell" && it.name !== "@sanct")) return true;
  const all = targetLists(s, it.ctl, it.name, it.mode || 0, [it.sid]).flat();
  return it.targets.some(t => all.some(x => same(x, t)) && (t.k !== "c" || t.oid == null || perm(s, t.id)?.oid === t.oid));
}

// ---------- a Mind Bend's choices ----------
/** The basic land types in a permanent's text, which Mind Bend can change. */
export function bendable(p) {
  const d = defOf(p.id), out = new Set();
  if (d.type === "land") { for (const t of typesOf(p)) if (BASICS.includes(t)) out.add(t); for (const t of fetchTypes(p)) out.add(t); }
  if (nm(p.id) === "Dandân") out.add(needType(p));
  return [...out];
}

/** A card of the library an Island or Plains search finds: its own types, as printed. */
export const hasType = (id, types) => id < TOKEN_AT && (defOf(id).subs || []).some(t => types.includes(t));

// ---------- resolutions ----------
const nextToken = s => TOKEN_AT + (s.nt = (s.nt || 0) + 1);

/** The resolutions by name: (s, item) → "done" or "wait". An item's step says where it carries on. */
export const RES = {
  "Dandân"(s, it) { enterBf(s, it.card, it.ctl); it.moved = true; say(s, `{s${it.ctl}}'s Dandân comes in`); return "done"; },

  "Brainstorm"(s, it) {
    if (it.step === 0) {
      draw(s, it.ctl, 3);
      const n = Math.min(2, s.hand[it.ctl].length);
      if (n) return ask(s, it, { t: "putback", seat: it.ctl, n }, 1);
    }
    return "done";
  },
  "Commit"(s, it) {
    const t = it.targets[0];
    if (t.k === "s") { const x = itemOf(s, t.sid); if (x) { say(s, `${x.name} goes second from the top`); leaveStack(s, x, "libsecond"); } }
    else { say(s, `${nm(t.id)} goes second from the top`); permToLib(s, t.id, "second"); }
    return "done";
  },
  "Memory"(s, it) {
    if (it.step === 0) {
      for (const seat of [0, 1]) handToLib(s, seat);
      s.lib.push(...s.yard);
      s.yard = [];
      shuffleLib(s);
      for (let i = 0; i < 7; i++) for (const seat of [s.active, other(s.active)]) draw(s, seat, 1);
      say(s, "Hands and graveyard are shuffled in, and each draws seven");
    }
    return "done";
  },
  "Memory Lapse"(s, it) {
    const x = itemOf(s, it.targets[0].sid);
    if (x) { say(s, `${x.name} is countered and goes on top of the library`); leaveStack(s, x, "libtop"); }
    return "done";
  },
  "Metamorphose"(s, it) {
    if (it.step === 0) {
      const p = perm(s, it.targets[0].id), opp = p.ctl;
      say(s, `${nm(p.id)} goes on top of the library`);
      permToLib(s, p.id, "top");
      const ids = s.hand[opp].filter(id => ["creature", "land"].includes(defOf(id).type));
      if (ids.length) return ask(s, it, { t: "pick", seat: opp, ids, for: "drop", optional: true }, 1);
    }
    return "done";
  },
  "Mind Bend"(s, it) {
    if (it.step === 0) {
      const p = perm(s, it.targets[0].id), froms = bendable(p);
      if (froms.length) return ask(s, it, { t: "bend", seat: it.ctl, froms, target: p.id }, 1);
      say(s, `Mind Bend finds nothing to change in ${nm(p.id)}`);
    }
    return "done";
  },
  "Narset's Reversal"(s, it) {
    if (it.step === 0) {
      const x = itemOf(s, it.targets[0].sid);
      const c = pushItem(s, { kind: "spell", name: x.name, card: x.card, ctl: it.ctl, targets: x.targets.map(t => ({ ...t })), mode: x.mode || 0, copy: true });
      say(s, `${x.name} is copied, and the original returns to its owner's hand`);
      leaveStack(s, x, "hand");
      if (c.targets.length) {
        // new targets for the copy, when there's a choice: another target, or the one legal target in place of a lost one.
        // The Reversal itself is still on the stack as it resolves, so a copied counter may be aimed at it, to fizzle
        // when it has gone, rather than at a spell of our own
        const options = targetLists(s, it.ctl, c.name, c.mode, [c.sid]).filter(l => l.length);
        if (options.length > 1 || (options.length === 1 && !same(options[0][0], c.targets[0]))) return ask(s, it, { t: "retarget", seat: it.ctl, copy: c.sid, options }, 1);
      }
    }
    return "done";
  },
  "Piracy Charm"(s, it) {
    if (it.step === 0) {
      const t = it.targets[0];
      if (it.mode === 0) { perm(s, t.id).walk = true; say(s, `${nm(t.id)} gains islandwalk`); }
      else if (it.mode === 1) { const p = perm(s, t.id); p.pump = [(p.pump?.[0] || 0) + 2, (p.pump?.[1] || 0) - 1]; say(s, `${nm(t.id)} gets +2/−1`); }
      else if (s.hand[t.seat].length) return ask(s, it, { t: "discard", seat: t.seat, n: 1, why: "Piracy Charm" }, 1);
    }
    return "done";
  },
  "Predict"(s, it) {
    if (it.step === 0) return ask(s, it, { t: "name", seat: it.ctl }, 1);
    const milled = mill(s, 1), hit = milled.length > 0 && DECK[milled[0]] === it.d.name;
    say(s, milled.length ? `Predict mills ${nm(milled[0])}: ${hit ? "a hit, draw two" : "a miss, draw one"}` : "Predict mills nothing: draw one");
    draw(s, it.ctl, hit ? 2 : 1);
    return "done";
  },
  "Quicken"(s, it) { s.quick[it.ctl] = true; draw(s, it.ctl, 1); return "done"; },
  "Repulse"(s, it) {
    const id = it.targets[0].id;
    say(s, `${nm(id)} returns to its owner's hand`);
    bounce(s, id);
    draw(s, it.ctl, 1);
    return "done";
  },
  "Chart a Course"(s, it) {
    if (it.step === 0) {
      draw(s, it.ctl, 2);
      if (!(s.active === it.ctl && s.attacked) && s.hand[it.ctl].length) return ask(s, it, { t: "discard", seat: it.ctl, n: 1, why: "Chart a Course" }, 1);
    }
    return "done";
  },
  "Deem Inferior"(s, it) {
    if (it.step === 0) {
      const p = perm(s, it.targets[0].id);
      if (isToken(p.id)) { leaveBf(s, p.id); return "done"; }
      return ask(s, it, { t: "owner", seat: p.ctl, target: p.id }, 1);
    }
    return "done";
  },
  "Gone Missing"(s, it) {
    const id = it.targets[0].id;
    say(s, `${nm(id)} goes on top of the library`);
    permToLib(s, id, "top");
    enterBf(s, nextToken(s), it.ctl);
    return "done";
  },
  "Lórien Revealed"(s, it) { draw(s, it.ctl, 3); return "done"; },
  "Mystic Retrieval"(s, it) {
    const id = it.targets[0].id;
    if (fromYard(s, id)) { toHandOpen(s, it.ctl, id); say(s, `${nm(id)} returns from the graveyard to hand`); }
    return "done";
  },
  "Take Inventory"(s, it) {
    draw(s, it.ctl, 1);
    draw(s, it.ctl, s.yard.filter(id => DECK[id] === "Take Inventory").length);
    return "done";
  },

  // abilities
  "@fetch"(s, it) {
    if (it.step === 0) {
      const ids = s.lib.filter(id => hasType(id, it.d.types));
      if (ids.length) return ask(s, it, { t: "search", seat: it.ctl, ids, to: "bf" }, 1);
      say(s, "The search finds nothing");
      shuffleLib(s);
    }
    return "done";
  },
  "@isle"(s, it) {
    if (it.step === 0) {
      const ids = s.lib.filter(id => hasType(id, ["Island"]));
      if (ids.length) return ask(s, it, { t: "search", seat: it.ctl, ids, to: "hand" }, 1);
      say(s, "The search finds no Island");
      shuffleLib(s);
    }
    return "done";
  },
  "@cycle"(s, it) { draw(s, it.ctl, 1); return "done"; },
  "@clue"(s, it) { draw(s, it.ctl, 1); return "done"; },
  "@dandan"(s, it) {
    // the Dandân it triggered for: if that one left (bounced and back is another object), there's nothing to sacrifice
    const p = perm(s, it.src);
    if (p && (it.oid == null || p.oid === it.oid)) { say(s, `{s${p.ctl}}'s Dandân is sacrificed`); toGrave(s, p.id); }
    return "done";
  },

  // enters-the-battlefield triggers
  "@depths"(s, it) {
    if (it.step === 0) {
      const ids = s.lib.slice(0, 3);
      for (const id of ids) knSet(s, id, knOf(s, id) | (1 << it.ctl));
      if (ids.length > 1) return ask(s, it, { t: "order", seat: it.ctl, cards: ids }, 1);
    }
    return "done";
  },
  "@falls"(s, it) {
    if (it.step === 0 && s.lib.length) {
      const id = s.lib[0];
      knSet(s, id, knOf(s, id) | (1 << it.ctl));
      return ask(s, it, { t: "surveil", seat: it.ctl, card: id }, 1);
    }
    return "done";
  },
  "@boil"(s, it) {
    if (it.step === 0) {
      const ids = s.bf.filter(p => p.ctl === it.ctl && isLand(p)).map(p => p.id);
      if (ids.length) return ask(s, it, { t: "pick", seat: it.ctl, ids, for: "boil" }, 1);
    }
    return "done";
  },
  // its target was chosen as it triggered (the engine's aim); a target gone from the graveyard has fizzled it already
  "@sanct"(s, it) {
    const t = it.targets[0];
    if (t && fromYard(s, t.id)) { toLib(s, t.id, "top", BOTH); say(s, `${nm(t.id)} goes on top of the library`); }
    return "done";
  },
};
