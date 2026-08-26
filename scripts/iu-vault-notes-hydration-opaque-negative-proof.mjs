#!/usr/bin/env node
/**
 * Negative proof for notes hydration opaque guard.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(REPO, "scripts", "iu-vault-notes-hydration-opaque-guard-v1.mjs");

function run(envExtra) {
  return spawnSync(process.execPath, [script], {
    cwd: REPO,
    env: { ...process.env, ...envExtra },
    encoding: "utf8",
  });
}

const neg = run({ IU_NEG_BYPASS_NOTES_OPAQUE: "1" });
const negOut = `${neg.stdout || ""}\n${neg.stderr || ""}`;
if (neg.status === 0 || !/IU_VAULT_NOTES_HYDRATION_OPAQUE_GUARD_FAIL/.test(negOut)) {
  console.error("NEGATIVE_BYPASS_OPAQUE_EXPECTED_FAIL_BUT_PASSED");
  console.error(negOut);
  process.exit(1);
}
console.log("IU_NOTES_HYDRATION_OPAQUE_NEGATIVE_BYPASS_FAIL_OK");

const pos = run({});
const posOut = `${pos.stdout || ""}\n${pos.stderr || ""}`;
if (pos.status !== 0 || !/IU_VAULT_NOTES_HYDRATION_OPAQUE_GUARD_PASS/.test(posOut)) {
  console.error("POSITIVE_GUARD_EXPECTED_PASS_BUT_FAILED");
  console.error(posOut);
  process.exit(1);
}
console.log("IU_NOTES_HYDRATION_OPAQUE_POSITIVE_PASS_OK");
