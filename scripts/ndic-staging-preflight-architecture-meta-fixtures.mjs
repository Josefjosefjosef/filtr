#!/usr/bin/env node
/**
 * Meta-tests: mutations against two-phase NDIC staging architecture must FAIL detection.
 * Offline only. No dispatch. No NDIC network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNetworkWorkflowArchitecture,
  assertPreflightWorkflowArchitecture,
  stripComments,
} from "./ndic-staging-preflight-architecture-fixtures.mjs";
import {
  verifyAttestationStatus,
  PREFLIGHT_STATUS_CONTEXT,
  buildAttestationDescription,
  computeExpiresAtIso,
  buildAttestationId,
} from "./ndic-staging-preflight-attestation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NET_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const PF_WF = path.join(ROOT, ".github", "workflows", "ndic-datex-v1-staging-preflight.yml");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

function mutateMustFail(id, src, mutateFn, assertFn) {
  const mutated = mutateFn(src);
  const result = assertFn(mutated);
  ok(id, result.ok === false, result.ok ? "FALSE_GREEN" : (result.fails || []).slice(0, 3).join("|"));
}

const netSrc = fs.readFileSync(NET_WF, "utf8");
const pfSrc = fs.readFileSync(PF_WF, "utf8");

ok("baseline_network_pass", assertNetworkWorkflowArchitecture(netSrc).ok);
ok("baseline_preflight_pass", assertPreflightWorkflowArchitecture(pfSrc).ok);

mutateMustFail(
  "meta_restore_offline_guards_ubuntu_dependency",
  netSrc,
  (s) =>
    s.replace(
      /jobs:\n/,
      "jobs:\n  offline-guards:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - run: echo hi\n\n"
    ),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_network_on_ubuntu",
  netSrc,
  (s) =>
    s.replace(
      /runs-on:\n\s+- self-hosted\n\s+- Linux\n\s+- X64\n\s+- ndic-cz-egress/,
      "runs-on: ubuntu-latest"
    ),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_remove_preflight_verify",
  netSrc,
  (s) => s.replace(/ndic-verify-preflight-attestation\.mjs/g, "echo-skip-preflight.mjs"),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_add_workflow_run_auto_network",
  netSrc,
  (s) => s.replace(/on:\n\s+workflow_dispatch:/, "on:\n  workflow_run:\n    workflows: [\"NDIC staging preflight\"]\n    types: [completed]\n  workflow_dispatch:"),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_add_push_trigger",
  netSrc,
  (s) => s.replace(/on:\n\s+workflow_dispatch:/, "on:\n  push:\n  workflow_dispatch:"),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_add_schedule_trigger",
  pfSrc,
  (s) => s.replace(/on:\n\s+workflow_dispatch:/, "on:\n  schedule:\n    - cron: \"0 * * * *\"\n  workflow_dispatch:"),
  assertPreflightWorkflowArchitecture
);

mutateMustFail(
  "meta_preflight_gains_ndic_secret",
  pfSrc,
  (s) =>
    s.replace(
      /node scripts\/ndic-publish-preflight-attestation\.mjs/,
      "echo ${{ secrets.IU_NDIC_PULL_URL }}\n          node scripts/ndic-publish-preflight-attestation.mjs"
    ),
  assertPreflightWorkflowArchitecture
);

mutateMustFail(
  "meta_preflight_runs_prod_sync",
  pfSrc,
  (s) =>
    s.replace(
      /node scripts\/ndic-publish-preflight-attestation\.mjs/,
      "node scripts/ndic-datex-v1-prod-sync.mjs"
    ),
  assertPreflightWorkflowArchitecture
);

mutateMustFail(
  "meta_continue_on_error_network",
  netSrc,
  (s) =>
    s.replace(
      /ndic-network-sync:\n/,
      "ndic-network-sync:\n    continue-on-error: true\n"
    ),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_always_if_bypass",
  netSrc,
  (s) =>
    s.replace(
      /if: >\n\s+github\.event_name == 'workflow_dispatch'/,
      "if: always()"
    ),
  (m) => {
    const base = assertNetworkWorkflowArchitecture(m);
    const always = /if:\s*always\(\)/.test(stripComments(m));
    return { ok: base.ok && !always, fails: always ? ["always_present"] : base.fails };
  }
);

// Attestation binding mutations
const HEAD = "f".repeat(40);
const NOW = Date.parse("2026-08-06T12:00:00.000Z");
const desc = buildAttestationDescription({
  headSha: HEAD,
  runId: "1",
  expiresAtIso: computeExpiresAtIso(NOW, 3600),
  attestationId: buildAttestationId(1, 2),
});

ok(
  "meta_accept_other_commit_must_fail",
  !verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "success",
    description: desc,
    expectedHeadSha: "a".repeat(40),
    nowMs: NOW + 1000,
  }).ok
);

ok(
  "meta_remove_expiry_must_fail",
  !verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "success",
    description: desc.replace(/exp=[^|]+/, "exp="),
    expectedHeadSha: HEAD,
    nowMs: NOW + 1000,
  }).ok
);

ok(
  "meta_hardcoded_pass_without_fields_must_fail",
  !verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "success",
    description: "PASS",
    expectedHeadSha: HEAD,
    nowMs: NOW + 1000,
  }).ok
);

ok(
  "meta_cancelled_preflight_must_fail",
  !verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "pending",
    description: desc,
    expectedHeadSha: HEAD,
    nowMs: NOW + 1000,
  }).ok
);

const report = { ok: fails.length === 0, failCount: fails.length, fails };
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
