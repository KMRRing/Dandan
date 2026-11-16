// howitworks.html: how Monte Scry Zero (the live engine) decides, and one real game of it against itself walked through decision
// by decision with its insides shown: what Scry believes of the other hand against the truth, the policy net's probabilities,
// the search's win chances, the value net's verdict. For the owner: it opens only with the key in the address (games-key.js),
// like the game history and the game lab, and their gear menu links all three.
// The game's data is lab/explain/game-<seed>.json, made by lab/explain/trace.mjs (the game, traced), without-scry.mjs (some
// decisions weighed again without Scry) and pack.mjs (with the notes, lab/explain/notes-<seed>.json). Nothing here computes.
import { keyOk } from "./games-key.js";
import { mountSettings } from "./lab-nav.js";
import { CARDS } from "./dandan-cards.js";

const root = document.getElementById("hw");
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = v => (v == null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(v > 0.995 || v < 0.005 ? 1 : 0)}%`);
const isLand = n => CARDS[n.replace(/^\*/, "")]?.type === "land";
const PHASE = { mull: "the mulligan", upkeep: "upkeep", draw: "draw step", main1: "first main phase", attackers: "attacks", blockers: "blocks", damage: "damage", main2: "second main phase", end: "end step" };
const QUESTION = { mull: "keep or mulligan", discard: "what to discard", bend: "what Mind Bend changes", pick: "a choice", putback: "what Brainstorm puts back", order: "the order of the top cards", search: "what to fetch", surveil: "surveil", attack: "what attacks", block: "what blocks", owner: "where it goes" };

let G = null, at = 0, onlyMoments = true, moments = [], byI = new Map(), seer = 0;   // seer: whose Scry the panel shows

async function main() {
  document.documentElement.classList.add("ready");
  if (!(await keyOk(new URLSearchParams(location.search).get("k")))) { location.replace("./"); return; }
  mountSettings("how");
  try { G = await (await fetch("lab/explain/game-3298.json")).json(); }
  catch (e) { root.innerHTML = `<h1>How Monte thinks</h1><p class="hw-sub">The game's data didn't load (${esc(e.message)}).</p>`; return; }
  G.steps.forEach((s, k) => byI.set(s.i, k));
  moments = G.moments.map(m => ({ ...m, k: byI.get(m.i) })).filter(m => m.k != null);
  at = moments[0]?.k ?? 0;
  render();
}

// ---------- the page ----------
function render() {
  const n = G.names;
  root.innerHTML = `
  <h1>How Monte thinks</h1>
  <p class="hw-lead">Monte Scry Zero, the engine in the live game, decides each move the same way. It guesses the cards it can't see, plays every option forward a couple of turns in many guessed worlds, and picks the option that wins most often. Three small neural nets do the guessing, the playing and the judging. Nothing hand-written about strategy is inside.</p>
  ${diagram()}
  <h2>The four parts</h2>
  ${parts()}
  <h2>One game, step by step: ${esc(n[1])} floods</h2>
  <p>${esc(G.summary)}</p>
  <p class="hw-note">A real game, seed ${G.seed}, ${G.steps.length} decisions. Both seats play the live nets (g9x-C) at Quick, ${G.deals} dealt worlds a decision; the app plays at Deepest, 2,048. Every number below is what the engine computed at that moment. "The truth" is shown for you; the engine never sees it.</p>
  <div id="hwCharts"></div>
  <div class="hw-game"><div class="hw-step" id="hwStep"></div>
  <div class="hw-panel" id="hwPanel"></div></div>
  <h2>What Scry was worth in this game</h2>
  ${withoutScry()}
  <h2>What this game shows</h2>
  ${lessons()}`;
  charts(); stepper(); panel();
}

function diagram() {
  // one decision: the record feeds Scry; Scry deals worlds; each option is played forward by the policy in each world; the value
  // net scores where each line ends; the average picks the move
  const box = (x, y, w, h, t, s, net = false) => `<rect class="bx${net ? " net" : ""}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/><text class="t" x="${x + 10}" y="${y + 20}">${t}</text>${s.map((l, k) => `<text class="s" x="${x + 10}" y="${y + 38 + k * 15}">${l}</text>`).join("")}`;
  return `<figure class="hw-fig" aria-label="How one decision is made">
  <svg viewBox="0 0 760 330" role="img">
    <defs><marker id="hwArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--brass)"/></marker></defs>
    ${box(10, 20, 170, 92, "The game so far", ["every public move:", "casts, passes, land drops,", "draws, mulligans"])}
    ${box(220, 20, 230, 92, "Scry (net 1)", ["each unseen card in their hand:", "a chance for every card name", "e.g. 0.03 lands, where luck says 0.7"], true)}
    ${box(490, 20, 260, 92, "Deal worlds", ["64 to 2,048 complete guesses:", "their hand drawn by Scry's odds,", "the library shuffled from the rest"])}
    ${box(490, 150, 260, 92, "Play each option forward", ["every legal move, in every world,", "two turns ahead (three on close calls),", "both sides moved by the policy (net 2)"], true)}
    ${box(220, 150, 230, 92, "Value net (net 3)", ["where each line ends:", "the chance to win from there,", "reading both hands face up"], true)}
    ${box(10, 150, 170, 92, "Pick", ["each option's average", "over all the worlds;", "the highest is played"])}
    <path class="ar" d="M180 66H218"/><path class="ar" d="M450 66H488"/><path class="ar" d="M620 112V148"/><path class="ar" d="M490 196H452"/><path class="ar" d="M220 196H182"/>
    <path class="loop" d="M95 242V290H620V244"/>
    <text class="s" x="230" y="306">the move played becomes part of the game so far, and Scry updates</text>
  </svg></figure>`;
}

