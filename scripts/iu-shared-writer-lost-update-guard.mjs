#!/usr/bin/env node
/**
 * Guard: CHMI + info-events + NDIC share production writer lock only on critical write jobs.
 * NDIC prep stays on staging group; no workflow-level shared lock.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  NDIC_STAGING_GROUP,
  PRODUCTION_ACTIVATION_GROUP,
  resolveNdicConcurrencyGroup,
  workflowLevelHasSharedLock,
  jobHasGroup,
} from "./ndic-datex-v1-concurrency-fixtures.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const ie = fs.readFileSync(path.join(REPO, ".github/workflows/update-info-events.yml"), "utf8");
const chmi = fs.readFileSync(path.join(REPO, ".github/workflows/update-chmi-cap-v2.yml"), "utf8");
const ndicPath = path.join(REPO, ".github/workflows/update-ndic-datex-v1.yml");

ok("ie_group", new RegExp("group:\\s*" + PRODUCTION_ACTIVATION_GROUP).test(ie), "ie");
ok("chmi_group", new RegExp("group:\\s*" + PRODUCTION_ACTIVATION_GROUP).test(chmi), "chmi");
ok("ie_no_cancel", /cancel-in-progress:\s*false/.test(ie), "ieCancel");
ok("chmi_no_cancel", /cancel-in-progress:\s*false/.test(chmi), "chmiCancel");
ok("ie_no_workflow_level_shared_lock", !workflowLevelHasSharedLock(ie), "ieWf");
ok("chmi_no_workflow_level_shared_lock", !workflowLevelHasSharedLock(chmi), "chmiWf");

if (fs.existsSync(ndicPath)) {
  const ndic = fs.readFileSync(ndicPath, "utf8");
  ok("ndic_no_workflow_level_shared_lock", !workflowLevelHasSharedLock(ndic), "ndicWf");
  ok("ndic_prep_staging", jobHasGroup(ndic, "ndic-prep", NDIC_STAGING_GROUP), "prep");
  ok("ndic_write_production", jobHasGroup(ndic, "ndic-shared-write", PRODUCTION_ACTIVATION_GROUP), "write");
  ok("ndic_cancel_false", /cancel-in-progress:\s*false/.test(ndic), "cancel");
  ok("ndic_shadow_isolated_group", resolveNdicConcurrencyGroup("shadow") === NDIC_STAGING_GROUP, "shadow");
  ok("ndic_active_shared_group", resolveNdicConcurrencyGroup("active") === PRODUCTION_ACTIVATION_GROUP, "active");
  ok("ndic_write_not_ubuntu", !/ndic-shared-write:[\s\S]*?runs-on:\s*ubuntu-latest/.test(ndic), "ubuntu");
  ok("ndic_no_ubuntu_latest_job", !/^\s*runs-on:\s*ubuntu-latest\s*$/m.test(ndic), "ubuntuJob");
}

if (fails.length) {
  console.error("IU_SHARED_WRITER_LOST_UPDATE_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_SHARED_WRITER_LOST_UPDATE_GUARD=PASS");
process.exit(0);
