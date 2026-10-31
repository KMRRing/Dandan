// A seat game's page round its runner (seats.js): solo on this device, the game kept as <id>:game as it changes, the
// computer player in the other seat. The page draws each view and makes its moves through move(). (The Almanac's version
// of this also seats friends at a table; here there is the one player, and the computer.)
import { localTable, createRunner } from "./seats.js";
import { onPause, isPaused } from "./menu.js";

/** A line with its seats named: {s2} becomes whoever sits in seat 2. */
export const fillNames = (text, seats) => String(text || "").replace(/\{s(\d+)\}/g, (_, i) => seats[Number(i)]?.name ?? `Seat ${Number(i) + 1}`);

/**
 * opts: rules (the game), id (its storage prefix), pace, botName(seat, G), level() (the computer player's strength),
 * onView(view), onOver(view), toast(msg), hold() (the page holds the computer's next move, as Tap to continue does;
 * runner.kick() lets it go), name (the player's). Returns { runner, view, move, deal, name, rename }.
 */
export function seatPage({ rules, id, pace = 900, botName, level = () => null, onView = () => {}, onOver = () => {}, toast = () => {}, hold = () => false, name = "You" }) {
  const KEY = `${id}:game`;
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
    save(G) { try { localStorage.setItem(KEY, JSON.stringify(G)); } catch { /* private mode */ } },
  };
  const solo = localTable(store, { name });
  const runner = createRunner({
    rules, table: solo, level, pace, botName,
    paused: () => isPaused() || hold(),
    onView, onOver, onError: toast,
  });
  solo.onChange(() => runner.update());
  onPause(() => {}, () => runner.kick());
  runner.update();

  return {
    runner,
    get view() { return runner.view(); },
    host: true,
    atTable: false,
    move: m => runner.move(m),
    /** A new game, at once. */
    deal: (options, seats) => runner.deal(options, seats),
    get name() { return solo.me.name; },
    /** The name the player goes by, from now on: in the seat, the log and the result. */
    rename(n) { solo.rename(n); runner.update(); },
  };
}
