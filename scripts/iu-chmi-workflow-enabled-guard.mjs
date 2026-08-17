#!/usr/bin/env node
/**
 * Guard: CHMI CAP autorun must detect a manually disabled sync workflow.
 * Static checks only (does not call GitHub API).
 *
 * Incident 2026-08-12..17: update-chmi-cap-v2.yml was disabled_manually →
 * schedule dead, Cloudflare dispatch 422, production feed frozen at 2026-08-11.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const freshness = fs.readFileSync(
  path.join(ROOT, ".github", "workflows", "chmi-cap-v2-freshness-watchdog.yml"),
  "utf8"
);
const fallback = fs.readFileSync(
  path.join(ROOT, ".github", "workflows", "chmi-cap-watchdog-cron-fallback.yml"),
  "utf8"
);
const worker = fs.readFileSync(
  path.join(ROOT, "cloudflare", "chmi-cap-watchdog", "src", "index.ts"),
  "utf8"
);
const syncWf = fs.readFileSync(
  path.join(ROOT, ".github", "workflows", "update-chmi-cap-v2.yml"),
  "utf8"
);

ok("freshness_checks_workflow_state", /actions\/workflows\/\$WORKFLOW_FILE"/.test(freshness) && /WF_STATE/.test(freshness), "state probe");
ok("freshness_fail_workflow_disabled", /WORKFLOW_DISABLED/.test(freshness), "fail state");
ok("freshness_fix_hint", /gh workflow enable/.test(freshness), "enable hint");
ok("worker_classifies_422_disabled", /workflow_disabled/.test(worker) && /fetchWorkflowState/.test(worker), "422 classify");
ok("fallback_detects_disabled", /workflow_disabled/.test(fallback) && /WATCHDOG_WORKFLOW_DISABLED/.test(fallback), "fallback");
ok("sync_cron_present", /cron:\s*"\*\/5 \* \* \* \*"/.test(syncWf), "*/5 cron");
ok("sync_no_disable_rebind", /Do NOT disable\/enable/.test(syncWf) || /keep workflow active/i.test(syncWf), "no disable");

if (fails.length) {
  console.error("IU_CHMI_WORKFLOW_ENABLED_GUARD=FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("IU_CHMI_WORKFLOW_ENABLED_GUARD=PASS");
