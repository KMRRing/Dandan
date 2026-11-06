// The key games.html opens with (games.js): only its SHA-256 is here, so the page's source doesn't give the link away. Whoever has the
// link has the page; the games themselves are readable by anyone who looks (README, "Reading the games"), so this is a door, not a vault.
export const HASH = "35b05353c6838c886497c5e78ae3a8a52262c8a84d8f5c815ce8c5b9afad7084";
export const sha = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
export const keyOk = async k => !!k && (await sha(k)) === HASH;
