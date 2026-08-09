#!/usr/bin/env node
/**
 * Meta/mutation guards for NDIC shared-write two-source model.
 * Offline only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  workflowUsesTwoSourceModel,
  jobBlock,
} from "./ndic-shared-write-two-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const FIX = path.join(ROOT, "scripts", "ndic-shared-write-main-checkout-fixtures.mjs");
const SUITE = path.join(ROOT, "scripts", "ndic-staging-preflight-suite.mjs");
const PKG = path.join(ROOT, "package.json");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

const ndic = fs.readFileSync(NDIC_WF, "utf8");
const write = jobBlock(ndic, "ndic-shared-write");
const suiteSrc = fs.readFileSync(SUITE, "utf8");
const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));

ok("baseline_two_source", workflowUsesTwoSourceModel(ndic));
ok("baseline_feature_checkout", /Checkout feature HEAD orchestration code/.test(write));
ok("baseline_main_checkout", /Checkout latest main shared-state worktree/.test(write));
ok("baseline_helper_from_orch", /ndic-orch\/scripts\/info-events-shared-writer-critical\.mjs\s+ndic/.test(write));
ok("baseline_target_main_data", /ndic-main-data\/projects\/data\/info_events/.test(write));
ok("baseline_reread_after_acquire", /reread after acquire/i.test(write));
ok("baseline_queue_max", /queue:\s*max\b/.test(write));
ok("baseline_shared_lock", /group:\s*info-events-data-writers/.test(write));
ok(
  "suite_wires_main_checkout_fixtures",
  /iu-ndic-shared-write-main-checkout-fixtures/.test(suiteSrc)
);
ok(
  "pkg_has_main_checkout_fixtures",
  Boolean(pkg.scripts && pkg.scripts["iu-ndic-shared-write-main-checkout-fixtures"])
);
ok("fixture_file_exists", fs.existsSync(FIX));

// Mutation: remove feature-code checkout path
{
  const mutated = ndic.replace(/path:\s*ndic-orch\b/g, "path: wiped-orch");
  ok(
    "FEATURE_CODE_SOURCE_META_GUARD_PASS",
    !workflowUsesTwoSourceModel(mutated),
    "caught-orch"
  );
}

// Mutation: helper source back to main workspace scripts/
{
  const mutated = ndic.replace(
    /node ndic-orch\/scripts\/info-events-shared-writer-critical\.mjs ndic/g,
    "node scripts/info-events-shared-writer-critical.mjs ndic"
  );
  ok(
    "MODULE_NOT_FOUND_REGRESSION_META_GUARD_PASS",
    !workflowUsesTwoSourceModel(mutated) &&
      /node\s+scripts\/info-events-shared-writer-critical\.mjs\s+ndic/.test(
        jobBlock(mutated, "ndic-shared-write")
      ),
    "legacy-return"
  );
}

// Mutation: remove main-data path / reread target
{
  const mutated = ndic.replace(/path:\s*ndic-main-data\b/g, "path: wiped-main");
  ok("MAIN_STATE_SOURCE_META_GUARD_PASS", !workflowUsesTwoSourceModel(mutated), "caught-main");
}

// Mutation: remove reread-after-acquire refresh step content
{
  const mutated = ndic.replace(
    /Refresh main tip before shared write \(reread after acquire\)/g,
    "Skip main tip refresh"
  ).replace(/git -C ndic-main-data fetch origin main/g, "echo NO_REREAD");
  ok(
    "REREAD_AFTER_ACQUIRE_META_GUARD_PASS",
    !/reread after acquire/i.test(jobBlock(mutated, "ndic-shared-write")) ||
      !/git -C ndic-main-data fetch origin main/.test(jobBlock(mutated, "ndic-shared-write")),
    "caught-reread"
  );
}

// Mutation: collapse to single checkout-main-overwrite model
{
  const mutated = write
    .replace(/path:\s*ndic-orch\b/g, "")
    .replace(/path:\s*ndic-main-data\b/g, "")
    .replace(
      /node ndic-orch\/scripts\/info-events-shared-writer-critical\.mjs ndic/g,
      "node scripts/info-events-shared-writer-critical.mjs ndic"
    );
  const fake = ndic.replace(write, mutated);
  ok(
    "WORKSPACE_ISOLATION_META_GUARD_PASS",
    !workflowUsesTwoSourceModel(fake),
    "collapse"
  );
}

// Mutation: remove shared lock
{
  const mutated = ndic.replace(
    /group:\s*info-events-data-writers/g,
    "group: ndic-only-no-shared"
  );
  ok(
    "meta_remove_shared_lock_caught",
    !/group:\s*info-events-data-writers/.test(jobBlock(mutated, "ndic-shared-write")),
    "lock"
  );
}

// Mutation: remove queue:max
{
  const mutated = ndic.replace(/queue:\s*max\b/g, "queue: single");
  ok(
    "meta_remove_queue_max_caught",
    !/queue:\s*max\b/.test(jobBlock(mutated, "ndic-shared-write")),
    "qmax"
  );
}

const report = {
  ok: fails.length === 0,
  fails,
  FEATURE_CODE_SOURCE_META_GUARD_PASS: fails.some((f) => f.startsWith("FEATURE_CODE"))
    ? "NO"
    : "YES",
  MAIN_STATE_SOURCE_META_GUARD_PASS: fails.some((f) => f.startsWith("MAIN_STATE"))
    ? "NO"
    : "YES",
  REREAD_AFTER_ACQUIRE_META_GUARD_PASS: fails.some((f) => f.startsWith("REREAD_AFTER"))
    ? "NO"
    : "YES",
  WORKSPACE_ISOLATION_META_GUARD_PASS: fails.some((f) => f.startsWith("WORKSPACE_ISOLATION"))
    ? "NO"
    : "YES",
  MODULE_NOT_FOUND_REGRESSION_META_GUARD_PASS: fails.some((f) =>
    f.startsWith("MODULE_NOT_FOUND_REGRESSION_META")
  )
    ? "NO"
    : "YES",
};
console.log(JSON.stringify(report, null, 2));
if (fails.length) {
  console.error("FAIL:" + fails.join(";"));
  process.exit(1);
}
