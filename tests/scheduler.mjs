// The scheduler's choice (lab/scheduler.mjs): only token holders with fresh beats; the most cores, then up longest, then by name.
import { chosenScheduler, FRESH_MS } from "../lab/scheduler.mjs";
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const now = 1e12, b = (by, cpus, boot, o = {}) => ({ by, hw: { cpus }, boot, t: now - 60000, sched: 1, ...o });
check(chosenScheduler([b("a", 4, 1), b("b", 16, 5), b("c", 16, 3)], now) === "c", "the most cores, then the machine up longest");
check(chosenScheduler([b("a", 4, 1), b("b", 16, 5, { sched: 0 })], now) === "a", "only a worker that holds the token");
check(chosenScheduler([b("a", 4, 1), b("b", 16, 5, { t: now - FRESH_MS - 1 })], now) === "a", "a stale beat is passed over (the next takes over)");
check(chosenScheduler([b("y", 8, 2), b("x", 8, 2)], now) === "x", "a tie goes by name");
check(chosenScheduler([], now) === null, "no one: GitHub's schedule is the backup");
process.exit(fails ? 1 : 0);
