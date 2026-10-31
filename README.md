# Dandan

A one-player page of Dandan, taken from the Almanac (Crates) and kept as it was: the same 80-card communal deck, the same
rules engine, the same computer player, the same 3D table. Open `index.html` from any web server (GitHub Pages serves it);
there is no build step.

Dandan is the Magic format played with one shared deck of 80 cards (16 Islands, 8 Memory Lapse, 10 Dandân and the rest).
Each player gets seven; a Dandân (4/1) can attack only a player who has an Island. You play against the computer, Claude.

## What is fixed here

The Almanac's Dandan has settings; this page has made the choices and removed the rest.

- **One player.** No inviting, no table, no watching: you sit down against the computer.
- **Dark Almanac only.** One look, night. No themes, no day mode.
- **3D table, full screen.** The tiled table, the header layout and the full-screen switch are gone.
- **The computer is always Hard, always thinking as long as it can** (the deepest setting: it plays out 4,096 deals
  before each move, in a worker so the page stays free). Easier levels and shorter thinking are gone.
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
- **The ring that pulses round the player to move** (and the one round a player you are aiming at) goes round the
  avatar and its life together; the life sits on the avatar's corner, so a circle round the avatar alone ran through it.
- The computer's name is **Claude**; its card fan is packed closer so the name fits a phone's header.

## The upkeep stop (a fix, also made in the Almanac)

Before the draw, if you could do anything (cast Predict or any instant, cycle a land), you are now asked whether to,
instead of the game drawing for you. From the second turn, every upkeep where a person could act is a stop, theirs or
yours, whether the top card is known or not; passing there goes on to the draw. The computer's own upkeep stays quiet
unless it has a known top card or a Brainstorm or Predict for your draw. `anyUpkeepMove` in `dandan-engine.js` is the
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
- `tests/upkeep.mjs` and `tests/dandan-window.mjs`, with `tests/dandan-scene.js`, which sets a game up at a chosen point.

The engine and the computer player are copies of the Almanac's; a rules fix there is made here by copying the file over.
