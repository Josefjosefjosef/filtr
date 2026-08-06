#!/usr/bin/env node
/** Guard: CHMI + info-events share production writer lock; NDIC staging is isolated. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  NDIC_STAGING_GROUP,
  PRODUCTION_ACTIVATION_GROUP,
  parseConcurrency,
  isStaticSharedWriterGroup,
  hasModeAwareGroupExpression,
  resolveNdicConcurrencyGroup,
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

if (fs.existsSync(ndicPath)) {
  const ndic = fs.readFileSync(ndicPath, "utf8");
  const conc = parseConcurrency(ndic);
  ok("ndic_not_static_shared_whole_wf", !isStaticSharedWriterGroup(conc.groupRaw), conc.groupRaw);
  ok("ndic_mode_aware", hasModeAwareGroupExpression(conc.groupRaw), conc.groupRaw);
  ok("ndic_staging_literal", conc.groupRaw.includes(NDIC_STAGING_GROUP), "staging");
  ok("ndic_active_joins_production", conc.groupRaw.includes(PRODUCTION_ACTIVATION_GROUP), "prod");
  ok("ndic_cancel_false", conc.cancelInProgress === "false", conc.cancelInProgress);
  ok("ndic_shadow_isolated_group", resolveNdicConcurrencyGroup("shadow") === NDIC_STAGING_GROUP, "shadow");
  ok("ndic_active_shared_group", resolveNdicConcurrencyGroup("active") === PRODUCTION_ACTIVATION_GROUP, "active");
}

if (fails.length) {
  console.error("IU_SHARED_WRITER_LOST_UPDATE_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_SHARED_WRITER_LOST_UPDATE_GUARD=PASS");
process.exit(0);
