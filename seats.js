// Seats: a game for a few seats round one table (cards, dice, dominoes, a board), each seat a person or a computer
// player, played solo on this device (you in seat 0, the computer players in the rest) or at a table (table.js) with
// friends each on their own phone, the computer players taking the seats nobody has. A friend who scans the QR code
// mid-game takes over a computer player's seat, hand and all; a player who leaves, or whose phone has been away a
// while, is played by the computer until they're back. The game itself is a module of pure functions, so one runner
// moves it either way, and the tests play it in Node (tests/seats.mjs). No page here: seats-ui.js wires a page.
//
// A game (rules):
//   { id, seats: { min, max },
//     deal({ seats, options, rng, now, prev }) → state     a fresh game for that many seats (prev: the last one's state)
//     toMove(state) → seat | null                          whose decision it is; null when it's nobody's (a pause, the end)
//     act(state, seat, move, { rng, now }) → state | string   the move made (on a copy), or why it can't be
//     bot(state, seat, { level, rng }) → move              a computer player's move, from what that seat may know
//     over(state) → bool
//     anytime?(move) → bool                                a move a seat may make whoever's decision it is (conceding);
//                                                          any other is refused out of turn
//     wakeAt?(state) → time | null                         when a timed step ends (the table's clock: a trick shown, the dice seen)
//     wake?(state, { rng, now }) → state | null            that step moved on
//     restore?(state) → state                              a state read back from the database made whole (it keeps no
//                                                          empty lists or objects, and may give a list back with holes) }
// A state may carry say: "text" or { text, lang }, a line for the narrator; the runner moves it to the record. A line
// names a seat as {s2}, filled with whoever sits there when it's said (a friend may have taken a computer's seat).
//
// The record of a game, wherever it's kept (solo: <id>:game on the device; at a table: the branch's game):
//   G = { seq, seed, n (moves made), seats, options, state, started, say: { n, text, lang } }
// Each move's randomness comes from the seed and the move's number, so a move worked out twice (a transaction run
// again on a fresher copy) comes out the same.

