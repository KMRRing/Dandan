// games.html: the games played on this page and who played them, for the owner. Not linked from the game: it opens only with the
// key in the address (games.html?k=…), whose SHA-256 is below. That keeps the page to whoever has the link; it does not hide the
// games (the database and the `game-records` branch are readable by anyone who looks, README "Reading the games").
// The key check is games-key.js (a file of its own so a Node test can run it).
// The list is the index room's `games` (finished) and `live` (still being played, or never finished), read as any visitor to the page
// reads; a game is played again from its seed and moves (records.js) and shown move by move, both hands open.
import { getSync } from "./net.js";
import { INDEX_ROOM, walk, replay } from "./records.js";
import { shownRules } from "./dandan-rules.js";
import { nm } from "./dandan-core.js";

import { keyOk } from "./games-key.js";

const root = document.getElementById("gv");
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const when = ms => new Date(Number(ms)).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const names = seats => String(seats?.[0]?.name ?? "").length ? seats : [{ name: "You" }, { name: "Monte" }];
const words = (text, seats) => String(text || "").replace(/\{s(\d+)\}/g, (_, i) => seats[Number(i)]?.name ?? `Seat ${Number(i) + 1}`);
const once = (sync, path) => new Promise((res, rej) => { let off = null, done = false; off = sync.watch(path, v => { if (done) return; done = true; res(v); queueMicrotask(() => off?.()); }, rej); });

let stamp = 0, sync = null, rows = [], filter = { name: "", state: "" }, open = null;

async function main() {
  document.documentElement.classList.add("ready");            // style.css shows the large mark until a page says it is ready
  if (!(await keyOk(new URLSearchParams(location.search).get("k")))) { location.replace("./"); return; }
  await load();
}
/** Reads the index and the unfinished games again (the page keeps no live feed: Refresh is how a game just finished shows). */
async function load() {
  root.innerHTML = '<h1>Dandan games</h1><p class="gv-sub">Loading the games…</p>';
  try {
    sync ||= await getSync();
    const [games, live] = await Promise.all([once(sync, `crates/rooms/${INDEX_ROOM}/games`), once(sync, `crates/rooms/${INDEX_ROOM}/live`)]);
    rows = [];
    for (const [key, g] of Object.entries(games || {})) if (!g?.check && g?.result) rows.push({ key, name: g.name, uid: g.uid, room: g.room, result: g.result, live: false });
    for (const [key, g] of Object.entries(live || {})) if (!g?.check && !(games || {})[key] && g?.result) rows.push({ key, name: g.name, uid: g.uid, result: g.result, game: g.game, live: true });
    rows.sort((a, b) => Number(b.key) - Number(a.key));
    stamp = Date.now();
    view === "players" ? players() : list();
  } catch (e) { root.innerHTML = `<h1>Dandan games</h1><p class="gv-sub">Could not read the games: ${esc(e?.message || e)}</p><div class="gv-bar"><button type="button" id="retry">Try again</button></div>`; root.querySelector("#retry").onclick = load; }
}

// ---- tabs, players, removing ----
let sure = null;                                           // what is waiting for a second tap: "player" or a game's key
const tabs = on => `<div class="gv-bar"><button type="button" data-tab="games"${on === "games" ? ' class="on"' : ""}>Games</button><button type="button" data-tab="players"${on === "players" ? ' class="on"' : ""}>Players</button><button type="button" id="refresh" title="Read the games again">Refresh</button><span class="gv-sub">${stamp ? "read " + new Date(stamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>`;
function wireTabs() {
  const rf = root.querySelector("#refresh"); if (rf) rf.onclick = () => { sure = null; load(); }; root.querySelectorAll("[data-tab]").forEach(b => { b.onclick = () => { sure = null; b.dataset.tab === "players" ? players() : list(); }; }); }
