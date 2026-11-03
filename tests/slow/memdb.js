// The Realtime Database's rules for what it keeps, and a database in memory that keeps them: what an offline party's
// host holds for everyone at it (lan.js), and what the tests play whole tables on (tests/fake-db.js, tests/rtdb.js).
// Firebase refuses a whole write for undefined, NaN or Infinity, a function, or a key with . # $ / [ ] or a control
// character anywhere in it (validateFirebaseData in its SDK); it keeps no nulls and no empty lists or objects; it keeps
// a list as an object of its indices; and it reads an object whose keys are all integers, more than half of them
// present, back as a list, with holes where the missing ones were. A game that holds up on Firebase holds up here.

const BAD_KEY = /[.#$/\[\]\x00-\x1f\x7f]/;
/** Throws as the database would on a value it refuses. */
export function validate(v, path = "") {
  if (v === undefined) throw new Error(`contains undefined in property '${path}'`);
  if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") throw new Error(`contains a ${typeof v} in property '${path}'`);
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`contains ${v} in property '${path}'`);
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    if (!k.length || (BAD_KEY.test(k) && !/^\.(sv|value|priority)$/.test(k))) throw new Error(`has an invalid key "${k}" in property '${path}'`);
    validate(x, path ? `${path}.${k}` : k);
  }
}
/** A value as the database keeps it: no nulls, no empty lists or objects, a list as an object of its indices
 *  (undefined for nothing at all). Plain JSON, so it's also what an offline party sends between phones. */
export function store(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "object") return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) { const s = store(x); if (s !== undefined) o[k] = s; }
  return Object.keys(o).length ? o : undefined;
}
/** A kept value as the database reads it back: a list wherever its keys say so, with holes, null for nothing. */
export function back(s) {
  if (s === undefined || s === null) return null;
  if (typeof s !== "object") return s;
  const keys = Object.keys(s), ints = keys.every(k => /^(0|[1-9]\d*)$/.test(k));
  if (ints && Math.max(...keys.map(Number)) < 2 * keys.length) { const a = []; for (const k of keys) a[Number(k)] = back(s[k]); return a; }
  const o = {};
  for (const k of keys) o[k] = back(s[k]);
  return o;
}
/** A value written and read back, as the database would; throws as the database would on what it refuses. */
export const roundTrip = v => { validate(v); return back(store(v)); };
/** Whether two values are the same, whatever the order of their keys. */
export function same(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
}

/** A path's parts ("crates/rooms/ABCD" → ["crates", "rooms", "ABCD"]), however it's slashed. */
export const parts = path => String(path).split("/").filter(Boolean);
/** A copy of a value as a reader gets it: what it would read back from the database. */
export const copy = v => back(store(v));

/**
 * A database in memory: get(path) (the value itself, not a copy), set(path, value), update(path, { child: value }),
 * and watch(path, cb), which hears the value now and after every change, a moment later, as over the network (only
 * when it has changed). Every write is checked and kept as the database would keep it.
 */
export function memoryDb() {
  let tree = null;
  const watchers = new Set();
  function get(path) {
    let v = tree;
    for (const k of parts(path)) { if (v == null || typeof v !== "object") return null; v = v[k]; }
    return v ?? null;
  }
  function put(path, value) {
    validate(value ?? null, path);
    const ks = parts(path), kept = value === null ? null : roundTrip(value);
    if (!ks.length) { tree = kept; return; }
    tree = tree && typeof tree === "object" ? tree : {};
    let o = tree;
    for (const k of ks.slice(0, -1)) o = (o[k] = o[k] && typeof o[k] === "object" ? o[k] : {});
    if (kept === null || kept === undefined) delete o[ks.at(-1)]; else o[ks.at(-1)] = kept;
    tree = roundTrip(tree) ?? null;                               // empty objects left behind go, as they do there
  }
  let pending = false;
  function notify() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      for (const w of watchers) {
        if (!w.live()) continue;
        const v = get(w.path);
        if (w.seen !== undefined && same(v, w.seen)) continue;
        w.seen = copy(v);
        w.cb(copy(v));
      }
    }, 0);
  }
  return {
    get,
    /** Writes a value (null deletes it); throws on what the database refuses, writing nothing. */
    set(path, value) { put(path, value); notify(); },
    /** Writes several children at once ({ "a/b": 1, c: null }), all or nothing. */
    update(path, obj) {
      for (const [k, v] of Object.entries(obj)) validate(v ?? null, `${path}/${k}`);
      for (const [k, v] of Object.entries(obj)) put(`${path}/${k}`, v);
      notify();
    },
    /** Calls cb(value) now and on every change while live() (a device that's gone hears nothing); returns stop. */
    watch(path, cb, live = () => true) {
      const w = { path, cb, live, seen: undefined };
      watchers.add(w);
      setTimeout(() => { if (watchers.has(w) && live()) { w.seen = copy(get(path)); cb(copy(get(path))); } }, 0);
      return () => watchers.delete(w);
    },
    /** Tells every watcher what has changed since it last heard (a device back online). */
    notify,
    /** The whole database, kept (to be put back after a reload), and putting it back. */
    snapshot: () => store(tree) ?? null,
    restore(kept) { tree = kept ? back(kept) : null; notify(); },
  };
}