/** A seeded generator (mulberry32): the same seed gives the same numbers on every device. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Two numbers mixed into one seed. */
export const mix = (a, b) => {
  let h = Math.imul((a >>> 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((b >>> 0) + 0x632BE5AB, 0xC2B2AE35);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
  return h >>> 0;
};
/** A list shuffled by rng (Fisher–Yates: every order equally likely). */
export function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const stateOf = (rules, G) => (rules.restore ? rules.restore(clone(G.state)) : clone(G.state));

/** The narrator's line a state carries, moved onto the record (numbered, so each is said once). */
function takeSay(G, state) {
  if (state?.say == null) return;
  const s = typeof state.say === "string" ? { text: state.say } : state.say;
  delete state.say;
  if (s?.text) G.say = { n: (G.say?.n || 0) + 1, text: s.text, lang: s.lang || "en-GB" };
}

/** A new game's record: seq follows the last; the seed is drawn here unless given. */
export function newRecord(rules, { seats, options = {}, prev = null, seq = 1, now = Date.now(), seed = (Math.random() * 2 ** 32) >>> 0 }) {
  const n = Math.max(rules.seats.min, Math.min(rules.seats.max, seats));
  const state = rules.deal({ seats: n, options, rng: seeded(seed), now, prev: prev ? stateOf(rules, prev) : null });
  const G = { seq, seed, n: 0, seats: n, options, state, started: now };
  takeSay(G, state);
  return G;
}

/** A move made: { G } the record after it, or { error } in words. */
export function applyMove(rules, G, seat, move, now = Date.now()) {
  const st = stateOf(rules, G);
  if (rules.over(st)) return { error: "The game is over" };
  if (rules.toMove(st) !== seat && !rules.anytime?.(move)) return { error: "It isn't your turn" };
  const r = rules.act(st, seat, move, { rng: seeded(mix(G.seed, G.n + 1)), now });
  if (typeof r === "string") return { error: r };
  if (!r) return { error: "That can't be played" };
  const next = { ...G, n: G.n + 1, state: r };
  takeSay(next, r);
  return { G: next };
}

/** A timed step moved on, or null when it isn't due (or the game has none). */
export function applyWake(rules, G, now = Date.now()) {
  if (!rules.wake || !rules.wakeAt) return null;
  const st = stateOf(rules, G);
  const at = rules.wakeAt(st);
  if (at == null || now < at) return null;
  const r = rules.wake(st, { rng: seeded(mix(G.seed, G.n + 1)), now });
  if (!r) return null;
  const next = { ...G, n: G.n + 1, state: r };
  takeSay(next, r);
  return next;
}

/** A computer player's move for a seat, from its own random stream. */
export function botMove(rules, G, seat, level = null) {
  return rules.bot(stateOf(rules, G), seat, { level, rng: seeded(mix(G.seed ^ 0xB0B, G.n + 1)) });
}

/**
 * Who sits in each of a game's seats: [{ seat, uid, name, bot, away, online }]. A seat is a person's while someone
 * at the table sits in it and is here (or has been away less than `grace` ms, by `awaySince`); otherwise the
 * computer plays it, under its own name (botName(seat, G): Cartel's are the game's, by its seats' personalities).
 */
export function whoSits(G, branch, { botName = s => `Seat ${s + 1}`, awaySince = {}, grace = 30000, now = Date.now() } = {}) {
  const people = Object.entries(branch?.players || {}).filter(([, p]) => p && Number.isInteger(p.seat));
  return Array.from({ length: G?.seats || 0 }, (_, seat) => {
    const hit = people.find(([, p]) => p.seat === seat);
    if (!hit) return { seat, uid: null, name: botName(seat, G), bot: true, away: false, online: true };
    const [uid, p] = hit, online = p.online !== false;
    const away = !online && now - (awaySince[uid] ?? now) >= grace;
    return { seat, uid, name: p.name, bot: away, away: !online, online };
  });
}

// ---------- solo: a table of one, on this device ----------
/**
 * The solo game as a table of one: the same shape as table.js's table (data, me, act, drive, now), so the runner moves
 * it the same way. store: { load() → record | null, save(record) }. You sit in seat 0 and run it.
 */
export function localTable(store, { name = "You" } = {}) {
  const data = { v: 1, rev: 0, players: { me: { name, seat: 0, online: true } }, game: store.load() || null };
  let listener = () => {};
  return {
    code: null, uid: "me", local: true,
    get data() { return data; },
    get me() { return { uid: "me", seat: 0, name: data.players.me.name, host: true, driver: true, backup: false }; },
    get players() { return [{ uid: "me", ...data.players.me }]; },
    rename(n) { if (n) data.players.me.name = n; },
    onChange(fn) { listener = fn; },
    /** The change made at once, saved, and the page told; resolves whether it was. */
    async act(change, { rev = null } = {}) {
      if (rev !== null && rev !== data.rev) return false;
      const next = clone(data);
      if (change(next) === false) return false;
      next.rev = data.rev + 1;
      Object.assign(data, next);
      store.save(data.game);
      listener(data);
      return true;
    },
    drive(work) { work(); },
    now: () => Date.now(),
  };
}

// ---------- the runner ----------
/**
 * Runs a game on a table (localTable, or table.js's): draws each state (onView), moves the computer players and the
 * timed steps when this device runs the table, makes this player's moves, deals. update() is to be called with every
 * state the table has; use(table) moves to another (solo to a table and back).
 *
 * opts: rules; level() the computer players' strength; pace (ms a computer player takes over its move, so a person
 * can follow, or a function of the state giving it: a secret vote needn't be watched); botName(seat, G); paused() (solo stands still while a menu is open, or while the page holds the computer's next move); onView(view); onOver(view) once for
 * each game that ends while it's watched; onError(message).
 *
 * view: { G, state, seat (yours, or null watching), seats (whoSits), mode ("solo" | "table"), me (the table's),
 * toMove, over, code }.
 */
export function createRunner({ rules, table, level = () => null, pace = 900, botName, paused = () => false, onView = () => {}, onOver = () => {}, onError = () => {}, grace = 30000 }) {
  let t = table, timer = 0, overSeen = new Set(), awaySince = {};
  const people = () => t.data?.players || {};

  function view() {
    const b = t.data, G = b?.game || null;
    if (!G) return { G: null, state: null, seat: null, seats: [], mode: t.local ? "solo" : "table", me: t.me, toMove: null, over: false, code: t.code };
    const state = stateOf(rules, G);
    const seats = whoSits(G, b, { botName, awaySince, grace, now: t.now() });
    const mine = t.me?.seat;
    return {
      G, state, seat: Number.isInteger(mine) && mine < G.seats ? mine : null, seats, mode: t.local ? "solo" : "table", me: t.me,
      toMove: rules.toMove(state), over: rules.over(state), code: t.code,
    };
  }

  /** Called with every state: note who's away, draw, and do the table's work if it's this device's. */
  function update() {
    const now = t.now();
    for (const [uid, p] of Object.entries(people())) {
      if (p?.online === false) awaySince[uid] ??= now; else delete awaySince[uid];
    }
    const v = view();
    try { onView(v); } catch (e) { console.error(e); }
    if (v.G && v.over) {
      const key = `${t.code || "solo"}:${v.G.seq}:${v.G.started}`;
      if (!overSeen.has(key)) { overSeen.add(key); try { onOver(v); } catch (e) { console.error(e); } }
    }
    // a fresh look, not v: drawing may have moved the game on (a choice given before its turn, sent the moment it
    // comes), and that move's own update, already done, mustn't be undone by this one's stale view
    schedule();
  }

  function schedule(v = view()) {
    clearTimeout(timer);
    if (!v.G || v.over || (t.local && paused())) return;
    const rev = t.data.rev;
    const who = v.toMove;
    if (who != null && v.seats[who]?.bot) {
      timer = setTimeout(() => t.drive(() => {
        const b = t.data;
        if (!b?.game || b.rev !== rev || (t.local && paused())) return;  // the table moved on meanwhile, or a menu opened
        let move;
        try { move = botMove(rules, b.game, who, level()); } catch (e) { console.error(e); return; }
        t.act(cur => {
          if (!cur.game) return false;
          const r = applyMove(rules, cur.game, who, move, t.now());
          if (r.error) { console.warn(`${rules.id}: the computer's move was refused (${r.error})`, move); return false; }
          cur.game = r.G;
        }, { rev });
      }), typeof pace === "function" ? pace(v.state) : pace);
      return;
    }
    // a timed step's end, or a person whose phone has gone away reaching the grace (the computer then takes the
    // seat): whichever comes first
    const now = t.now(), at = rules.wakeAt?.(v.state) ?? null;
    const waiting = who != null ? v.seats[who] : null;
    const lapse = waiting?.away && !waiting.bot ? (awaySince[waiting.uid] ?? now) + grace : null;
    if (at != null && (lapse == null || at <= lapse)) {
      timer = setTimeout(() => t.drive(() => t.act(cur => {
        if (!cur.game || (t.local && paused())) return false;
        const g = applyWake(rules, cur.game, t.now());
        if (!g) return false;
        cur.game = g;
      })), Math.max(30, at - now + 20));
    } else if (lapse != null) timer = setTimeout(update, Math.max(200, lapse - now + 50));
  }

  /** This player's move: resolves "" when it's made, or why not. */
  async function move(m) {
    const v = view();
    if (!v.G || v.seat == null) return "You're watching this game";
    const check = applyMove(rules, v.G, v.seat, m, t.now());
    if (check.error) return check.error;
    let why = "";
    const ok = await t.act(cur => {
      if (!cur.game || cur.game.seq !== v.G.seq) { why = "That game has ended"; return false; }
      const r = applyMove(rules, cur.game, v.seat, m, t.now());
      if (r.error) { why = r.error; return false; }
      cur.game = r.G;
    });
    return ok ? "" : why || "Couldn't make that move: try again";
  }

  /** A new game (solo, or the host at a table): as many seats as asked, at least everyone at the table. */
  async function deal(options = {}, seats = options.seats ?? rules.seats.min) {
    const seed = (Math.random() * 2 ** 32) >>> 0, now = t.now();
    return t.act(cur => {
      const here = Object.values(cur.players || {}).filter(p => p && Number.isInteger(p.seat));
      const want = Math.max(seats, here.length ? Math.max(...here.map(p => p.seat)) + 1 : 1);
      cur.game = newRecord(rules, { seats: want, options, prev: cur.game, seq: (cur.game?.seq || 0) + 1, now, seed });
    });
  }

  return {
    update, move, deal, view,
    get table() { return t; },
    /** Moves to another table (a solo game to a table and back): draws what's there. */
    use(next) { clearTimeout(timer); t = next; awaySince = {}; update(); },
    /** Looks again whether the computer has a move to make (after a pause). */
    kick() { schedule(); },
    stop() { clearTimeout(timer); },
  };
}
