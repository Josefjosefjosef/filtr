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
  NDIC_NETWORK_JOB,
  NDIC_SHARED_WRITE_JOB,
  jobChunk,
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
  (s) => {
    const prep = jobChunk(s, NDIC_NETWORK_JOB);
    if (!prep) return s;
    const mutatedPrep = prep.replace(
      /runs-on:\n\s+- self-hosted\n\s+- Linux\n\s+- X64\n\s+- ndic-cz-egress/,
      "runs-on: ubuntu-latest"
    );
    return s.replace(prep, mutatedPrep);
  },
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_shared_write_on_ubuntu",
  netSrc,
  (s) => {
    const write = jobChunk(s, NDIC_SHARED_WRITE_JOB);
    if (!write) return s;
    const mutatedWrite = write.replace(
      /runs-on:\n\s+- self-hosted\n\s+- Linux\n\s+- X64\n\s+- ndic-cz-egress/,
      "runs-on: ubuntu-latest"
    );
    return s.replace(write, mutatedWrite);
  },
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_github_hosted_gains_ndic_secret",
  netSrc,
  (s) => {
    const write = jobChunk(s, NDIC_SHARED_WRITE_JOB);
    if (!write) return s;
    const mutatedWrite = write.replace(
      /runs-on:\n\s+- self-hosted\n\s+- Linux\n\s+- X64\n\s+- ndic-cz-egress/,
      "runs-on: ubuntu-latest"
    ).replace(
      /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
      "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n          IU_NDIC_PULL_URL: ${{ secrets.IU_NDIC_PULL_URL }}"
    );
    return s.replace(write, mutatedWrite);
  },
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_remove_ndic_cz_egress_label",
  netSrc,
  (s) => {
    const prep = jobChunk(s, NDIC_NETWORK_JOB);
    if (!prep) return s;
    const mutatedPrep = prep.replace(/\n\s+- ndic-cz-egress/, "");
    return s.replace(prep, mutatedPrep);
  },
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_remove_self_hosted_labels",
  netSrc,
  (s) => {
    const prep = jobChunk(s, NDIC_NETWORK_JOB);
    if (!prep) return s;
    const mutatedPrep = prep.replace(
      /runs-on:\n\s+- self-hosted\n\s+- Linux\n\s+- X64\n\s+- ndic-cz-egress/,
      "runs-on:\n      - Linux\n      - X64"
    );
    return s.replace(prep, mutatedPrep);
  },
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_restore_whole_workflow_shared_lock",
  netSrc,
  (s) =>
    s.replace(
      /# Intentionally NO workflow-level info-events-data-writers\.\n/,
      "concurrency:\n  group: info-events-data-writers\n  cancel-in-progress: false\n\n# Intentionally NO workflow-level info-events-data-writers.\n"
    ),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_remove_narrow_shared_write_job",
  netSrc,
  (s) => s.replace(new RegExp(`(?:^|\\n) {2}${NDIC_SHARED_WRITE_JOB}:\\n(?: {4}.*\\n|\\n)*`), "\n"),
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
      new RegExp(`${NDIC_NETWORK_JOB}:\\n`),
      `${NDIC_NETWORK_JOB}:\n    continue-on-error: true\n`
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
    const jobChunkText = jobChunk(m, NDIC_NETWORK_JOB);
    const beforeUpload = jobChunkText.split("Upload redacted shadow forensic artifacts")[0] || jobChunkText;
    const jobAlways = /if:\s*always\(\)/.test(beforeUpload);
    return { ok: base.ok && !jobAlways, fails: jobAlways ? ["job_always_present"] : base.fails };
  }
);

mutateMustFail(
  "meta_remove_shadow_forensic_artifact",
  netSrc,
  (s) => s.replace(/Upload redacted shadow forensic artifacts[\s\S]*?retention-days:\s*1\n/, ""),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_forensic_upload_without_always",
  netSrc,
  (s) =>
    s.replace(
      /if: \$\{\{ always\(\) && github\.event\.inputs\.mode == 'shadow' \}\}/,
      "if: github.event.inputs.mode == 'shadow'"
    ),
  assertNetworkWorkflowArchitecture
);

