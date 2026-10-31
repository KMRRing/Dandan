// Loads the Firebase connection once, on first need (a finished game's result is written to the database: results.js).
// While the connection is being made it says how far it has got (loading.js: progress).
import { progress } from "./loading.js";

let promise = null;
let stage = null;            // where the connection has got to while it's being made ({ text, at }); null once made
/** The connection's stage (sync.js says each as it gets there); nothing once it's made. */
export function connecting(text, at) {
  stage = text ? { text, at } : null;
  if (stage) progress(text, at);
}
export function getSync() {
  if (window.__cratesSync) return Promise.resolve(window.__cratesSync);   // test harness
  if (!promise) {
    connecting("Connecting to the game server", 0.15);
    promise = import("./sync.js").then(m => m.connect())
      .then(sync => { connecting(null); return sync; }, e => { promise = null; connecting(null); throw e; });
  } else if (stage) progress(stage.text, stage.at);
  return promise;
}
