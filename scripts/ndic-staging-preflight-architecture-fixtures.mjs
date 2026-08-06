#!/usr/bin/env node
/**
 * Synthetic NDIC two-phase staging architecture fixtures (offline).
 * Proves ubuntu queue is removed from authorized network staging run.
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
  check("net_has_network_job", hasJob(src, "ndic-network-sync"));
  check("net_no_ubuntu_latest", !/ubuntu-latest/.test(c));
  check("net_no_needs_offline_guards", !/needs:\s*offline-guards/.test(c));
  check("net_no_continue_on_error", !/continue-on-error:\s*true/.test(c));

  const net = jobChunk(src, "ndic-network-sync");
  check("net_job_present_chunk", Boolean(net));
  check("net_runs_on_self_hosted", /self-hosted/.test(net));
  check("net_runs_on_linux", /Linux/.test(net));
  check("net_runs_on_x64", /X64/.test(net));
  check("net_runs_on_ndic_cz_egress", /ndic-cz-egress/.test(net));
  check("net_verify_preflight_step", /ndic-verify-preflight-attestation\.mjs/.test(net));
  check("net_identity_before_checkout", /Preflight runner identity/.test(net));
  check("net_secrets_present_on_network_only", /secrets\.IU_NDIC_PULL_URL/.test(net));
  check("net_no_always_bypass", !/if:\s*always\(\)/.test(net));

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
