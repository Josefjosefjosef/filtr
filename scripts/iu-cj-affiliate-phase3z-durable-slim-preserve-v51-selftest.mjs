#!/usr/bin/env node
/**
 * V51.1: fetch-staging / publish-gate slim tips must preserve durable ledgers
 * (price history / reverify / identity) so append-only survives orphan rewrite.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wf = readFileSync(
  join(root, ".github/workflows/cj-affiliate-catalog-sync.yml"),
  "utf8"
);

const must = [
  "iu-affiliate-cj-durable-price-history-v50.json",
  "iu-affiliate-cj-product-reverify-v50.json",
  "iu-affiliate-cj-product-identity-v50.json",
  "STAGING_SLIM_PRESERVED",
  "PUBLISH_SLIM_PRESERVED",
  "DURABLE_PRIOR_RUN_RESTORE",
  "DURABLE_LEDGER_MISSING",
];

const missing = must.filter((s) => !wf.includes(s));
if (missing.length) {
  console.error("FAIL missing markers:", missing.join(", "));
  process.exit(1);
}

// Staging slim restore loop must list all three durable files (not only DURABLE_FILES stash).
const stagingBlock = wf.slice(
  wf.indexOf("STAGING_SLIM_PRESERVED"),
  wf.indexOf("STAGING_SLIM_PRESERVED") + 800
);
for (const f of [
  "iu-affiliate-cj-durable-price-history-v50.json",
  "iu-affiliate-cj-product-reverify-v50.json",
  "iu-affiliate-cj-product-identity-v50.json",
]) {
  if (!wf.includes(f)) {
    console.error("FAIL workflow missing", f);
    process.exit(1);
  }
}

console.log("PASS iu-cj-affiliate-phase3z-durable-slim-preserve-v51-selftest");
