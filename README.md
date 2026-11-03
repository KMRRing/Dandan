# Dandan

A one-player page of Dandan, taken from the Almanac (Crates) and kept as it was: the same 80-card communal deck, the same
rules engine, the same computer player, the same 3D table. Open `index.html` from any web server (GitHub Pages serves it);
there is no build step.

Dandan is the Magic format played with one shared deck of 80 cards (16 Islands, 8 Memory Lapse, 10 Dandân and the rest).
Each player gets seven; a Dandân (4/1) can attack only a player who has an Island. You play against the computer, Monte.

## What is fixed here

The Almanac's Dandan has settings; this page has made the choices and removed the rest.

- **One player.** No inviting, no table, no watching: you sit down against the computer.
- **Dark Almanac only.** One look, night. No themes, no day mode.
- **3D table, full screen.** The tiled table, the header layout and the full-screen switch are gone.
- **The computer is always Hard, always thinking as long as it can** (the deepest setting: it plays out up to
  2,048 deals before each move, in a worker so the page stays free; "How the computer searches" below says why that many).
  Easier levels and shorter thinking are gone.
- **No coach, no review of your play, no revealed-card marks.** Nothing marks what you have seen of the other hand or
  of the library: you have to remember it.
- **No rules or cards pages, no copy log, no win/loss record, no other games.**

What you can change:

- **Computer's pace** (Menu): 3 s, which keeps what the computer did on the table for three seconds before its next
  move, or Tap to continue, which waits for you after each thing it does.
- **Hold priority when I cast** and **Choose which lands to tap**, the two small switches at the top of the screen
  (lit while on). Both are kept on the device.
- **Name** (Menu). You are asked it when you first open the page, and it can be changed any time. It is kept on the
  device (`dandan:name`).
- **Concede** (a concession counts as a loss). There is no New game in the menu: a game is played out or conceded, and
  the next is dealt from the sheet that ends it (or the button under a finished table). A reload resumes the game in hand.

## What differs from the Almanac's look

- **The Dandân's picture** is drawn again for this page (`dandan-art.js`): a heavy-jawed predator out of the dark water,
  teeth bared, an amber eye lit, light falling in shafts. The other twenty-four pictures are the Almanac's.
- **The hand** is a tenth larger and sits clear of the Pass button (the outer cards of the fan swing below the hand's
  box, which is why they once sat on it).
- **The rings that pulse round the player to move** (and the pair round a player you are aiming at, a step further out)
  are two outlines: a circle round the avatar and a rounded rectangle round its life, which sits on the avatar's corner.
  The circle lies under the life and is left open where the life is, so no line crosses it and the two rings never meet.
  (A circle alone ran through the life; one ring round both looked like a pill.)
- The computer's name is **Monte**, after the Monte Carlo search that picks its moves (it plays out many dealt-out games
  and keeps the move that does best); its card fan is packed closer so the name fits a phone's header.

## How the computer searches

Hard plays out many deals of the cards it can't see (the other hand, the library), each move down its own tree, and keeps
the move that does best on average (`dandan-think.js`). Two things were measured on 200 positions from Hard-against-Hard
games, each searched to 8,192 deals with nothing dropped, so any rule could be replayed on the record:

- **A move is dropped only at doublings (128, 256, 512... deals), when it trails the leader by more than three standard
  errors of the gap.** Before, it was every second deal at two standard errors. A move that is really the best trails by
  chance now and then, and a look every other deal over thousands of deals gives it a thousand chances to be dropped for
  good: in positions with a clear best move the old rule dropped it in 6% of searches at 4,096 deals, against 2% now. The
  longer the search ran, the more it gave away.
- **About 1,000 deals is where the choice stops changing:** from 1,024 to 4,096 deals the move chosen was no better in
  any kind of position (futile, close or clear), so Deepest is 2,048, which is better than the 4,096 it replaces (with the
  old rule) and about a quarter quicker. A 40-game match, current rule at 256 deals against the new rule at 128, scored
  52.5% for the current one, plus or minus 13: no difference a game can show, with a third less thinking.

