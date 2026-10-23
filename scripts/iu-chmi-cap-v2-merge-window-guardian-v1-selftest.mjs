#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GUARDIAN_WORKFLOW_BASENAME,
  TARGET_WORKFLOW_FILES,
  clampWaitMinutes,
  restoreTargetWorkflows,
  validateGuardianWorkflowStatic,
} from "./iu-chmi-cap-v2-merge-window-guardian-v1.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

expect("wait_min_ok", clampWaitMinutes(10) === 10);
expect("wait_min_low", clampWaitMinutes(0) === null);
expect("wait_min_high", clampWaitMinutes(16) === null);
expect("wait_min_nan", clampWaitMinutes("x") === null);

const wfSrc = fs.readFileSync(
  path.join(REPO_ROOT, ".github", "workflows", GUARDIAN_WORKFLOW_BASENAME),
  "utf8"
);
expect("static_guard_ok", validateGuardianWorkflowStatic(wfSrc).length === 0);
expect("guardian_not_in_targets", !TARGET_WORKFLOW_FILES.includes(GUARDIAN_WORKFLOW_BASENAME));

{
  const r = await restoreTargetWorkflows({
    targets: [...TARGET_WORKFLOW_FILES],
    maxAttempts: 3,
    retryDelayMs: 0,
    enableWorkflow: async () => ({ ok: true, status: 204 }),
    fetchState: async () => ({ ok: true, status: 200, state: "active" }),
  });
  expect("restore_success", r.status === "SAFE" && r.reason === "ALL_TARGETS_ACTIVE");
}

{
  const failOnce = new Set(["update-chmi-cap-v2.yml"]);
  const r = await restoreTargetWorkflows({
    targets: [...TARGET_WORKFLOW_FILES],
    maxAttempts: 3,
    retryDelayMs: 0,
    enableWorkflow: async (file) => {
      if (failOnce.has(file)) {
        failOnce.delete(file);
        return { ok: false, status: 503 };
      }
      return { ok: true, status: 204 };
    },
    fetchState: async () => ({ ok: true, status: 200, state: "active" }),
  });
  expect("api_error_then_success", r.status === "SAFE");
}

{
  const r = await restoreTargetWorkflows({
    targets: ["update-chmi-cap-v2.yml"],
    maxAttempts: 2,
    retryDelayMs: 0,
    enableWorkflow: async () => ({ ok: false, status: 403 }),
    fetchState: async () => ({ ok: true, status: 200, state: "active" }),
  });
  expect("api_error_exhausted", r.status === "BLOCKED" && r.reason === "INCOMPLETE_RESTORE");
}

{
  const r = await restoreTargetWorkflows({
    targets: ["update-chmi-cap-v2.yml"],
    maxAttempts: 2,
    retryDelayMs: 0,
    enableWorkflow: async () => ({ ok: true, status: 204 }),
    fetchState: async () => ({ ok: true, status: 200, state: "disabled" }),
  });
  expect("partial_verify_inactive", r.status === "BLOCKED");
}

if (failures.length) {
  console.error(JSON.stringify({ IU_CHMI_CAP_V2_MERGE_WINDOW_GUARDIAN_V1_SELFTEST: "FAIL", failures }));
  process.exit(1);
}
console.log(JSON.stringify({ IU_CHMI_CAP_V2_MERGE_WINDOW_GUARDIAN_V1_SELFTEST: "OK", failures: [], CJ_LIVE_HTTP_CALLS: 0 }));
