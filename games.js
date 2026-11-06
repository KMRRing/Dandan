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

const verdict = r => (r.live ? ["in progress", "gv-live"] : r.result.conceded ? [r.result.won ? "won (conceded)" : "conceded", "gv-lost"] : r.result.drawn ? ["drawn", ""] : r.result.won ? ["won", "gv-won"] : ["lost", "gv-lost"]);
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
    ${run.error ? `<p class="gv-lost">The moves stop making sense at move ${run.at + 1}: ${esc(run.error)} (the rules may have changed since).</p>` : ""}
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
