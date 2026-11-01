// Collects the finished games from the database into a folder (the `game-records` branch, by .github/workflows/games.yml):
//   games/<key>.json   one game: { key, room, line (its index line), game (as kept: seed, seats, moves, state…), result }
//   index.json         every game's summary, oldest first
//   status.json        when it last found anything, how many it has, what went wrong
// It reads as any visitor to the page does, signing in anonymously with the page's own public key, so it needs no secret:
// the index room (records.js) lists every game with the room it is in, and a game it already has is not fetched again.
// usage: node tools/pull-games.mjs <folder> [--check]       (IDENTITY_URL and DB_URL are for the test, which runs a stand-in)
// --check collects nothing: it writes a marked line into the index room, reads it back and takes it away, which shows that the
// page's own write is allowed by the database's rules (the result is `check` in status.json).
// --scan finds the games kept before the index existed (or that never got a line in it): a room's code is four letters, so it
// asks every room (24 letters, 331,776 codes, each answer a few bytes) for its Dandan result, and keeps what it finds.
import fs from "node:fs";
import path from "node:path";
import { INDEX_ROOM } from "../records.js";

const API_KEY = "AIzaSyCfl6mWI_7cf2VYnpxXB9WwTU_weoH8vA0";               // the page's own (public by design; sync.js)
const IDENTITY = process.env.IDENTITY_URL || "https://identitytoolkit.googleapis.com/v1/accounts:signUp";
// the database lives at the second address (the first answers "a different region", as sync.js finds out too); one that is wrong
// is passed over, and said only if none answers
const DBS = process.env.DB_URL ? process.env.DB_URL.split(",") : ["https://croatiabio-default-rtdb.firebaseio.com", "https://croatiabio-default-rtdb.europe-west1.firebasedatabase.app"];
// a key can be limited to the pages that may use it; say we come from the page
const HEADERS = { "content-type": "application/json", referer: "https://kmrring.github.io/", origin: "https://kmrring.github.io" };

const dir = process.argv[2] || "records", CHECK = process.argv[3] === "--check", SCAN = process.argv[3] === "--scan";
const LETTERS = process.env.SCAN_LETTERS || "ABCDEFGHJKLMNPQRSTUVWXYZ";             // the letters a table's code is made of
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch { return fallback; } };
const write = (file, v) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), JSON.stringify(v)); };
const errors = [];
const fail = (what, e) => { errors.push(`${what}: ${e?.message || e}`); console.error(what, e?.message || e); };

