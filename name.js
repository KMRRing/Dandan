// The name the player goes by, asked when they sit down at the table and kept on this device (dandan:name). It is what the
// seat is called in the log, and what a result is kept under in the database (results.js).
const KEY = "dandan:name";
const MAX = 24;

/** The name this device goes by, or "". */
export function savedName() {
  try { return (localStorage.getItem(KEY) || "").trim().slice(0, MAX); } catch { return ""; }
}
/**
 * Asks the name (the saved one to begin with); resolves with it, kept for next time. Required unless `closable`, which
 * adds a Close and resolves null when it is used.
 */
export function askName({ title = "Your name", note = "", button = "Sit down", closable = false } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = "sheet dd-name";
  dlg.setAttribute("aria-label", title);
  dlg.innerHTML = `<form method="dialog"><div class="pick-head"><h2></h2>${closable ? '<button class="btn" type="button" data-close>Close</button>' : ""}</div>
    <p class="dd-sub"></p><label for="ddName">Your name</label>
    <input id="ddName" maxlength="${MAX}" autocomplete="nickname" autocapitalize="words" required>
    <button class="btn primary wide" type="submit"></button></form>`;
  dlg.querySelector("h2").textContent = title;
  dlg.querySelector(".dd-sub").textContent = note;
  dlg.querySelector(".dd-sub").hidden = !note;
  dlg.querySelector("[type=submit]").textContent = button;
  const input = dlg.querySelector("input");
  input.value = savedName();
  document.body.appendChild(dlg);
  return new Promise(resolve => {
    let name = null;
    dlg.querySelector("[data-close]")?.addEventListener("click", () => dlg.close());
    if (!closable) dlg.addEventListener("cancel", e => e.preventDefault());   // Escape doesn't skip it: the name is asked
    dlg.querySelector("form").addEventListener("submit", () => { name = input.value.trim().slice(0, MAX) || null; });
    dlg.addEventListener("close", () => {
      dlg.remove();
      if (name) try { localStorage.setItem(KEY, name); } catch { /* private mode */ }
      resolve(name || (closable ? null : savedName() || "You"));
    }, { once: true });
    dlg.showModal();
    input.focus();
    input.select();
  });
}