- **Before the draw, the look-ahead lets both seats act.** The turns it plays out used to pass the upkeep for both players
  (unless a top card was known), as if nobody ever cracked a Flood Plain, cycled a land or cast Predict, Brainstorm or
  Quicken there. Now those are stops in the look-ahead (`predrawMove` in `dandan-engine.js`); an instant that only deals
  with a creature isn't, as it can as well be cast with the drawn card in hand. In 200 games against the version that
  passes there, it scored 53% plus or minus 7 at the same thinking time: not a gain a match can show, kept because the
  look-ahead should know what a player can do at that moment (Korbi's call).

What this measures is how well the search has settled on its own evaluation of a position (Medium's play out to the
second turn ahead, scored by the trained value network), not a true chance of winning: more deals of the same search can't
find what it doesn't model, so a stronger computer has to come from what each deal sees (the reads, how far ahead, the
evaluation), not from more deals.

## Medium, the quick player inside the search

The search plays every move that isn't in its own tree with Medium (`policyMove` in `dandan-policy.js`, a hand-written
scorer of moves): 50 to 80 percent of the moves in a look-ahead are Medium's, so how well Medium plays decides how
good the look-ahead is. Measured against the search, over 1,411 decisions taken from a look-ahead (every candidate valued
over 512 deals), Medium gave up about 1.6 win-percent points a decision and picked a different move from the search in a
third to a half of them.

The errors were sorted and the biggest corrected in `TUNE`, a handful of constants read by the scorer: a move must score
a full point to be played rather than pass; counters are worth 0.4 less, and a counter on a counter keeps only 0.6 of its
worth (it is tempo, not a spell); Dandân is cast a little more eagerly; Flood Plain and Izzet Boilerworks are played
later. They were fitted on each half of the positions and judged on the other half, and only what both fits agreed on
is kept (+0.4 to +0.5 points a decision on positions not fitted). One plain bug went with them: Narset's Reversal, held
against the other side's Memory Lapse or Commit on one's own spell, wasn't seen as an answer.

The first match, 126 games (63 deals, both seats each) at the same thinking time (about 610 ms a search against 560),
scored the version with this 55.6% plus or minus 8.3, and it was adopted on that at Korbi's call. It was a lucky start.
The same match run on GitHub Actions until its stopping rule ended it (Matches, above) scored 51.8% over 480 deals (960
games), 95% interval 48.8% to 54.7%: a gain of about two points that the match could not establish (it ended at its
cap, undecided), which is what a fit worth half a point a decision on positions held out would lead one to expect. It is
kept because it costs nothing and the evidence points the right way, not because it was shown better. A gain this size
needs some 4,000 deals to prove, so the changes worth testing are those of five points or more.
What would give more is replacing Medium in the rollouts with a policy learned from the search's own
choices; that is not built.

## Matches

A change to the computer is kept only if it is shown better than the current one in a match at the same thinking time.
A match plays each deal twice with the seats swapped (so a lucky deal cancels), and the search is counted in deals, not
seconds, so a result is the same on any machine. It is run from the Actions tab of the repository: Bot match, Run
workflow, with the candidate (a branch, tag or commit), the champion (the `champion` branch unless told otherwise) and
the search deals a decision (256; the deepest setting is 2,048).

