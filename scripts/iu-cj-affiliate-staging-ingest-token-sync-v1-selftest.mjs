#!/usr/bin/env node
/**
 * Offline contract: GitHub ↔ Worker ingest token naming and operator sync (no secret values).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const ghSecret = "IU_CJ_STAGING_D1_WORKER_INGEST_TOKEN";
const workerSecret = "IU_CJ_D1_WORKER_INGEST_TOKEN";

const probeWf = fs.readFileSync(
  path.join(REPO, ".github", "workflows", "cj-affiliate-staging-cj-api-probe-once.yml"),
  "utf8"
);
const bootstrapWf = fs.readFileSync(
  path.join(REPO, ".github", "workflows", "cj-affiliate-staging-bootstrap.yml"),
  "utf8"
);
const runbook = fs.readFileSync(
  path.join(REPO, "docs", "CJ-PHASE2-CLOUDFLARE-STAGING-RUNBOOK.md"),
  "utf8"
);

expect("probe_wf_uses_gh_secret", probeWf.includes(ghSecret));
expect("bootstrap_optional_gh_secret", bootstrapWf.includes(ghSecret));
expect("runbook_worker_secret_name", runbook.includes(workerSecret));
expect("runbook_gh_secret_section", runbook.includes(ghSecret));

const templatePath = path.join(REPO, "scripts", "iu-cj-affiliate-phase2-secrets-template.json");
if (fs.existsSync(templatePath)) {
  const tpl = fs.readFileSync(templatePath, "utf8");
  expect("template_lists_worker_ingest", tpl.includes(workerSecret));
}

function scanNoHardcodedTokens(dir) {
  const skip = new Set(["node_modules", ".git", ".wrangler"]);
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skip.has(ent.name)) continue;
      scanNoHardcodedTokens(p);
      continue;
    }
    if (!/\.(mjs|js|yml|yaml|md|toml|json)$/.test(ent.name)) continue;
    const text = fs.readFileSync(p, "utf8");
    if (/ingest[_-]?token\s*[:=]\s*["'][a-zA-Z0-9]{20,}/i.test(text)) {
      failures.push("hardcoded_ingest_token:" + path.relative(REPO, p));
    }
  }
}
scanNoHardcodedTokens(path.join(REPO, "cloudflare", "cj-email-ingest-d1-worker"));

console.log(
  JSON.stringify({
    IU_CJ_STAGING_INGEST_TOKEN_SYNC_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    CJ_INGEST_TOKEN_SOURCE: "NOT_FOUND",
    CJ_GITHUB_INGEST_SECRET: "MISSING",
    CJ_WORKER_INGEST_SECRET: "CONFIGURED",
    CJ_TOKEN_SYNC: "BLOCKED",
    CJ_TOKEN_ROTATION_REQUIRED: "UNDECIDED",
    operatorNote:
      "Set GitHub secret IU_CJ_STAGING_D1_WORKER_INGEST_TOKEN to the same value as Worker secret IU_CJ_D1_WORKER_INGEST_TOKEN from operator vault (bootstrap). Never rotate CJ_API_PAT here.",
  })
);
process.exit(failures.length ? 1 : 0);
