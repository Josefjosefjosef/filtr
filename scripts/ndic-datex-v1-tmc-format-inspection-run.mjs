#!/usr/bin/env node
/**
 * TMC format-inspection entrypoint.
 * --offline-ready: verify mode + env refuse + write sanitised stub report (no NDIC network).
 * Live ZIP inspection requires ops-enabled path + self-hosted CZ runner (not in this prep).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";
import {
  assertInspectionProductionSafe,
  serializeInspectionReport,
  INSPECTION_MODE,
  buildCandidateFormatFromCentral,
  PATH_CATEGORY,
  categorizePath,
} from "./ndic-datex-v1/tmc-format-inspection.mjs";

const offlineReady = process.argv.includes("--offline-ready");

try {
  assertInspectionProductionSafe(process.env);
} catch (e) {
  console.error(String((e && e.code) || e.message || e));
  process.exit(1);
}

const mode = String(process.env.IU_NDIC_DATEX_V1_MODE || "").trim().toLowerCase();
if (offlineReady) {
  // Local/CI offline readiness may run without env mode; force inspection mode.
  process.env.IU_NDIC_DATEX_V1_MODE = "format_inspection";
} else if (mode !== "format_inspection") {
  console.error("REFUSING_NON_INSPECTION_MODE");
  process.exit(1);
}

if (!offlineReady) {
  // Live path reserved for separately approved dispatch with ZIP already on task FS.
  console.error("LIVE_TMC_FORMAT_INSPECTION_NOT_ENABLED");
  process.exit(2);
}

// Offline-ready path: optional identity check skipped when not on runner.
if (process.env.RUNNER_ENVIRONMENT === "self-hosted") {
  try {
    assertNdicCzechEgressRunnerOrThrow(process.env);
  } catch (e) {
    console.error(String((e && e.code) || "REFUSING_GITHUB_HOSTED"));
    process.exit(1);
  }
}

const work =
  process.env.IU_NDIC_SHADOW_WORK_DIR ||
  process.env.RUNNER_TEMP ||
  null;
if (!work) {
  console.error("TMC_DISK_WORKDIR_REQUIRED");
  process.exit(1);
}

const report = {
  ok: true,
  mode: INSPECTION_MODE,
  offlineReady: true,
  liveNetworkInspection: false,
  importerActivated: false,
  resolverActivated: false,
  publishActivated: false,
  productionWrite: false,
  ...buildCandidateFormatFromCentral({ datFileCount: 0 }),
  authoritativeFormat: "UNVERIFIED",
  authoritativeFormatVerified: false,
  workDirCategory: categorizePath(work),
  note: "offline_fixtures_only",
};

const outDir = path.join(work, "ndic-inspect-report");
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
const { json, truncated, bytes } = serializeInspectionReport(report);
const outFile = path.join(outDir, "inspection-report.json");
fs.writeFileSync(outFile, json, { mode: 0o600 });
console.log(
  JSON.stringify({
    ok: true,
    mode: INSPECTION_MODE,
    offlineReady: true,
    reportBytes: bytes,
    reportTruncated: truncated,
    workDirCategory: report.workDirCategory,
    pathCategoryEnum: PATH_CATEGORY,
  })
);

void fileURLToPath;