// a remove button that asks once more in the page itself (no browser pop-ups)
const removeBar = (rs, what, id = "player") => rs.length ? `<div class="gv-bar gv-remove">${sure === id
  ? `<span class="gv-lost">Remove ${what} and all their data?</span><button type="button" data-yes="1">Yes, remove</button><button type="button" data-no="1">Cancel</button>`
  : `<button type="button" data-ask="${id}">Remove ${id === "player" ? "this player and their games" : "this game"}…</button>`}<span class="gv-sub" id="gvMsg"></span></div>` : "";
function wireRemove(getRows, after, id = "player") {
  const q = s => root.querySelector(s);
  if (q("[data-ask]")) q("[data-ask]").onclick = () => { sure = id; redraw(); };
  if (q("[data-no]")) q("[data-no]").onclick = () => { sure = null; redraw(); };
  if (q("[data-yes]")) q("[data-yes]").onclick = async () => {
    q("[data-yes]").disabled = true;
    const bad = await removeGames(getRows());
    sure = null;
    if (bad.length) { redraw(); const m = root.querySelector("#gvMsg"); if (m) m.textContent = `Not everything went: ${bad.slice(0, 3).join("; ")}`; return; }
    after(); open = null; list();
  };
}
const redraw = () => (open ? draw() : (view === "players" ? players() : list()));
let view = "games";
/** Takes the games out of the index, the unfinished list and their rooms, and leaves a mark the collector obeys (its copy on the records branch goes at its next run). */
async function removeGames(rs) {
  const bad = [], gone = new Set();
  const step = async (what, fn) => { try { await fn(); return true; } catch (e) { bad.push(`${what} (${e?.message || e})`); return false; } };
  for (const r of rs) {
    const base = `crates/rooms/${INDEX_ROOM}`;
    const ok = [await step("mark", () => sync.update(`${base}/removed`, { [r.key]: true })),
      await step("index", () => sync.update(`${base}/games`, { [r.key]: null })),
      await step("unfinished", () => sync.update(`${base}/live`, { [r.key]: null }))];
    if (r.room) await step("room", () => sync.update(`crates/rooms/${r.room}`, { dandan: null }));
    if (ok.every(Boolean)) gone.add(r.key);
  }
  rows = rows.filter(r => !gone.has(r.key));
  return bad;
}
const rate = (n, d) => (d ? Math.round(100 * n / d) + "%" : "—");
function players() {
  view = "players"; open = null;
  const by = new Map();
  for (const r of rows) {
    const p = by.get(r.name) || { name: r.name, n: 0, done: 0, won: 0, lost: 0, drawn: 0, live: 0, turns: 0, last: 0, ids: new Set(), levels: {} };
    by.set(r.name, p);
    p.n++; p.ids.add(r.uid); p.last = Math.max(p.last, Number(r.key));
    if (r.live) { p.live++; continue; }
    p.done++; p.turns += r.result.turns || 0;
    if (r.result.drawn) p.drawn++; else if (r.result.won) p.won++; else p.lost++;
    const l = r.result.level || "?"; (p.levels[l] ||= { w: 0, n: 0 }); p.levels[l].n++; if (r.result.won && !r.result.drawn) p.levels[l].w++;
  }
  const ps = [...by.values()].sort((a, b) => b.last - a.last);
  root.innerHTML = `<h1>Dandan games</h1>${tabs("players")}
    <p class="gv-sub">${ps.length} players, ${rows.length} games.</p>
    <ol class="gv-list">${ps.map(p => `<li><button type="button" data-p="${esc(p.name)}"><span class="meta">${when(p.last)}</span>
      <span><span class="who">${esc(p.name)}</span> <span class="meta">${p.done} finished · ${p.won} won · ${p.lost} lost${p.drawn ? ` · ${p.drawn} drawn` : ""}${p.live ? ` · ${p.live} not finished` : ""}<br>
      win rate ${rate(p.won, p.done)} · ${p.done ? "avg " + Math.round(p.turns / p.done) + " turns" : ""} · ${Object.entries(p.levels).map(([l, x]) => `${esc(l)} ${x.w}/${x.n}`).join(", ")} · ${p.ids.size} device${p.ids.size > 1 ? "s" : ""}</span></span><span class="res">›</span></button></li>`).join("")}</ol>`;
  wireTabs();
  root.querySelector(".gv-list").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { filter.name = b.dataset.p; view = "games"; list(); } };
}

