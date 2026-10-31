// Dandan on seats.js: a module of pure functions, so one runner moves it solo or at a table (README, Seats). Two
// seats; the computer takes the one nobody sits in. Whose decision it is: whoever holds priority, or is asked a question;
// conceding is anyone's at any time.
// A move made at the table is read for what it shows of the mover's hand (dandan-observe.js): every pass it led to at a
// moment that could show something, asked or not.
import { deal, toMove, act, restore, passPoints } from "./dandan-engine.js";
import { botMove } from "./dandan-bot.js";
import { notePasses } from "./dandan-observe.js";
import { noteTurn } from "./dandan-advantage.js";

export const rules = {
  id: "dandan",
  seats: { min: 2, max: 2 },
  // reading: a game whose passes are read (obs, kept through the database, which drops an empty list)
  deal: ({ rng, prev }) => ({ ...deal({ rng, prev }), reading: 1, obs: [] }),
  toMove,
  act: (s, seat, move, ctx) => {
    const turn = s.turn, r = act(s, seat, move, ctx);
    if (typeof r !== "string" && !ctx?.quiet) {
      if (passPoints.length) notePasses(r, passPoints.splice(0));
      // a turn has begun: the judge's chance at its start, for the review at the end (a game ended in it has its result)
      if (r.turn !== turn && !r.over) noteTurn(r);
    }
    return r;
  },
  bot: (s, seat, ctx) => botMove(s, seat, ctx),
  over: s => s.over,
  anytime: m => m?.t === "concede",
  restore,
};
