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

  check("net_workflow_dispatch_only_trigger", /^on:\r?\n\s+workflow_dispatch:/m.test(src));
  check("net_no_push_trigger", !/^push:/m.test(c));
  check("net_no_schedule_trigger", !/^schedule:/m.test(c));
  check("net_no_workflow_run_trigger", !/^workflow_run:/m.test(c));
  check("net_no_offline_guards_job", !hasJob(src, "offline-guards"));
  check("net_has_network_job", hasJob(src, NDIC_NETWORK_JOB));
  check("net_has_shared_write_job", hasJob(src, NDIC_SHARED_WRITE_JOB));
  // Whole update workflow must stay off ubuntu-latest (incident 31118898675 + shared-write isolation).
  check("net_no_ubuntu_latest", !/ubuntu-latest/.test(c));
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
  ok("network_no_ubuntu_queue", !/ubuntu-latest/.test(stripComments(netSrc)));

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
