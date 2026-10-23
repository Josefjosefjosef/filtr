#!/usr/bin/env node
/**
 * Regression tests for CJ smoke scopes (fail-closed): offline fixture + staging API probe.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CJ_AFFILIATE_PHASE2_OFFLINE_FIXTURE_SELFTEST,
  CJ_OFFLINE_CATALOG_NORMALIZE_SELFTEST,
  CJ_PARTNER_SLOT_PLANNER_SELFTEST,
  CJ_STAGING_API_PROBE_EXECUTE,
  allowsDataOnlyFastPath,
  isCjAffiliatePhase2OfflineOnlyScope,
  isCjOfflineCatalogNormalizeScope,
  isCjPartnerSlotPlannerPhaseAScope,
  isCjStagingApiProbeOnlyScope,
} from "./smoke-data-only-scope.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = CJ_AFFILIATE_PHASE2_OFFLINE_FIXTURE_SELFTEST;
const CATALOG = CJ_OFFLINE_CATALOG_NORMALIZE_SELFTEST;
const SLOT = CJ_PARTNER_SLOT_PLANNER_SELFTEST;
const PROBE = CJ_STAGING_API_PROBE_EXECUTE;
const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

expect("fixture_only_scoped", isCjAffiliatePhase2OfflineOnlyScope([FIXTURE]) === true);
expect(
  "fixture_only_allows_fast_path",
  allowsDataOnlyFastPath([FIXTURE]) === true
);

expect(
  "fixture_plus_validator_full_smoke",
  isCjAffiliatePhase2OfflineOnlyScope([
    FIXTURE,
    "scripts/iu-cj-affiliate-phase2-coupon-eligibility.mjs",
  ]) === false
);
expect(
  "fixture_plus_worker_full_smoke",
  isCjAffiliatePhase2OfflineOnlyScope([
    FIXTURE,
    "cloudflare/cj-email-ingest-d1-worker/wrangler.toml",
  ]) === false
);
expect(
  "fixture_plus_workflow_full_smoke",
  isCjAffiliatePhase2OfflineOnlyScope([
    FIXTURE,
    ".github/workflows/cj-affiliate-email-ingest.yml",
  ]) === false
);
expect(
  "fixture_plus_unknown_full_smoke",
  isCjAffiliatePhase2OfflineOnlyScope([FIXTURE, "assets/app.js"]) === false
);
expect("empty_diff_full_smoke", isCjAffiliatePhase2OfflineOnlyScope([]) === false);
expect(
  "wiring_without_fixture_full_smoke",
  isCjAffiliatePhase2OfflineOnlyScope(["scripts/smoke-data-only-scope.mjs"]) === false
);

expect(
  "catalog_normalize_scoped",
  isCjOfflineCatalogNormalizeScope([
    CATALOG,
    "scripts/iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs",
    "scripts/fixtures/cj-link-search-coupon-offline-anonymized-v1.xml",
    "scripts/smoke-data-only-scope.mjs",
    ".github/workflows/smoke.yml",
  ]) === true
);
expect(
  "catalog_normalize_fast_path",
  allowsDataOnlyFastPath([
    CATALOG,
    "scripts/iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs",
    "scripts/fixtures/cj-link-search-coupon-offline-anonymized-v1.xml",
  ]) === true
);
expect(
  "catalog_plus_assets_full_smoke",
  isCjOfflineCatalogNormalizeScope([CATALOG, "assets/app.js"]) === false
);

expect(
  "slot_planner_scoped",
  isCjPartnerSlotPlannerPhaseAScope([
    SLOT,
    "scripts/iu-cj-affiliate-phase2-partner-slot-planner-v1.mjs",
    "scripts/iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs",
    "scripts/fixtures/cj-phase2-approved-partners-v1.json",
    "scripts/smoke-data-only-scope.mjs",
    ".github/workflows/smoke.yml",
  ]) === true
);
expect(
  "slot_planner_plus_catalog_js_full_smoke",
  isCjPartnerSlotPlannerPhaseAScope([SLOT, "assets/iu-affiliate-catalog.js"]) === false
);

expect("probe_execute_only_scoped", isCjStagingApiProbeOnlyScope([PROBE]) === true);
expect("probe_execute_only_fast_path", allowsDataOnlyFastPath([PROBE]) === true);
expect(
  "probe_plus_assets_full_smoke",
  isCjStagingApiProbeOnlyScope([PROBE, "assets/app.js"]) === false
);
expect(
  "probe_wiring_without_execute_full_smoke",
  isCjStagingApiProbeOnlyScope(["scripts/smoke-data-only-scope.mjs"]) === false
);
expect(
  "probe_plus_prod_ingest_workflow_full_smoke",
  isCjStagingApiProbeOnlyScope([
    PROBE,
    ".github/workflows/cj-affiliate-email-ingest.yml",
  ]) === false
);

const smokeYml = fs.readFileSync(path.join(REPO, ".github", "workflows", "smoke.yml"), "utf8");
expect(
  "smoke_yml_cj_offline_step",
  /CJ Affiliate Phase 2 offline selftest smoke/.test(smokeYml)
);
expect(
  "smoke_yml_cj_catalog_normalize_step",
  /CJ offline catalog normalize smoke/.test(smokeYml) &&
    /cj_offline_catalog_normalize_only == 'true'/.test(smokeYml)
);
expect(
  "smoke_yml_cj_slot_planner_step",
  /CJ partner slot planner Phase A smoke/.test(smokeYml) &&
    /cj_partner_slot_planner_phase_a_only == 'true'/.test(smokeYml)
);
expect(
  "smoke_yml_cj_step_fail_closed",
  /cj_affiliate_phase2_offline_only == 'true'[\s\S]*set -euo pipefail[\s\S]*coupon-eligibility-fixture-selftest/.test(
    smokeYml
  )
);
expect(
  "smoke_yml_cj_probe_scope_step",
  /cj_staging_api_probe_only == 'true'[\s\S]*staging-cj-api-probe-v1-selftest/.test(smokeYml)
);
expect(
  "smoke_yml_parallel_pool_skips_cj_scope",
  /Playwright guard suite \(parallel pool, manifest v1\)[\s\S]*cj_affiliate_phase2_offline_only != 'true'/.test(
    smokeYml
  )
);
expect(
  "smoke_yml_parallel_pool_skips_probe_scope",
  /Playwright guard suite \(parallel pool, manifest v1\)[\s\S]*cj_staging_api_probe_only != 'true'/.test(
    smokeYml
  )
);

const manifest = JSON.parse(
  fs.readFileSync(path.join(REPO, "scripts", "ci", "smoke-guard-manifest-v1.json"), "utf8")
);
const missingCjGate = manifest.guards.filter(
  (g) => !String(g.ifGha || "").includes("cj_affiliate_phase2_offline_only")
);
expect("manifest_all_guards_cj_offline_gate", missingCjGate.length === 0);
const missingProbeGate = manifest.guards.filter(
  (g) => !String(g.ifGha || "").includes("cj_staging_api_probe_only")
);
expect("manifest_all_guards_cj_probe_gate", missingProbeGate.length === 0);

console.log(
  JSON.stringify({
    IU_CJ_AFFILIATE_PHASE2_SMOKE_SCOPE_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
