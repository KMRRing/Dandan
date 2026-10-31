// Dandan's cards: the 80 of Dave's Dandan list, the communal deck of the Forgetful Fish format (Magic: The Gathering),
// as data. The rules text on the page is in our own words; what each card does is in dandan-spells.js, checked against
// the texts below. Every cost and text was read from a source, not recalled:
//   · text: the card pages at tappedout.net (https://tappedout.net/mtg-card/<name>/), the same site as the list itself
//     (https://tappedout.net/mtg-decks/daves-dandan/, read 19 Oct 2026: 80 in the main deck, 6 in the sideboard)
//   · cost and type: api.magicthegathering.io/v1/cards?name=… (every card), Deem Inferior's from scryfall.com/card/mh3/57
// The sideboard (Fire // Ice, Mission Briefing, More or Less) isn't played in this format and isn't here.

/** Basic land types: what Mind Bend can change one into another. */
export const BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
/** The colour a basic land type taps for. */
export const BASIC_MANA = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };

/**
 * name: { cost "{1}{U}", type, subs (land types), pt, mana (printed mana abilities: alternatives of colour lists),
 * tapped (enters tapped), text (ours), flash (an instant), src }.
 * A split card's halves are two entries, "Commit" and "Memory", under the one card "Commit // Memory" in DECK.
 */
export const CARDS = {
  "Island": { cost: "", type: "land", subs: ["Island"], basic: true, text: "Basic land. Taps for blue mana, and counts as an Island, which Dandâns need.", src: "basic land type; the list" },
  "Flood Plain": { cost: "", type: "land", subs: [], tapped: true, fetch: ["Plains", "Island"], text: "Enters tapped. Tap and sacrifice it to fetch a Plains or Island card from the library onto the battlefield, then shuffle.", src: "tappedout.net/mtg-card/flood-plain" },
  "Halimar Depths": { cost: "", type: "land", subs: [], tapped: true, mana: [["U"]], text: "Enters tapped, and you look at the top three cards of the library and put them back in any order. Taps for blue.", src: "tappedout.net/mtg-card/halimar-depths" },
  "Izzet Boilerworks": { cost: "", type: "land", subs: [], tapped: true, mana: [["U", "R"]], text: "Enters tapped, and you return a land you control to your hand. Taps for blue and red together.", src: "tappedout.net/mtg-card/izzet-boilerworks" },
  "Lonely Sandbar": { cost: "", type: "land", subs: [], tapped: true, mana: [["U"]], cycling: "{U}", text: "Enters tapped. Taps for blue. Cycling {U}: discard it from your hand to draw a card.", src: "tappedout.net/mtg-card/lonely-sandbar" },
  "Mystic Sanctuary": { cost: "", type: "land", subs: ["Island"], text: "An Island. Enters tapped unless you control three or more other Islands; if it enters untapped, you may put an instant or sorcery card from the graveyard on top of the library.", src: "tappedout.net/mtg-card/mystic-sanctuary" },
  "Remote Isle": { cost: "", type: "land", subs: [], tapped: true, mana: [["U"]], cycling: "{2}", text: "Enters tapped. Taps for blue. Cycling {2}: discard it from your hand to draw a card.", src: "tappedout.net/mtg-card/remote-isle" },
  "Thundering Falls": { cost: "", type: "land", subs: ["Island", "Mountain"], tapped: true, text: "An Island and a Mountain: taps for blue or red. Enters tapped, and you surveil 1 (look at the top card; it may go to the graveyard).", src: "tappedout.net/mtg-card/thundering-falls" },

  "Dandân": { cost: "{U}{U}", type: "creature", pt: [4, 1], text: "4/1 Fish. Can't attack unless the defending player controls an Island. Sacrifice it as soon as you control no Islands.", src: "tappedout.net/mtg-card/dandan; magicthegathering.io (4/1, {U}{U})" },

  "Brainstorm": { cost: "{U}", type: "instant", text: "Draw three cards, then put two cards from your hand back on top of the library, in the order you like.", src: "tappedout.net/mtg-card/brainstorm" },
  "Commit": { cost: "{3}{U}", type: "instant", text: "Put a spell on the stack, or a nonland permanent, into its owner's library, second from the top.", src: "tappedout.net/mtg-card/commit-memory" },
  "Memory": { cost: "{4}{U}{U}", type: "sorcery", aftermath: true, text: "Aftermath: cast only from the graveyard, and then exiled. Each player shuffles their hand and the graveyard into the library, then draws seven cards.", src: "tappedout.net/mtg-card/commit-memory" },
  "Memory Lapse": { cost: "{1}{U}", type: "instant", text: "Counter a spell. It goes on top of the library instead of into the graveyard.", src: "tappedout.net/mtg-card/memory-lapse" },
  "Metamorphose": { cost: "{1}{U}", type: "instant", text: "Put a permanent an opponent controls on top of the library. That opponent may then put an artifact, creature, enchantment or land card from their hand onto the battlefield.", src: "tappedout.net/mtg-card/metamorphose" },
  "Mind Bend": { cost: "{U}", type: "instant", text: "Change a permanent's text by swapping one basic land type for another, for good. A Dandân told to look for a Swamp is sacrificed; an Island told to be a Mountain taps for red.", src: "tappedout.net/mtg-card/mind-bend" },
  "Narset's Reversal": { cost: "{U}{U}", type: "instant", text: "Copy an instant or sorcery spell on the stack, choosing new targets for the copy if you like, and return the original to its owner's hand.", src: "tappedout.net/mtg-card/narsets-reversal" },
  "Piracy Charm": { cost: "{U}", type: "instant", modes: ["islandwalk", "pump", "discard"], text: "Choose one: a creature gains islandwalk until end of turn; or a creature gets +2/−1 until end of turn; or a player discards a card.", src: "tappedout.net/mtg-card/piracy-charm" },
  "Predict": { cost: "{1}{U}", type: "instant", text: "Name a card, then mill the top card of the library. If it has that name, draw two cards; otherwise draw one.", src: "tappedout.net/mtg-card/predict" },
  "Quicken": { cost: "{U}", type: "instant", text: "The next sorcery you cast this turn can be cast as though it had flash. Draw a card.", src: "tappedout.net/mtg-card/quicken" },
  "Repulse": { cost: "{2}{U}", type: "instant", text: "Return a creature to its owner's hand. Draw a card.", src: "tappedout.net/mtg-card/repulse" },

  "Chart a Course": { cost: "{1}{U}", type: "sorcery", text: "Draw two cards, then discard a card unless you attacked with a creature this turn.", src: "tappedout.net/mtg-card/chart-a-course" },
  "Deem Inferior": { cost: "{3}{U}", type: "sorcery", text: "Costs {1} less for each card you've drawn this turn. The owner of a nonland permanent puts it into the library second from the top, or on the bottom.", src: "tappedout.net/mtg-card/deem-inferior; scryfall.com/card/mh3/57" },
  "Gone Missing": { cost: "{4}{U}", type: "sorcery", text: "Put a permanent on top of its owner's library. Investigate: you get a Clue ({2}, sacrifice it: draw a card).", src: "tappedout.net/mtg-card/gone-missing" },
  "Lórien Revealed": { cost: "{3}{U}{U}", type: "sorcery", cycling: "{1}", islandcycling: true, text: "Draw three cards. Islandcycling {1}: pay {1} and discard it from your hand to fetch an Island card from the library, then shuffle.", src: "tappedout.net/mtg-card/lorien-revealed" },
  "Mystic Retrieval": { cost: "{3}{U}", type: "sorcery", flashback: "{2}{R}", text: "Return an instant or sorcery card from the graveyard to your hand. Flashback {2}{R}: cast it from the graveyard, then it is exiled.", src: "tappedout.net/mtg-card/mystic-retrieval" },
  "Take Inventory": { cost: "{1}{U}", type: "sorcery", text: "Draw a card, then draw a card for each Take Inventory in the graveyard.", src: "tappedout.net/mtg-card/take-inventory; magicthegathering.io ({1}{U})" },

  "Clue": { cost: "", type: "token", clue: "{2}", text: "Artifact token. {2}, sacrifice it: draw a card.", src: "Gone Missing's investigate" },
};

