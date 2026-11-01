// A finished game's result, written to the database for evaluating the game from the back end (nothing of it is shown
// on the page): who played (the name they gave), how it ended, and the whole game as the seats runner keeps it (its moves,
// its log, the judge's chances after each action). The game goes to the Almanac's Firebase project (sync.js), in the shape
// of a table's room, `crates/rooms/CODE/dandan` (`players`, `game`, and a `result` summary), which the database's rules
// already allow, so nothing has to be set up there; and a line about it goes in the index room (records.js), so the games can
// be found again without knowing their codes (tools/pull-games.mjs, run by .github/workflows/games.yml, collects them).
//
// A result is kept on this device until the database has it (no connection, a closed tab: it is tried again at the next
// game's end and the next time the page opens), and each game is sent once (by when it began).
import { getSync } from "./net.js";
import { entryOf, indexLine, INDEX_ROOM } from "./records.js";

const QUEUE = "dandan:unsent", SENT = "dandan:sent";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";   // a room's code, as the Almanac's: no I or O
const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
let flushing = null;

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
/**
 * The game's room, under a fresh code (the codes are four letters; one taken is tried again), then its line in the index.
 * The code is kept in the queue once the room is made, so a send that fails at the index goes on from there and never makes
 * a second room.
 */
async function send(sync, entry) {
  const { name, result, game, at } = entry;
  let room = entry.room;
  if (!room) {
    const branch = JSON.parse(JSON.stringify({
      v: 1, app: 1, created: at, host: sync.uid, rev: 1,
      players: { [sync.uid]: { name, slot: 0, seat: 0, online: false, joined: result.started } },
      game, result,
    }));
    for (let attempt = 0; attempt < 6 && !room; attempt++) {
      const code = newCode(), r = await sync.tx(`crates/rooms/${code}`, cur => (cur === null ? { suite: 1, created: at, owner: sync.uid, dandan: branch } : undefined));
      if (r.committed) room = code;
    }
    if (!room) return false;
    write(QUEUE, read(QUEUE, []).map(q => (q.key === entry.key ? { ...q, room } : q)));
  }
  const line = JSON.parse(JSON.stringify({ ...indexLine(entry, room), uid: sync.uid }));
  const r = await sync.tx(`crates/rooms/${INDEX_ROOM}/games/${entry.key}`, cur => (cur === null ? line : undefined));
  return r.committed || r.value != null;                  // already there is as good as written
}
// the page opening again: what an earlier visit couldn't send
addEventListener("load", () => setTimeout(flush, 3000));
addEventListener("online", () => setTimeout(flush, 1000));   // a result kept while offline goes when the connection is back, without waiting for the next game
