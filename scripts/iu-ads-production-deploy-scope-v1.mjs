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

const event = process.env.GITHUB_EVENT_NAME || "local";
if (event === "workflow_dispatch") {
  emit("run", "workflow_dispatch");
  process.exit(0);
}

if (!fs.existsSync(manifestPath)) {
  emit("run", "manifest_missing_fail_open");
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const cjPaths = manifest.cjInfraOnlyPaths || [];

function isCjInfraOnlyPath(filePath) {
  for (const p of cjPaths) {
    if (filePath === p || filePath.startsWith(p)) return true;
  }
  return false;
}

const deployRelevantPrefixes = ["cloudflare/iu-ads/", ".github/workflows/deploy-iu-ads.yml"];

function isDeployRelevant(filePath) {
  return deployRelevantPrefixes.some((p) => filePath === p || filePath.startsWith(p));
}

const sha = process.env.GITHUB_SHA || "HEAD";
const before = process.env.GITHUB_BEFORE || "";
let files = [];
if (process.env.IU_ADS_SCOPE_CHANGED_FILES) {
  files = process.env.IU_ADS_SCOPE_CHANGED_FILES.split("|").map((s) => s.trim()).filter(Boolean);
} else try {
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
  emit("run", "diff_failed_fail_open");
  process.exit(0);
}

const relevant = files.filter(isDeployRelevant);
if (relevant.length === 0) {
  emit("run", "no_deploy_relevant_paths");
  process.exit(0);
}

const allCjInfra = relevant.every(isCjInfraOnlyPath);
if (allCjInfra) {
  emit("skip", "cj_affiliate_archive_infra_only");
  process.exit(0);
}

emit("run", "production_ads_paths_changed");
process.exit(0);
