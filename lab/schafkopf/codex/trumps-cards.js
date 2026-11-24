// Trumps' cards: one numbering for every pack (a card is its suit × 9 + its rank, the ranks 6 to ace), and each pack's
// suits and names: the Swiss pack Jass is played with in German-speaking Switzerland (bells, shields, roses, acorns),
// the German pack of Schafkopf (bells, hearts, leaves, acorns), the French of Belote and of Jass in Romandy. Which of
// the four suits a pack calls what is fixed per game (trumps-games.js), so a card id means the same card everywhere.
// The Swiss and German cards are drawn here (the page and the course both draw them), the French by cards.js.
export const RANKS = ["6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const cid = (s, r) => s * 9 + RANKS.indexOf(r);
export const suitOf = id => Math.floor(id / 9);
export const rankOf = id => RANKS[id % 9];
/** A pack of cards from a lowest rank up: 36 from the six (Jass), 32 from the seven (Belote, Schafkopf). */
export const deckFrom = low => Array.from({ length: 4 }, (_, s) => RANKS.slice(RANKS.indexOf(low)).map(r => cid(s, r))).flat();

/**
 * The packs: each suit's name (in the pack's language and in English), its mark for French cards, and what each rank is
 * called and lettered. The court cards of the Swiss and German packs are the Under (U), the Ober (O) and the King; the
 * ten of the Swiss pack is the Banner.
 */
export const PACKS = {
  swiss: { suits: ["Schellen", "Schilten", "Rosen", "Eicheln"], en: ["bells", "shields", "roses", "acorns"],
    rank: { 6: "6", 7: "7", 8: "8", 9: "9", T: "10", J: "U", Q: "O", K: "K", A: "A" }, names: { T: "Banner", J: "Under", Q: "Ober", K: "König", A: "Ass" } },
  german: { suits: ["Schellen", "Herz", "Gras", "Eichel"], en: ["bells", "hearts", "leaves", "acorns"],
    rank: { 6: "6", 7: "7", 8: "8", 9: "9", T: "10", J: "U", Q: "O", K: "K", A: "A" }, names: { T: "Zehner", J: "Unter", Q: "Ober", K: "König", A: "Sau" } },
  // French: the suit index in cards.js's order (♦ ♣ ♥ ♠) is the card's suit itself
  french: { suits: ["♦", "♣", "♥", "♠"], en: ["diamonds", "clubs", "hearts", "spades"],
    rank: { 6: "6", 7: "7", 8: "8", 9: "9", T: "10", J: "J", Q: "Q", K: "K", A: "A" }, names: { T: "ten", J: "jack", Q: "queen", K: "king", A: "ace" } },
};
/** How a Jass suit (bells, shields, roses, acorns) is drawn in the French pack: ♦, ♠, ♥, ♣. */
export const JASS_FRENCH = [0, 3, 2, 1];
/** A card's name in words, for a screen reader and the log: "Under of acorns", "10 of hearts". */
export function cardName(id, pack, suitMap = null) {
  const p = PACKS[pack], r = rankOf(id), s = suitMap ? suitMap[suitOf(id)] : suitOf(id);
  const rank = pack === "french" ? (p.names[r] || r) : (p.names[r] || r);
  return `${rank} of ${p.en[s]}`;
}

import { cardArt } from "./trumps-art.js";

// the Swiss and German packs' suit marks, drawn: bells, shields, roses, acorns; hearts, leaves
const ICONS = {
  bell: `<svg viewBox="0 0 20 20"><path d="M10 2.2a1.6 1.6 0 1 1 0 .01M4.6 9.5a5.4 5.4 0 0 1 10.8 0v3.6l1.6 2.1H3l1.6-2.1z" fill="#E1A82E" stroke="#5A3A12" stroke-width="1.1"/><path d="M4.8 11.6h10.4" stroke="#B3302A" stroke-width="1.6"/><circle cx="10" cy="16.6" r="1.6" fill="#5A3A12"/></svg>`,
  shield: `<svg viewBox="0 0 20 20"><path d="M3.5 3h13v6.5c0 4.2-3 6.7-6.5 8.2-3.5-1.5-6.5-4-6.5-8.2z" fill="#E1A82E" stroke="#3B2A12" stroke-width="1.1"/><path d="M3.6 3.1 16.4 13.8" stroke="#B3302A" stroke-width="3"/><path d="M10 3v14.5" stroke="#1E2730" stroke-width="1.1"/></svg>`,
  rose: `<svg viewBox="0 0 20 20"><path d="M5 15.5 2.4 18M15 15.5l2.6 2.5" stroke="#2F7D3B" stroke-width="1.6" stroke-linecap="round"/><g fill="#C2312A" stroke="#6E1610" stroke-width=".9"><circle cx="10" cy="5.2" r="3.3"/><circle cx="14.6" cy="8.6" r="3.3"/><circle cx="12.9" cy="14" r="3.3"/><circle cx="7.1" cy="14" r="3.3"/><circle cx="5.4" cy="8.6" r="3.3"/></g><circle cx="10" cy="10.2" r="2.8" fill="#E8C24A" stroke="#6E1610" stroke-width=".9"/></svg>`,
  acorn: `<svg viewBox="0 0 20 20"><path d="M10 1.8v2.4" stroke="#4A3016" stroke-width="1.4" stroke-linecap="round"/><path d="M4.6 8.4c0-2.8 2.4-4.4 5.4-4.4s5.4 1.6 5.4 4.4z" fill="#7A5226" stroke="#3A2410" stroke-width="1"/><path d="M5.4 8.4h9.2c0 5-2 9-4.6 9.6-2.6-.6-4.6-4.6-4.6-9.6z" fill="#D9A441" stroke="#5A3A12" stroke-width="1"/><path d="M6 6.4h8M5.4 7.6h9.2" stroke="#3A2410" stroke-width=".6" opacity=".6"/></svg>`,
  heart: `<svg viewBox="0 0 20 20"><path d="M10 17.6C4.2 13.2 2 10.2 2 7.2A4.2 4.2 0 0 1 10 5a4.2 4.2 0 0 1 8 2.2c0 3-2.2 6-8 10.4z" fill="#C2312A" stroke="#6E1610" stroke-width="1"/></svg>`,
  leaf: `<svg viewBox="0 0 20 20"><path d="M10 18.4V10M10 2C5 5.4 4.2 10.6 10 15.6 15.8 10.6 15 5.4 10 2z" fill="#3E8E3A" stroke="#1E4A1C" stroke-width="1.1" stroke-linejoin="round"/><path d="M10 4.4v11M10 7.6 7.4 6M10 10.4 7 8.6M10 7.6 12.6 6M10 10.4 13 8.6" stroke="#1E4A1C" stroke-width=".7"/></svg>`,
};
const SUIT_ICON = { swiss: ["bell", "shield", "rose", "acorn"], german: ["bell", "heart", "leaf", "acorn"] };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** A suit's mark, drawn, in the Swiss or German pack. */
export const suitIcon = (pack, suit) => ICONS[SUIT_ICON[pack][suit]];
/** The German pack as the whole Bavarian pack, while the page has it on: a card's id to its picture (trumps-deck.js),
 *  else null. */
export const LOOK = { german: null };
/** A Swiss or German card as markup (the French are cards.js's): its rank and suit in the corner, the suit large at its
 *  foot; or, with the German pack's pictures on, the card's picture. */
export function packCard(id, pack, { cls = "", data = {} } = {}) {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join(""), pic = pack === "german" ? LOOK.german?.[id] : null;
  if (pic) return `<span class="cd tr-cd german pic${cls ? ` ${cls}` : ""}"${attrs} role="img" aria-label="${esc(cardName(id, pack))}"><img src="${pic}" alt="" draggable="false" decoding="async"></span>`;
  // the face is one drawing (trumps-art.js)
  return `<span class="cd tr-cd vec ${pack}${cls ? ` ${cls}` : ""}"${attrs} role="img" aria-label="${esc(cardName(id, pack))}">${cardArt(pack, rankOf(id), suitOf(id), PACKS[pack].rank[rankOf(id)])}</span>`;
}
