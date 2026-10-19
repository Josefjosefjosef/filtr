#!/usr/bin/env node
/**
 * Decide whether a main-branch push should run production IU Ads deploy (D1 apply + wrangler).
 * Uses content-aware diff review for sensitive paths — file name alone never grants SKIP.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  deployWorkflowDiffIsProductionDeployGateSafe,
  indexProductionDiffWiresCjRoutes,
  testHelperApplyMigrationsDiffIsTestOnlyCj,
  typesTsDiffIsCjOptionalEnvOnly,
  wranglerTomlDiffIsCommentOnly,
} from "./iu-ads-production-deploy-scope-diff-v1.mjs";

const repoRoot = process.env.IU_ADS_SCOPE_REPO_ROOT
  ? path.resolve(process.env.IU_ADS_SCOPE_REPO_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "cloudflare/iu-ads/cj-affiliate-archive-infra-paths.json");

function emit(decision, reason) {
  const line = `IU_ADS_PRODUCTION_DEPLOY=${decision}`;
  console.log(line);
  console.log(`IU_ADS_PRODUCTION_DEPLOY_REASON=${reason}`);
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `${line}\n`);
  }
}

function finish(decision, reason, exitCode = 0) {
  emit(decision, reason);
  process.exit(exitCode);
}

const event = process.env.GITHUB_EVENT_NAME || "local";
if (event === "workflow_dispatch") {
  finish("run", "workflow_dispatch");
}

if (!fs.existsSync(manifestPath)) {
  finish("blocked", "manifest_missing", 1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const cjPaths = manifest.cjInfraOnlyPaths || [];
const deployGateScripts = manifest.deployGateScriptPaths || [];
const cjOptionalEnvFields = manifest.cjOptionalEnvFields || ["ADS_CJ_AFFILIATE_ARCHIVE_ENABLED"];
const productionSensitivePaths = manifest.productionSensitivePaths || [
  "cloudflare/iu-ads/wrangler.toml",
  "cloudflare/iu-ads/src/types.ts",
  ".github/workflows/deploy-iu-ads.yml",
];

function isCjInfraOnlyPath(filePath) {
  for (const p of cjPaths) {
    if (filePath === p || filePath.startsWith(p)) return true;
  }
  return false;
}

function isDeployGateScript(filePath) {
  return deployGateScripts.some((p) => filePath === p || filePath.startsWith(p));
}

function isProductionSensitivePath(filePath) {
  return productionSensitivePaths.some((p) => filePath === p || filePath.startsWith(p));
}

const deployRelevantPrefixes = ["cloudflare/iu-ads/", ".github/workflows/deploy-iu-ads.yml"];

function isDeployRelevant(filePath) {
  return deployRelevantPrefixes.some((p) => filePath === p || filePath.startsWith(p));
}

function isStandardAdsMigrationPath(filePath) {
  return /^cloudflare\/iu-ads\/migrations\/\d/.test(filePath);
}

const sha = process.env.GITHUB_SHA || "HEAD";
const before = process.env.GITHUB_BEFORE || "";
let files = [];
if (process.env.IU_ADS_SCOPE_CHANGED_FILES !== undefined) {
  if (process.env.IU_ADS_SCOPE_CHANGED_FILES === "") {
    finish("blocked", "empty_change_list", 1);
  }
  files = process.env.IU_ADS_SCOPE_CHANGED_FILES.split("|")
    .map((s) => s.trim())
    .filter(Boolean);
} else {
  try {
    if (before && before !== "0000000000000000000000000000000000000000") {
      files = execSync(`git diff --name-only ${before} ${sha}`, { cwd: repoRoot, encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean);
    } else {
      files = execSync("git diff --name-only HEAD^ HEAD", { cwd: repoRoot, encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean);
    }
  } catch {
    finish("blocked", "diff_failed", 1);
  }
}

let fileDiffOverrides = null;
if (process.env.IU_ADS_SCOPE_FILE_DIFFS) {
  try {
    fileDiffOverrides = JSON.parse(process.env.IU_ADS_SCOPE_FILE_DIFFS);
  } catch {
    finish("blocked", "invalid_file_diffs_json", 1);
  }
}

function getUnifiedDiff(filePath) {
  if (fileDiffOverrides && Object.prototype.hasOwnProperty.call(fileDiffOverrides, filePath)) {
    return fileDiffOverrides[filePath];
  }
  const diffBase =
    process.env.IU_ADS_SCOPE_DIFF_BASE ||
    (before && before !== "0000000000000000000000000000000000000000" ? before : "origin/main");
  const diffHead = process.env.IU_ADS_SCOPE_DIFF_HEAD || sha;
  try {
    return execSync(`git diff ${diffBase} ${diffHead} -- "${filePath.replace(/"/g, "")}"`, {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

function runProductionEntryIsolationGuard() {
  execSync(`node "${path.join(repoRoot, "scripts/iu-ads-production-entry-isolation-guard-v1.mjs")}"`, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

const relevant = files.filter(isDeployRelevant);
if (relevant.length === 0) {
  finish("run", "no_deploy_relevant_paths");
}

for (const file of relevant) {
  if (isStandardAdsMigrationPath(file)) {
    finish("run", "standard_d1_migration_changed");
  }
  if (file === "cloudflare/iu-ads/src/index.ts") {
    finish("run", "production_worker_source_changed");
  }
}

for (const file of relevant) {
  if (isDeployGateScript(file)) continue;
  if (isCjInfraOnlyPath(file)) continue;

  const diff = getUnifiedDiff(file);

  if (file === "cloudflare/iu-ads/wrangler.toml") {
    if (!diff || !String(diff).trim()) finish("blocked", "missing_diff_wrangler_toml", 1);
    if (!wranglerTomlDiffIsCommentOnly(diff)) finish("run", "wrangler_toml_production_config");
    continue;
  }

  if (file === "cloudflare/iu-ads/src/types.ts") {
    if (!diff || !String(diff).trim()) finish("blocked", "missing_diff_types_ts", 1);
    if (!typesTsDiffIsCjOptionalEnvOnly(diff, cjOptionalEnvFields)) finish("run", "types_production_env_changed");
    continue;
  }

  if (file === ".github/workflows/deploy-iu-ads.yml") {
    if (!diff || !String(diff).trim()) finish("blocked", "missing_diff_deploy_workflow", 1);
    if (!deployWorkflowDiffIsProductionDeployGateSafe(diff)) finish("run", "deploy_workflow_production_steps_changed");
    continue;
  }

  if (file === "cloudflare/iu-ads/src/index-production.ts") {
    if (indexProductionDiffWiresCjRoutes(diff)) {
      finish("blocked", "production_entry_cj_wiring", 1);
    }
    try {
      runProductionEntryIsolationGuard();
    } catch {
      finish("blocked", "production_entry_isolation_failed", 1);
    }
    continue;
  }

  if (file === "cloudflare/iu-ads/test/helpers/apply-iu-ads-migrations.ts") {
    if (!diff || !String(diff).trim()) finish("blocked", "missing_diff_test_helper", 1);
    if (!testHelperApplyMigrationsDiffIsTestOnlyCj(diff)) finish("run", "test_helper_production_behavior");
    continue;
  }

  if (isProductionSensitivePath(file)) {
    if (!diff || !String(diff).trim()) finish("blocked", "missing_diff_sensitive_path", 1);
    finish("run", "production_sensitive_config_unreviewed");
  }

  finish("run", "production_ads_paths_changed");
}

finish("skip", "infrastructure_no_production_deploy_impact");
