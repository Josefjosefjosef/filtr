#!/usr/bin/env node
/**
 * Negative proof for lock UX actions guard.
 * IU_NEG_STUCK_PIN_PENDING=1 must FAIL; clean re-run must PASS.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guard = path.join(REPO, "scripts", "iu-vault-lock-ux-actions-guard-v1.mjs");

function run(envExtra) {
  return spawnSync(process.execPath, [guard], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...envExtra },
  });
}

const neg = run({ IU_NEG_STUCK_PIN_PENDING: "1" });
const negOut = `${neg.stdout || ""}\n${neg.stderr || ""}`;
if (neg.status === 0 || !/FAIL/.test(negOut)) {
  console.log("FAIL");
  console.log("negative_expected_fail_but_passed");
  console.log(negOut.slice(0, 800));
  process.exit(1);
}
if (!/wrong_pin_input_not_editable|wrong_pin_submit_stuck_disabled|wrong_pin_left_inflight/.test(negOut)) {
  console.log("FAIL");
  console.log("negative_missing_expected_fail_reason");
  console.log(negOut.slice(0, 800));
  process.exit(1);
}

const pos = run({ IU_NEG_STUCK_PIN_PENDING: "0" });
const posOut = `${pos.stdout || ""}\n${pos.stderr || ""}`;
if (pos.status !== 0 || !/PASS/.test(posOut)) {
  console.log("FAIL");
  console.log("positive_expected_pass");
  console.log(posOut.slice(0, 800));
  process.exit(1);
}

console.log("PASS");
