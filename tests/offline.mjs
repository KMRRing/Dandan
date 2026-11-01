// The app opens with no connection, from the home screen too. The service worker (sw.js, written by tools/build-sw.mjs from
// tools/service-worker.js) keeps every file on the device (tools/offline.mjs). Checked here: nothing a page, a script or a
// stylesheet names is left out of what is kept; the manifest's icons are there; a load whose path is built as the code runs is
// one accounted for; and the service worker itself, run against a stand-in for the browser's caches and the network: a first
// install fills one copy and takes the page, a request is answered from it with the network gone, an update waits to be told
// to take over and then deletes the older copy, a failed download leaves the older version in charge, and an interrupted
// one is finished from where it stopped.
import fs from "fs";
import path from "path";
import vm from "vm";
import { ROOT, offlineFiles, NEVER } from "../tools/offline.mjs";
import { serviceWorker, hashOf, render, LOGIC } from "../tools/build-sw.mjs";

let bad = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) bad++; };

// ---------- what is kept, and that nothing a file names is left out ----------
const kept = offlineFiles(), keptSet = new Set(kept);
check(["index.html", "manifest.webmanifest", "pwa.js", "dandan.js", "dandan-worker.js", "style.css", "icon.svg", "fonts/archivo-latin.woff2"].every(f => keptSet.has(f)),
  `the page, its scripts, the computer's worker, the styles and the font are kept (${kept.length} files)`);
