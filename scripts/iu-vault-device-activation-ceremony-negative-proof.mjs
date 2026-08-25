#!/usr/bin/env node
/**
 * Negative proof: duplicate/extra WebAuthn get during activation must FAIL ceremony guard;
 * clean run must PASS.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guard = path.join(REPO, "scripts", "iu-vault-device-activation-ceremony-guard-v1.mjs");

function run(envExtra) {
  return spawnSync(process.execPath, [guard], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...envExtra },
  });
}

const neg = run({ IU_NEG_FORCE_VERIFY_GET: "1" });
const negOut = `${neg.stdout || ""}\n${neg.stderr || ""}`;
if (neg.status === 0 || !/FAIL/.test(negOut)) {
  console.log("FAIL");
  console.log("negative_expected_fail_but_passed");
  console.log(negOut.slice(0, 1200));
  process.exit(1);
}
if (!/too_many_|negative_force_verify/.test(negOut)) {
  console.log("FAIL");
  console.log("negative_missing_ceremony_fail_reason");
  console.log(negOut.slice(0, 1200));
  process.exit(1);
}

const pos = run({ IU_NEG_FORCE_VERIFY_GET: "0" });
const posOut = `${pos.stdout || ""}\n${pos.stderr || ""}`;
if (pos.status !== 0 || !/PASS/.test(posOut)) {
  console.log("FAIL");
  console.log("positive_expected_pass");
  console.log(posOut.slice(0, 1200));
  process.exit(1);
}

console.log("PASS");
