#!/usr/bin/env node
/**
 * Negative proof wrapper for mobile lifecycle guard.
 * Forces empty-before-hydrate clobber path → must FAIL, then PASS without env.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(REPO, "scripts", "iu-vault-mobile-lifecycle-preservation-guard-v1.mjs");

function run(envExtra) {
  return spawnSync(process.execPath, [script], {
    cwd: REPO,
    env: { ...process.env, ...envExtra },
    encoding: "utf8",
  });
}

const neg = run({ IU_NEG_EMPTY_BEFORE_HYDRATE: "1" });
const negOut = `${neg.stdout || ""}\n${neg.stderr || ""}`;
if (neg.status === 0 || !/IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_GUARD_FAIL/.test(negOut)) {
  console.error("NEGATIVE_EXPECTED_FAIL_BUT_PASSED");
  console.error(negOut);
  process.exit(1);
}
console.log("IU_MOBILE_LIFECYCLE_NEGATIVE_EMPTY_WRITE_FAIL_OK");

const neg2 = run({ IU_NEG_SKIP_PAGESHOW_HYDRATE: "1" });
const neg2Out = `${neg2.stdout || ""}\n${neg2.stderr || ""}`;
if (neg2.status === 0 || !/IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_GUARD_FAIL/.test(neg2Out)) {
  console.error("NEGATIVE_SKIP_HYDRATE_EXPECTED_FAIL_BUT_PASSED");
  console.error(neg2Out);
  process.exit(1);
}
console.log("IU_MOBILE_LIFECYCLE_NEGATIVE_SKIP_HYDRATE_FAIL_OK");

const pos = run({});
const posOut = `${pos.stdout || ""}\n${pos.stderr || ""}`;
if (pos.status !== 0 || !/IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_GUARD_PASS/.test(posOut)) {
  console.error("POSITIVE_EXPECTED_PASS_BUT_FAILED");
  console.error(posOut);
  process.exit(1);
}
console.log("IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_NEGATIVE_PROOF_PASS");
