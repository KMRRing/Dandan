# Modern: the first pool (parked)

Korbi, 17 November 2026 (19:13–19:25 Kyiv): the plan for the general engine's first Modern matchups, written down and parked
while Dandân's learning loop comes first. Nothing here is built yet.

## The five decks

From MTGGoldfish's Modern metagame page, last 30 days, as read on 17 November 2026:

| Deck | Share | Why |
|---|---|---|
| Eldrazi Ramp | 12.5% | the most-played deck; ramp |
| Affinity | 8.0% | artifact aggro |
| Amulet Titan | 6.1% | the combo deck, and the largest rules job (Amulet of Vigor with bounce lands, Summoner's Pact, Primeval Titan) |
| Boros Energy | 5.8% | aggro; Jeskai Energy (3.4%) as its variant |
| Rakdos Midrange | 4.6% | midrange; Korbi's deck, the playstyle he enjoys |

Plus Korbi's own variant of Rakdos splashing blue (Grixis) with Stubborn Denial. Grixis Midrange/Control are 0.3–0.4% and
Stubborn Denial is barely played in Modern now; whether the splash is worth it is the engine's first card-evaluation question.

About 37% of the decks (41% with Jeskai Energy); a game has both decks in the pool about one time in six, so this pool proves
the pipeline, not the meta. Selling matchup reports needs the 20–25-deck tier (80–85% of decks, about 70% of games).

Left out: Izzet Prowess (5.0%, the first reserve), Azorius Control (1.4%), Mono-Green Broodscale (1.2%; its infinite loop needs
the engine to shortcut loops, a general feature for later). Gemini's metagame tables (17 Nov) were checked and found wrong.

## The order

1. The card pool: every card of the six lists' recent real versions, the flex cards included (the rules are the cost; varying a
   list afterwards is free).
2. Fixed lists first (the most common list of each), to find the rules bugs and get the loop sound.
3. Then each game deals real published lists (core plus flex slots as often as players choose them), with about a fifth of the
   lists held out of training to test the belief net that reads which deck and which list the other player has.
4. Self-improving decks (swap a card from the pool, keep it if it wins more) only once the play is strong: weak play judges
   cards wrong, and decks changing while the policy learns mix up better cards with better play. Stubborn Denial first.
