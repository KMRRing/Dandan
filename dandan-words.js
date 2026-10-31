// A move in words, as an instruction without its capital ("cast Memory Lapse on their Dandân", "pass"): what Hard's
// look-ahead (dandan-think.js) calls the other player's first answer in each deal it plays out. The coach of the
// Almanac's Dandan used these words to explain; here there is no coach, and nothing shows them, but the search still
// keeps them as it did, so its play is exactly the same.
import { CARDS, DECK, HALVES } from "./dandan-cards.js";
import { halfOf } from "./dandan-engine.js";
import { nm, perm, isCreature, itemOf } from "./dandan-core.js";

const front = id => (HALVES[DECK[id]] ? HALVES[DECK[id]][0] : DECK[id]);
// ---------- a move by name ----------
/** A permanent or spell as the seat would call it: "their Dandân", "your Island", "their Brainstorm". */
function thing(s, seat, t) {
  if (!t) return "";
  if (t.k === "p") return t.seat === seat ? "yourself" : "them";
  if (t.k === "g") return `${nm(t.id)} in the graveyard`;
  if (t.k === "s") { const it = itemOf(s, t.sid); return it ? `${it.ctl === seat ? "your" : "their"} ${spellName(it)}` : "a spell"; }
  const p = perm(s, t.id);
  return p ? `${p.ctl === seat ? "your" : "their"} ${nm(t.id)}` : nm(t.id);
}
const STACK_NAMES = { "@fetch": "Flood Plain search", "@isle": "islandcycling", "@cycle": "cycling", "@clue": "Clue", "@dandan": "Dandân sacrifice",
  "@depths": "Halimar Depths look", "@falls": "surveil", "@boil": "Izzet Boilerworks return", "@sanct": "Mystic Sanctuary" };
const spellName = it => STACK_NAMES[it.name] || it.name;
const MODE = ["for islandwalk", "for +2/−1", "for a discard"];
const handNames = ids => ids.map(nm).join(" and ");

/** A move in words, as an instruction without its capital: "cast Memory Lapse on their Dandân", "pass". */
export function moveName(m, s, seat) {
  if (!m) return "";
  switch (m.t) {
    case "pass": return s.stack.length ? "let it resolve" : "pass";
    case "land": return `play ${nm(m.card)}`;
    case "cast": {
      const half = m.from === "yard" ? halfOf(m.card, "yard") : front(m.card);
      const how = CARDS[half]?.modes ? ` ${MODE[m.mode ?? 0]}` : "";
      const t = m.targets?.[0];
      const on = !t ? "" : t.k === "g" ? ` for ${nm(t.id)}` : ` on ${thing(s, seat, t)}`;
      const flash = m.from === "yard" ? (CARDS[half]?.flashback ? " with flashback" : " from the graveyard") : "";
      return `cast ${half}${how}${on}${flash}`;
    }
    case "cycle": return `${CARDS[front(m.card)]?.islandcycling ? "islandcycle" : "cycle"} ${nm(m.card)}`;
    case "ability": return nm(m.id) === "Clue" ? "crack the Clue" : "sacrifice Flood Plain for an Island";
    case "keep": return "keep this hand";
    case "mull": return s.pending?.free || s.pending?.first ? "take the free mulligan" : "take a mulligan";
    case "bottom": return `put ${handNames(m.cards || [])} on the bottom`;
    case "discard": return `discard ${handNames(m.cards || [])}`;
    case "putback": return (m.cards || []).length > 1 ? `put back ${nm(m.cards[0])} on top and ${nm(m.cards[1])} under it` : `put back ${handNames(m.cards || [])}`;
    case "attack": {
      const n = (m.ids || []).length, all = s.pending?.ids?.length || n;
      return !n ? "don't attack" : n === all && n > 1 ? `attack with all ${n} Dandâns` : `attack with ${n === 1 ? "one Dandân" : `${n} Dandâns`}`;
    }
    case "block": { const n = (m.pairs || []).length; return !n ? "don't block" : `block ${n === 1 ? "their attacker" : `${n} attackers`}`; }
    case "order": return `put them ${(m.cards || []).map(nm).join(", ")}, the first on top`;
    case "surveil": return m.yard ? `put ${nm(s.pending?.card)} in the graveyard` : `keep ${nm(s.pending?.card)} on top`;
    case "search": return m.card == null ? "find nothing" : `${s.pending?.to === "bf" ? "fetch" : "find"} ${nm(m.card)}`;
    case "pick": {
      if (m.card == null) return s.pending?.for === "sanct" ? "put nothing on top" : "put nothing in";
      return s.pending?.for === "boil" ? `return ${nm(m.card)}` : s.pending?.for === "drop" ? `put ${nm(m.card)} onto the battlefield` : `put ${nm(m.card)} on top`;
    }
    case "owner": return m.bottom ? "put it on the bottom" : "put it second from the top";
    case "bend": {
      const t = perm(s, s.pending?.target);
      return t && isCreature(t) ? `make it look for a ${m.to} instead of an ${m.from}` : `turn its ${m.from} into a ${m.to}`;
    }
    case "name": return `name ${m.name}`;
    case "retarget": {
      if (!m.targets?.length) return "keep the copy's target";
      const t = m.targets[0], it = t.k === "s" ? itemOf(s, t.sid) : null;
      if (it && it.sid === s.pending?.sid) return "aim the copy at your Reversal, so it does nothing";
      return `aim the copy at ${thing(s, seat, t)}`;
    }
  }
  return "";
}
