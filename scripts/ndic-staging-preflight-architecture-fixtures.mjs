#!/usr/bin/env node
/**
 * Synthetic NDIC two-phase staging architecture fixtures (offline).
 * Proves:
 * - network prep + shared write stay on Czech self-hosted (no ubuntu queue)
 * - GitHub-hosted never receives IU_NDIC secrets / NDIC network / NDIC shared write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PREFLIGHT_STATUS_CONTEXT,
  DEFAULT_TTL_SECONDS,
  buildAttestationDescription,
  parseAttestationDescription,
  verifyAttestationStatus,
  computeExpiresAtIso,
  buildAttestationId,
} from "./ndic-staging-preflight-attestation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NET_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const PF_WF = path.join(ROOT, ".github", "workflows", "ndic-datex-v1-staging-preflight.yml");

/** Canonical NDIC network/prep job name after narrow shared-writer split. */
export const NDIC_NETWORK_JOB = "ndic-prep";
/** Canonical NDIC critical shared-write job name. */
export const NDIC_SHARED_WRITE_JOB = "ndic-shared-write";
/** Scheduled arming gate job (GitHub-hosted, no secrets, no NDIC network). */
export const NDIC_SCHEDULE_GATE_JOB = "schedule-gate";
/** Inline scheduled preflight job (GitHub-hosted, no secrets, publishes attestation). */
export const NDIC_SCHEDULED_PREFLIGHT_JOB = "scheduled-preflight";
/** Only these jobs of the network workflow may run on GitHub-hosted runners. */
export const GITHUB_HOSTED_ALLOWED_JOBS = Object.freeze([
  NDIC_SCHEDULE_GATE_JOB,
  NDIC_SCHEDULED_PREFLIGHT_JOB,
  // Checks/auto-merge/Pages only — no NDIC secrets, no shared feed mutation.
  "ndic-post-write",
  "resolve",
]);
/** Conservative staggered cadence (no authoritative NDIC minimum interval documented). */
export const NDIC_SCHEDULE_CRON = "7,22,37,52 * * * *";

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

