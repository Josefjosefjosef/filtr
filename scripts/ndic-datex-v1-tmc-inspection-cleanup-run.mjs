#!/usr/bin/env node
/**
 * Fenced wipe of inspection task dirs under RUNNER_TEMP only.
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
for (const name of ALLOWED_TASK_DIR_NAMES) {
  const target = path.join(runnerTemp, name);
  try {
    wipeInspectionTaskDir(target, { runnerTemp });
  } catch (e) {
    const code = e && e.code ? String(e.code) : CLEANUP_REJECT.FENCE;
    // Missing dir is ok; fence/foreign must fail closed.
    if (code !== CLEANUP_REJECT.EMPTY) {
      console.error(code);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
