#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { allowsDataOnlyFastPath, isDataOnlyScope, isFastPoolPipelineScope, isVaultSecurityRuntimeScope, isWorkflowOnlyScope } from "./smoke-data-only-scope.mjs";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    failed += 1;
  }
}

/** Prevent data-only + skipped Playwright install from still running UI browser guards. */
function assertSmokeYmlDataOnlyGatesPlaywrightUiSteps() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const smokePath = path.join(here, "..", ".github", "workflows", "smoke.yml");
  const text = fs.readFileSync(smokePath, "utf8");
  const required = [
    "Install Playwright browsers",
    "Desktop cold-start FOUC guard",
    "Mobile iCentrum boot FOUC guard",
    "Traffic auto background full hydrate guard",
  ];
  for (const name of required) {
    const re = new RegExp(
      String.raw`- name:\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*\n\s*if:\s*steps\.scope\.outputs\.data_only\s*!=\s*'true'`,
      "m"
    );
    assert(re.test(text), `smoke.yml step "${name}" must gate on data_only != true (Playwright binary skip path)`);
  }
}
assertSmokeYmlDataOnlyGatesPlaywrightUiSteps();

assert(isDataOnlyScope(["projects/data/publishable_pool.json"]), "pool file is data-only");
assert(isDataOnlyScope(["projects/data/articles/index.json", "projects/data/article_feed_chunks/feed/init.json"]), "chunks are data-only");
assert(!isDataOnlyScope(["assets/app.js"]), "assets not data-only");
assert(!isDataOnlyScope(["projects/data/x.json", "assets/app.js"]), "mixed not data-only");
assert(!isDataOnlyScope([]), "empty not data-only");
assert(isFastPoolPipelineScope([".github/workflows/update-articles-fast-pool.yml"]), "fast pool workflow-only is pipeline scope");
assert(isWorkflowOnlyScope([".github/workflows/update-weather.yml", ".github/workflows/pages-publish-from-main-data.yml"]), "multi workflow-only is workflow scope");
assert(
  isWorkflowOnlyScope([
    ".github/workflows/iu-ads-admin-e2e-prod.yml",
    ".github/workflows/iu-ads-post-migration-prod-verify.yml",
    "cloudflare/iu-ads/scripts/iu-ads-admin-e2e-prod.mjs",
    "scripts/iu-ads-post-migration-prod-verify.mjs",
  ]),
  "Ads E2E/verify tooling is workflow-only scope"
);
assert(!isWorkflowOnlyScope([".github/workflows/smoke.yml", "assets/app.js"]), "mixed workflow+assets not workflow scope");
assert(isFastPoolPipelineScope(["package.json", "projects/data/publishable_pool.json"]), "data + package.json is pipeline scope");
assert(!isFastPoolPipelineScope([".github/workflows/update-articles-fast-pool.yml", "assets/app.js"]), "mixed workflow+assets not pipeline scope");
assert(isVaultSecurityRuntimeScope(["assets/iu-vault-bootstrap-v1.js"]), "vault bootstrap is vault runtime scope");
assert(isVaultSecurityRuntimeScope(["assets/iu-vault-lock-v1.js", "scripts/iu-vault-lock-unlock-preserves-data-guard-v1.mjs"]), "vault runtime asset in mixed diff");
assert(!isVaultSecurityRuntimeScope(["projects/data/x.json", "scripts/iu-vault-lock-unlock-preserves-data-guard-v1.mjs"]), "guard script alone is not vault runtime scope");
assert(!allowsDataOnlyFastPath(["assets/iu-vault-bootstrap-v1.js"]), "vault bootstrap blocks fast path");
assert(!allowsDataOnlyFastPath([".github/workflows/smoke.yml", "assets/iu-vault-bootstrap-v1.js"]), "vault+wworkflow blocks fast path");
assert(allowsDataOnlyFastPath([".github/workflows/smoke.yml"]), "workflow-only still allows fast path when no vault runtime");

console.log("SMOKE_DATA_ONLY_SCOPE_PROOF=" + (failed === 0 ? "PASS" : "FAIL"));
process.exit(failed === 0 ? 0 : 1);