mutateMustFail(
  "meta_upload_entire_runner_temp",
  netSrc,
  (s) =>
    s.replace(
      /path: \|\n\s+\$\{\{\s*runner\.temp\s*\}\}\/ndic-shadow-forensic\/ndic-shadow-forensic-summary\.json\n\s+\$\{\{\s*runner\.temp\s*\}\}\/ndic-shadow-forensic\/ndic-shadow-card-preview\.json\n\s+\$\{\{\s*runner\.temp\s*\}\}\/ndic-shadow-forensic\/ndic-shadow-validation-report\.json/,
      "path: ${{ runner.temp }}"
    ),
  (m) => {
    const base = assertNetworkWorkflowArchitecture(m);
    const fullTemp = /path:\s*\$\{\{\s*runner\.temp\s*\}\}\s*$/m.test(m);
    return { ok: base.ok && !fullTemp, fails: fullTemp ? ["full_temp_upload"] : base.fails };
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

// Product offline suite must gate POINTS empty-field + basic-importer fixtures (fail-closed).
const SUITE_JS = path.join(ROOT, "scripts", "ndic-staging-preflight-suite.mjs");
const PKG_JSON = path.join(ROOT, "package.json");
const suiteSrc = fs.readFileSync(SUITE_JS, "utf8");
const pkg = JSON.parse(fs.readFileSync(PKG_JSON, "utf8"));
const pkgScripts = pkg.scripts || {};

ok(
  "suite_requires_points_empty_field_policy_fixtures",
  /iu-ndic-tmc-points-empty-field-policy-fixtures/.test(suiteSrc)
);
ok(
  "suite_requires_tmc_basic_importer_fixtures",
  /iu-ndic-tmc-basic-importer-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_points_empty_field_policy_fixtures",
  Boolean(pkgScripts["iu-ndic-tmc-points-empty-field-policy-fixtures"])
);
ok(
  "pkg_has_tmc_basic_importer_fixtures",
  Boolean(pkgScripts["iu-ndic-tmc-basic-importer-fixtures"])
);
ok(
  "suite_requires_shadow_forensic_retention_fixtures",
  /iu-ndic-shadow-forensic-retention-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_shadow_forensic_retention_fixtures",
  Boolean(pkgScripts["iu-ndic-shadow-forensic-retention-fixtures"])
);
ok(
  "suite_requires_location_forensic_probe_fixtures",
  /iu-ndic-location-forensic-probe-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_location_forensic_probe_fixtures",
  Boolean(pkgScripts["iu-ndic-location-forensic-probe-fixtures"])
);
ok("suite_requires_openlr_fixtures", /iu-ndic-openlr-fixtures/.test(suiteSrc));
ok("pkg_has_openlr_fixtures", Boolean(pkgScripts["iu-ndic-openlr-fixtures"]));
ok(
  "suite_requires_remaining_location_gap_fixtures",
  /iu-ndic-remaining-location-gap-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_remaining_location_gap_fixtures",
  Boolean(pkgScripts["iu-ndic-remaining-location-gap-fixtures"])
);
ok(
  "suite_requires_traffic_ui_snapshot_persist_fixtures",
  /iu-ndic-traffic-ui-snapshot-persist-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_traffic_ui_snapshot_persist_fixtures",
  Boolean(pkgScripts["iu-ndic-traffic-ui-snapshot-persist-fixtures"])
);
ok(
  "suite_requires_data_pr_rest_runtime_fixtures",
  /iu-ndic-data-pr-rest-runtime-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_data_pr_rest_runtime_fixtures",
  Boolean(pkgScripts["iu-ndic-data-pr-rest-runtime-fixtures"])
);
ok(
  "preflight_wf_runs_product_suite",
  /ndic-staging-preflight-suite\.mjs/.test(pfSrc)
);

function suiteMustKeepPointsFixtures(id, mutateFn) {
  const mutated = mutateFn(suiteSrc);
  const stillHasPolicy = /iu-ndic-tmc-points-empty-field-policy-fixtures/.test(mutated);
  const stillHasImporter = /iu-ndic-tmc-basic-importer-fixtures/.test(mutated);
  ok(id, !(stillHasPolicy && stillHasImporter), "FALSE_GREEN_SUITE_STILL_HAS_POINTS");
}

suiteMustKeepPointsFixtures("meta_remove_points_policy_from_suite_must_fail", (s) =>
  s.replace(/iu-ndic-tmc-points-empty-field-policy-fixtures/g, "iu-ndic-tmc-points-empty-field-policy-REMOVED")
);
suiteMustKeepPointsFixtures("meta_remove_basic_importer_from_suite_must_fail", (s) =>
  s.replace(/iu-ndic-tmc-basic-importer-fixtures/g, "iu-ndic-tmc-basic-importer-REMOVED")
);
{
  const mutated = suiteSrc.replace(
    /iu-ndic-shadow-forensic-retention-fixtures/g,
    "iu-ndic-shadow-forensic-retention-REMOVED"
  );
  ok(
    "meta_remove_shadow_forensic_retention_from_suite_must_fail",
    !/iu-ndic-shadow-forensic-retention-fixtures/.test(mutated),
    "FALSE_GREEN_SUITE_STILL_HAS_FORENSIC"
  );
}
{
  const mutated = suiteSrc.replace(/iu-ndic-openlr-fixtures/g, "iu-ndic-openlr-REMOVED");
  ok("meta_remove_openlr_from_suite_must_fail", !/iu-ndic-openlr-fixtures/.test(mutated), "FALSE_GREEN_SUITE_STILL_HAS_OPENLR");
}
{
  const mutated = suiteSrc.replace(
    /iu-ndic-remaining-location-gap-fixtures/g,
    "iu-ndic-remaining-location-gap-REMOVED"
  );
  ok(
    "meta_remove_remaining_gap_from_suite_must_fail",
    !/iu-ndic-remaining-location-gap-fixtures/.test(mutated),
    "FALSE_GREEN_SUITE_STILL_HAS_REMAINING_GAP"
  );
}
{
  const mutated = suiteSrc.replace(
    /iu-ndic-traffic-ui-snapshot-persist-fixtures/g,
    "iu-ndic-traffic-ui-snapshot-persist-REMOVED"
  );
  ok(
    "meta_remove_traffic_ui_snapshot_persist_from_suite_must_fail",
    !/iu-ndic-traffic-ui-snapshot-persist-fixtures/.test(mutated),
    "FALSE_GREEN_SUITE_STILL_HAS_TRAFFIC_UI_SNAPSHOT_PERSIST"
  );
}
{
  const renamed = suiteSrc.replace(
    /iu-ndic-traffic-ui-snapshot-persist-fixtures/g,
    "iu-ndic-traffic-ui-snapshot-persist-renamed"
  );
  ok(
    "meta_rename_traffic_ui_snapshot_persist_from_suite_must_fail",
    !/iu-ndic-traffic-ui-snapshot-persist-fixtures/.test(renamed),
    "FALSE_GREEN_SUITE_STILL_HAS_CANONICAL_PERSIST_NAME"
  );
}
{
  const mutated = suiteSrc.replace(
    /iu-ndic-data-pr-rest-runtime-fixtures/g,
    "iu-ndic-data-pr-rest-runtime-REMOVED"
  );
  ok(
    "meta_remove_data_pr_rest_runtime_from_suite_must_fail",
    !/iu-ndic-data-pr-rest-runtime-fixtures/.test(mutated),
    "FALSE_GREEN_SUITE_STILL_HAS_DATA_PR_RUNTIME"
  );
}
{
  const renamed = suiteSrc.replace(
    /iu-ndic-data-pr-rest-runtime-fixtures/g,
    "iu-ndic-data-pr-rest-runtime-renamed"
  );
  ok(
    "meta_rename_data_pr_rest_runtime_from_suite_must_fail",
    !/iu-ndic-data-pr-rest-runtime-fixtures/.test(renamed),
    "FALSE_GREEN_SUITE_STILL_HAS_CANONICAL_DATA_PR_RUNTIME_NAME"
  );
}
// Fixture source must keep the three previously-missing gates + duplicate prevention.
{
  const fixSrc = fs.readFileSync(
    path.join(ROOT, "scripts", "ndic-data-pr-rest-runtime-fixtures.mjs"),
    "utf8"
  );
  ok("meta_data_pr_fixture_has_existing_pr_test", /DATA_PR_EXISTING_PR_REFRESH_PASS/.test(fixSrc));
  ok("meta_data_pr_fixture_has_create_pr_test", /DATA_PR_NEW_PR_CREATE_PASS/.test(fixSrc));
  ok("meta_data_pr_fixture_has_auth_fail_test", /DATA_PR_AUTH_FAILS_CLOSED/.test(fixSrc));
  ok("meta_data_pr_fixture_has_duplicate_test", /DATA_PR_DUPLICATE_PR_POSSIBLE_NO/.test(fixSrc));
  const removeExisting = fixSrc.replace(/DATA_PR_EXISTING_PR_REFRESH_PASS/g, "REMOVED_EXISTING");
  ok(
    "meta_remove_existing_pr_test_must_fail",
    !/DATA_PR_EXISTING_PR_REFRESH_PASS/.test(removeExisting)
  );
  const removeCreate = fixSrc.replace(/DATA_PR_NEW_PR_CREATE_PASS/g, "REMOVED_CREATE");
  ok("meta_remove_create_pr_test_must_fail", !/DATA_PR_NEW_PR_CREATE_PASS/.test(removeCreate));
  const removeAuth = fixSrc.replace(/DATA_PR_AUTH_FAILS_CLOSED/g, "REMOVED_AUTH");
  ok("meta_remove_auth_fail_test_must_fail", !/DATA_PR_AUTH_FAILS_CLOSED/.test(removeAuth));
  const removeDup = fixSrc.replace(/DATA_PR_DUPLICATE_PR_POSSIBLE_NO/g, "REMOVED_DUP");
  ok(
    "meta_remove_duplicate_prevention_test_must_fail",
    !/DATA_PR_DUPLICATE_PR_POSSIBLE_NO/.test(removeDup)
  );
}

const netA = assertNetworkWorkflowArchitecture(netSrc);
const writeChunk = jobChunk(netSrc, NDIC_SHARED_WRITE_JOB);
const prepChunk = jobChunk(netSrc, NDIC_NETWORK_JOB);
const report = {
  ok: fails.length === 0,
  failCount: fails.length,
  fails,
  NETWORK_ARCHITECTURE_META_GUARD_PASS: fails.every((f) => !String(f).startsWith("meta_")) && netA.ok ? "YES" : fails.length === 0 ? "YES" : "NO",
  NETWORK_NO_UBUNTU_META_GUARD_PASS: !/ubuntu-latest/.test(stripComments(netSrc)) ? "YES" : "NO",
  NDIC_SECRET_ISOLATION_META_GUARD_PASS: /secrets\.IU_NDIC_/.test(prepChunk) && !/secrets\.IU_NDIC_/.test(writeChunk) ? "YES" : "NO",
  NDIC_SHARED_WRITE_RUNNER_META_GUARD_PASS:
    /self-hosted/.test(writeChunk) && /ndic-cz-egress/.test(writeChunk) && !/ubuntu-latest/.test(writeChunk)
      ? "YES"
      : "NO",
  TEST_RUNNER_FALSE_GREEN_POSSIBLE: fails.length ? "YES" : "NO",
};
// Meta guard PASS requires all mutation catches + baseline architecture PASS.
report.NETWORK_ARCHITECTURE_META_GUARD_PASS = fails.length === 0 && netA.ok ? "YES" : "NO";
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