check(kept.every(f => !NEVER(f)) && !keptSet.has("sw.js") && !kept.some(f => /^(?:tests|tools|lab)\//.test(f)), "the tests, the tools, the lab and the service worker itself are not");

/** Where a name in `file` points, taken from the file's own folder (an import, a url(), a tag) and, for a script's string, also from the page's (the top). */
const resolve = (file, ref) => {
  const u = ref.split(/[?#]/)[0];
  return [path.posix.normalize(path.posix.join(path.posix.dirname(file), u)), path.posix.normalize(u)];
};
const away = u => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
const refs = (file, src) => {
  const out = [];
  if (file.endsWith(".html")) for (const m of src.matchAll(/\s(?:src|href)\s*=\s*"([^"]+)"/g)) out.push([m[1], false]);
  else if (file.endsWith(".css")) for (const m of src.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) out.push([m[1], false]);
  else if (file.endsWith(".webmanifest")) { const m = JSON.parse(src); for (const i of m.icons || []) out.push([i.src, false]); out.push([m.start_url, false]); }
  else if (file.endsWith(".js")) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    for (const m of code.matchAll(/(?:from|import\s*\(?|new URL\()\s*["'](\.{1,2}\/[^"']+)["']/g)) out.push([m[1], false]);
    for (const m of code.matchAll(/["'`]((?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:js|css|png|svg|woff2|webmanifest|html))["'`]/g)) out.push([m[1], true]);
  }
  return out.filter(([u]) => u && !away(u) && u !== "./");
};
const missing = [];
for (const f of kept.filter(f => /\.(?:html|css|js|webmanifest)$/.test(f))) {
  for (const [ref, loose] of refs(f, fs.readFileSync(ROOT + f, "utf8"))) {
    if (/^(?:\.\/)?sw\.js$/.test(ref)) continue;                       // the browser fetches the worker itself
    const [own, top] = resolve(f, ref);
    // an import or a url() is taken from the file's folder; a string in a script only counts where it names a file at all
    if (!keptSet.has(own) && !(loose && keptSet.has(top))) { if (!loose || fs.existsSync(ROOT + own) || fs.existsSync(ROOT + top)) missing.push(`${f} → ${ref}`); }
  }
}
check(missing.length === 0, `every import, stylesheet url(), tag and icon names a file that is kept${missing.length ? ": " + missing.join(", ") : ""}`);

// a load whose path is made as the code runs can't be followed by reading: each is accounted for here, so a new one is looked at
const BUILT = { "sync.js": "the database's own address (another site, never kept)" };
const built = [];
for (const f of kept.filter(f => f.endsWith(".js"))) {
  const code = fs.readFileSync(ROOT + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  for (const m of code.matchAll(/\b(import|fetch|importScripts|new (?:Shared)?Worker)\s*\(\s*([^)\n]{0,60})/g)) {
    const arg = m[2];
    if (/^["'`][^"'`$]*["'`]/.test(arg) || /^new URL\(\s*["'][^"']+["']\s*,\s*import\.meta\.url/.test(arg)) continue;
    if (m[1] === "import" && arg === "") continue;
    built.push({ f, call: `${m[1]}(${arg}` });
  }
  for (const m of code.matchAll(/\.src\s*=(?!=)\s*([^;\n]{0,40})/g)) if (!/^["']/.test(m[1])) built.push({ f, call: `.src = ${m[1]}` });
}
check(built.every(b => BUILT[b.f]), `every load built as the code runs is accounted for${built.filter(b => !BUILT[b.f]).length ? ": " + built.filter(b => !BUILT[b.f]).map(b => `${b.f}: ${b.call}`).join("; ") : ""}`);

// the manifest
{
  const m = JSON.parse(fs.readFileSync(ROOT + "manifest.webmanifest", "utf8"));
  const px = f => { const d = fs.readFileSync(ROOT + f); return [d.readUInt32BE(16), d.readUInt32BE(20)]; };
  check(m.start_url === "./" && m.scope === "./" && m.display === "standalone", "the manifest opens the app's own page, on its own");
  check(m.icons.every(i => keptSet.has(i.src) && px(i.src).join("x") === i.sizes), "its icons are kept and are the size they say");
  check(m.icons.some(i => i.sizes === "192x192") && m.icons.some(i => i.sizes === "512x512") && m.icons.some(i => i.purpose === "maskable"), "with a 192, a 512 and a maskable one (what Android asks for to install)");
  check(/rel="manifest"/.test(fs.readFileSync(ROOT + "index.html", "utf8")) && /pwa\.js/.test(fs.readFileSync(ROOT + "dandan.js", "utf8")), "the page links the manifest, and the game loads pwa.js, which registers the worker");
}

// ---------- the list and the version ----------
{
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "off-")) + "/";
  fs.writeFileSync(dir + "index.html", "<p>a</p>"); fs.writeFileSync(dir + "a.js", "1");
  const one = serviceWorker(dir, ["index.html", "a.js"]), again = serviceWorker(dir, ["index.html", "a.js"]);
  fs.writeFileSync(dir + "a.js", "2");
  const changed = serviceWorker(dir, ["index.html", "a.js"]);
  check(one.version === again.version && one.text === again.text, "the same files give the same worker");
  check(changed.version !== one.version && changed.text.includes(hashOf("2")), "a changed file gives a new version (that is what makes devices fetch it)");
  check(/\nconst VERSION = "[0-9a-f]{12}";\nconst FILES = \{\n  "\.\/": "[0-9a-f]{12}",/.test(one.text), "sw.js begins with its version and the list of files with their hashes");
  fs.rmSync(dir, { recursive: true });
}

// ---------- the service worker, run against a stand-in for the browser ----------
const BASE = "https://site.test/Dandan/";
class Req { constructor(u, o = {}) { this.url = new URL(u, BASE).href; this.method = o.method || "GET"; this.mode = o.mode || "no-cors"; } }
class FakeCache {
  constructor() { this.m = new Map(); }
  async put(req, res) { this.m.set(req.url, res); }
  async keys() { return [...this.m.keys()].map(url => ({ url })); }
  async match(req, o = {}) {
    let url = typeof req === "string" ? new URL(req, BASE).href : req.url;
    if (o.ignoreSearch) { url = url.split("?")[0]; for (const [k, v] of this.m) if (k.split("?")[0] === url) return v.clone(); return undefined; }
    return this.m.get(url)?.clone();
  }
}
/** One device: its storage (kept across versions) and a site that serves files (a map of path to text), or is gone. */
function device() {
  const store = new Map(), dev = { store, site: new Map(), up: true, fetched: [], fails: new Set() };
  dev.caches = {
    open: async k => { if (!store.has(k)) store.set(k, new FakeCache()); return store.get(k); },
    keys: async () => [...store.keys()],
    delete: async k => store.delete(k),
  };
  dev.fetch = async (req, o = {}) => {
    const url = new URL(typeof req === "string" ? req : req.url, BASE);
    dev.fetched.push({ path: url.pathname.replace("/Dandan/", ""), query: url.search, noStore: o.cache === "no-store" });
    if (!dev.up) throw new TypeError("Failed to fetch");
    const p = url.pathname.replace("/Dandan/", "") || "index.html";
    if (dev.fails.has(p) || !dev.site.has(p)) return new Response("no", { status: dev.fails.has(p) ? 500 : 404 });
    return new Response(dev.site.get(p), { headers: { "Content-Type": p.endsWith(".js") ? "text/javascript" : "text/html" } });
  };
  /** A worker of this version running on the device. */
  dev.start = (version, files) => {
    const hashes = Object.fromEntries(Object.entries(files).map(([f, text]) => [f, hashOf(text)]));
    const listeners = {}, log = { skipped: false, claimed: false };
    const self = { location: new URL("sw.js", BASE), addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => { log.skipped = true; }, clients: { claim: async () => { log.claimed = true; } } };
    vm.runInNewContext(render(version, hashes, fs.readFileSync(LOGIC, "utf8")), { self, caches: dev.caches, fetch: dev.fetch, Request: Req, Response, URL, Promise, Object, Set, Array, Error, TypeError, String });
    const fire = async (type, init = {}) => { const waits = []; const event = { waitUntil: p => waits.push(p), ...init }; listeners[type](event); await Promise.all(waits); return event; };
    return {
      log, hashes,
      install: () => fire("install"), activate: () => fire("activate"),
      message: (data, ports) => fire("message", { data, ports }),
      /** What the worker answers a request with: its text, "network" if it left it to the browser, or the error. */
      async get(url, o = {}) {
        let answered;
        const event = { request: new Req(url, o), respondWith: p => { answered = p; } };
        listeners.fetch(event);
        if (!answered) return "browser";
        try { const res = await answered; return res instanceof Response ? await res.text() : res; } catch (e) { return `error: ${e.message}`; }
      },
    };
  };
  return dev;
}
const SITE1 = { "./": "<html>v1</html>", "index.html": "<html>v1</html>", "dandan.js": "game v1", "style.css": "css v1", "menu.js": "menu v1" };
const publish = (dev, files) => { dev.site = new Map(Object.entries(files).map(([f, t]) => [f === "./" ? "index.html" : f, t])); dev.site.set("", files["./"]); };
const cacheOf = (dev, v) => dev.store.get(`dandan-${v}`);

{
  const dev = device(); publish(dev, SITE1);
  const w1 = dev.start("v1", SITE1);
  await w1.install();
  check(cacheOf(dev, "v1")?.m.size === Object.keys(SITE1).length, "a first install keeps every file of its list");
  check(dev.fetched.length === Object.keys(SITE1).length && dev.fetched.every(f => f.query === `?v=${w1.hashes[f.path === "" ? "./" : f.path]}` && f.noStore), "each is asked for once, at an address carrying its hash, past every cache");
  check(!w1.log.skipped, "an install doesn't take over by itself");
  await w1.activate();
  check(w1.log.claimed, "the first install takes the page that began it (nothing older to be mixed up with)");

  dev.up = false;                                                           // the network is gone
  check(await w1.get("https://site.test/Dandan/dandan.js") === "game v1", "with no connection a script is answered from the copy");
  check(await w1.get("https://site.test/Dandan/style.css?x=1") === "css v1", "whatever ?query its address carries");
  check(await w1.get("https://site.test/Dandan/", { mode: "navigate" }) === "<html>v1</html>", "the app's own address opens its page");
  check(await w1.get("https://site.test/Dandan/elsewhere.html", { mode: "navigate" }) === "<html>v1</html>", "a page that isn't kept opens the app, not the browser's error");
  check((await w1.get("https://site.test/Dandan/elsewhere.js")).startsWith("error:"), "a file that isn't kept, offline, fails as it would");
  check(await w1.get("https://other.test/x.js") === "browser" && await w1.get("https://site.test/Dandan/dandan.js", { method: "POST" }) === "browser", "another site's requests and a POST are left to the browser");
  dev.up = true;

  // an update: one file changed
  const SITE2 = { ...SITE1, "./": "<html>v2</html>", "index.html": "<html>v2</html>", "menu.js": "menu v2" };
  publish(dev, SITE2);
  dev.fetched.length = 0;
  const w2 = dev.start("v2", SITE2);
  await w2.install();
  check(cacheOf(dev, "v1") && cacheOf(dev, "v2")?.m.size === Object.keys(SITE2).length, "an update fills a copy of its own and leaves the older one in charge");
  check(await w1.get("https://site.test/Dandan/menu.js") === "menu v1", "the older version goes on answering from its own copy");
  check(!w2.log.skipped, "the new version waits");
  await w2.message("take-over");
  check(w2.log.skipped, "until the page tells it to take over");
  await w2.activate();
  check(!cacheOf(dev, "v1") && cacheOf(dev, "v2") && !w2.log.claimed, "then the older copy is deleted, and a running page is not claimed (it reloads)");
  check(await w2.get("https://site.test/Dandan/menu.js") === "menu v2" && await w2.get("https://site.test/Dandan/", { mode: "navigate" }) === "<html>v2</html>", "and the new files answer");
  let version = null;
  await w2.message("version", [{ postMessage: d => { version = d.version; } }]);
  check(version === "v2", "a page can ask which version is in charge");
}
{
  // a download that fails, then an interrupted one finished from where it stopped
  const dev = device(); publish(dev, SITE1);
  const w1 = dev.start("v1", SITE1); await w1.install(); await w1.activate();
  const SITE2 = { ...SITE1, "dandan.js": "game v2", "menu.js": "menu v2" };
  publish(dev, SITE2); dev.fails.add("menu.js");
  const w2 = dev.start("v2", SITE2);
  let failed = null;
  try { await w2.install(); } catch (e) { failed = e.message; }
  check(failed && /menu\.js: HTTP 500/.test(failed), `a file the site refuses fails the install, saying which${failed ? ` (${failed})` : ""}`);
  check(cacheOf(dev, "v1") && await w1.get("https://site.test/Dandan/dandan.js") === "game v1", "and the version in charge stays");
  dev.fails.clear(); dev.fetched.length = 0;
  const again = dev.start("v2", SITE2);
  await again.install();
  const got = cacheOf(dev, "v2").m.size;
  check(got === Object.keys(SITE2).length && dev.fetched.length < Object.keys(SITE2).length, `the next attempt finishes from where the last stopped (${dev.fetched.length} of ${Object.keys(SITE2).length} files fetched again)`);
}

process.exit(bad ? 1 : (console.log("offline: every file kept, the worker answers with no connection, an update waits and replaces the older copy whole"), 0));