function parts() {
  const card = (k, h, p, dl) => `<div class="hw-card"><div class="k">${k}</div><h3>${h}</h3><p>${p}</p><dl>${dl.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl></div>`;
  return `<div class="hw-parts">
  ${card("Net 1 · belief", "Scry: what's in their hand", "Reads the public record (what they played, passed on, drew, mulliganed into) and gives every unseen card in the other hand its own chance of being each of the 25 card names. Cards known for certain, like a land Izzet Boilerworks returned in view, count as known.", [["Inputs", "547 (the public position + 13 numbers on their play so far) + 12 per card on its own history"], ["Size", "64 hidden units"], ["Trained on", "9.1 million hidden cards in 2.0 million self-play positions"], ["Better than luck?", "per-card loss 2.48 against the pool's 2.68; two-or-more-lands calls, Brier 0.126 against 0.169"]])}
  ${card("Net 2 · policy", "Zero: what it would play", "Given the position as one seat sees it, plus Scry's estimate of the other hand, it scores every legal move. It plays both sides of every look-ahead, and narrows the search tree to the few moves that matter.", [["Inputs", "654"], ["Size", "128 and 64 hidden units"], ["Trained on", "885,563 searched decisions"], ["Agrees with the search", "80% of decisions (95% of passes, 53% of land plays)"]])}
  ${card("Search", "Many worlds, every option", "For each legal move it deals complete guesses of the hidden cards, plays the move and two turns after it, and averages the results. When the best two are within 3 points it looks three turns ahead. The highest average is played.", [["Worlds a decision", "Quick 64, Long 256, Deep 1,024, Deepest 2,048 (the app's default)"], ["Look-ahead", "2 turns; 3 on a close call"]])}
  ${card("Net 3 · value", "Who's winning", "Gives the chance the seat wins from a position. It is trained on finished self-play games with both hands face up, and the search uses it on its dealt worlds, where both hands are known.", [["Inputs", "665 (both sides, face up)"], ["Size", "64 and 32 hidden units"], ["Trained on", "2.97 million positions"]])}
  </div>`;
}

