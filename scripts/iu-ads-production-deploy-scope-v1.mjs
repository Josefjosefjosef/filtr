#!/usr/bin/env node
/**
 * Decide whether a main-branch push should run production IU Ads deploy (D1 apply + wrangler).
 * CJ affiliate archive infrastructure may land without triggering production deploy.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function isProductionSensitivePath(filePath) {
  return productionSensitivePaths.some((p) => filePath === p || filePath.startsWith(p));
}

const deployRelevantPrefixes = ["cloudflare/iu-ads/", ".github/workflows/deploy-iu-ads.yml"];

function isDeployRelevant(filePath) {
  return deployRelevantPrefixes.some((p) => filePath === p || filePath.startsWith(p));
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

const relevant = files.filter(isDeployRelevant);
if (relevant.length === 0) {
  finish("run", "no_deploy_relevant_paths");
}

if (relevant.some(isProductionSensitivePath)) {
  finish("run", "production_sensitive_config");
}

const allCjInfra = relevant.every(isCjInfraOnlyPath);
if (allCjInfra) {
  finish("skip", "cj_affiliate_archive_infra_only");
}

finish("run", "production_ads_paths_changed");
