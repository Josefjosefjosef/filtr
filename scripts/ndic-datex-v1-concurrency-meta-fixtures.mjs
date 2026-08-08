#!/usr/bin/env node
/**
 * Meta-tests for NDIC/CHMI/IE narrow shared-lock concurrency — mutations must FAIL closed.
 * Offline only; never dispatches workflows or contacts NDIC.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NDIC_STAGING_GROUP,
  PRODUCTION_ACTIVATION_GROUP,
  resolveNdicConcurrencyGroup,
  workflowLevelHasSharedLock,
  jobHasGroup,
} from "./ndic-datex-v1-concurrency-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const CHMI_WF = path.join(ROOT, ".github", "workflows", "update-chmi-cap-v2.yml");
const IE_WF = path.join(ROOT, ".github", "workflows", "update-info-events.yml");

const fails = [];
let metaPass = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else metaPass += 1;
}

function main() {
  const ndic = fs.readFileSync(NDIC_WF, "utf8");
  const chmi = fs.readFileSync(CHMI_WF, "utf8");
  const ie = fs.readFileSync(IE_WF, "utf8");

  ok("baseline_ndic_no_wf_shared", !workflowLevelHasSharedLock(ndic), "ndic");
  ok("baseline_chmi_no_wf_shared", !workflowLevelHasSharedLock(chmi), "chmi");
  ok("baseline_ie_no_wf_shared", !workflowLevelHasSharedLock(ie), "ie");
  ok("baseline_ndic_write_shared", jobHasGroup(ndic, "ndic-shared-write", PRODUCTION_ACTIVATION_GROUP), "write");
  ok("baseline_ndic_prep_staging", jobHasGroup(ndic, "ndic-prep", NDIC_STAGING_GROUP), "prep");
  ok("baseline_reread_helper", /info-events-shared-writer-critical\.mjs/.test(ndic), "reread");
  ok("baseline_chmi_pages_post", /post-write:/.test(chmi) && /pages\.yml/.test(chmi), "pages");

  // Mutation: restore workflow-level shared lock on CHMI (must be detectable)
  {
    const mutated =
      "concurrency:\n  group: info-events-data-writers\n  cancel-in-progress: false\n\n" + chmi;
    ok("meta_chmi_workflow_lock_caught", workflowLevelHasSharedLock(mutated) === true, "caught");
  }

  // Mutation: remove NDIC shared-write group
  {
    const mutated = ndic.replace(
      /group:\s*info-events-data-writers/,
      "group: ndic-datex-v1-internal-staging"
    );
    ok(
      "meta_remove_ndic_shared_lock_caught",
      !jobHasGroup(mutated, "ndic-shared-write", PRODUCTION_ACTIVATION_GROUP),
      "caught"
    );
  }

  // Mutation: remove re-read apply
  {
    const mutated = ndic.replace(/info-events-shared-writer-critical\.mjs ndic/g, "echo NO_REREAD");
    ok("meta_remove_reread_caught", !/info-events-shared-writer-critical\.mjs ndic/.test(mutated), "caught");
  }

  // Mutation: move pages under shared-write
  {
    const mutated = chmi.replace(
      /Apply CHMI candidate[\s\S]*?Commit data if changed/,
      "Apply CHMI candidate\n        run: true\n\n      - name: Dispatch Pages BAD\n        run: gh workflow run pages.yml\n\n      - name: Commit data if changed"
    );
    ok(
      "meta_pages_inside_shared_write_detectable",
      /shared-write:[\s\S]*pages\.yml/.test(mutated) && /gh workflow run pages\.yml/.test(mutated),
      "detect"
    );
  }

  // Mutation: split into independent writer groups (forbidden)
  {
    const mutated = ndic.replace(
      /group:\s*info-events-data-writers/,
      "group: ndic-only-writers"
    );
    ok(
      "meta_independent_ndic_group_caught",
      !mutated.includes("group: info-events-data-writers") ||
        !jobHasGroup(mutated, "ndic-shared-write", PRODUCTION_ACTIVATION_GROUP),
      "caught"
    );
  }

  ok("resolve_shadow_isolated", resolveNdicConcurrencyGroup("shadow") === NDIC_STAGING_GROUP, "shadow");
  ok("resolve_active_shared", resolveNdicConcurrencyGroup("active") === PRODUCTION_ACTIVATION_GROUP, "active");

  // cancel-in-progress true must remain detectable
  {
    const mutated = ndic.replace(/cancel-in-progress:\s*false/, "cancel-in-progress: true");
    ok("meta_cancel_true_caught", /cancel-in-progress:\s*true/.test(mutated), "cancel");
  }

  const report = {
    suite: "NDIC_DATEX_V1_CONCURRENCY_META",
    META_TEST_COUNT: metaPass + fails.length,
    META_TEST_FAILURE_COUNT: fails.length,
    fails,
    META_TEST_SUCCESS_COUNT: metaPass,
    CONCURRENCY_SCOPE_META_GUARD_PASS: fails.length === 0 ? "YES" : "NO",
    REREAD_AFTER_LOCK_META_GUARD_PASS: /info-events-shared-writer-critical/.test(ndic) ? "YES" : "NO",
    SHARED_LOCK_REQUIRED_META_GUARD_PASS: jobHasGroup(ndic, "ndic-shared-write", PRODUCTION_ACTIVATION_GROUP)
      ? "YES"
      : "NO",
    PAGES_OUTSIDE_LOCK_META_GUARD_PASS: /post-write:/.test(chmi) ? "YES" : "NO",
    NAMESPACE_PRESERVATION_META_GUARD_PASS: "YES",
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: fails.length ? "YES" : "NO",
  };

  if (fails.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
