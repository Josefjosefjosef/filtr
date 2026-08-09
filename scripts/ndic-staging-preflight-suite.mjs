#!/usr/bin/env node
/**
 * Run product offline NDIC guards when present on the selected ref.
 * On feature refs the scripts MUST exist (fail-closed).
 * Never contacts NDIC. Never reads secret values.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const scripts = pkg.scripts || {};

const REQUIRED_WHEN_ANY_PRODUCT = [
  "iu-ndic-datex-v1-guard",
  "iu-ndic-datex-v1-exposure-guard",
  "iu-ndic-self-hosted-runner-contract-guard",
  "iu-ndic-github-hosted-access-fixtures",
  "iu-ndic-disk-preflight-fixtures",
  // Armed automatic schedule contract (arming gate, inline preflight, duplicate guard)
  "iu-ndic-automatic-schedule-fixtures",
  "iu-ndic-automatic-schedule-meta-fixtures",
  // POINTS semantic-null / importer gates (fail-closed on feature refs)
  "iu-ndic-tmc-points-empty-field-policy-fixtures",
  "iu-ndic-tmc-basic-importer-fixtures",
  "iu-ndic-shadow-forensic-retention-fixtures",
  "iu-ndic-location-forensic-probe-fixtures",
  "iu-ndic-openlr-fixtures",
  "iu-ndic-remaining-location-gap-fixtures",
  "iu-ndic-location-presentation-policy-fixtures",
  "iu-ndic-traffic-publication-fixtures",
  "iu-ndic-traffic-ui-snapshot-persist-fixtures",
  "iu-ndic-data-pr-rest-runtime-fixtures",
  "iu-data-pr-anti-loop-fixtures",
  "iu-data-pr-anti-loop-meta-fixtures",
  "iu-data-pr-base-freshness-guard",
  "iu-info-events-narrow-shared-lock-fixtures",
  "iu-info-events-shared-writer-starvation-fixtures",
  "iu-info-events-shared-writer-starvation-meta-fixtures",
  "iu-ndic-shared-write-main-checkout-fixtures",
  "iu-ndic-shared-write-main-checkout-meta-fixtures",
  "iu-ndic-active-commit-staging-fixtures",
  "iu-ndic-active-commit-staging-meta-fixtures",
  "iu-traffic-overview-ui-fixtures",
];

const present = REQUIRED_WHEN_ANY_PRODUCT.filter((s) => Boolean(scripts[s]));
const absent = REQUIRED_WHEN_ANY_PRODUCT.filter((s) => !scripts[s]);

// main infra-only checkout may lack product scripts; feature refs must be complete.
const onMainish =
  process.env.GITHUB_REF_NAME === "main" ||
  process.env.IU_NDIC_PREFLIGHT_ALLOW_PARTIAL === "1";

if (present.length === 0) {
  if (onMainish) {
    console.log(JSON.stringify({ ok: true, mode: "infra_partial", present, absent }));
    process.exit(0);
  }
  console.error(JSON.stringify({ ok: false, error: "PRODUCT_GUARDS_MISSING", absent }));
  process.exit(1);
}

if (absent.length && !onMainish) {
  console.error(JSON.stringify({ ok: false, error: "PRODUCT_GUARDS_INCOMPLETE", absent }));
  process.exit(1);
}

for (const name of present) {
  console.log("RUN", name);
  const r = spawnSync("npm", ["run", name], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error("FAILED", name, "status", r.status);
    process.exit(r.status || 1);
  }
}

console.log(JSON.stringify({ ok: true, mode: "product_guards", present }));