async function json(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const before = read("status.json", {}), index = read("index.json", []), have = new Set(index.map(g => g.key));
  let token = null, base = null;
  try { token = (await json(`${IDENTITY}?key=${API_KEY}`, { method: "POST", headers: HEADERS, body: JSON.stringify({ returnSecureToken: true }) })).idToken; }
  catch (e) { fail("sign-in", e); }
  let lines = null;
  const passed = [];
  for (const db of token ? DBS : []) {
    try { lines = (await json(`${db}/crates/rooms/${INDEX_ROOM}/games.json?auth=${token}`, { headers: HEADERS })) || {}; base = db; break; }
    catch (e) { passed.push([`index at ${db}`, e]); }
  }
  if (!base) for (const [what, e] of passed) fail(what, e);
  if (CHECK && base) return selfCheck(base, token, before);
  if (SCAN && base) return scan(base, token, before, index, have);
  let found = 0;
  for (const [key, line] of Object.entries(lines || {})) {
    if (have.has(key) || !line?.room || line.check) continue;
    try {
      const branch = await json(`${base}/crates/rooms/${line.room}/dandan.json?auth=${token}`, { headers: HEADERS });
      if (!branch?.game) throw new Error("no game in the room");
      write(`games/${key}.json`, { key, room: line.room, line, game: branch.game, result: branch.result || line.result, players: branch.players });
      index.push({ key, room: line.room, uid: line.uid, ...(branch.result || line.result) });
      found++;
    } catch (e) { fail(`game ${key} in ${line.room}`, e); }
  }
  index.sort((a, b) => (a.ended || 0) - (b.ended || 0));
  // the folder changes (and so is committed) only when there is something new to say, so the branch isn't a log of idle hours
  const kept = new Set(index.map(g => g.key)), listed = Object.keys(lines || {});
  const status = { at: new Date().toISOString(), games: index.length, new: found, listed: listed.length, unread: listed.filter(k => !kept.has(k)).length, errors };
  if (found) write("index.json", index);
  if (found || !before.at || errors.join() !== (before.errors || []).join()) write("status.json", status);
  console.log(`${index.length} games, ${found} new, ${errors.length} problems`);
}
/** Every room asked for its Dandan result; what answers is fetched whole and kept like any game, marked `scanned`. */
async function scan(base, token, before, index, have) {
  const L = LETTERS.length, total = L ** 4, found = [], t0 = Date.now();
  let next = 0, failed = 0, asked = 0;
  const codeOf = i => LETTERS[Math.floor(i / L ** 3) % L] + LETTERS[Math.floor(i / L ** 2) % L] + LETTERS[Math.floor(i / L) % L] + LETTERS[i % L];
  const get = async url => {
    for (let attempt = 0; ; attempt++) {
      try { return await json(url, { headers: HEADERS }); }
      catch (e) { if (attempt >= 3) throw e; await new Promise(r => setTimeout(r, 300 * 2 ** attempt)); }
    }
  };
  const worker = async () => {
    while (failed < 500) {
      const i = next++;
      if (i >= total) return;
      const room = codeOf(i);
      try {
        const result = await get(`${base}/crates/rooms/${room}/dandan/result.json?auth=${token}`);
        if (result) found.push({ room, result });
      } catch (e) { failed++; if (failed < 5) fail(`scan ${room}`, e); }
      if (++asked % 25000 === 0) console.log(`asked ${asked} of ${total} rooms, ${found.length} games, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.SCAN_WIDTH) || 96 }, worker));
  let added = 0;
  for (const { room, result } of found) {
    const key = String(result.started);
    if (have.has(key)) continue;
    try {
      const branch = await get(`${base}/crates/rooms/${room}/dandan.json?auth=${token}`);
      write(`games/${key}.json`, { key, room, line: null, scanned: true, game: branch.game, result: branch.result, players: branch.players });
      index.push({ key, room, scanned: true, ...branch.result });
      have.add(key); added++;
    } catch (e) { fail(`game in ${room}`, e); }
  }
  index.sort((a, b) => (a.ended || 0) - (b.ended || 0));
  if (added) write("index.json", index);
  const scanned = { at: new Date().toISOString(), rooms: asked, found: found.length, added, failed };
  write("status.json", { ...before, games: index.length, scan: scanned, errors });
  console.log(`scan: ${JSON.stringify(scanned)}; ${index.length} games`);
}
/** The page's own write, tried: a marked line in the index room, read back, taken away. */
async function selfCheck(base, token, before) {
  const key = `check-${Date.now()}`, url = `${base}/crates/rooms/${INDEX_ROOM}/games/${key}.json?auth=${token}`, check = {};
  const step = async (name, init, ok) => { try { const v = await json(url, { headers: HEADERS, ...init }); check[name] = ok(v); } catch (e) { check[name] = false; fail(`check ${name}`, e); } };
  await step("write", { method: "PUT", body: JSON.stringify({ room: "CHECK", check: true, at: Date.now() }) }, v => v?.check === true);
  await step("read", {}, v => v?.check === true);
  await step("delete", { method: "DELETE" }, () => true);
  await step("gone", {}, v => v === null);
  write("status.json", { ...before, check: { at: new Date().toISOString(), ...check }, errors });
  console.log(`check: ${JSON.stringify(check)}`);
}
main().catch(e => { fail("run", e); write("status.json", { at: new Date().toISOString(), errors }); }).finally(() => { process.exitCode = 0; });
