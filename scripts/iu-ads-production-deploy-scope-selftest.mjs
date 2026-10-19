#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts/iu-ads-production-deploy-scope-v1.mjs");

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

// D — manual dispatch always runs production deploy path
assertContains(runScope({ GITHUB_EVENT_NAME: "workflow_dispatch" }), "IU_ADS_PRODUCTION_DEPLOY=run");

const cjOnly =
  "cloudflare/iu-ads/migrations-cj-affiliate-archive/0025_affiliate_ad_archive.sql|cloudflare/iu-ads/cj-affiliate-archive-infra-paths.json|cloudflare/iu-ads/src/index-cj-affiliate-archive.ts";

// A — CJ-only infra
assertContains(
  runScope({ GITHUB_EVENT_NAME: "push", IU_ADS_SCOPE_CHANGED_FILES: cjOnly }),
  "IU_ADS_PRODUCTION_DEPLOY=skip"
);

// B — premium / ads worker change
assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/src/index.ts",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

// C — mixed: must RUN (production deploy allowed; CJ routes stay out of index-production bundle)
assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: cjOnly + "|cloudflare/iu-ads/src/admin-premium-selected.ts",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

// E — empty change list on push: fail-open to RUN (never skip on ambiguity)
assertContains(
  runScope({ GITHUB_EVENT_NAME: "push", IU_ADS_SCOPE_CHANGED_FILES: "" }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

// F — wrangler.toml alone in manifest still RUN when paired with non-manifest file
assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/wrangler.toml|cloudflare/iu-ads/src/index.ts",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=run"
);

// F-alt — wrangler.toml ONLY (listed as CJ infra): skip is OK (config comment-only CJ merges)
assertContains(
  runScope({
    GITHUB_EVENT_NAME: "push",
    IU_ADS_SCOPE_CHANGED_FILES: "cloudflare/iu-ads/wrangler.toml",
  }),
  "IU_ADS_PRODUCTION_DEPLOY=skip"
);

execSync(`node "${path.join(repoRoot, "scripts/iu-ads-production-entry-isolation-guard-v1.mjs")}"`, {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: "pipe",
});

console.log("IU_ADS_PRODUCTION_DEPLOY_SCOPE_SELFTEST=OK");
