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
    const jobChunkText = (m.match(/(?:^|\n)( {2}ndic-network-sync:\n(?: {4}.*\n|\n)*)/) || [])[1] || "";
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

const report = { ok: fails.length === 0, failCount: fails.length, fails };
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