It plays at least 30 deals (60 games), then looks again each time the deals played have doubled (60, 120, 240, 480), and
stops when the candidate is **shown better** than even, when it **can no longer reach 55%** (a gain worth having), or when
480 deals leave it undecided. Until then it goes on by itself: the last job of each run scores everything so far and
starts the next run. A candidate at 48% after 30 deals goes on, for it may still be 55% (Korbi's rule). Each look has to
clear a stricter bar than the one before (`lab/sequential.mjs`): stopping the first time an ordinary 95% interval clears
50% would adopt a candidate that is no better in about one match in five, because every look is another chance for luck.
With the error spent across the looks, an equal candidate is adopted in at most one match in twenty however it runs. Made-up
matches (`tests/sequential.mjs`) show what to expect: a candidate truly at 60% is adopted nearly always, in about 100 deals;
at 55% it is adopted about two times in three (the rest mostly end undecided at 480 deals: a 5-point gain is hard to
prove beyond doubt, and takes some 500 deals); at 50% it is rejected in most matches and adopted in 4%; at 45% it is
rejected in about 110 deals. A candidate that costs no more thinking and is undecided near 55% is a judgment call.

The verdict after every run is in its annotation and summary, and every game is kept on the `match-results` branch
(a folder `<candidate>-<champion>-d<deals>` at its root: `games.jsonl`, `verdict.json`, `log.txt`). Adopting a candidate means merging
it into `main` and moving `champion` to it (`git push origin main:champion`).

`lab/match.mjs` plays a run of deals between two checkouts of the repository, `lab/sequential.mjs` is the stopping rule,
`lab/score.mjs` scores games the old way (a fixed number, no stopping rule) and `lab/shard.mjs` says which deals a job plays.

### Candidates and the rules check (3 November 2026)

**Record, all at 256 search deals a decision against `champion` (2041b7f).** `main` itself (20be6b5): 50.6% over 480 deals
(960 games), 95% interval 48.0 to 53.2, so a candidate built on `main` is read against an even field. A judge-guided opening
hand (keep a seven if the judge puts it above what the next mulligan is worth; e91429b): 43.3% over 60 deals, stopped, and
51.9% (48.3 to 55.5) over 344 deals of Medium against Medium; out of the policy, left at that commit. Hard playing another move
over Medium's at half a standard error of the gap, not one and half a point (9878a15, `MARGIN` in `dandan-think.js`; it
scored 0.16 points a decision better on 424 positions, on deals it hadn't picked from): 50.8% over 480 deals (48.0 to 53.6),
the cap, undecided; put back. Nothing is adopted. A gain of two points needs several thousand deals to show against this
field, and the match stops at 480.

**The rules check** is `lab/rules-check.mjs`: random, Easy, Medium and Hard (8 deals) play each other as the page deals (the
computer's spells shown, the loser first), and `lab/audit.mjs` checks every state against the rules as written, not against the
engine's own helpers: each of the 80 cards in one place, every move offered one `check` accepts, the land drop offered when
and only when it is allowed, the mana a seat can make against every way its lands can tap, nothing left alive that should have
died, the result against the life totals and the library. About 1,900 games (the last 300, on this commit, 46,572 moves): no rule broken (the audit's own
mistakes were the cases where a resolution is half done: Metamorphose asks before the state-based check, a Brainstorm
into a short library). `tests/slow/dandan.mjs` is the old rules spec, run by hand (nine minutes): clean; four habits of Medium's
that Hard corrects are reported as GAP.

**A kept game plays again only under `shownRules`** (`dandan-rules.js`, which the page plays by): the computer's shown stops
are among its moves, and who went first isn't in the seed (the last game's loser does; `replay` takes it from `state.first`).
Under the plain `rules` the first computer spell is refused with "It isn't your turn". Of the 41 kept games, 12 carry their
moves and all 12 replay; the earliest (1 November 14:05) lacks the computer's first move, its keep, and replays only with it put back.
`lab/review.mjs` weighs a kept game's computer decisions again, `lab/regret.mjs` the gap between Medium's move and the best of the
shortlist by kind of decision, `lab/quick-match.mjs` plays Medium against Medium between two checkouts in minutes.

## The computer's spells are shown

A spell of Monte's that you have nothing to answer used to go on the stack and resolve inside the move that cast it, so
Piracy Charm or Memory Lapse went straight to the graveyard, too fast to read. Now the game stops with it on the stack,
you to pass, and the page passes for you after two seconds (`SPELL_MS` in `dandan.js`), so what it does is seen before it
happens. The stop is the engine's (`showStop` in `dandan-engine.js`, asked for by the page alone, for the computer's moves,
with `show`): it is made once for each spell, and noted in the state (`shown`) so the page can tell it from a question.

- A spell you could answer is a question as always, and you decide; there is no second stop.
- Your own spells are not held. Abilities (cycling, a Flood Plain's search) and triggers are not shown, only spells.
- At **Tap to continue** the page doesn't pass for you: you tap Pass, which says it lets the spell resolve.
- Two seconds don't run while a menu is open, or while you are reading a card, choosing lands or aiming. The pass the page
  makes is not counted as your move, so what the spell did then stays on the table for the computer's pace as usual.
- The computer's search never stops there: the games it plays out in its head run on as before (`tests/stack-show.mjs`).

## The upkeep stop (a fix, also made in the Almanac)

Before the draw, if you could do anything (cast Predict or any instant, cycle a land), you are now asked whether to,
instead of the game drawing for you. From the second turn, every upkeep where a person could act is a stop, theirs or
yours, whether the top card is known or not; passing there goes on to the draw. The computer is asked at its own upkeep too whenever it
could do something, and Hard's search weighs passing against every move there (cracking a Flood Plain, cycling, Predict,
Brainstorm, Quicken, any instant); only the quick move that is the fallback with no worker passes unless it has a known
top card or a Brainstorm or Predict for your draw. `anyUpkeepMove` in `dandan-engine.js` is the
rule, and `node tests/upkeep.mjs` checks it. A Flood Plain with no Island or Plains card left in the library to fetch is
not a reason to stop (cracking it would only shuffle); `node tests/dandan-window.mjs` checks that and the Flood Plain's own stop.

