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

In a match of 126 games (63 deals, both seats each) at the same thinking time (about 610 ms a search against 560), the
version with this scored 55.6% plus or minus 8.3 against the one without. That isn't a result a match of this size can
prove, and it was stopped at 126 of the 160 planned; it was adopted at Korbi's call, a gain at no extra cost being
reason enough. What would give more is replacing Medium in the rollouts with a policy learned from the search's own
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

## Where the results go

Nothing about results is shown on the page. When a game ends, it is written to the Almanac's Firebase database
(`sync.js`, anonymous sign-in) as a room of its own under `crates/rooms/<four letters>/dandan`, in the shape of a table's
room the database's rules already allow:

- `players`: your name, under your anonymous id.
- `game`: the game as the runner keeps it at its end: the seed, the seats and the whole state (the library's order,
  both hands, the battlefield, the log of everything done, and the judge's chances after each action).
- `result`: a summary: `name`, `won`, `drawn`, `winner` (the seat), `why` (how it ended; `conceded` too), `turns`,
  `life` (both), `library` (cards left), `started`, `ended`, `ms`, and the settings it was played at (`level`, `think`,
  `pace`, `view`) and the page.

A result is kept on the device until the database has it (`dandan:unsent`): with no connection, or a tab closed too
soon, it is tried again at the next game's end and the next time the page opens. Each game is sent once, by when it began
(`dandan:sent`). The game never waits on the database.

## Files

- `index.html`, `dandan.js` (the page), `dandan.css`, `dandan-3d.js` and `-3d.css` (the table), `style.css` (the
  Almanac's frame and tokens, `menu.js`, `loading.js`, `wide.js`).
- `dandan-cards.js`, `-core.js`, `-spells.js`, `-engine.js`, `-rules.js` (the game); `-bot.js`, `-policy.js`, `-think.js`,
  `-eval.js`, `-reads.js`, `-observe.js`, `-advantage.js` (the computer player and the judge), `-worker.js` (the search,
  off the page's thread); `dandan-words.js` (move names, taken out of the Almanac's coach file so Hard reads as before).
- `seats.js` (the game runner), `seats-ui.js` (here: solo only), `name.js`, `results.js`, `net.js`, `sync.js`.
- `tests/upkeep.mjs`, `tests/dandan-window.mjs`, `tests/hidden-info.mjs` and `tests/stack-show.mjs`, with `tests/dandan-scene.js`, which sets a game
  up at a chosen point. `hidden-info` holds the computer to the rule that it never uses what it can't see: dealt the
  cards it can't see again, its search weighs every move the same and picks the same one. Each runs in under a second.
- `lab/`, `tests/sequential.mjs` and `.github/workflows/match.yml`: the matches between two builds of the computer (Matches, above).

The engine and the computer player are copies of the Almanac's; a rules fix there is made here by copying the file over
(the shown spell is this page's alone: `show` in `act` and `showStop` in `dandan-engine.js`, which a copy must keep).
