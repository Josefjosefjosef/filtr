#!/usr/bin/env node
/**
 * Offline selftest for CHMI substantive-change gate strip rules.
 */
import assert from "assert";
import { createRequire } from "module";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = path.join(REPO, "scripts", "iu-chmi-cap-v2-substantive-change-gate-v1.mjs");

function stripVolatileLocal(value) {
  const VOLATILE_KEYS = new Set([
    "generatedAt",
    "last_checked_at",
    "last_success_at",
    "lastRunAt",
    "runMs",
    "at",
  ]);
  const VOLATILE_OBJECTS = new Set(["runHistory", "lastRun"]);
  if (Array.isArray(value)) return value.map(stripVolatileLocal);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (VOLATILE_KEYS.has(k) || VOLATILE_OBJECTS.has(k)) continue;
    out[k] = stripVolatileLocal(v);
  }
  return out;
}

const a = {
  bodyHash: "abc",
  generatedAt: "2026-01-01T00:00:00Z",
  last_checked_at: "t1",
  items: [{ id: 1 }],
  runHistory: [{ at: "t1" }],
};
const b = {
  bodyHash: "abc",
  generatedAt: "2026-01-02T00:00:00Z",
  last_checked_at: "t2",
  items: [{ id: 1 }],
  runHistory: [{ at: "t2" }, { at: "t3" }],
};
assert.strictEqual(JSON.stringify(stripVolatileLocal(a)), JSON.stringify(stripVolatileLocal(b)));

const c = { ...b, bodyHash: "changed" };
assert.notStrictEqual(JSON.stringify(stripVolatileLocal(a)), JSON.stringify(stripVolatileLocal(c)));

const run = spawnSync(process.execPath, [gate], { cwd: REPO, encoding: "utf8" });
assert.strictEqual(run.status, 0, run.stderr || run.stdout);
assert.match(run.stdout, /SUBSTANTIVE=(true|false)/);

console.log(
  JSON.stringify({
    OK: true,
    schema: "iu-chmi-cap-v2-substantive-change-gate-v1-selftest",
    liveEnabled: false,
    publishArmed: false,
  })
);