## A Reversal on its own spell, when the target is about to go (a fix, 1 November 2026)

Dave's game, turn 31: the computer cast a Deem Inferior on his Dandân, he answered with a Repulse on that same Dandân, and the
computer passed. The Repulse resolved first (the Dandân to his hand, a card drawn) and the Deem Inferior found nothing. A
Narset's Reversal on the Deem Inferior, with the Repulse still on the stack, would have put a copy of it above the Repulse: the
copy resolves first and sends the Dandân to the library, the Repulse then has nothing to return (it fizzles, and draws him
nothing), and the original Deem Inferior comes back to the computer's hand. Cast only after the Repulse had resolved, it saved
the card and nothing else.

The engine allowed it all along; the computer never rated it. Medium's value of a Reversal on a spell of its own was a copy
that does nothing new (a card and two mana for a copy of what is already happening), except against a counter aimed at that
spell. That scored below the cut-off at which Hard's search stops weighing a move (a move is weighed only if Medium rates it
above −0.8), as soon as the computer held a Memory Lapse, or had little mana to spare (a score of −1.2 to −1.7; with plenty of
mana it was −0.75, just inside, and the search then found it, which is why it is not always missed). So the line was never
tried and Hard passed.

Now a spell of theirs above the computer's, aimed at the permanent its spell is aimed at, and one that takes it off the table the
moment it resolves (`takenAway` in `dandan-policy.js`: Repulse, Commit, Metamorphose, Gone Missing, Piracy Charm's +2/−1; not
Mind Bend, which only changes what the Dandân looks for) is rated like a counter aimed at it: the spell happens, the card is
kept and theirs is spent for nothing. In the position above it rates 1.6 to 2.5, first of the moves, and Hard plays it where it
passed (tried with 5 to 9 lands and a Memory Lapse or a spare Dandân in hand). The mirror case holds too: its own Repulse on its own
Dandân, answered by a Piracy Charm's +2/−1 that would kill it first, is copied by Hard (Medium rates a Reversal on the Charm
higher there, 1.75 to 0.18; that is left as it was). `node tests/reversal-save.mjs` checks it:
the rating, the search, the engine's own resolution (his Dandân to the bottom of the library, the Repulse fizzling, the Deem
Inferior back in the computer's hand) and which spells count. It changes nothing else: a Reversal on its own spell with nothing
above it is rated as before. A match could not show a gain from it (the position is rare); like the upkeep stop it is a mistake
the computer can be shown to make.

## Tapping a land for its mana on its own (1 November 2026)

Korbi: "when clicking an untapped land, the player should also get a choice to tap it to float mana, which will then be used
by later spells if eligible, whether or not manual tap mode is enabled." Tapping a land of yours that is untapped, while you
hold priority, now shows a **Tap** button beside Pass on the card read (one for each way the land taps: a Thundering Falls
offers blue and red, an Island blue). The mana floats in your pool, shown under your name ("U floating"), and the next spell
or ability you pay for spends it before any land, so a Memory Lapse after a tapped Island taps one more land, not two. It
goes when the step ends, as floating mana always did here (a land tapped for more than a cost needed already floated).

It is the engine's `{ t: "mana", id, alt }` (`tapForMana` in `dandan-engine.js`): a mana ability, so it uses no stack,
passes no priority and settles nothing: you hold priority as you did, with a spell on the stack too, to pay for the answer.
It is kept in the game's moves like any other, so a game played again moves the same way. It is not among `moves()`, so the
computer never floats mana and its search is not widened by it; it reads your pool as open mana, as it reads any (`openMana`).
The manual tap switch is a different thing and is unchanged: it chooses which lands pay for a spell as you cast it; this taps
one ahead of time. `node tests/mana-tap.mjs` checks the engine's side (the pool, priority kept, the order of payment, the
step's end, what is refused).

## The stack and the end of the library (1 November 2026)

Korbi: make sure that every time the computer has the initiative it assesses the board and the stack correctly, above all
when the library is nearly gone and the loser is whoever draws from it empty, and when several spells are on the stack and the
order of resolution decides what fizzles and who draws what. This was audited before it was changed: positions from the
games kept so far, every legal move valued over many deals with the look-ahead run out (the same machinery Hard uses), half
the deals choosing the best move and the other half judging it, and a player's **regret** being how many points of win chance
its move gives up against the best one. Two audits: 1,277 decisions with two or more spells on the stack, and 1,135 positions
with the library cut to one to ten cards. What it found, and what was done:

- **Medium did not read the library at all.** A Lórien Revealed (draw three) with an empty library scored +1.45, though it
  loses on the spot. Now any move that draws more cards than the library holds scores
  -9 at every level (`libraryTerm` in `dandan-policy.js`; `libraryMove` is what each card takes out of the library or puts
  back: a draw, a mill, a cycled card, a Flood Plain's Island; a spell countered by Memory Lapse or Commit, a permanent sent
  to the library). In the 8 of 1,135 positions where this changed Medium's pick, the regret went from 47 to 9
  points (60 to 24 with an opponent that answers back); it is the one part that is right whoever the opponent is.
- **Who draws from the empty library is a race, and Medium now plays it.** With only draw steps left the (L+1)th draw
  loses, and every card taken out or put back moves that by one: a Brainstorm, a cycled land or a Quicken with three cards
  left changes who runs out (`emptiedBy`; `tests/library-end.mjs` checks the count against the engine playing it out for
  libraries of 0 to 7 cards). A move that changes who loses is worth 5, 3 or 1.5 cards depending on how near the end is
  (3 cards or fewer, 7 or fewer, 12 or fewer), and the library is only looked at inside 12 cards. The other player can put
  it back with a draw of their own, so the worth is cut by what they hold: whole with an empty hand, 0.6 with one card, 0.35
  with two, 0.2 with three or more (`UNDONE`; set before the audit, not fitted to it). It is worth less than it looks. Counting the
  check above, and with the opponent in the look-ahead not answering, regret fell from 8.2 to 7.6 points (0.64 plus or minus 0.29); with the
  opponent answering as the race rule itself does, from 9.1 to 8.6 (0.49 plus or minus 0.33). Better in both, never worse,
  and neither is far from noise; the full-weight race did 1.01 plus or minus 0.37 better in the first and 0.36 plus or minus
  0.42 in the second, and was passed over for being less steady.
- **Hard's look-ahead did not reach the end.** It looks two turns ahead and hands the rest to the judge, which has seen
  almost no game end by an empty library (it knows only the size of the library, as a fraction of 80). So two turns ahead said
  nothing about who would draw last. With 8 cards or fewer left the look-ahead now plays on to the end of the game (the
  library plus two turns; `endOfLibrary` in `dandan-think.js`: the position's own result, not the judge's guess) and the
  root weighs every move there is, up to twelve, not the seven or so Medium rates highest. Regret fell from 5.6 to 2.6 points
  (a difference of 3.0 plus or minus 0.4 over the 1,135 positions, Hard's deals not the ones that judged) and from 6.9 to 2.5
  against a look-ahead whose opponent answers like Medium with the race rule. It is the largest gain of the whole audit. The
  cost is thinking time: a search of 48 deals took 85 ms on average with 40 cards left and 295 ms (at most 1.3 s) with 5, on
  the machine it was measured on.
- **With a spell on the stack Hard dropped the best move too often.** Hard weighs a move only if Medium rates it above -0.8,
  which is a fair cut when the board is quiet and a bad one when several spells wait: which to counter or copy, or whether to
  draw in answer, turns on what the others do, and Medium's score does not see that. In the 1,277 decisions the best move was
  outside Hard's shortlist in 83 (6.5%), by two points or more in 35. With anything on the stack the root now weighs up to
  twelve moves (`candidates`; inside the tree the width stays at four); misses fell to 17 of 1,065 (1.6%), by two points or
  more in 9, and Hard's own shortfall against the best move from 0.14 to 0.04 points. Stack decisions took 104 ms on
  average at 48 deals, now 162 (at most 0.6 s). `tests/stack-shortlist.mjs` rebuilds one: the computer's Commit aimed at his
  Dandân, his Repulse answering on the same Dandân, and the Lapse on the Repulse that lets the Commit through is weighed.
- **Medium charged nothing for the card a Narset's Reversal gives back.** The original spell goes back to its owner's hand
  (it is not countered, the owner keeps the card and only its effect is denied), so a Reversal on a Memory Lapse of
  theirs left them the Lapse to cast again, which the rating ignored. It now charges 0.9 of that card's worth. On the stack decisions, with this the only change to
  Medium's play in that audit, its regret went from 3.4 to 2.9 points (1,277 positions before, 1,065 after).

**Tried and left out.** A rating for countering a spell that frees the permanent one's own spell is aimed at (their Repulse
on the Dandân our Commit targets), and treating a counter aimed at one of our own spells as a spell and not as tempo
(`TUNE.counterOnCounter`), moved Medium's mistakes about without removing them: 2.83 against 2.84 points over 265 matched
positions, passing less and countering too often. Reverted.

