#!/usr/bin/env node
/**
 * Fenced wipe of inspection task dirs under RUNNER_TEMP only.
 * Emits a safe attestation JSON (no absolute paths, no secrets).
 * Usage: node scripts/ndic-datex-v1-tmc-inspection-cleanup-run.mjs
 */
import path from "node:path";
import fs from "node:fs";
import {
  wipeInspectionTaskDir,
  ALLOWED_TASK_DIR_NAMES,
  CLEANUP_REJECT,
  CLEANUP_ATTESTATION,
  attestInspectionCleanup,
} from "./ndic-datex-v1/tmc-inspection-cleanup.mjs";

const runnerTemp = process.env.RUNNER_TEMP || "";
if (!runnerTemp) {
  console.error(CLEANUP_REJECT.FENCE);
  process.exit(1);
}

const reportHandedOff = process.env.NDIC_INSPECTION_REPORT_HANDED_OFF === "1";

let failed = false;
const dirs = [];
for (const name of ALLOWED_TASK_DIR_NAMES) {
  const target = path.join(runnerTemp, name);
  // Capture ZIP/staging presence under work roots before wipe.
  let zipExisted = false;
  let stagingExisted = false;
  if (name === "ndic-inspect-work" || name === "ndic-inspect-work-offline") {
    zipExisted = fs.existsSync(path.join(target, "task.zip"));
    stagingExisted = fs.existsSync(path.join(target, "staging"));
  }
  try {
    const result = wipeInspectionTaskDir(target, { runnerTemp });
    const zipGone = !fs.existsSync(path.join(target, "task.zip"));
    const stagingGone = !fs.existsSync(path.join(target, "staging"));
    dirs.push({
      taskDirName: name,
      wiped: result.wiped === true,
      absentAfter: result.absentAfter === true,
      attestedAbsent: result.attestedAbsent === true,
      taskZipRemoved: zipExisted ? zipGone : true,
      stagingRemoved: stagingExisted ? stagingGone : true,
      pathCategory: "task_temp",
    });
    if (result.attestedAbsent !== true) failed = true;
    if (zipExisted && !zipGone) failed = true;
    if (stagingExisted && !stagingGone) failed = true;
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
        taskZipRemoved: false,
        stagingRemoved: false,
        pathCategory: "task_temp",
        rejectCode: code,
      });
    }
  }
}

const workAttest = attestInspectionCleanup({
  runnerTemp,
  reportHandedOffBeforeCleanup: reportHandedOff,
  skipWipe: true,
});

const attestation = {
  cleanupScriptExecuted: true,
  cleanupAttested: failed === false && workAttest.cleanupAttestation === CLEANUP_ATTESTATION.PASSED,
  cleanupAttestation:
    failed || workAttest.cleanupAttestation !== CLEANUP_ATTESTATION.PASSED
      ? CLEANUP_ATTESTATION.FAILED
      : CLEANUP_ATTESTATION.PASSED,
  taskWorkdirRemoved: workAttest.taskWorkdirRemoved,
  taskZipRemoved: workAttest.taskZipRemoved,
  stagingRemoved: workAttest.stagingRemoved,
  reportHandedOffBeforeCleanup: reportHandedOff,
  foreignPathTouched: false,
  taskOwnedOnly: true,
  runnerTempCategory: "runner_temp",
  dirs,
};
console.log(JSON.stringify(attestation));
process.exit(attestation.cleanupAttestation === CLEANUP_ATTESTATION.PASSED ? 0 : 1);
