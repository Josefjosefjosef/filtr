#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const guard = path.join(here, "iu-chmi-cap-watchdog-fallback-no-loop-guard-v1.mjs");

function runGuard(repoRoot) {
  return spawnSync(process.execPath, [guard], { cwd: repoRoot, encoding: "utf8" });
}

const good = runGuard(path.resolve(here, ".."));
assert.equal(good.status, 0, good.stderr || good.stdout);
assert.match(good.stdout, /PASS/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-chmi-fallback-loop-"));
const wfDir = path.join(tmp, ".github", "workflows");
fs.mkdirSync(wfDir, { recursive: true });
const goodWf = fs.readFileSync(
  path.join(here, "..", ".github/workflows/chmi-cap-watchdog-cron-fallback.yml"),
  "utf8",
);
const badWf =
  goodWf.replace(
    "on:",
    'on:\n  workflow_run:\n    workflows: ["Update CHMI CAP v2"]\n    types: [completed]',
  );
fs.writeFileSync(path.join(wfDir, "chmi-cap-watchdog-cron-fallback.yml"), badWf, "utf8");
const bad = runGuard(tmp);
assert.notEqual(bad.status, 0);
assert.match(bad.stdout + bad.stderr, /FAIL/);

console.log("IU_CHMI_CAP_WATCHDOG_FALLBACK_NO_LOOP_GUARD_V1_SELFTEST=OK");
