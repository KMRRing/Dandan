// The menu's Refresh button (1 November 2026, Korbi: "add a 'refresh' button into settings that'll download latest version on
// the bookmarked app"): pwa.js's side of an update, played against a stand-in for the browser's service worker.
// Run: node tests/refresh.mjs
let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };

// ---------- the stand-ins ----------
const classes = new Set();
const node = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, append() {}, appendChild() {}, querySelector: () => null, dataset: {}, style: { setProperty() {}, removeProperty() {} } });
const stub = { ...node(), hidden: false, createElement: () => node(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  documentElement: { ...node(), classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } }, body: node() };
globalThis.document = stub;
stub.readyState = "complete";
globalThis.MutationObserver = class { observe() {} };           // menu.js watches the page for its dialogs opening
globalThis.addEventListener = () => {};
let reloads = 0;
globalThis.location = { reload: () => { reloads++; } };
const real = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => real(fn, ms >= 4000 ? 5 : ms, ...a);     // the wait for the page to reload on its own

/** A worker: its state, and what it does with the messages the page sends. */
function worker(state, { version = "abcdef0123456789", onMessage } = {}) {
  const w = { state, sent: [], listeners: [], addEventListener(_, f) { w.listeners.push(f); }, removeEventListener(_, f) { w.listeners = w.listeners.filter(x => x !== f); },
    set(next) { w.state = next; for (const f of [...w.listeners]) f(); },
    postMessage(m, ports) { w.sent.push(m); if (m === "version") ports?.[0]?.postMessage({ version }); else onMessage?.(m, w); } };
  return w;
}
/** A registration whose update() does what `update` says, and a browser around it. */
async function device({ supported = true, update, active = worker("activated"), waiting = null }) {
  const reg = { active, waiting, installing: null, listeners: {}, addEventListener(t, f) { reg.listeners[t] = f; }, update: () => update(reg) };
  const sw = { controller: active, listeners: {}, register: async () => reg, addEventListener(t, f) { sw.listeners[t] = f; } };
  Object.defineProperty(globalThis, "navigator", { value: supported ? { serviceWorker: sw } : {}, configurable: true });
  reloads = 0; classes.clear();
  const pwa = await import(`../pwa.js?device=${++device.n}`);
  await new Promise(r => real(r, 5));
  return { reg, sw, pwa };
}
device.n = 0;
const slow = ms => new Promise(r => real(r, ms));

// ---------- the cases ----------
{
  const d = await device({ update: async () => {} });
  const say = await d.pwa.refresh();
  check(/latest version \(abcdef\)/.test(say) && reloads === 0, "nothing newer: it says so, with the version, and the page stays");
  check(!classes.has("busy"), "…and the rete is gone");
}
{
  const d = await device({ update: async reg => { throw new TypeError("Failed to fetch"); } });
  const say = await d.pwa.refresh();
  check(/didn't answer/.test(say) && reloads === 0 && !d.reg.active.sent.includes("take-over"), "no connection: it says so and leaves the version on the device");
}
{
  // a newer version found: it downloads (long enough for the rete to show), waits, and is told to take over
  const waiting = worker("installing", { onMessage: (m, w) => { if (m === "take-over") d.sw.listeners.controllerchange?.(); } });
  const d = await device({ update: async reg => { reg.installing = waiting; real(() => { reg.installing = null; reg.waiting = waiting; waiting.set("installed"); }, 300); } });
  const run = d.pwa.refresh();
  await slow(200);
  check(classes.has("busy"), "a download that takes a moment puts the rete up");
  const say = await run;
  check(waiting.sent.includes("take-over") && reloads >= 1 && say === "", "a newer version is downloaded, told to take over, and the page reloads onto it");
  check(!classes.has("busy"), "…and the rete is released");
}
{
  // already downloaded in the background and waiting: no new download, just the switch
  const waiting = worker("installed");
  const d = await device({ update: async () => {}, waiting });
  await d.pwa.refresh();
  check(waiting.sent.includes("take-over") && reloads >= 1, "a version already saved and waiting is switched to at once");
}
{
  const bust = worker("installing");
  const d = await device({ update: async reg => { reg.installing = bust; real(() => bust.set("redundant"), 20); } });
  const say = await d.pwa.refresh();
  check(/couldn't be saved/.test(say) && reloads === 0 && !bust.sent.includes("take-over"), "a download that fails leaves the version on the device and says so");
}
{
  const d = await device({ supported: false, update: async () => {} });
  const say = await d.pwa.refresh();
  check(say === "" && reloads === 1, "a browser without service workers just reloads the page");
}
{
  // the button: a plain one in the menu that shows what refresh says
  const d = await device({ update: async () => {} });
  const b = d.pwa.refreshAction(() => {});
  check(b !== undefined, "the menu gets a Refresh button");
}

globalThis.setTimeout = real;
console.log(bad ? `${bad} failed` : "all ok");
process.exit(bad ? 1 : 0);                                       // the message ports of the version asks keep Node waiting
