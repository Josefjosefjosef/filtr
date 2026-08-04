#!/usr/bin/env node
/**
 * Fenced wipe of inspection task dirs under RUNNER_TEMP only.
 * Emits a safe attestation JSON (no absolute paths, no secrets).
 * Usage: node scripts/ndic-datex-v1-tmc-inspection-cleanup-run.mjs
 */
import path from "node:path";
import {
  wipeInspectionTaskDir,
  ALLOWED_TASK_DIR_NAMES,
  CLEANUP_REJECT,
} from "./ndic-datex-v1/tmc-inspection-cleanup.mjs";

const runnerTemp = process.env.RUNNER_TEMP || "";
if (!runnerTemp) {
  console.error(CLEANUP_REJECT.FENCE);
  process.exit(1);
}

let failed = false;
const dirs = [];
for (const name of ALLOWED_TASK_DIR_NAMES) {
  const target = path.join(runnerTemp, name);
  try {
    const result = wipeInspectionTaskDir(target, { runnerTemp });
    dirs.push({
      taskDirName: name,
      wiped: result.wiped === true,
      absentAfter: result.absentAfter === true,
      attestedAbsent: result.attestedAbsent === true,
      pathCategory: "task_temp",
    });
    if (result.attestedAbsent !== true) failed = true;
  } catch (e) {
    const code = e && e.code ? String(e.code) : CLEANUP_REJECT.FENCE;
    if (code !== CLEANUP_REJECT.EMPTY) {
      console.error(code);
      failed = true;
      dirs.push({
        taskDirName: name,
        wiped: false,
        absentAfter: false,
        attestedAbsent: false,
        pathCategory: "task_temp",
        rejectCode: code,
      });
    }
  }
}

const attestation = {
  cleanupAttested: failed === false,
  taskOwnedOnly: true,
  runnerTempCategory: "runner_temp",
  dirs,
};
console.log(JSON.stringify(attestation));
process.exit(failed ? 1 : 0);
