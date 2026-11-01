// Offline play and updates. Registers the service worker (sw.js, written by tools/build-sw.mjs from tools/service-worker.js),
// which keeps every file of the app on the device, and says how it stands (the menu's About part).
//
// An update downloads in the background and waits: taking over while the game runs would hand a running page the files of
// another version (the computer's search is a worker started on demand). So the new version takes over when the app goes off
// screen, or when Check for a new version finds one, and the page reloads onto it; the game is kept in localStorage, so a
// reload picks it up where it was. A first install needs none of this: nothing older is there to be mixed up with.
import { action, line } from "./menu.js";

const supported = "serviceWorker" in navigator;
let reg = null, checkedAt = 0;

/** The waiting version, told to take over (only when an older one is in charge: a first install is already). */
function takeOver() {
  if (reg?.waiting && navigator.serviceWorker.controller) reg.waiting.postMessage("take-over");
}
/** Resolves when a worker has finished installing (or failed to). */
const installed = worker => new Promise(done => {
  const look = () => { if (worker.state === "installed" || worker.state === "redundant" || worker.state === "activated") { worker.removeEventListener("statechange", look); done(worker.state); } };
  worker.addEventListener("statechange", look);
  look();
});

const ready = supported
  ? navigator.serviceWorker.register("./sw.js").then(r => {
    reg = r;
    r.addEventListener("updatefound", () => { const w = r.installing; if (w) installed(w).then(() => { if (document.hidden) takeOver(); }); });
    if (document.hidden) takeOver();
    return r;
  }, () => null)
  : Promise.resolve(null);
if (supported) {
  // a page whose files came from one version, handed to another, reloads (every page of the app, not only the one that asked); the
  // first install taking the page that began it (nothing in charge before) doesn't
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (controlled) location.reload(); controlled = true; });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) takeOver();
    else if (reg && Date.now() - checkedAt > 60_000) { checkedAt = Date.now(); reg.update().catch(() => {}); }   // an app left open is looked at when it's brought back
  });
}

/** The version the device is on, asked of the worker in charge; null if it doesn't answer. */
function versionOf(worker) {
  return new Promise(done => {
    if (!worker) return done(null);
    const ch = new MessageChannel(), timer = setTimeout(() => done(null), 1500);
    ch.port1.onmessage = e => { clearTimeout(timer); done(e.data?.version || null); };
    worker.postMessage("version", [ch.port2]);
  });
}

/** In words: whether the game is kept for offline play, and on which version. */
export async function offlineStatus() {
  if (!supported) return "Offline play needs a browser that keeps apps (and a secure address).";
  const r = await ready;
  if (!r) return "Offline play isn't set up: the browser wouldn't start the app's worker.";
  if (!r.active) return r.installing ? "Saving the game on this device for offline play…" : "Offline play isn't ready yet: open the app once more while online.";
  const v = await versionOf(r.active);
  return `Ready for offline play${v ? `: version ${v.slice(0, 6)}` : ""}.${r.waiting ? " A newer version is saved and starts the next time the app is closed." : ""}`;
}

/** Looks for a newer version and, if there is one, switches to it (the page reloads). Resolves with what to say. */
export async function check() {
  const r = await ready;
  if (!r) return "Offline play isn't available here.";
  checkedAt = Date.now();
  try { await r.update(); } catch { return "The site didn't answer: the version on this device stays."; }
  if (r.installing && await installed(r.installing) === "redundant") return "The new version couldn't be saved: the version on this device stays.";
  if (!r.waiting) return "Up to date.";
  takeOver();
  return "Updating…";
}

/** The menu's offline line and its button, in `box`; `say` shows a short message (the page's toast). */
export function offlineMenu(box, say) {
  const status = line("Checking offline play…");
  box.append(status, action("Check for a new version", async () => say(await check()), "link"));
  offlineStatus().then(text => { status.textContent = text; });
}
