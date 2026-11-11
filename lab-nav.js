// The settings button of the owner's two pages (games.html, the game history, and lab.html, the game lab): a gear at the top right
// that opens a small menu to go to the other. Both pages open only with the key in the address (?k=…, games-key.js), so the
// link to the other page carries the same key; each page checks it again on its own, so a wrong key goes to the game.
// mountSettings(current) is called once the key is known good ("history" or "lab").
const GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-1.9-3.3-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14.1 2.6h-3.8l-.4 2.5A7.6 7.6 0 0 0 7.3 6.6l-2.3-.9-1.9 3.3L5 10.5a7.6 7.6 0 0 0 0 3L3.1 15l1.9 3.3 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h3.8l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 1.9-3.3Z"/></svg>`;
const PAGES = [["history", "Game history", "games.html"], ["lab", "Game lab", "lab.html"]];

export function mountSettings(current, key = new URLSearchParams(location.search).get("k")) {
  if (document.getElementById("navGear")) return document.getElementById("navGear");
  const box = document.createElement("div");
  box.className = "nav-set";
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "navGear"; btn.className = "pick nav-gear";
  btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-label", "Settings: switch page"); btn.title = "Settings";
  btn.innerHTML = GEAR;
  const menu = document.createElement("div");
  menu.className = "nav-menu"; menu.setAttribute("role", "menu"); menu.hidden = true;
  for (const [id, label, file] of PAGES) {
    const a = document.createElement("a");
    a.setAttribute("role", "menuitem");
    a.textContent = label;
    a.href = `${file}?k=${encodeURIComponent(key || "")}`;
    if (id === current) { a.setAttribute("aria-current", "page"); a.addEventListener("click", e => { e.preventDefault(); close(); }); }
    menu.append(a);
  }
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
  document.addEventListener("click", e => { if (!box.contains(e.target)) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  box.append(btn, menu);
  (document.querySelector("#app > .top .top-right") || document.body).append(box);   // in the lab it joins the game's own buttons; on the history it floats at the corner
  if (!box.parentElement.classList.contains("top-right")) box.classList.add("nav-float");
  return btn;
}
