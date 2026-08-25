#!/usr/bin/env node
/**
 * Negative proof: force empty overwrite after unlock while hydration pending is ignored
 * (IU_NEG_FORCE_EMPTY_WRITE=1) → preservation guard must FAIL.
 * Without env → PASS.
 */
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(REPO, "scripts", "iu-vault-post-unlock-preservation-guard-v1.mjs");

const broken = spawnSync(process.execPath, [GUARD], {
  cwd: REPO,
  encoding: "utf8",
  timeout: 120000,
  env: { ...process.env, IU_NEG_FORCE_EMPTY_WRITE: "1" },
});

if (broken.status === 0) {
  console.error("NEGATIVE_PROOF_FAIL:empty_overwrite_still_passed");
  console.error(broken.stdout);
  process.exit(1);
}

const fixed = spawnSync(process.execPath, [GUARD], {
  cwd: REPO,
  encoding: "utf8",
  timeout: 120000,
  env: { ...process.env, IU_NEG_FORCE_EMPTY_WRITE: "0" },
});

if (fixed.status !== 0) {
  console.error("NEGATIVE_PROOF_FAIL:normal_run_failed");
  console.error(fixed.stdout);
  process.exit(1);
}

console.log("NEGATIVE_PROOF_PASS");
process.exit(0);
