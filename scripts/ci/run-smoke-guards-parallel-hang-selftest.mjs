#!/usr/bin/env node
/**
 * Regression: a child that ignores SIGTERM / spawns a grandchild must not stall
 * the parallel pool forever. Expect timeout settle within ~default+force window.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const runnerUrl = pathToFileURL(path.join(HERE, "run-smoke-guards-parallel-v1.mjs")).href;
const { runCmd } = await import(runnerUrl);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-smoke-hang-"));
const sticky = path.join(tmp, "sticky-child.mjs");
// Child ignores SIGTERM and keeps event-loop alive — simulates hung npm/chrome under shell.
fs.writeFileSync(
  sticky,
  `
process.on('SIGTERM', () => { /* ignore — reproduces hung shell child */ });
process.on('SIGINT', () => { /* ignore */ });
setInterval(() => {}, 1000);
console.log('STICKY_CHILD_STARTED');
`,
  "utf8"
);

const started = Date.now();
process.env.IU_SMOKE_GUARD_DEFAULT_TIMEOUT_MIN = "0.05"; // ~3s floor is enforced in runner (≥3)
// Runner clamps min to 3 minutes — too long for unit selftest. Call with explicit timeoutMinutes.
const result = await runCmd("sticky-hang-fixture", `node "${sticky}"`, {}, 0.05, 1);
const elapsedMs = Date.now() - started;

const failures = [];
if (result.ok) failures.push("expected_not_ok");
if (result.code !== "timeout" && result.code !== "timeout_force") {
  failures.push("expected_timeout_code:" + result.code);
}
// Must settle well under the old 20-minute default (allow force window ~20s after 0.05min≈3s clamp).
// With clamp DEFAULT min=3, explicit timeoutMinutes=0.05 still uses 0.05*60*1000 from runCmd:
// maxMs = (timeoutMinutes || DEFAULT) * 60 * 1000 → 0.05 is truthy → 3 seconds + 20s force = ~23s.
if (elapsedMs > 45_000) failures.push("settled_too_slow_ms:" + elapsedMs);
if (elapsedMs < 500) failures.push("settled_too_fast_suspicious:" + elapsedMs);

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_SMOKE_PARALLEL_HANG_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    result,
    elapsedMs,
  })
);
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}
process.exit(ok ? 0 : 1);