// ---------- the charts: Scry's read of the flooded hand, and who the value net says is winning ----------
function charts() {
  const el = document.getElementById("hwCharts"), F = G.flooded, O = 1 - F, n = G.names;
  const pts = G.steps.map((s, k) => ({ k, turn: s.turn, scry: s.scry[O].lands, pool: s.scry[O].pool, real: s.scry[O].real, val: s.value[O] }));
  // the value net at quiet moments only (nothing on the stack, no question pending): mid-spell positions swing it about
  const quiet = pts.filter((p, k) => !G.steps[k].q && !G.steps[k].board.stack.length);
  el.innerHTML = `
  <div class="hw-chart" id="chLands"><h3>Lands in ${esc(n[F])}'s hand, as ${esc(n[O])} sees it</h3>
    <div class="hw-legend"><span class="c-scry"><i></i>Scry's estimate</span><span class="c-pool"><i></i>Luck alone (known cards + the unseen pool's odds)</span><span class="c-real"><i></i>The truth</span></div>
    ${lineChart(pts, [["scry", "c-scry"], ["pool", "c-pool"], ["real", "c-real", true]], { max: 4, ticks: [0, 1, 2, 3, 4], fmt: v => v.toFixed(0) })}</div>
  <div class="hw-chart" id="chVal"><h3>${esc(n[O])}'s chance to win, by the value net</h3>
    ${lineChart(quiet, [["val", "c-val"]], { max: 1, ticks: [0, 0.5, 1], fmt: v => `${v * 100}%` })}
    <p class="hw-note">At each decision with nothing on the stack. It reads both hands, so it can be sure before either player is.</p></div>`;
  for (const id of ["chLands", "chVal"]) hover(document.getElementById(id), pts, id === "chLands"
    ? p => `Turn ${p.turn}: Scry ${p.scry.toFixed(1)} · luck ${p.pool.toFixed(1)} · truth ${p.real}`
    : p => `Turn ${p.turn}: ${pct(p.val)}`);
}
const W = 760, H = 170, PL = 34, PR = 12, PT = 10, PB = 24;
const X = k => PL + (k / Math.max(1, G.steps.length - 1)) * (W - PL - PR);
function lineChart(pts, series, { max, ticks, fmt }) {
  const Y = v => PT + (1 - v / max) * (H - PT - PB);
  const grid = ticks.map(t => `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${PL - 6}" y="${Y(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`).join("");
  // turn ticks every 4 turns, at the first decision of that turn
  const seen = new Set(), xt = [];
  pts.forEach(p => { if (!seen.has(p.turn) && p.turn % 4 === 0 && p.turn > 0) { seen.add(p.turn); xt.push(p); } });
  const xa = xt.map(p => `<text class="ax" x="${X(p.k)}" y="${H - 6}" text-anchor="middle">t${p.turn}</text>`).join("");
  const lines = series.map(([f, cls, step]) => {
    let d = "";
    pts.forEach((p, j) => { const x = X(p.k), y = Y(Math.min(max, p[f])); d += j ? (step ? `H${x}V${y}` : `L${x} ${y}`) : `M${x} ${y}`; });
    return `<path class="ln ${cls}" d="${d}"/>`;
  }).join("");
  const marks = moments.map(m => `<line class="grid" x1="${X(m.k)}" x2="${X(m.k)}" y1="${H - PB}" y2="${H - PB + 4}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}" role="img">${grid}${marks}${lines}${xa}<line class="cur" y1="${PT}" y2="${H - PB}" x1="0" x2="0"/></svg>`;
}
function hover(box, pts, text) {
  const svg = box.querySelector("svg"), tip = document.createElement("div");
  tip.className = "hw-tip"; tip.hidden = true; box.append(tip);
  const kAt = e => { const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W; return Math.max(0, Math.min(pts.length - 1, Math.round(((x - PL) / (W - PL - PR)) * (pts.length - 1)))); };
  svg.addEventListener("pointermove", e => {
    const k = kAt(e), r = box.getBoundingClientRect();
    tip.textContent = text(pts[k]); tip.hidden = false;
    const left = e.clientX - r.left + 12;
    tip.style.left = `${Math.min(left, r.width - tip.offsetWidth - 4)}px`; tip.style.top = `${e.clientY - r.top - 30}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  svg.addEventListener("click", e => { go(kAt(e)); document.getElementById("hwStep").scrollIntoView({ block: "start" }); });
}
function cursor() {
  for (const svg of document.querySelectorAll(".hw-chart svg")) { const c = svg.querySelector(".cur"); c.setAttribute("x1", X(at)); c.setAttribute("x2", X(at)); }
}

// ---------- the stepper ----------
function stepper() {
  const el = document.getElementById("hwStep");
  el.innerHTML = `
  <div class="hw-bar">
    <button type="button" id="hwMom" class="${onlyMoments ? "on" : ""}" aria-pressed="${onlyMoments}">Key moments</button>
    <button type="button" id="hwAll" class="${onlyMoments ? "" : "on"}" aria-pressed="${!onlyMoments}">Every decision</button>
  </div>
  <div class="hw-bar">
    <button type="button" id="hwPrev" aria-label="Back">◀</button>
    <input type="range" class="hw-slider" id="hwSlider" min="0" max="${G.steps.length - 1}" value="${at}" aria-label="Decision">
    <button type="button" id="hwNext" aria-label="Forward">▶</button>
  </div>
  <div class="hw-where" id="hwWhere"></div>`;
  el.querySelector("#hwMom").onclick = () => { onlyMoments = true; stepper(); panel(); };
  el.querySelector("#hwAll").onclick = () => { onlyMoments = false; stepper(); panel(); };
  el.querySelector("#hwPrev").onclick = () => move(-1);
  el.querySelector("#hwNext").onclick = () => move(1);
  el.querySelector("#hwSlider").oninput = e => go(Number(e.target.value), true);
}
function move(d) {
  if (!onlyMoments) return go(at + d);
  const list = d > 0 ? moments.filter(m => m.k > at) : moments.filter(m => m.k < at).reverse();
  if (list.length) go(list[0].k);
}
function go(k, fromSlider = false) {
  at = Math.max(0, Math.min(G.steps.length - 1, k));
  if (!fromSlider) document.getElementById("hwSlider").value = at;
  panel();
}

function panel() {
  const s = G.steps[at], n = G.names, who = n[s.who];
  const m = moments.find(x => x.k === at);
  const prev = document.getElementById("hwPrev"), next = document.getElementById("hwNext");
  if (onlyMoments) { prev.disabled = !moments.some(x => x.k < at); next.disabled = !moments.some(x => x.k > at); }
  else { prev.disabled = at === 0; next.disabled = at === G.steps.length - 1; }
  const mi = moments.indexOf(m);
  document.getElementById("hwWhere").innerHTML = `${s.turn ? `<b>Turn ${s.turn}</b>, ${esc(n[s.active])}'s ${PHASE[s.phase] || s.phase}` : "<b>Before the game</b>"} · <b>${esc(who)}</b> decides ${s.q ? esc(QUESTION[s.q] || s.q) : ""} · decision ${at + 1} of ${G.steps.length}${m ? ` · moment ${mi + 1} of ${moments.length}` : ""}`;
  cursor();
  const b = s.scry[seer];
  document.getElementById("hwPanel").innerHTML = `
  ${m ? `<div class="hw-moment"><div class="act">${esc(m.act)}</div><h3>${esc(m.title)}</h3><p>${esc(m.text)}</p></div>` : ""}
  <div class="hw-box"><h3>The table</h3>${[0, 1].map(x => side(s, x)).join("")}<p class="hw-note">Library: ${s.board.lib} cards${s.board.stack.length ? ` · on the stack: ${esc(s.board.stack.join(", "))}` : ""}. Dimmed lands are tapped; dashed hand cards are hidden from the decider.</p></div>
  <div class="hw-two">
    <div class="hw-box"><h3>${esc(who)}'s options</h3>${options(s)}</div>
    <div class="hw-box"><h3>${esc(n[seer])}'s Scry: ${esc(n[1 - seer])}'s hand</h3>
      <div class="hw-bar hw-seer"><button type="button" data-seer="0" class="${seer === 0 ? "on" : ""}">${esc(n[0])}'s</button><button type="button" data-seer="1" class="${seer === 1 ? "on" : ""}">${esc(n[1])}'s</button></div>${belief(b)}</div>
  </div>
  <div class="hw-two">
    <div class="hw-box"><h3>What happened</h3><p><b>${esc(who)}</b>: ${esc(s.move)}</p><ul class="hw-log">${(s.log || []).map(l => `<li${/^(Untap|Upkeep|Draw|Main|Combat|End step|Attack|Blocks|Damage|Turn)/.test(l) ? ' class="st"' : ""}>${esc(words(l))}</li>`).join("")}</ul></div>
    <div class="hw-box"><h3>Value net, before this move</h3>${[0, 1].map(x => `<p>${esc(n[x])}: <b>${pct(s.value[x])}</b></p>`).join("")}<p class="hw-note">The value net looks at both hands face up, so this is a verdict on the real position, not on what either player knows.</p></div>
  </div>`;
  document.querySelectorAll("#hwPanel [data-seer]").forEach(btn => { btn.onclick = () => { seer = Number(btn.dataset.seer); panel(); }; });
}
const words = l => l.replace(/\{s(\d)\}/g, (_, i) => G.names[Number(i)]);
function side(s, x) {
  const p = s.board.p[x], hidden = x !== s.who;
  const chip = (c, cls = "") => `<span class="chip${isLand(c) ? " land" : ""}${c.startsWith("*") ? " tap" : ""}${cls}">${esc(c.replace(/^\*/, ""))}</span>`;
  return `<div class="hw-side"><div><span class="who p${x}">${esc(G.names[x])}</span> · ${p.life} life · ${p.hand.length} in hand</div>
    <div class="row"><span class="l">Lands</span>${p.lands.map(c => chip(c)).join("") || "–"}</div>
    ${p.other.length ? `<div class="row"><span class="l">In play</span>${p.other.map(c => chip(c)).join("")}</div>` : ""}
    <div class="row"><span class="l">${hidden ? "The truth" : "Hand"}</span>${p.hand.map(c => chip(c, hidden ? " hid" : "")).join("") || "–"}</div></div>`;
}
function options(s) {
  if (!s.options) return `<p class="hw-note">Only one legal option: no search.</p>`;
  const rows = s.options.map(([mv, mean, prior, nn, pick]) => `<tr class="${pick ? "chosen" : ""}"><td class="opt">${esc(mv)}</td><td class="n">${pct(prior)}<span class="bar prior" style="width:${(prior * 2.5).toFixed(2)}rem"></span></td><td class="n">${pct(mean)}<span class="bar" style="width:${(Math.max(0, mean) * 2.5).toFixed(2)}rem"></span></td></tr>`).join("");
  return `<table class="hw-tbl"><thead><tr><th>Option</th><th class="n">Policy</th><th class="n">Search: wins</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="hw-note">${s.nOptions > s.options.length ? `Top ${s.options.length} of ${s.nOptions} legal options. ` : ""}Policy: the net's own probability, before any search. Search: the share of ${G.deals} dealt worlds won after that move. ▸ marks the move played.</p>`;
}
function belief(b) {
  const max = Math.max(4, b.hand);
  const bar = (label, v, cls) => `<span>${label}</span><span class="track"><span class="fill ${cls}" style="width:${Math.min(100, (v / max) * 100)}%"></span></span><span class="n">${typeof v === "number" ? v.toFixed(v % 1 ? 1 : 0) : v}</span>`;
  const rows = b.names.slice(0, 9).map(([nm, exp, any, real]) => `<tr><td>${esc(nm)}</td><td class="n">${exp.toFixed(2)}</td><td class="n">${pct(any)}</td><td class="n">${real || ""}</td></tr>`).join("");
  return `<p class="hw-note">${b.hand} cards, ${b.unknown === 0 ? "every one known" : `${b.unknown} unknown`}${b.unknown < b.hand && b.unknown ? `, ${b.hand - b.unknown} known` : ""}.</p>
  <div class="hw-lands">${bar("Scry: lands", b.lands, "c-scry")}${bar("Luck alone", b.pool, "c-pool")}${bar("The truth", b.real, "c-real")}</div>
  <table class="hw-tbl"><thead><tr><th>Card</th><th class="n">Expected</th><th class="n">At least one</th><th class="n">Really</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- the same decisions without Scry ----------
function withoutScry() {
  const n = G.names, rows = G.withoutScry.map(r => {
    const k = byI.get(r.i), s = G.steps[k], top = (L, mv) => L.list.find(o => o.move === mv)?.mean;
    const names = [...new Set([...r.live.list.slice(0, 3).map(o => o.move)])];
    return names.map((mv, j) => `<tr${mv === r.live.best ? ' class="chosen"' : ""}>${j ? "" : `<td class="dec" rowspan="${names.length}"><button type="button" data-k="${k}">Turn ${s.turn}</button><br><span class="hw-note">${esc(n[r.who])}</span></td>`}<td class="opt">${esc(mv)}</td><td class="n">${pct(top(r.live, mv))}</td><td class="n">${pct(top(r.blind, mv))}</td></tr>`).join("");
  }).join("");
  const html = `<p>The same decisions weighed twice at 256 worlds each: by the live engine, and by the same engine with Scry taken out, so the other hand is dealt by luck alone and the policy sees luck's odds. Both follow the whole game and get the same random seed, so the deals line up.</p>
  <div class="hw-box" style="overflow-x:auto"><table class="hw-tbl"><thead><tr><th>Decision</th><th>Option</th><th class="n">With Scry</th><th class="n">Without</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="hw-note">▸ marks the move the live engine would play at 256 worlds; it can differ from the game, which was played at 64.</p></div>
  <p>In this game Scry rarely changed the move. At 9 decisions the two agreed on 7; they split only once ${esc(n[1])} was already lost. Where it mattered was the size of the gaps: without Scry, blind deals kept handing ${esc(n[1])} counters it didn't have, so spending mana (Take Inventory, a second Dandân) looked riskier than it was. Most of the flood was public anyway: Izzet Boilerworks returned lands to ${esc(n[1])}'s hand in view, and a player passing turn after turn with five lands open tells the same story to anyone.</p>`;
  queueMicrotask(() => document.querySelectorAll("#hw button[data-k]").forEach(btn => { btn.onclick = () => { onlyMoments = false; stepper(); go(Number(btn.dataset.k)); document.getElementById("hwStep").scrollIntoView({ block: "start" }); }; }));
  return html;
}

function lessons() {
  return `<ul class="hw-ul">
  <li><b>Scry saw the shortage, and the flood was public.</b> On turns 10 to 15 it put 0.0 to 0.8 lands in ${esc(G.names[1])}'s hand where luck said 0.7 to 1.4; the truth was none. In the flood it added only a little to what was public (2.5 to 3.5 against luck's 2.1 to 3.1; the truth 3 or 4), because Izzet Boilerworks kept showing the lands. It never found the Commit // Memory ${esc(G.names[1])} held from turn 13 to 19 (5% or less), and it expected a Memory Lapse that wasn't there.</li>
  <li><b>Passing gets a head start.</b> The search keeps the first-listed option unless another beats it by more than its noise plus half a point. That rule was written for Medium, when the first option was Medium's own move; in Zero the first option is passing. It is why ${esc(G.names[0])} stopped attacking at 99%, and it is a hand-written input still inside.</li>
  <li><b>Scry follows physical cards.</b> Each unseen card gets its own history (opening hand, drawn on turn 5…), tracked by its real identity. When a card leaves the hand the engine knows which one left, which a player can't. Small, but it is hidden information leaking in, and it's on the review doc's list.</li>
  <li><b>Scry is frozen during the look-ahead.</b> The worlds are dealt once at the root; what the other player shows inside a line doesn't update the guess.</li>
  </ul>
  <p class="hw-note">The full review and the list of changes before the next compute wave: <a href="https://claude.ai/artifact/2q2BzsxzEuJbj3d2MnxjW1" target="_blank" rel="noopener">Monte Scry Zero: full component review</a>.</p>`;
}

main();
