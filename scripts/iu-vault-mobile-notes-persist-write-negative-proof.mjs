#!/usr/bin/env node
/**
 * Negative proof for mobile notes persist write guard.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(REPO, "scripts", "iu-vault-mobile-notes-persist-write-guard-v1.mjs");

function run(envExtra) {
  return spawnSync(process.execPath, [script], {
    cwd: REPO,
    env: { ...process.env, ...envExtra },
    encoding: "utf8",
  });
}

const neg = run({ IU_NEG_SKIP_FLUSH: "1" });
const negOut = `${neg.stdout || ""}\n${neg.stderr || ""}`;
if (neg.status === 0 || !/IU_VAULT_MOBILE_NOTES_PERSIST_WRITE_GUARD_FAIL/.test(negOut)) {
  console.error("NEGATIVE_SKIP_FLUSH_EXPECTED_FAIL_BUT_PASSED");
  console.error(negOut);
  process.exit(1);
}
console.log("IU_MOBILE_NOTES_WRITE_NEGATIVE_SKIP_FLUSH_FAIL_OK");

const neg2 = run({ IU_NEG_BLOCK_SILVER_ENSURE: "1" });
const neg2Out = `${neg2.stdout || ""}\n${neg2.stderr || ""}`;
if (neg2.status === 0 || !/IU_VAULT_MOBILE_NOTES_PERSIST_WRITE_GUARD_FAIL/.test(neg2Out)) {
  console.error("NEGATIVE_BLOCK_ENSURE_EXPECTED_FAIL_BUT_PASSED");
  console.error(neg2Out);
  process.exit(1);
}
console.log("IU_MOBILE_NOTES_WRITE_NEGATIVE_BLOCK_ENSURE_FAIL_OK");

const pos = run({});
const posOut = `${pos.stdout || ""}\n${pos.stderr || ""}`;
if (pos.status !== 0 || !/IU_VAULT_MOBILE_NOTES_PERSIST_WRITE_GUARD_PASS/.test(posOut)) {
  console.error("POSITIVE_GUARD_EXPECTED_PASS_BUT_FAILED");
  console.error(posOut);
  process.exit(1);
}
console.log("IU_MOBILE_NOTES_WRITE_POSITIVE_PASS_OK");
