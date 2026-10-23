#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const guard = path.join(here, "iu-chmi-cap-watchdog-fallback-no-loop-guard-v1.mjs");

const MIN_GOOD = `
on:
  workflow_dispatch:
    inputs:
      force_probe_dispatch:
        type: boolean
  schedule:
    - cron: "3,18,33,48 * * * *"
steps:
  - name: Force probe dispatch (manual ops)
    run: |
      \${WATCHDOG_PROBE_URL}?dispatch=1
  - name: Stale-gated CHMI recovery (schedule + default manual)
    run: |
      chmi_cap_watchdog_observe.json
      WATCHDOG_STALE_RECOVERY_DISPATCH=gh
`;

const MIN_BAD = MIN_GOOD.replace(
  "on:",
  'on:\n  workflow_run:\n    workflows: ["Update CHMI CAP v2"]',
);

function runGuard(repoRoot) {
  return spawnSync(process.execPath, [guard], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, IU_CHMI_GUARD_REPO_ROOT: repoRoot },
  });
}

function writeFixture(dir, content) {
  const wfDir = path.join(dir, ".github", "workflows");
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, "chmi-cap-watchdog-cron-fallback.yml"), content, "utf8");
}

const goodRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-chmi-fallback-good-"));
writeFixture(goodRoot, MIN_GOOD);
const good = runGuard(goodRoot);
assert.equal(good.status, 0, good.stderr || good.stdout);

const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-chmi-fallback-bad-"));
writeFixture(badRoot, MIN_BAD);
const bad = runGuard(badRoot);
assert.notEqual(bad.status, 0);
assert.match(bad.stdout + bad.stderr, /FAIL/);

console.log("IU_CHMI_CAP_WATCHDOG_FALLBACK_NO_LOOP_GUARD_V1_SELFTEST=OK");