/** The 80 cards, in the list's order: a card's id is its place here. (Tokens are 100 and up.) */
const LIST = [
  ["Brainstorm", 2], ["Commit // Memory", 2], ["Memory Lapse", 8], ["Metamorphose", 2], ["Mind Bend", 2], ["Narset's Reversal", 2],
  ["Piracy Charm", 2], ["Predict", 2], ["Quicken", 2], ["Repulse", 2], ["Flood Plain", 2], ["Halimar Depths", 2], ["Island", 16],
  ["Izzet Boilerworks", 2], ["Lonely Sandbar", 2], ["Mystic Sanctuary", 2], ["Remote Isle", 2], ["Thundering Falls", 2],
  ["Chart a Course", 2], ["Deem Inferior", 2], ["Gone Missing", 2], ["Lórien Revealed", 2], ["Mystic Retrieval", 2], ["Take Inventory", 4], ["Dandân", 10],
];
export const DECK = LIST.flatMap(([n, k]) => Array(k).fill(n));
export const TOKEN_AT = 100;
/** The distinct names in the deck, as they're named for Predict. */
export const NAMES = LIST.map(([n]) => n);

/** The split card's halves. */
export const HALVES = { "Commit // Memory": ["Commit", "Memory"] };

/** A card id's name (the card, "Commit // Memory" for the split card; tokens by id). */
export const cardName = id => (id >= TOKEN_AT ? "Clue" : DECK[id]);
/** The entry of a card or half by name. */
export const def = name => CARDS[name];
export const isToken = id => id >= TOKEN_AT;

/** A cost string as numbers: "{3}{U}{U}" is { g: 3, U: 2, R: 0 } (a fresh object each time, read once per string). */
const COSTS = new Map();
export function parseCost(cost) {
  const k = String(cost || "");
  let c = COSTS.get(k);
  if (!c) {
    c = { g: 0, U: 0, R: 0 };
    for (const [, x] of k.matchAll(/\{(\w)\}/g)) {
      if (/\d/.test(x)) c.g += Number(x);
      else c[x] = (c[x] || 0) + 1;
    }
    COSTS.set(k, c);
  }
  return { ...c };
}
/** The mana value of a cost. */
export const total = c => c.g + c.U + c.R;
/** A cost as a short word, {2}{R}. */
export const costWords = cost => String(cost || "").replace(/\{(\w)\}/g, "$1");