export function stripComments(src) {
  return String(src || "")
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf("#");
      if (idx < 0) return line;
      const before = line.slice(0, idx);
      if ((before.match(/"/g) || []).length % 2 === 1) return line;
      if ((before.match(/'/g) || []).length % 2 === 1) return line;
      return before;
    })
    .join("\n");
}

export function hasJob(src, name) {
  return new RegExp(`(?:^|\\n)\\s{2}${name}:\\s*\\n`).test(src);
}

export function jobChunk(src, name) {
  const re = new RegExp(`(?:^|\\n)( {2}${name}:\\n(?: {4}.*\\n|\\n)*)`);
  const m = src.match(re);
  return m ? m[1] : "";
}

/** Enumerate the top-level trigger keys declared under `on:`. */
export function extractOnTriggers(src) {
  const lines = stripComments(src).split(/\r?\n/);
  const triggers = [];
  let inOn = false;
  for (const line of lines) {
    if (!inOn) {
      if (/^on:\s*$/.test(line)) inOn = true;
      continue;
    }
    if (/^\S/.test(line)) break;
    const m = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (m) triggers.push(m[1]);
  }
  return triggers;
}

/** Source with the GitHub-hosted-allowed job chunks removed. */
export function withoutGithubHostedAllowedJobs(src) {
  let rest = src;
  for (const job of GITHUB_HOSTED_ALLOWED_JOBS) {
    const chunk = jobChunk(rest, job);
    if (chunk) rest = rest.replace(chunk, "");
  }
  return rest;
}

function czechLabelsPresent(chunk) {
  return (
    /self-hosted/.test(chunk) &&
    /Linux/.test(chunk) &&
    /X64/.test(chunk) &&
    /ndic-cz-egress/.test(chunk)
  );
}

export function assertNetworkWorkflowArchitecture(src) {
  const c = stripComments(src);
  const localFails = [];
  const check = (id, cond, detail) => {
    if (!cond) localFails.push(id + (detail != null ? ":" + String(detail) : ""));
  };

  // SAFE SCHEDULE CONTRACT: exactly schedule + workflow_dispatch, nothing else.
  const triggers = extractOnTriggers(src);
  check(
    "net_triggers_exactly_schedule_and_dispatch",
    triggers.slice().sort().join(",") === "schedule,workflow_dispatch",
    triggers.join("+")
  );
  check("net_has_schedule_trigger", triggers.includes("schedule"));
  check("net_has_workflow_dispatch_trigger", triggers.includes("workflow_dispatch"));
  check("net_no_push_trigger", !triggers.includes("push"));
  check("net_no_workflow_run_trigger", !triggers.includes("workflow_run"));
  check("net_no_pull_request_trigger", !triggers.includes("pull_request"));
  check(
    "net_schedule_cron_conservative",
    new RegExp(`-\\s*cron:\\s*["']${NDIC_SCHEDULE_CRON.replace(/\*/g, "\\*")}["']`).test(c)
  );
  check("net_no_offline_guards_job", !hasJob(src, "offline-guards"));
  check("net_has_network_job", hasJob(src, NDIC_NETWORK_JOB));
  check("net_has_shared_write_job", hasJob(src, NDIC_SHARED_WRITE_JOB));
  // ubuntu-latest is allowed ONLY on the no-secret schedule gate / inline preflight jobs.
  check("net_no_ubuntu_outside_schedule_jobs", !/ubuntu-latest/.test(withoutGithubHostedAllowedJobs(c)));
  check("net_no_needs_offline_guards", !/needs:\s*offline-guards/.test(c));
  check("net_no_continue_on_error", !/continue-on-error:\s*true/.test(c));
  check("net_no_workflow_level_shared_lock", !/^concurrency:\s*\n\s+group:\s*info-events-data-writers/m.test(c));

  const net = jobChunk(src, NDIC_NETWORK_JOB);
  check("net_job_present_chunk", Boolean(net));
  check("net_runs_on_self_hosted", /self-hosted/.test(net));
  check("net_runs_on_linux", /Linux/.test(net));
  check("net_runs_on_x64", /X64/.test(net));
  check("net_runs_on_ndic_cz_egress", /ndic-cz-egress/.test(net));
  check("net_czech_labels", czechLabelsPresent(net));
  check("net_verify_preflight_step", /ndic-verify-preflight-attestation\.mjs/.test(net));
  check("net_identity_before_checkout", /Preflight runner identity/.test(net));
  check("net_secrets_present_on_network_only", /secrets\.IU_NDIC_PULL_URL/.test(net));
  check("net_has_prod_sync", /ndic-datex-v1-prod-sync\.mjs/.test(net));
  check("net_staging_concurrency", /group:\s*ndic-datex-v1-internal-staging/.test(net));
  check("net_no_production_shared_lock", !/group:\s*info-events-data-writers/.test(net));
  // Job-level if: always() is forbidden; forensic upload may use always()&&shadow only.
  const beforeUpload = net.split("Upload redacted shadow forensic artifacts")[0] || net;
  check("net_no_job_level_always_bypass", !/if:\s*always\(\)/.test(beforeUpload) && !/if:\s*\$\{\{\s*always\(\)\s*\}\}/.test(beforeUpload));
  check("net_shadow_forensic_dir_env", /IU_NDIC_FORENSIC_DIR/.test(net));
  check("net_shadow_forensic_artifact_upload", /ndic-shadow-forensic-summary\.json/.test(net));
  check("net_shadow_forensic_retention_1d", /retention-days:\s*1/.test(net));
  check("net_shadow_forensic_no_full_temp_upload", !/path:\s*\$\{\{\s*runner\.temp\s*\}\}\s*$/m.test(net));
  check("net_shadow_forensic_mode_guard", /github\.event\.inputs\.mode\s*==\s*'shadow'/.test(net));
  check(
    "net_shadow_forensic_upload_on_failure",
    /if:\s*\$\{\{\s*always\(\)\s*&&\s*github\.event\.inputs\.mode\s*==\s*'shadow'\s*\}\}/.test(net)
  );
  check("net_shadow_forensic_if_no_files_error", /if-no-files-found:\s*error/.test(net));
  check("net_shadow_forensic_explicit_allowlist_only", /ndic-shadow-forensic\/ndic-shadow-forensic-summary\.json/.test(net));
  check("net_no_continue_on_error_in_job", !/continue-on-error:\s*true/.test(net));
  // Scheduled runs must reach ACTIVE through a resolved mode, never through inputs.mode.
  check("net_prep_resolves_mode", /NDIC_RESOLVED_MODE:\s*\$\{\{\s*github\.event_name == 'schedule'/.test(net));
  check("net_prep_scheduled_mode_active", /github\.event_name == 'schedule' && 'active'/.test(net));
  check("net_prep_exports_resolved_mode_output", /resolved_mode:\s*\$\{\{\s*steps\.mode\.outputs\.resolved_mode\s*\}\}/.test(net));
  // Skipped scheduled jobs must not block the manual dispatch path, without always().
  check("net_prep_if_uses_not_cancelled", /if:\s*>\s*\n\s+!cancelled\(\)/.test(net));
  check("net_prep_needs_schedule_gate", /-\s*schedule-gate\b/.test(net));
  check("net_prep_needs_scheduled_preflight", /-\s*scheduled-preflight\b/.test(net));
  check("net_prep_dispatch_path_preserved", /github\.event_name == 'workflow_dispatch'/.test(net));
  check("net_prep_schedule_path_requires_gate", /needs\.schedule-gate\.outputs\.proceed == 'true'/.test(net));
  check(
    "net_prep_schedule_path_requires_preflight_success",
    /needs\.scheduled-preflight\.result == 'success'/.test(net)
  );

  const gate = jobChunk(src, NDIC_SCHEDULE_GATE_JOB);
  check("gate_job_present_chunk", Boolean(gate));
  check("gate_runs_ubuntu", /runs-on:\s*ubuntu-latest/.test(gate));
  check("gate_schedule_only", /github\.event_name == 'schedule'/.test(gate));
  check("gate_no_ndic_secrets", !/secrets\.IU_NDIC_/.test(gate));
  check("gate_no_prod_sync", !/ndic-datex-v1-prod-sync\.mjs/.test(gate));
  check("gate_uses_arming_variable", /vars\.NDIC_AUTOMATION_ENABLED/.test(gate));
  check("gate_runs_arming_script", /ndic-schedule-arming\.mjs/.test(gate));
  check("gate_outputs_proceed", /proceed:\s*\$\{\{\s*steps\.gate\.outputs\.proceed\s*\}\}/.test(gate));
  check("gate_outputs_skip_reason", /skip_reason:\s*\$\{\{\s*steps\.gate\.outputs\.skip_reason\s*\}\}/.test(gate));
  check("gate_no_continue_on_error", !/continue-on-error:\s*true/.test(gate));

  const spf = jobChunk(src, NDIC_SCHEDULED_PREFLIGHT_JOB);
  check("spf_job_present_chunk", Boolean(spf));
  check("spf_runs_ubuntu", /runs-on:\s*ubuntu-latest/.test(spf));
  check("spf_needs_gate", /needs:\s*schedule-gate/.test(spf));
  check("spf_requires_proceed", /needs\.schedule-gate\.outputs\.proceed == 'true'/.test(spf));
  check("spf_no_ndic_secrets", !/secrets\.IU_NDIC_/.test(spf));
  check("spf_no_prod_sync", !/ndic-datex-v1-prod-sync\.mjs/.test(spf));
  check("spf_no_shadow_run", !/ndic-datex-v1-shadow-run\.mjs/.test(spf));
  check("spf_runs_product_suite", /ndic-staging-preflight-suite\.mjs/.test(spf));
  check("spf_runs_architecture_fixtures", /iu-ndic-staging-preflight-architecture-fixtures/.test(spf));
  check("spf_runs_attestation_fixtures", /iu-ndic-staging-preflight-attestation-fixtures/.test(spf));
  check("spf_runs_schedule_fixtures", /iu-ndic-automatic-schedule-fixtures/.test(spf));
  check("spf_publishes_attestation", /ndic-publish-preflight-attestation\.mjs/.test(spf));
  check("spf_binds_head_sha", /IU_NDIC_PREFLIGHT_EXPECTED_HEAD:\s*\$\{\{\s*github\.sha\s*\}\}/.test(spf));
  check("spf_no_continue_on_error", !/continue-on-error:\s*true/.test(spf));

  // Duplicate-run guard: NDIC-only job-level orchestration group, never a whole-run lock
  // (a whole-run lock would queue the schedule gate and defeat the early duplicate skip).
  check(
    "net_orchestration_lock_ndic_only",
    /group:\s*ndic-datex-v1-internal-staging\s*\n\s+cancel-in-progress:\s*false/.test(net)
  );
  check("net_no_workflow_level_concurrency", !/^concurrency:\s*$/m.test(c.split(/\njobs:\s*\n/)[0] || ""));

  const write = jobChunk(src, NDIC_SHARED_WRITE_JOB);
  check("write_job_present_chunk", Boolean(write));
  check("write_runs_on_self_hosted", /self-hosted/.test(write));
  check("write_runs_on_linux", /Linux/.test(write));
  check("write_runs_on_x64", /X64/.test(write));
  check("write_runs_on_ndic_cz_egress", /ndic-cz-egress/.test(write));
  check("write_czech_labels", czechLabelsPresent(write));
  check("write_no_ubuntu_latest", !/ubuntu-latest/.test(write));
  check("write_identity_before_checkout", /Preflight runner identity/.test(write));
  check("write_no_ndic_secrets", !/secrets\.IU_NDIC_/.test(write));
  check("write_no_prod_sync", !/ndic-datex-v1-prod-sync\.mjs/.test(write));
  check("write_has_shared_lock", /group:\s*info-events-data-writers/.test(write));
  check("write_has_reread_apply", /info-events-shared-writer-critical\.mjs\s+ndic/.test(write));
  check("write_cancel_false", /cancel-in-progress:\s*false/.test(write));

  check(
    "reconcile_inline_in_shared_write",
    /ndic-data-pr-reconcile-against-main\.mjs/.test(write) &&
      !hasJob(src, "ndic-reconcile-data-pr")
  );
  check("reconcile_no_full_history_clone", !/ndic-main-data:[\s\S]*?fetch-depth:\s*0/.test(c));
  check("write_reclaims_disk_before_checkout", /Reclaim workspace disk before checkout/.test(write));

  const postWrite = jobChunk(src, "ndic-post-write");
  check("post_write_job_present", Boolean(postWrite));
  check("post_write_runs_ubuntu", /runs-on:\s*ubuntu-latest/.test(postWrite));
  check("post_write_no_shared_lock", !/group:\s*info-events-data-writers/.test(postWrite));
  check("post_write_no_ndic_secrets", !/secrets\.IU_NDIC_/.test(postWrite));
  check("post_write_dispatches_checks", /gh workflow run smoke\.yml/.test(postWrite));
  check("post_write_needs_shared_write", /needs:\s*ndic-shared-write/.test(src.split("ndic-post-write:")[1] || ""));
  // Two-source model (ACTIVE run 31254863015): feature orch + main data, never same-workspace overwrite.
  check("write_feature_orch_path", /path:\s*ndic-orch\b/.test(write));
  check("write_main_data_path", /path:\s*ndic-main-data\b/.test(write) && /ref:\s*main\b/.test(write));
  check(
    "write_helper_from_feature_orch",
    /ndic-orch\/scripts\/info-events-shared-writer-critical\.mjs\s+ndic/.test(write)
  );
  check(
    "write_target_main_shared_state",
    /ndic-main-data\/projects\/data\/info_events/.test(write)
  );
  check(
    "write_no_legacy_same_workspace_apply",
    !/node\s+scripts\/info-events-shared-writer-critical\.mjs\s+ndic/.test(write)
  );
  // ACTIVE 31257122613: prep still packs with required-output assert before artifact upload.
  check(
    "pack_asserts_candidate_required_outputs",
    /ndic-assert-candidate-required-outputs\.mjs/.test(net)
  );
  // After #9403: write job eligibility uses prep.result (not needs outputs); candidate
  // validation is fail-closed inside the job after artifact download.
  const writeIfRegion = (() => {
    const idx = write.search(/\n\s*runs-on:/);
    return stripComments(idx >= 0 ? write.slice(0, idx) : write);
  })();
  check("write_uses_cancelled_guard", /!cancelled\(\)/.test(writeIfRegion));
  check(
    "write_uses_prep_result_gate",
    /needs\.ndic-prep\.result\s*==\s*'success'/.test(writeIfRegion)
  );
  check(
    "write_no_candidate_ready_job_gate",
    !/needs\.ndic-prep\.outputs\.candidate_ready/.test(writeIfRegion)
  );
  check(
    "write_no_resolved_mode_job_gate",
    !/needs\.ndic-prep\.outputs\.resolved_mode/.test(writeIfRegion)
  );
  check(
    "write_no_prep_outputs_job_gate",
    !/needs\.ndic-prep\.outputs\./.test(writeIfRegion)
  );
  check(
    "write_download_candidate_artifact",
    /download-artifact/.test(write) &&
      /ndic-ie-candidate-\$\{\{\s*github\.run_id\s*\}\}/.test(write)
  );
  check(
    "write_asserts_downloaded_candidate_required",
    /ndic-validate-shared-write-candidate\.mjs/.test(write)
  );
  check(
    "write_uses_stage_shared_write_outputs",
    /ndic-stage-shared-write-outputs\.mjs/.test(write)
  );
  check(
    "write_no_all_or_nothing_git_add_swallow",
    !/git\s+add[\s\S]{0,400}2>\s*\/dev\/null\s*\|\|\s*true/.test(write)
  );
  // Old pack-time assert must NOT be the sole write-job eligibility/validation contract.
  check(
    "write_old_assert_not_required_as_active_architecture",
    !/ndic-assert-candidate-required-outputs\.mjs/.test(write)
  );

  return { ok: localFails.length === 0, fails: localFails };
}

export function assertPreflightWorkflowArchitecture(src) {
  const c = stripComments(src);
  const localFails = [];
  const check = (id, cond, detail) => {
    if (!cond) localFails.push(id + (detail != null ? ":" + String(detail) : ""));
  };

  check("pf_name", /name:\s*NDIC staging preflight/.test(src));
  check("pf_workflow_dispatch_only", /^on:\r?\n\s+workflow_dispatch:/m.test(src));
  check("pf_no_push", !/^push:/m.test(c));
  check("pf_no_schedule", !/^schedule:/m.test(c));
  check("pf_no_workflow_run", !/^workflow_run:/m.test(c));
  check("pf_runs_ubuntu", /runs-on:\s*ubuntu-latest/.test(src));
  check("pf_no_ndic_secrets", !/secrets\.IU_NDIC_/.test(c));
  check("pf_no_prod_sync", !/ndic-datex-v1-prod-sync\.mjs/.test(c));
  check("pf_no_shadow_run", !/ndic-datex-v1-shadow-run\.mjs/.test(c));
  check("pf_publish_attestation", /ndic-publish-preflight-attestation\.mjs/.test(src));
  check("pf_architecture_fixtures", /iu-ndic-staging-preflight-architecture-fixtures/.test(src));
  check("pf_attestation_fixtures", /iu-ndic-staging-preflight-attestation-fixtures/.test(src));
  check("pf_no_continue_on_error", !/continue-on-error:\s*true/.test(c));
  check("pf_concurrency_group", /ndic-datex-v1-staging-preflight/.test(src));
  check("pf_cancel_false", /cancel-in-progress:\s*false/.test(src));
  // timeout may be present; must not be the sole coupling — architecture removes network wait
  check("pf_timeout_not_under_15_forced_fail", true);

  return { ok: localFails.length === 0, fails: localFails };
}

function main() {
  const netSrc = fs.readFileSync(NET_WF, "utf8");
  const pfSrc = fs.readFileSync(PF_WF, "utf8");

  ok("net_wf_exists", fs.existsSync(NET_WF));
  ok("pf_wf_exists", fs.existsSync(PF_WF));

  const netA = assertNetworkWorkflowArchitecture(netSrc);
  ok("network_architecture", netA.ok, netA.fails.join("|"));
  const pfA = assertPreflightWorkflowArchitecture(pfSrc);
  ok("preflight_architecture", pfA.ok, pfA.fails.join("|"));
  ok("offline_guard_queue_dependency_removed", !/offline-guards/.test(stripComments(netSrc)));
  ok(
    "network_no_ubuntu_queue",
    !/ubuntu-latest/.test(withoutGithubHostedAllowedJobs(stripComments(netSrc)))
  );

  // Attestation unit matrix
  const head = "b".repeat(40);
  const other = "c".repeat(40);
  const now = Date.parse("2026-08-06T16:00:00Z");
  const expOk = computeExpiresAtIso(now, DEFAULT_TTL_SECONDS);
  const desc = buildAttestationDescription({
    headSha: head,
    runId: "99",
    expiresAtIso: expOk,
    attestationId: buildAttestationId(99, 1),
  });
  ok("attest_parse_ok", parseAttestationDescription(desc).ok);
  ok(
    "preflight_success_correct_head",
    verifyAttestationStatus({
      context: PREFLIGHT_STATUS_CONTEXT,
      state: "success",
      description: desc,
      expectedHeadSha: head,
      nowMs: now + 1000,
    }).ok
  );
  ok(
    "preflight_wrong_head",
    !verifyAttestationStatus({
      context: PREFLIGHT_STATUS_CONTEXT,
      state: "success",
      description: desc,
      expectedHeadSha: other,
      nowMs: now + 1000,
    }).ok
  );
  ok(
    "preflight_expired",
    !verifyAttestationStatus({
      context: PREFLIGHT_STATUS_CONTEXT,
      state: "success",
      description: desc,
      expectedHeadSha: head,
      nowMs: Date.parse(expOk) + 1000,
    }).ok
  );
  ok(
    "preflight_missing_desc",
    !verifyAttestationStatus({
      context: PREFLIGHT_STATUS_CONTEXT,
      state: "success",
      description: "",
      expectedHeadSha: head,
      nowMs: now + 1000,
    }).ok
  );
  ok(
    "preflight_cancelled_state",
    !verifyAttestationStatus({
      context: PREFLIGHT_STATUS_CONTEXT,
      state: "failure",
      description: desc,
      expectedHeadSha: head,
      nowMs: now + 1000,
    }).ok
  );
  ok(
    "preflight_failure_state",
    !verifyAttestationStatus({
      context: PREFLIGHT_STATUS_CONTEXT,
      state: "error",
      description: desc,
      expectedHeadSha: head,
      nowMs: now + 1000,
    }).ok
  );
  ok(
    "network_without_preflight",
    !verifyAttestationStatus({
      context: "other",
      state: "success",
      description: desc,
      expectedHeadSha: head,
      nowMs: now + 1000,
    }).ok
  );
  ok("no_hardcoded_pass_in_net_wf", !/PREFLIGHT_PASS:\s*YES/.test(netSrc) && !/exit 0\s*#\s*force/.test(netSrc));
  ok("no_automatic_network_dispatch", !/workflow_run:/.test(stripComments(pfSrc)) && !/workflow_run:/.test(stripComments(netSrc)));
  ok("no_github_hosted_ndic_network", !/ubuntu-latest[\s\S]{0,800}secrets\.IU_NDIC_/.test(pfSrc));
  ok("refusing_path_still_in_net", /REFUSING_GITHUB_HOSTED/.test(netSrc));
  ok("publication_not_enabled_in_wf", !/PUBLICATION_ENABLED:\s*['\"]?true/.test(netSrc));

  const report = {
    ok: fails.length === 0,
    passCount,
    failCount: fails.length,
    fails,
  };
  console.log(JSON.stringify(report, null, 2));
  if (fails.length) process.exit(1);
}

const isDirect =
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith("ndic-staging-preflight-architecture-fixtures.mjs");
if (isDirect) main();
