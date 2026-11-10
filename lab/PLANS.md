# Plans: the styles Hard can choose between

Korbi, 10 November 2026: Monte's early tempo play is very strong (it beats strong human players about 70% of the time), but
in the mid and late game strong players squeeze it: they dispose of its threats efficiently, take selective two-for-ones and
build a mana edge, so the mana-hungry equalizers (Mystic Retrieval, Commit // Memory) are theirs and not Monte's. The judge
learned from Medium against Medium, so it values positions as worth what they are when two tempo players continue; it
underprices the card and the mana lead (lab/LEDGER.md: res1, ar1).

The way out: a few plan bots, each a Medium variant that plays one plan well; Hard weighs a move under each (its own plan
against the other's most dangerous reply, the plan kept unless another is clearly better), playing the mid game out to the
end rather than taking the judge's word two turns on; and the judge, later, trained on games of that Hard against itself.
Budget: three or four plans. Tempo is today's Medium. Squeeze and deck are below. The fourth is left open for whatever the
judge and the results still disagree about once these are in.

Each plan bot is first checked on its own: against today's Medium from mid-game positions (lab/quick-match.mjs `late`), and
read by Korbi. A clumsy plan bot would teach Hard that the plan doesn't work.

## Tempo (today's Medium)

Develop threats early, force the other player to answer on your schedule, race the damage. Kept as it is.

## Squeeze: win the exchange, then the game

Survive comfortably, trade so the other player is always one for one or worse, grow the mana lead, own the equalizers, and
only then turn the advantage into a win.

1. **Triage threats by the clock.** A Dandân is a threat in proportion to how soon it kills (turns to death with what can
   already hit). Far from death, let it resolve: answer it later, cheaply, on your own terms (Piracy Charm, Mind Bend,
   Metamorphose, Deem Inferior with card draw behind it, Repulse, Gone Missing), when the other player has tapped out.
   Spend a counter on a Dandân only when it brings death within reach or the answer later would cost more than the counter.
2. **Count every exchange.** Prefer plays that leave the card count even or better: one for one at worst, two for one when
   offered (a counter on a spell that would gain them a card, an answer that also strands a second card, a Retrieval or
   Memory denied when they are behind on cards). Never spend two cards on one, nor a card on something that would not have
   gained them anything. Keep count of the Take Inventories in the graveyard (each makes the next one draw more): theirs to
   deny, yours to build.
3. **Don't feed their counters; hold two up.** Holding two mana open for a squeezing answer comes before casting a Dandân
   whenever there is something in hand to squeeze with. Cast threats when the other player is tapped low or has just spent
   a counter, or with a counter of your own to back it, not into open mana and likely answers (the reads of their hand: a
   chance to answer our Dandân passed up counts against them holding one).
4. **Grow the mana, and plan to stay ahead on it.** A land every turn, ahead of anything else; cycle or dig to find it, and
   keep the next land drops in sight (lands in hand, the draws to find them), not just this turn's. Leave mana open on
   their turn and, when it isn't needed, spend it at their end step on drawing (Quicken, Brainstorm, Predict, Chart a
   Course's like): mana unspent at their end step, about to untap, is the one resource wasted.
5. **Own the equalizers.** Cast Mystic Retrieval and Memory when the mana edge lets you back them with a counter; deny
   theirs: hold a counter for their Memory when they are behind on cards, keep what their Retrieval would find out of the
   graveyard when they have its mana.
6. **Close when it's safe.** Once three or more cards ahead with a counter in hand and the clock comfortable, deploy threats
   with backup: the squeeze ends in tempo, on your terms.

## Shared by every plan: the tactics

Korbi: squeeze must play the smartest of all, and much of it belongs to every plan bot, as some of these plays are extremely
powerful. Every time priority comes to a bot with an action available, it weighs its options (never an automatic pass).
Open mana is worth a lot during the other player's turn and little at their end step, when it is about to untap.

The tactics, a growing list (each one also a puzzle in the tests: a position where it is the right play, which every bot
must find):

- **Repulse at our Dandân (or any targeted spell at it):** Mind Bend the target again so it is no longer a legal target,
  and the spell fizzles.
- **Mystic Retrieval at a spell in the graveyard:** take that spell first, at instant speed, with Mystic Sanctuary (it
  goes on top of the library instead), and the Retrieval fizzles.
- **Predict:** draw the known card first, shuffle the library, or cast our own Predict before theirs resolves.
- **Take Inventory:** count the copies in the graveyard (each adds a card to the next). Don't cast the first one into
  an opponent known to hold one: let them go first and draw the extra card off theirs.

### Holding mana (Korbi, 10 November 2026)

Hold mana open in their turn when either:
1. we hold an instant draw (Predict) and don't need the card now, because the land for the turn is already played; or
2. we hold many reactive spells, counterspells above all.

His examples, each a test position (4 mana in all of them):
- Take Inventory + Memory Lapse: cast Take Inventory, unless we *know* they hold a Take Inventory too: ours in the
  graveyard would give theirs an extra card. Never be the one who sets up their Take Inventory.
- Take Inventory + 2 Memory Lapse: cast nothing, keep it all open.
- Predict + Take Inventory + Memory Lapse, land for the turn not yet played: cast Take Inventory (most likely), since it
  can find the land.
- Same hand, land already played: keep Predict and Memory Lapse open. Predict when they make a play at the top of the
  library; Memory Lapse a strong play of theirs, or a spell aimed at stopping our Predict.

## Deck: win the library race

The library is shared; whoever must draw from it empty loses. A player behind on the board but ahead on answers can win by
making sure it is the other one who draws last.

1. **Count.** From when the library is short enough to matter (the cards left against the draws both players will
   certainly make, about two turns' worth a turn), track who draws from it empty with no one changing the count.
2. **Change the count only when it helps, and late.** The tools that change it: drawing extra (Brainstorm, Lórien Revealed,
   Take Inventory, Chart a Course, Predict's draw, cycling), milling (Predict), putting cards back (Commit, Gone Missing,
   Mystic Sanctuary, Brainstorm's two). Keep them for the last moment, when the other player can no longer answer.
3. **Deny theirs.** Hold counters for their count-changing spells, above all Memory (it reshuffles and resets the race).
4. **Just survive.** Answer only what would kill before the library does; threats of your own matter only to force their
   answers. Don't draw when it hands them the race.
5. **Go back to the other plans** when the count can't be won.

## Open

The fourth plan: kept for a divergence between the judge's verdicts and the results that persists once squeeze and deck are
in (lab/residuals.mjs and lab/swings.mjs, on self-play and on the kept games, say where).