**Not done, and not known.** The audit's idea of the best move is the same engine's, over 48 to 128 deals, with Medium
playing on past the first few decisions; where two lines are close, its answer is noise (the regret figures carry the
error given above). Some mistakes in it are not explained: Medium passes where drawing in answer to a counter aimed at its own
spell is better (about 290 of the 1,277 positions, worth some 1,000 points of regret between them), and with a Memory Lapse
of its own against a Lapse aimed at its Dandân the search is split between countering and letting it resolve, and Medium
does not tell the cases apart. The
judge itself still has no idea of the end of the library, which is why the look-ahead plays on to the end instead; inside the
tree, Hard weighs four moves at a node, so a rare correct response may still not be tried. No Bot match was run: these are a small share of
a game's decisions, and a match of 480 deals could not be expected to show a gain this size (Medium's earlier fit, worth half
a point a decision, ended undecided). Like the upkeep stop and the Reversal fix, these are mistakes the computer can be shown
to make, kept on that evidence and not on a match; a match from the Actions tab (candidate against `champion`) will say if
it costs anything elsewhere.

## The log says when things resolve (1 November 2026)

Two testers' games looked like a card had gone missing from the top of the library, and in both the engine was right and the log
was silent. In the first the computer cast Metamorphose in its own upkeep, so the tester's Dandân went on top and the computer drew
it in the draw step (found by rebuilding the game from its seed and log: no moves had been kept, so a search over the legal moves,
each checked against the log, found the one sequence the engine plays out as recorded). In the second a Mind Bend was countered
by a Memory Lapse onto the top of the library, and a Repulse that had been cast first then resolved and drew it, a card before the
other player's draw: right by the stack (the last cast resolves first), but the log showed the casts and not the order they came off.

So each item now says "Repulse resolves" (or "Thundering Falls trigger resolves", "Cycling resolves"…) as it comes off the stack
(`resolveTop` in `dandan-engine.js`), before whatever it does; a spell countered never resolves, and one whose target has gone
says it fizzles, not that it resolves. What is drawn is deliberately not in the log (the other player reads it too): a draw
stays silent, and the order of resolutions is how a reader works out which card went where. `node tests/resolve-log.mjs` plays the
Mind Bend game's stack and checks the order and that the draw is not named.

## Where the results go

Nothing about results is shown on the page. When a game ends, it is written to the Almanac's Firebase database
(`sync.js`, anonymous sign-in) as a room of its own under `crates/rooms/<four letters>/dandan`, in the shape of a table's
room the database's rules already allow:

