#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts/iu-ads-production-deploy-scope-v1.mjs");
const manifest = fs.readFileSync(
  path.join(repoRoot, "cloudflare/iu-ads/cj-affiliate-archive-infra-paths.json"),
  "utf8"
);

function runScope(envExtra) {
  return execSync(`node "${script}"`, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, IU_ADS_SCOPE_REPO_ROOT: repoRoot, ...envExtra },
  });
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
  "cloudflare/iu-ads/migrations-cj-affiliate-archive/0025_affiliate_ad_archive.sql|cloudflare/iu-ads/cj-affiliate-archive-infra-paths.json";
assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: cjOnly,
  }),
  "IU_ADS_PRODUCTION_DEPLOY=skip"
);

assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: cjOnly + "|cloudflare/iu-ads/src/index.ts",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

console.log("IU_ADS_PRODUCTION_DEPLOY_SCOPE_SELFTEST=OK");
