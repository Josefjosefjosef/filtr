/** Staging scheduler contract — cron disabled until explicit GO. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CJ_WORKFLOWS = [
  ".github/workflows/cj-affiliate-email-ingest.yml",
  ".github/workflows/cj-affiliate-offline-import-dispatch.yml",
];

export function scanWorkflowForCron(workflowText) {
  const hasSchedule = /^\s*schedule\s*:/m.test(workflowText);
  const hasDispatch = /workflow_dispatch\s*:/.test(workflowText);
  return { hasSchedule, hasDispatch };
}

export function auditCjIngestSchedulerContract() {
  const workflows = [];
  for (const rel of CJ_WORKFLOWS) {
    const full = path.join(repoRoot, rel);
    const text = fs.readFileSync(full, "utf8");
    const scan = scanWorkflowForCron(text);
    workflows.push({ path: rel, ...scan });
  }
  const cronArmed = workflows.some((w) => w.hasSchedule);
  return {
    ok: !cronArmed,
    cronArmed,
    workflows,
    recommended: "cloudflare_cron_or_gha_dispatch_manual_until_staging_burn_in",
    publishable: false,
  };
}

export function describeSingleFlightContract() {
  return {
    lockFileEnv: "IU_CJ_UNATTENDED_LOCK_PATH",
    ownerIdPattern: "unattended-<pid>-<timestamp>",
    retry: "exponential_backoff_on_429_and_5xx",
    idempotence: "content_hash_and_d1_completed_uids",
    checkpointLoss: "fail_closed_no_publish",
    publishable: false,
  };
}
