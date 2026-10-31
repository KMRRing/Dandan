// A finished game's result, written to the database for evaluating the game from the back end (nothing of it is shown
// on the page): who played (the name they gave), how it ended, and the whole game as the seats runner keeps it, its log
// and the judge's chances after each action included. It goes to the Almanac's Firebase project (sync.js), in the shape
// of a table's room, `crates/rooms/CODE/dandan` (`players`, `game`, and a `result` summary), which the database's rules
// already allow, so nothing has to be set up there.
//
// A result is kept on this device until the database has it (no connection, a closed tab: it is tried again at the next
// game's end and the next time the page opens), and each game is sent once (by when it began).
import { getSync } from "./net.js";

const QUEUE = "dandan:unsent", SENT = "dandan:sent";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // a room's code, as the Almanac's: no I or O
const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
let flushing = null;

/** What the back end gets of a finished game: the table as the Almanac keeps one, and a summary. */
function entryOf(v, how) {
  const s = v.state, me = v.seat, now = Date.now(), name = v.seats?.[me]?.name || "You";
  const result = {
    name, won: s.winner === me, drawn: s.winner < 0, winner: s.winner, why: s.why || "", conceded: s.why === "conceded",
    turns: s.turn, life: s.life, library: s.lib.length, started: v.G.started, ended: now, ms: now - v.G.started,
    ...how, page: location.host + location.pathname,
  };
  return { key: String(v.G.started), name, result, game: v.G, at: now };
}
/** Notes a finished game, and tries to send what's waiting. Never throws: the game goes on whatever the database does. */
export function recordResult(v, how = {}) {
  try {
    const entry = entryOf(v, how), queue = read(QUEUE, []);
    if (read(SENT, []).includes(entry.key) || queue.some(q => q.key === entry.key)) return;
    write(QUEUE, [...queue, entry].slice(-10));
  } catch (e) { console.error(e); }
  flush();
}
/** Sends what's waiting, one result after another; what fails stays for next time. */
export function flush() {
  if (flushing) return flushing;
  if (!read(QUEUE, []).length) return Promise.resolve();
  flushing = (async () => {
    try {
      const sync = await getSync();
      for (const entry of read(QUEUE, [])) {
        if (!(await send(sync, entry))) break;
        write(QUEUE, read(QUEUE, []).filter(q => q.key !== entry.key));
        write(SENT, [...read(SENT, []), entry.key].slice(-50));
      }
    } catch (e) { console.warn("dandan: the result is kept for later", e); }
    finally { flushing = null; }
  })();
  return flushing;
}
/** A room of its own for the game, under a fresh code (the codes are four letters; one taken is tried again). */
async function send(sync, { name, result, game, at }) {
  const branch = JSON.parse(JSON.stringify({
    v: 1, app: 1, created: at, host: sync.uid, rev: 1,
    players: { [sync.uid]: { name, slot: 0, seat: 0, online: false, joined: result.started } },
    game, result,
  }));
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await sync.tx(`crates/rooms/${newCode()}`, cur => (cur === null ? { suite: 1, created: at, owner: sync.uid, dandan: branch } : undefined));
    if (r.committed) return true;
  }
  return false;
}
// the page opening again: what an earlier visit couldn't send
addEventListener("load", () => setTimeout(flush, 3000));