- `players`: your name, under your anonymous id.
- `game`: the game as the runner keeps it at its end: the seed, the seats, the state (the library's order, both hands, the
  battlefield, the log of everything done, and the judge's chances after each action) and, since 1 November 2026, `moves`,
  every move made, seat and move, in order, as one string (the database drops an empty list, and a move with no targets
  has one). A game is played again from its seed and its moves (`replay` in `records.js`; each move's randomness comes from
  the seed and its number, and nothing in the state depends on the clock), so it comes out move for move the same, and a
  reader can stop at any move and see the table as it stood. A game kept before that has the state and its log, not the moves.
- `result`: a summary: `name`, `won`, `drawn`, `winner` (the seat), `why` (how it ended; `conceded` too), `turns`,
  `life` (both), `library` (cards left), `moves` (how many), `started`, `ended`, `ms`, and the settings it was played at
  (`level`, `think`, `pace`, `view`) and the page.

A line about the game also goes in one room that is always the same, `crates/rooms/DDIX/games/<started>` (a code with an I
in it: the codes a table is given never have one, so no table is it): where the game is (`room`), who played (`name`, `uid`)
and the summary. That is how the games can be found again, since the database's rules open a room only to someone who knows its
code. A result is kept on the device until the database has it (`dandan:unsent`): with no connection, or a tab closed too
soon, it is tried again at the next game's end and the next time the page opens. Each game is sent once, by when it began
(`dandan:sent`); once its room is made the code is kept with it, so a failure at the index never makes a second room. The game
never waits on the database. A game not played to its end (the tab closed, the page left) is not kept.

### Reading the games

A session can't reach the database (the network it works from allows GitHub and little else), and the page can't list it, so
`.github/workflows/games.yml` collects the games onto a branch, **`game-records`**, which anyone can read with git (a session
fetches it). It runs every hour (the cron) and when started by hand (Actions → Game records → Run workflow; or `gh api -X
POST repos/KMRRing/dandan/actions/workflows/games.yml/dispatches -f ref=main`). `tools/pull-games.mjs` signs in as any visitor to
the page does (anonymously, with the page's own public key), reads the index room and fetches the games it doesn't have. No
secret is involved, and no change to the database's rules. The branch holds:

- `games/<started>.json`: one game: `{ key, room, line, game (the seed, seats, `moves` as a string, the final state), result, players }`.
- `index.json`: every game's summary and room, oldest first: the table to start from for win rates, by name, level and day.
- `status.json`: when it last found anything, how many games it has, how many are listed but unread (`unread`), and what
  went wrong (`errors`: the sign-in, the index, a game's room). Something is committed only when a game is new or the problems
  change, so the branch isn't a log of idle hours.

Run it by hand with *check* ticked and it collects nothing: it writes a marked line into the index room, reads it back and takes it
away, and `status.json` says (`check`: `write`, `read`, `delete`, `gone`) whether the page's own write is allowed by the database's
rules. That is the first thing to look at if a game was played and nothing came.

Games kept before the index existed have no line in it, so the hourly run can't see them. Tick *scan* and it asks every room (the
four-letter codes: 24 letters, 331,776 rooms, each answer a few bytes, a few minutes) whether it holds a Dandan result, fetches
the games it finds and adds them to `index.json` marked `scanned: true`; the later runs leave them alone. Run it once after
this change, and again only if the index is ever lost. `status.json` says (`scan`) how many rooms it asked, how many held a game
and how many failed.

The repository is public, so the branch is too: the games, the names players gave and their anonymous ids can be read by
anyone who looks (the database already lets anyone signed in read a room whose code they guess, four letters). A private
repository for it would take a secret to push across; not done.

## Offline

The game opens and plays with no connection, from the home screen too, once the page has been opened online once. `sw.js` (a
service worker, the browser's own way of keeping a site on the device) holds every file of the app, about a megabyte: the page, its
scripts, the computer's search worker, the styles, the font and the icons. A played game is saved in the browser as before, so the
game you left is the game you come back to. Only the database needs the network, and only for the finished game's result, which
`results.js` already keeps until it can send it; it now also sends it the moment the connection comes back (the `online` event),
not at the next game's end. The menu's About part says whether it is ready ("Ready for offline play: version 7d9898"), and its Settings part has
*Refresh to the latest version* (below).

The list is every file of the app's own kinds outside `tests/`, `tools/`, `lab/` and `.github/` (`tools/offline.mjs`). The app
is small enough that "everything that ships" is simpler and safer than finding what each page loads, and `tests/offline.mjs`
checks it the other way: every import, stylesheet `url()`, tag and manifest icon names a file that is kept, and a load whose path
is built as the code runs (none but the database's address, which is another site) fails the test until it is looked at. Not kept:
Firebase's scripts, which come from Google's servers (they are only for the result, which waits).

A version is one set of files and is used whole: a page is never handed a file of another version than the rest, which matters
here because the computer's search is a worker the page starts when it needs it. So an update downloads in the background (each
file asked for at an address carrying its hash, past every cache; a file the site refuses fails the install, and the version in
charge stays; an interrupted download finishes from where it stopped) and then waits. It takes over when the app goes off screen,
or when *Refresh* finds one, and the page reloads onto it; the game is in the browser's storage, so it picks up
where it was. The older copy is deleted only once the new one is in charge. The first install needs none of this (nothing older is
there to be mixed up with) and takes the page that began it. An app left open is looked at for a new version when it is brought back
(at most once a minute).

`sw.js` is written by `.github/workflows/pages.yml` and by nobody else: on every push to `main` it runs every test (under ten
seconds together; `tests/syntax.mjs` parses each script as the module it is, since `node --check` alone passes a broken module on
Node 22) and, only if they pass, rebuilds `sw.js` (the list of files, each with a hash of its bytes, and a version from them all)
and commits it as github-actions[bot]. Pages serves `main` as pushed, but installed copies move only when `sw.js` changes, so a push
that fails a test never reaches them. Never commit `sw.js` by hand (pull before the next push: the bot's commit is on `main`);
`node tools/build-sw.mjs --local` writes one to try offline play, which you don't commit. The manifest (`manifest.webmanifest`,
icons in `icons/`, drawn from `icon.svg`, with a maskable one for Android) lets it be installed; the page links it.

**Refresh (1 November 2026, Korbi: "add a 'refresh' button into settings that'll download latest version on the bookmarked app").**
*Refresh to the latest version* is a button in the menu's Settings part (it replaces the quiet *Check for a new version* link in
About, which was easy to miss and said only "Up to date."). It asks the site for `sw.js`, and if that names a newer version it
puts the rete up with the stage ("Looking for a new version", "Downloading it", "Starting it"), downloads it, tells it to take over
and reloads onto it, the game where it was. With nothing newer it says "This is the latest version (7d9898)", and with no
connection or a failed download it says so and leaves the version on the device. It cannot fetch what hasn't been published: a
push reaches the app only a minute or two after its tests pass (the workflow commits `sw.js` then), which is the design, so that
a broken push never reaches the phone; the message says it. `refresh()` in `pwa.js`; `node tests/refresh.mjs` plays it against a
stand-in for the browser's service worker (nothing newer, no connection, a download that takes a moment, one already waiting, one
that fails, no service workers at all).

Tried in Chromium on a local server: installed, then the server stopped altogether and the page reloaded and played (the mulligan, a
hand, the computer's worker loaded from the copy; no request failed); an unknown address offline opens the app; *Refresh*
switching to a changed version and reloading with the game kept and the old copy gone; a version found while the app is
on screen waiting, and taking over when it went off screen; one found while off screen taking over at once.

## Files

- `index.html`, `dandan.js` (the page), `dandan.css`, `dandan-3d.js` and `-3d.css` (the table), `style.css` (the
  Almanac's frame and tokens, `menu.js`, `loading.js`, `wide.js`).
- `dandan-cards.js`, `-core.js`, `-spells.js`, `-engine.js`, `-rules.js` (the game); `-bot.js`, `-policy.js`, `-think.js`,
  `-eval.js`, `-reads.js`, `-observe.js`, `-advantage.js` (the computer player and the judge), `-worker.js` (the search,
  off the page's thread); `dandan-words.js` (move names, taken out of the Almanac's coach file so Hard reads as before).
- `seats.js` (the game runner; this copy also keeps every move), `seats-ui.js` (here: solo only), `name.js`, `results.js` and
  `records.js` (what a game is kept as, and played again from), `net.js`, `sync.js`; `tools/pull-games.mjs` and
  `.github/workflows/games.yml` (collecting the games, above).
- `tests/records.mjs` (a game kept with its moves plays again to the same state, move for move; the entry and the index line are plain
  data) and `tests/pull-games.mjs` (the collector against a stand-in database: each game once, a game it can't read said, nothing
  kept lost); `tests/upkeep.mjs`, `tests/dandan-window.mjs`, `tests/hidden-info.mjs`, `tests/reversal-save.mjs`, `tests/mana-tap.mjs`, `tests/library-end.mjs`, `tests/stack-shortlist.mjs` and `tests/stack-show.mjs`, with `tests/dandan-scene.js`, which sets a game
  up at a chosen point. `hidden-info` holds the computer to the rule that it never uses what it can't see: dealt the
  cards it can't see again, its search weighs every move the same and picks the same one. Each runs in under a second.
- `pwa.js` (registers the worker, takes updates, the menu's offline line), `manifest.webmanifest`, `icons/`; `tools/offline.mjs`, `tools/build-sw.mjs`,
  `tools/service-worker.js` and `.github/workflows/pages.yml` (Offline, above); `tests/offline.mjs` and `tests/syntax.mjs`.
- `lab/`, `tests/sequential.mjs` and `.github/workflows/match.yml`: the matches between two builds of the computer (Matches, above); `tests/slow/dandan.mjs`, the rules spec, run by hand (Candidates and the rules check, above).

The engine and the computer player are copies of the Almanac's; a rules fix there is made here by copying the file over
(the shown spell is this page's alone: `show` in `act` and `showStop` in `dandan-engine.js`, which a copy must keep). `seats.js` is the Almanac's with one change, which a copy must keep too: `applyMove` also keeps each move in `G.moves`.
