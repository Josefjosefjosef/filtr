#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  deployWorkflowDiffIsProductionDeployGateSafe,
  typesTsDiffIsCjOptionalEnvOnly,
  wranglerTomlDiffIsCommentOnly,
} from "./iu-ads-production-deploy-scope-diff-v1.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts/iu-ads-production-deploy-scope-v1.mjs");

function runScope(envExtra) {
  return execSync(`node "${script}"`, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      IU_ADS_SCOPE_REPO_ROOT: repoRoot,
      IU_ADS_SCOPE_DIFF_BASE: "origin/main",
      IU_ADS_SCOPE_DIFF_HEAD: "HEAD",
      ...envExtra,
    },
  });
}

function runScopeExpectBlocked(envExtra) {
  try {
    runScope(envExtra);
    console.error("FAIL: expected blocked exit");
    process.exit(1);
  } catch (e) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    if (!out.includes("IU_ADS_PRODUCTION_DEPLOY=blocked")) {
      console.error("FAIL: expected IU_ADS_PRODUCTION_DEPLOY=blocked in output");
      console.error(out);
      process.exit(1);
    }
  }
}

function assertContains(out, needle) {
  if (!out.includes(needle)) {
    console.error("FAIL: expected output to contain", needle);
    console.error(out);
    process.exit(1);
  }
}

assertContains(runScope({ GITHUB_EVENT_NAME: "workflow_dispatch" }), "IU_ADS_PRODUCTION_DEPLOY=run");

const cjOnly =
  "cloudflare/iu-ads/migrations-cj-affiliate-archive/0025_affiliate_ad_archive.sql|cloudflare/iu-ads/cj-affiliate-archive-infra-paths.json|cloudflare/iu-ads/src/index-cj-affiliate-archive.ts";

assertContains(
  runScope({ GITHUB_EVENT_NAME: "push", IU_ADS_SCOPE_CHANGED_FILES: cjOnly }),
  "IU_ADS_PRODUCTION_DEPLOY=skip"
);

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/src/index.ts",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/migrations/0024_example.sql",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: cjOnly + "|cloudflare/iu-ads/src/admin-premium-selected.ts",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

runScopeExpectBlocked({ GITHUB_EVENT_NAME: "push", IU_ADS_SCOPE_CHANGED_FILES: "" });

const pr12112Files = execSync("git diff --name-only origin/main HEAD", { cwd: repoRoot, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .join("|");

assertContains(
  runScope({ GITHUB_EVENT_NAME: "push", IU_ADS_SCOPE_CHANGED_FILES: pr12112Files }),
  "IU_ADS_PRODUCTION_DEPLOY=skip"
);

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/wrangler.toml|cloudflare/iu-ads/src/index.ts",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

const unsafeWranglerDiff = `diff --git a/cloudflare/iu-ads/wrangler.toml b/cloudflare/iu-ads/wrangler.toml
--- a/cloudflare/iu-ads/wrangler.toml
+++ b/cloudflare/iu-ads/wrangler.toml
@@ -1,1 +1,1 @@
-name = "infouzel-ads"
+name = "infouzel-ads-evil"
`;

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/wrangler.toml",
    IU_ADS_SCOPE_FILE_DIFFS: JSON.stringify({ "cloudflare/iu-ads/wrangler.toml": unsafeWranglerDiff }),
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

if (wranglerTomlDiffIsCommentOnly(unsafeWranglerDiff)) {
  console.error("FAIL: unit wrangler unsafe diff should not pass");
  process.exit(1);
}

const safeCommentDiff = `diff --git a/cloudflare/iu-ads/wrangler.toml b/cloudflare/iu-ads/wrangler.toml
--- a/cloudflare/iu-ads/wrangler.toml
+++ b/cloudflare/iu-ads/wrangler.toml
@@ -44,6 +44,7 @@
 migrations_dir = "migrations"
+# CJ note only.
`;

if (!wranglerTomlDiffIsCommentOnly(safeCommentDiff)) {
  console.error("FAIL: unit wrangler safe comment diff");
  process.exit(1);
}

const unsafeWorkflowDiff = `diff --git a/.github/workflows/deploy-iu-ads.yml b/.github/workflows/deploy-iu-ads.yml
--- a/.github/workflows/deploy-iu-ads.yml
+++ b/.github/workflows/deploy-iu-ads.yml
@@ -1,1 +1,0 @@
-    if: needs.resolve_production_deploy_scope.outputs.production_deploy == 'run'
`;

if (deployWorkflowDiffIsProductionDeployGateSafe(unsafeWorkflowDiff)) {
  console.error("FAIL: unsafe workflow diff should be rejected");
  process.exit(1);
}

const typesSafe = `diff --git a/cloudflare/iu-ads/src/types.ts b/cloudflare/iu-ads/src/types.ts
--- a/cloudflare/iu-ads/src/types.ts
+++ b/cloudflare/iu-ads/src/types.ts
@@ -10,6 +10,8 @@
+  /** CJ only. */
+  ADS_CJ_AFFILIATE_ARCHIVE_ENABLED?: string;
`;

if (!typesTsDiffIsCjOptionalEnvOnly(typesSafe)) {
  console.error("FAIL: types safe diff unit");
  process.exit(1);
}

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/src/types.ts",
    IU_ADS_SCOPE_FILE_DIFFS: JSON.stringify({ "cloudflare/iu-ads/src/types.ts": typesSafe }),
  }),
  "IU_ADS_PRODUCTION_DEPLOY=skip"
);

const typesUnsafe = `diff --git a/cloudflare/iu-ads/src/types.ts b/cloudflare/iu-ads/src/types.ts
--- a/cloudflare/iu-ads/src/types.ts
+++ b/cloudflare/iu-ads/src/types.ts
@@ -10,6 +10,6 @@
-  ADS_SAFE_MODE?: string;
+  ADS_SAFE_MODE?: boolean;
`;

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/src/types.ts",
    IU_ADS_SCOPE_FILE_DIFFS: JSON.stringify({ "cloudflare/iu-ads/src/types.ts": typesUnsafe }),
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/src/unknown-new-module.ts",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

execSync(`node "${path.join(repoRoot, "scripts/iu-ads-production-entry-isolation-guard-v1.mjs")}"`, {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: "pipe",
});

console.log("IU_ADS_PRODUCTION_DEPLOY_SCOPE_SELFTEST=OK");
