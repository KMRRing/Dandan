// Every game's menu, the same everywhere. A game still fills its menu (#menuBody) as it always has; this module
// shapes what it puts there each time it opens:
//  - the sheet: a title, an × at the top right, a tap outside closes it; it rises from the bottom on a phone and
//    stands as a card on a wide screen (style.css)
//  - the order: a game that marks its parts with data-part (or uses part() below) has them laid out as Play, Content,
//    Together, Settings, About, whatever order it added them in, each under the same small heading
//  - the clutter: a long explanation (more than a sentence or two) goes into one closed "How it works" at the
//    bottom, so the menu shows choices and buttons, and the reading is there for whoever opens it
// Loaded by every page through pwa.js.


export const PARTS = ["play", "content", "together", "settings", "about"];
const LABEL = { play: "", content: "Content", together: "Together", settings: "Settings", about: "About" };
const LONG = 120;                           // characters: longer than this, an explanation folds away

/** A part of the menu, made in `body` and laid out in its place: part(body, "settings").append(...). */
export function part(body, name) {
  let box = body.querySelector(`:scope > [data-part="${name}"]`);
  if (!box) { box = document.createElement("section"); box.dataset.part = name; box.className = "menu-part"; body.appendChild(box); }
  return box;
}

// ---------- the controls, the same in every game ----------
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
/**
 * One of: a label and its options; onChange(value) when another is tapped. options: [[value, text], …]. A few short
 * options sit in a segmented row beside the label; more, or longer ones, in a grid of buttons under it (a segmented
 * row that wraps onto a second line breaks its own borders).
 */
export function choice(label, options, value, onChange) {
  const compact = options.length <= 3 && options.reduce((n, [, t]) => n + String(t).length, 0) <= 20;
  const dense = options.every(([, t]) => String(t).length <= 3);
  const row = el("div", compact ? "menu-row" : "menu-grid-wrap"), set = el("div", compact ? "menu-seg" : dense ? "menu-grid dense" : "menu-grid");
  set.setAttribute("role", "radiogroup");
  set.setAttribute("aria-label", label);
  for (const [v, text] of options) {
    const b = el("button", null, text);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(v === value));
    b.addEventListener("click", () => {
      if (v === value) return;
      value = v;
      for (const x of set.children) x.setAttribute("aria-checked", String(x === b));
      onChange(v);
    });
    set.appendChild(b);
  }
  row.append(el("span", "menu-label", label), set);
  return row;
}
/**
 * Some of: a label and a grid of options to tick; onChange(values) with the ticked values, in the options' order. With
 * max, ticking one more lets go of the one ticked longest ago. With all (the include kind), All and None beside the
 * label tick every option or none.
 */
export function ticks(label, options, values, onChange, max = Infinity, { all = false } = {}) {
  const wrap = el("div", "menu-grid-wrap"), grid = el("div", options.every(([, t]) => String(t).length <= 3) ? "menu-grid dense" : "menu-grid");
  if (grid.classList.contains("dense")) grid.style.gridTemplateColumns = `repeat(${Math.min(options.length, 10)}, minmax(0, 1fr))`;   // 1–10 in one row
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", label);
  const order = [...values], buttons = new Map();               // order: ticked values, oldest first
  const show = () => { for (const [v, b] of buttons) b.setAttribute("aria-pressed", String(order.includes(v))); };
  const changed = () => { show(); onChange(options.map(([x]) => x).filter(x => order.includes(x))); };
  for (const [v, text] of options) {
    const b = el("button", null, text);
    b.type = "button";
    b.addEventListener("click", () => {
      const at = order.indexOf(v);
      if (at >= 0) order.splice(at, 1); else { order.push(v); if (order.length > max) order.shift(); }
      changed();
    });
    buttons.set(v, b);
    grid.appendChild(b);
  }
  show();
  const name = el("span", "menu-label", label);
  if (!all) { wrap.append(name, grid); return wrap; }
  const head = el("div", "menu-ticks-head"), both = el("span", "menu-allnone");
  for (const [text, keep] of [["All", true], ["None", false]]) {
    const b = el("button", "link", text);
    b.type = "button";
    b.setAttribute("aria-label", `${text}: ${label}`);
    b.addEventListener("click", () => { order.splice(0, order.length, ...(keep ? options.map(([x]) => x).slice(0, max) : [])); changed(); });
    both.append(b);
  }
  both.insertBefore(document.createTextNode(" · "), both.lastChild);
  head.append(name, both);
  wrap.append(head, grid);
  return wrap;
}
/** A switch: a label and on or off; onChange(on). */
export function toggle(label, on, onChange) {
  const row = el("div", "menu-row"), sw = el("button", "menu-switch");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(!!on));
  sw.setAttribute("aria-label", label);
  sw.addEventListener("click", () => { on = !on; sw.setAttribute("aria-checked", String(on)); onChange(on); });
  row.append(el("span", "menu-label", label), sw);
  return row;
}
/** A button: the menu closes, then fn runs. kind: "primary" (the one to press), "" (plain) or "link" (quiet). */
export function action(text, fn, kind = "") {
  const b = el("button", kind === "link" ? "link menu-link" : `btn wide${kind === "primary" ? " primary" : ""}`, text);
  b.type = "button";
  b.addEventListener("click", () => { document.getElementById("menuDlg")?.close(); fn(); });
  return b;
}
/**
 * The header's dropdown, in the menu too: the same choice, from the same <select> (a game's quick switch stays in its
 * header), laid out like any choice; picking one closes the menu and changes the select, so
 * the game answers exactly as it does to the header.
 */
