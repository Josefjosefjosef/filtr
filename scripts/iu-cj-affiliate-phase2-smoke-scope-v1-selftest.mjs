#!/usr/bin/env node
/**
 * Regression tests for cj_affiliate_phase2_offline_only smoke scope (fail-closed).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CJ_AFFILIATE_PHASE2_OFFLINE_FIXTURE_SELFTEST,
  allowsDataOnlyFastPath,
  isCjAffiliatePhase2OfflineOnlyScope,
} from "./smoke-data-only-scope.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = CJ_AFFILIATE_PHASE2_OFFLINE_FIXTURE_SELFTEST;
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

const smokeYml = fs.readFileSync(path.join(REPO, ".github", "workflows", "smoke.yml"), "utf8");
expect(
  "smoke_yml_cj_offline_step",
  /CJ Affiliate Phase 2 offline selftest smoke/.test(smokeYml)
);
expect(
  "smoke_yml_cj_step_fail_closed",
  /cj_affiliate_phase2_offline_only == 'true'[\s\S]*set -euo pipefail[\s\S]*coupon-eligibility-fixture-selftest/.test(
    smokeYml
  )
);
expect(
  "smoke_yml_parallel_pool_skips_cj_scope",
  /Playwright guard suite \(parallel pool, manifest v1\)[\s\S]*cj_affiliate_phase2_offline_only != 'true'/.test(
    smokeYml
  )
);

const manifest = JSON.parse(
  fs.readFileSync(path.join(REPO, "scripts", "ci", "smoke-guard-manifest-v1.json"), "utf8")
);
const missingCjGate = manifest.guards.filter(
  (g) => !String(g.ifGha || "").includes("cj_affiliate_phase2_offline_only")
);
expect("manifest_all_guards_cj_gate", missingCjGate.length === 0);

console.log(
  JSON.stringify({
    IU_CJ_AFFILIATE_PHASE2_SMOKE_SCOPE_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
