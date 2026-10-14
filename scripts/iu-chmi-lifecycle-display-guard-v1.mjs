#!/usr/bin/env node
/**
 * Regression: CHMI CAP lifecycle filtering (active/future/inactive/cancelled/territory).
 * Uses core module with fixture events — no production feed mutation.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

const coreUrl = pathToFileURL(path.join(REPO, "assets/iu-info-system-core-v1.js")).href;
const core = await import(coreUrl);
const { getChmiWarningLifecycleStatus, isPublicFeedChmiWarning } = core;

const now = Date.parse("2026-10-14T12:00:00.000Z");

function ev(validFrom, validTo, extra) {
  return {
    id: "ie-chmi-v2-guard-fixture",
    sourceId: "chmi",
    status: "aktivni",
    capV2: { msgType: "Alert", temporalState: "active" },
    validFrom,
    validTo,
    ...(extra || {}),
  };
}

const active = ev("2026-10-14T08:00:00Z", "2026-10-15T08:00:00Z");
const future = ev("2026-10-15T08:00:00Z", "2026-10-16T08:00:00Z");
const ended = ev("2026-10-12T08:00:00Z", "2026-10-13T08:00:00Z");
const cancelled = ev("2026-10-14T08:00:00Z", "2026-10-15T08:00:00Z", {
  capV2: { msgType: "Cancel", temporalState: "cancelled" },
  status: "zruseno",
});

must(getChmiWarningLifecycleStatus(active, now) === "ACTIVE", "lifecycle:active");
must(getChmiWarningLifecycleStatus(future, now) === "FUTURE", "lifecycle:future");
must(getChmiWarningLifecycleStatus(ended, now) === "INACTIVE", "lifecycle:ended");
must(getChmiWarningLifecycleStatus(cancelled, now) === "CANCELLED", "lifecycle:cancelled");

must(isPublicFeedChmiWarning(active, now) === true, "public:active");
must(isPublicFeedChmiWarning(future, now) === true, "public:future");
must(isPublicFeedChmiWarning(ended, now) === false, "public:ended_hidden");
must(isPublicFeedChmiWarning(cancelled, now) === false, "public:cancelled_hidden");

const prodVerify = path.join(process.env.TEMP || "/tmp", "iu_chmi_prod_verify.json");
if (fs.existsSync(prodVerify)) {
  try {
    const report = JSON.parse(fs.readFileSync(prodVerify, "utf8"));
    must(typeof report.verdict === "string", "prod_verify:verdict_present");
    if (report.production && report.parser) {
      const stale =
        report.production.generatedAt &&
        Date.parse(report.production.generatedAt) < now - 86400000;
      if (stale && report.verdict === "FAIL") {
        must(report.alarms && report.alarms.length > 0, "prod_verify:stale_feed_alarm");
      }
    }
  } catch (_) {
    must(false, "prod_verify:parse");
  }
}

if (fails.length) {
  console.log("IU_CHMI_LIFECYCLE_DISPLAY_GUARD=FAIL");
  for (const f of fails) console.log(f);
  process.exit(1);
}
console.log("IU_CHMI_LIFECYCLE_DISPLAY_GUARD=PASS");