// a conceded game is a lost one (10 November 2026, Korbi: a player concedes once they know they have lost), so it shows as that
const verdict = r => (r.live ? ["in progress", "gv-live"] : r.result.drawn ? ["drawn", ""] : r.result.won ? ["won", "gv-won"] : ["lost", "gv-lost"]);
function list() {
  open = null; view = "games";
  const people = [...new Set(rows.map(r => r.name))].sort();
  const shown = rows.filter(r => (!filter.name || r.name === filter.name) && (!filter.state || (filter.state === "live") === r.live));
  root.innerHTML = `<h1>Dandan games</h1>${tabs("games")}
    <div class="gv-bar"><select id="fName"><option value="">Everyone</option>${people.map(p => `<option${p === filter.name ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>
    <select id="fState"><option value="">All games</option><option value="live"${filter.state === "live" ? " selected" : ""}>Not finished</option><option value="done"${filter.state === "done" ? " selected" : ""}>Finished</option></select>
    <span class="gv-sub">${shown.length} of ${rows.length}</span></div>
    ${filter.name ? removeBar(shown, `${esc(filter.name)}: ${shown.length} games`) : ""}
    <ol class="gv-list">${shown.map(r => { const [v, c] = verdict(r); return `<li><button type="button" data-k="${r.key}"><span class="meta">${when(r.key)}</span><span><span class="who">${esc(r.name)}</span> <span class="meta">${esc(r.result.level || "")} · turn ${r.result.turns} · ${r.result.moves} moves</span></span><span class="res ${c}">${v}</span></button></li>`; }).join("")}</ol>`;
  wireTabs(); wireRemove(() => shown, () => { filter.name = ""; });
  root.querySelector("#fName").onchange = e => { filter.name = e.target.value; list(); };
  root.querySelector("#fState").onchange = e => { filter.state = e.target.value; list(); };
  root.querySelector(".gv-list").onclick = e => { const b = e.target.closest("[data-k]"); if (b) show(rows.find(r => r.key === b.dataset.k)); };
}

async function show(r) {
  root.innerHTML = `<h1>Dandan games</h1><p class="gv-sub">Opening the game…</p>`;
  let game = r.game;
  try {
    if (!game) game = (await once(sync, `crates/rooms/${r.room}/dandan/game`));
  } catch (e) { root.innerHTML = `<p class="gv-sub">Could not open it: ${esc(e?.message || e)}</p><button id="back">Back</button>`; root.querySelector("#back").onclick = list; return; }
  const seats = names(game.seats), run = walk(shownRules, game), total = run.lens.length;
  // a game begun before the page recorded moves has only the moves made since (the page was updated while it was in hand), so it
  // cannot be played again from the deal: `n` counts every move, and a game with the first one missing starts at a land, not a keep
  const kept = typeof game.moves === "string" ? JSON.parse(game.moves) : game.moves || [], first = kept[0]?.[1]?.t;
  run.partial = (game.n > kept.length) ? game.n - kept.length : (run.error && run.at === 0 && first && !["keep", "mull"].includes(first)) ? -1 : 0;
  open = { r, game, seats, run, total, at: total, find: "" };
  draw();
}

function draw() {
  const { r, game, seats, run, total, at, find } = open, [v, c] = verdict(r);
  const G = replay(shownRules, game, at), s = G.error ? null : G.state;
  const hits = find ? run.G.state.log.map((e, i) => ({ e, i })).filter(x => x.e.t && words(x.e.t, seats).toLowerCase().includes(find.toLowerCase())).slice(0, 40) : [];
  const cards = ids => ids.map(id => nm(id)).join(", ") || "—";
  const bf = seat => (s.bf || []).filter(p => p.ctl === seat).map(p => nm(p.id) + (p.tapped ? " (tapped)" : "")).join(", ") || "—";
  root.innerHTML = `<h1>Dandan games</h1>
    <div class="gv-bar"><button type="button" id="back">All games</button></div>
    ${removeBar([r], "this game", "game")}
    <p><b>${esc(r.name)}</b> vs ${esc(seats[1]?.name || "Monte")} · ${when(r.key)} · <span class="${c}">${v}</span></p>
    <p class="gv-sub">${esc(r.result.level || "")}${r.result.think ? " · thinks " + esc(r.result.think) : ""} · turn ${r.result.turns} · ${total} moves${r.live ? " · last move written " + when(r.result.ended) : ""} · player ${esc(String(r.uid || "").slice(0, 8))} · ${esc(r.result.page || "")}</p>
    ${run.partial ? `<p class="gv-lost">This game began before moves were recorded${run.partial > 0 ? ` (${run.partial} of its first moves are missing)` : ""}, so it cannot be played again from the deal; only its result and summary are kept.</p>` : run.error ? `<p class="gv-lost">The moves stop making sense at move ${run.at + 1}: ${esc(run.error)} (the rules may have changed since).</p>` : ""}
    <div class="gv-bar"><button type="button" data-d="-10">−10</button><button type="button" data-d="-1">◀</button><b>move ${at} of ${total}</b><button type="button" data-d="1">▶</button><button type="button" data-d="10">+10</button></div>
    <input class="gv-slider" id="sl" type="range" min="0" max="${total}" value="${at}">
    ${s ? `<div class="gv-state">
      <div class="gv-box"><h3>Turn ${s.turn} · ${esc(seats[s.active]?.name)} · ${esc(s.step)} · life ${s.life.map((l, i) => `${esc(seats[i]?.name)} ${l}`).join(", ")} · library ${s.lib.length}</h3>
        <p>Top of the library: ${s.lib.length ? esc(nm(s.lib[0])) : "—"}</p></div>
      ${[0, 1].map(i => `<div class="gv-box"><h3>${esc(seats[i]?.name)}</h3><p><b>Hand:</b> ${esc(cards(s.hand[i]))}</p><p><b>In play:</b> ${esc(bf(i))}</p></div>`).join("")}
      <div class="gv-box"><h3>Stack</h3><p>${s.stack.length ? s.stack.map(x => esc(words("{s" + x.ctl + "}", seats) + "'s " + x.name)).join(" ← ") : "—"}</p></div>
      <div class="gv-box"><h3>Log</h3><ol class="gv-log">${s.log.map(e => `<li${e.st ? ' class="st"' : ""}>${esc(words(e.t, seats))}</li>`).join("")}</ol></div></div>` : ""}
    <div class="gv-bar"><input type="text" id="find" placeholder="Find in the log, e.g. Repulse" value="${esc(find)}"></div>
    <ol class="gv-found">${hits.map(h => `<li><button type="button" data-line="${h.i}">${esc(words(h.e.t, seats))}</button></li>`).join("")}</ol>`;
  const log = root.querySelector(".gv-log"); if (log) log.scrollTop = log.scrollHeight;
  root.querySelector("#back").onclick = () => { sure = null; list(); };
  wireRemove(() => [r], () => {}, "game");
  root.querySelector("#sl").oninput = e => { open.at = Number(e.target.value); draw(); };
  root.querySelector("#sl").onchange = e => { open.at = Number(e.target.value); draw(); };
  root.querySelectorAll("[data-d]").forEach(b => { b.onclick = () => { open.at = Math.max(0, Math.min(total, open.at + Number(b.dataset.d))); draw(); }; });
  root.querySelector("#find").onchange = e => { open.find = e.target.value.trim(); draw(); };
  root.querySelectorAll("[data-line]").forEach(b => {
    // the first move after which that line is in the log
    b.onclick = () => { const i = run.lens.findIndex(n => n > Number(b.dataset.line)); open.at = i < 0 ? total : i + 1; draw(); };
  });
}
if (typeof document !== "undefined" && typeof window !== "undefined" && !globalThis.__GAMES_TEST) main();