export function mirror(label, select) {
  const options = [...select.options].filter(o => !o.disabled).map(o => [o.value, o.label]);
  return choice(label, options, select.value, v => { document.getElementById("menuDlg")?.close(); select.value = v; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
/** A short status line (a best, where you are). */
export const line = text => el("p", "menu-line", text);

export const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
// Kontor's menu button: three rules, technical
const KONTOR_MENU = '<svg class="k-menu" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></svg>';
// the menu button: an astrolabe's rete, Almanac's large loader standing still (rete.svg): the navy plate with its brass
// limb and hour ticks, the rete (its ring, the off-centre ecliptic, four flame-shaped star pointers) and the rule across
// it, pinned at the centre. While the menu is open the rete turns over the plate and the rule the other way (style.css).
export const RETE = `<svg class="rete" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#1C2A34"/><circle cx="50" cy="50" r="43" fill="none" stroke="#C8923A" stroke-width="3.2"/><path d="M85 50L90.5 50M85.74 59.58L89.12 60.48M80.31 67.5L85.07 70.25M76.16 76.16L78.64 78.64M67.5 80.31L70.25 85.07M59.58 85.74L60.48 89.12M50 85L50 90.5M40.42 85.74L39.52 89.12M32.5 80.31L29.75 85.07M23.84 76.16L21.36 78.64M19.69 67.5L14.93 70.25M14.26 59.58L10.88 60.48M15 50L9.5 50M14.26 40.42L10.88 39.52M19.69 32.5L14.93 29.75M23.84 23.84L21.36 21.36M32.5 19.69L29.75 14.93M40.42 14.26L39.52 10.88M50 15L50 9.5M59.58 14.26L60.48 10.88M67.5 19.69L70.25 14.93M76.16 23.84L78.64 21.36M80.31 32.5L85.07 29.75M85.74 40.42L89.12 39.52" stroke="#F3E1BA" stroke-width="1.9" stroke-linecap="round" opacity=".75" fill="none"/><circle cx="50" cy="50" r="17" fill="none" stroke="#F3E1BA" stroke-width="1.3" opacity=".3"/><path d="M50 21V79M21 50H79" stroke="#F3E1BA" stroke-width="1.3" opacity=".22"/><g class="rete-turn"><circle cx="50" cy="50" r="31" fill="none" stroke="#F3E1BA" stroke-width="2.4"/><circle cx="50" cy="41" r="19" fill="none" stroke="#C8923A" stroke-width="3.6"/><path d="M50 22V19M50 60V81M31 41H20.1M69 41H79.9" stroke="#F3E1BA" stroke-width="2.2" stroke-linecap="round"/><path d="M33.12 76Q33.39 71.43 35.86 66.85Q31.59 69 27.33 71.14Z" fill="#F3E1BA"/><path d="M72.67 71.14Q67.89 69 64.14 66.85Q65.51 71.43 66.88 76Z" fill="#F3E1BA"/><path d="M20.52 40.42Q25.32 40.56 30.06 40.7Q26.89 37.14 23.71 33.57Z" fill="#F3E1BA"/><path d="M76.29 33.57Q73.97 37.14 69.94 40.7Q74.71 40.56 79.48 40.42Z" fill="#F3E1BA"/></g><g class="rete-rule"><path d="M78.67 70.08L21.33 29.92" stroke="#F3E1BA" stroke-width="3.8" stroke-linecap="round"/></g><circle cx="50" cy="50" r="4.8" fill="#C8923A"/><circle cx="50" cy="50" r="1.8" fill="#1C2A34"/></svg>`;
const heads = new Map();
/** Puts the part make() returns at the head of the page's menu (a menu filled once, not at every opening, too), until
 *  dropMenuHead(name). */
export function menuHead(name, make) {
  heads.set(name, make);
  const body = document.getElementById("menuBody");
  if (body?.children.length) shape(body);
}
/** Takes a part menuHead put there out of the menu, at once and from then on. */
export function dropMenuHead(name) {
  heads.delete(name);
  document.querySelector(`#menuBody > [data-head="${name}"]`)?.remove();
}

let shaping = false;
/** Lays out what the game just put in the menu: parts in order, under their headings; long explanations folded away. */
function shape(body) {
  if (shaping) return;
  shaping = true;
  try {
    for (const [name, make] of [...heads].reverse()) {
      if (body.querySelector(`:scope > [data-head="${name}"]`)) continue;
      const part = make();
      if (part) { part.dataset.head = name; body.prepend(part); }
    }
    // parts in the standard order, each with its heading (Play needs none: it's the top), after anything unmarked
    for (const box of body.querySelectorAll(":scope > [data-part]")) {
      const name = box.dataset.part;
      if (LABEL[name] && !box.querySelector(":scope > .menu-h")) { const h = document.createElement("h4"); h.className = "menu-h"; h.textContent = LABEL[name]; box.prepend(h); }
      box.hidden = ![...box.children].some(c => !c.classList.contains("menu-h"));   // a part with nothing in it stays out of sight
    }
    // long explanations, wherever they are, into one closed "How it works" at the very bottom
    let about = body.querySelector(":scope > details.menu-how");
    const long = [...body.querySelectorAll("p.stats, p.set-note, p.note")].filter(p => !p.closest("details.menu-how") && !p.dataset.keep && p.textContent.trim().length > LONG);
    if (long.length) {
      if (!about) { about = document.createElement("details"); about.className = "menu-how"; about.innerHTML = "<summary>How it works</summary>"; }
      for (const p of long) about.appendChild(p);
    }
    // the order: unmarked things as the game added them, then the parts in standard order, then How it works; nodes
    // are only moved when the order is wrong, so laying it out doesn't set itself off again
    const kids = [...body.children];
    const want = [...kids.filter(k => !k.dataset.part && k !== about), ...PARTS.map(p => kids.find(k => k.dataset.part === p)).filter(Boolean), ...(about ? [about] : [])];
    if (want.some((k, i) => kids[i] !== k)) for (const k of want) body.appendChild(k);
    // headings left with nothing under them (their only line folded away) go too
    for (const h of body.querySelectorAll(":scope > h3, :scope > h4:not(.menu-h)")) { const next = h.nextElementSibling; if (!next || /^H[34]$/.test(next.tagName) || next === about) h.remove(); }
  } finally { shaping = false; }
}

// ---------- the pause: a game stands still while its menu, its rules, or the games screen is open ----------
// Games listen with onPause(pause, resume): pause() when it should stop, resume(ms) when it may go on, ms being how
// long it stood (to move a deadline or a start on by). A duo match's shared clock doesn't stop; the games see to that.
// (a game's own sheet that should stop it too, River's course say, carries the class pauses)
export const PAUSERS = "#menuDlg[open], #helpDlg[open], #rulesDlg[open], dialog.apps[open], dialog.apps-pop[open], dialog.pauses[open]";
let pausedAt = null;
export const isPaused = () => pausedAt !== null;
export function onPause(pause, resume) {
  addEventListener("suite:pause", () => pause());
  addEventListener("suite:resume", e => resume(e.detail.ms));
}
function settlePause() {
  const on = !!document.querySelector(PAUSERS);
  if (on === isPaused()) return;
  if (on) { pausedAt = performance.now(); dispatchEvent(new CustomEvent("suite:pause")); }
  else { const ms = performance.now() - pausedAt; pausedAt = null; dispatchEvent(new CustomEvent("suite:resume", { detail: { ms } })); }
}
new MutationObserver(settlePause).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });

/** Gives the page's menu its shape: the × at the top right, a tap outside closes, and the contents laid out on each open. */
function upgrade() {
  const dlg = document.getElementById("menuDlg");
  if (!dlg || dlg.dataset.shaped) return;
  dlg.dataset.shaped = "1";
  dlg.classList.add("menu-sheet");
  const close = document.getElementById("menuClose") || dlg.querySelector(".pick-head .btn");
  if (close) {                                                   // the game's own Close button, as an ×: its listener stays
    close.className = "icon-btn menu-x";
    close.setAttribute("aria-label", "Close");
    close.innerHTML = CLOSE;
  }
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });   // the backdrop: outside the sheet
  const btn = document.getElementById("menuBtn");
  const look = document.documentElement.dataset.theme;           // Modern keeps its plain "Menu" button
  if (btn && look !== "modern") {                                                     // the rete stands still, and turns while the menu is open
    btn.classList.add("rete-btn");
    btn.setAttribute("aria-label", "Menu");
    btn.innerHTML = look === "kontor" || look === "office" ? KONTOR_MENU : RETE;   // Office: the same three rules, rounded in themes.css
    new MutationObserver(() => btn.classList.toggle("turning", dlg.open)).observe(dlg, { attributes: true, attributeFilter: ["open"] });
  }
  const body = document.getElementById("menuBody") || dlg;
  new MutationObserver(() => queueMicrotask(() => shape(body))).observe(body, { childList: true });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", upgrade); else upgrade();
