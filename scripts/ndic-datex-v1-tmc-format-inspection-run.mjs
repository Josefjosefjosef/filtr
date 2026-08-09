#!/usr/bin/env node
/**
 * TMC format-inspection entrypoint (shadow-only).
 *
 * --offline-ready: no network; verifies mode + env refuse + stub sanitised report.
 * Live (default): Czech self-hosted only; downloads TMC ZIP via allowlisted HTTPS;
 * peeks allowlisted entries; writes sanitised report ≤64 KiB; never importer/publish.
 *
 * Never logs URL, Authorization, secrets, raw rows, basenames, or absolute paths.
 * Stdout is a minimal envelope only — never the full report.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";
import {
  getNdicDatexV1Config,
  assertAllowedPullUrl,
  NDIC_SYNC_UA,
  DEFAULT_LIMITS,
} from "./ndic-datex-v1/config.mjs";
import {
  createBoundedTempPath,
  streamResponseToFileBounded,
} from "./ndic-datex-v1/bounded-fetch.mjs";
import { DEFAULT_ZIP_LIMITS } from "./ndic-datex-v1/tmc-zip.mjs";
import { runDiskPreflight, measureTaskOwnedBytes, assertNoTestDiskProviderEnv } from "./ndic-datex-v1/disk-preflight.mjs";
import { inspectZipFileCentral } from "./ndic-datex-v1/tmc-archive-stream.mjs";
import {
  assertInspectionProductionSafe,
  serializeInspectionReport,
  INSPECTION_MODE,
  buildCandidateFormatFromCentral,
  inspectTmcZipFormatFromFile,
  PATH_CATEGORY,
  categorizePath,
  INSPECTION_REJECT,
  INSPECTION_OUTCOME,
  REPORT_SAFETY,
  buildStdoutEnvelope,
  finalizeInspectionOutcome,
} from "./ndic-datex-v1/tmc-format-inspection.mjs";

const offlineReady = process.argv.includes("--offline-ready");
const FETCH_TIMEOUT_MS = 120_000;
const ALLOWED_TMC_CONTENT_TYPES = new Set([
  "application/zip",
  "application/octet-stream",
  "application/x-zip-compressed",
  "binary/octet-stream",
  "",
  "unknown",
]);

function wipeTree(p) {
  if (!p) return;
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {}
}

/**
 * Validate+serialize report; write JSON + readiness marker when safe.
 * @returns {{ outFile: string|null, bytes: number, truncated: boolean, outDir: string, reportSafety: string, sanitizedReady: boolean }}
 */
function writeReport(work, report) {
  const outDir = path.join(work, "ndic-inspect-report");
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const markerPath = path.join(outDir, "sanitized_report_ready.marker");
  try {
    fs.unlinkSync(markerPath);
  } catch (_) {}
  try {
    const finalized = finalizeInspectionOutcome({ ...report });
    const { json, truncated, bytes, object } = serializeInspectionReport(finalized);
    const outFile = path.join(outDir, "inspection-report.json");
    fs.writeFileSync(outFile, json, { mode: 0o600 });
    object.reportSafety = REPORT_SAFETY.PASSED;
    const reserialized = serializeInspectionReport(object);
    fs.writeFileSync(outFile, reserialized.json, { mode: 0o600 });
    fs.writeFileSync(markerPath, "true\n", { mode: 0o600 });
    return {
      outFile,
      bytes: reserialized.bytes,
      truncated: reserialized.truncated || truncated,
      outDir,
      reportSafety: REPORT_SAFETY.PASSED,
      sanitizedReady: true,
      object: reserialized.object,
    };
  } catch (e) {
    try {
      fs.unlinkSync(path.join(outDir, "inspection-report.json"));
    } catch (_) {}
    try {
      fs.unlinkSync(markerPath);
    } catch (_) {}
    return {
      outFile: null,
      bytes: 0,
      truncated: false,
      outDir,
      reportSafety: REPORT_SAFETY.FAILED,
      sanitizedReady: false,
      errorCode: e && e.code ? String(e.code) : INSPECTION_REJECT.INTERNAL_ERROR,
      object: null,
    };
  }
}

function emitEnvelope(fields) {
  console.log(JSON.stringify(buildStdoutEnvelope(fields)));
}

function exitForOutcome(outcome, reportSafety) {
  if (outcome === INSPECTION_OUTCOME.SUCCESS && reportSafety === REPORT_SAFETY.PASSED) return 0;
  if (outcome === INSPECTION_OUTCOME.SECURITY_FAILURE || outcome === INSPECTION_OUTCOME.TECHNICAL_FAILURE) return 1;
  // expected_reject / insufficient_evidence → fail-closed but report may still be safe
  return 2;
}

try {
  assertInspectionProductionSafe(process.env);
  assertNoTestDiskProviderEnv(process.env);
} catch (e) {
  console.error(String((e && e.code) || e.message || e));
  process.exit(1);
}

const mode = String(process.env.IU_NDIC_DATEX_V1_MODE || "").trim().toLowerCase();
if (offlineReady) {
  process.env.IU_NDIC_DATEX_V1_MODE = "format_inspection";
} else if (mode !== "format_inspection") {
  console.error("REFUSING_NON_INSPECTION_MODE");
  process.exit(1);
}

const work =
  process.env.IU_NDIC_SHADOW_WORK_DIR ||
  process.env.RUNNER_TEMP ||
  null;
if (!work) {
  console.error("TMC_DISK_WORKDIR_REQUIRED");
  process.exit(1);
}
fs.mkdirSync(work, { recursive: true, mode: 0o700 });

if (offlineReady) {
  if (process.env.RUNNER_ENVIRONMENT === "self-hosted") {
    try {
      assertNdicCzechEgressRunnerOrThrow(process.env);
    } catch (e) {
      console.error(String((e && e.code) || "REFUSING_GITHUB_HOSTED"));
      process.exit(1);
    }
  }
  const report = finalizeInspectionOutcome({
    ok: true,
    mode: INSPECTION_MODE,
    offlineReady: true,
    liveNetworkInspection: false,
    livePathImplemented: true,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
    ...buildCandidateFormatFromCentral({ datFileCount: 0 }),
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
    workDirCategory: categorizePath(work),
    note: "offline_fixtures_only",
    rejectCode: null,
    severity: "insufficient_evidence",
  });
  // Offline stub is intentionally insufficient_evidence (authoritative unverified).
  report.inspectionOutcome = INSPECTION_OUTCOME.INSUFFICIENT_EVIDENCE;
  report.ok = true; // offline-ready probe itself succeeded
  const written = writeReport(work, report);
  emitEnvelope({
    ok: true,
    mode: INSPECTION_MODE,
    inspectionOutcome: INSPECTION_OUTCOME.INSUFFICIENT_EVIDENCE,
    reportSafety: written.reportSafety,
    rejectCode: null,
    reportBytes: written.bytes,
    reportTruncated: written.truncated,
    workDirCategory: report.workDirCategory,
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
    sanitized_report_ready: written.sanitizedReady,
  });
  process.exit(written.sanitizedReady ? 0 : 1);
}

// --- Live path ---
try {
  assertNdicCzechEgressRunnerOrThrow(process.env);
} catch (e) {
  console.error(String((e && e.code) || "REFUSING_GITHUB_HOSTED"));
  process.exit(1);
}

const config = getNdicDatexV1Config(process.env);
if (!config.formatInspection) {
  console.error("REFUSING_NON_INSPECTION_MODE");
  process.exit(1);
}
if (!config.hasTmcCredentials) {
  console.error("TMC_CREDENTIALS_MISSING");
  process.exit(1);
}

let tempDir = null;
let exitCode = 0;
try {
  assertAllowedPullUrl(config.tmcPullUrl);
  const maxBytes = Math.min(
    Number(config.limits.maxResponseBytes) || DEFAULT_LIMITS.maxResponseBytes,
    DEFAULT_ZIP_LIMITS.maxCompressedTotal
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const token = Buffer.from(`${config.tmcPullUser}:${config.tmcPullPass}`, "utf8").toString("base64");
  let res;
  try {
    res = await fetch(config.tmcPullUrl, {
      method: "GET",
      redirect: "error",
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/zip, application/octet-stream, */*;q=0.1",
        "User-Agent": NDIC_SYNC_UA,
      },
    });
  } finally {
    clearTimeout(timer);
  }

  function finishReject(rejectCode, extra = {}) {
    const report = finalizeInspectionOutcome({
      ok: false,
      mode: INSPECTION_MODE,
      rejectCode,
      severity: "archive_reject",
      liveNetworkInspection: true,
      livePathImplemented: true,
      importerActivated: false,
      resolverActivated: false,
      publishActivated: false,
      productionWrite: false,
      authoritativeFormat: "UNVERIFIED",
      authoritativeFormatVerified: false,
      workDirCategory: categorizePath(work),
      ...extra,
    });
    const written = writeReport(work, report);
    emitEnvelope({
      ok: false,
      mode: INSPECTION_MODE,
      inspectionOutcome: report.inspectionOutcome,
      reportSafety: written.reportSafety,
      rejectCode,
      reportBytes: written.bytes,
      reportTruncated: written.truncated,
      workDirCategory: report.workDirCategory,
      authoritativeFormat: "UNVERIFIED",
      authoritativeFormatVerified: false,
      importerActivated: false,
      resolverActivated: false,
      publishActivated: false,
      productionWrite: false,
      sanitized_report_ready: written.sanitizedReady,
    });
    return exitForOutcome(report.inspectionOutcome, written.reportSafety);
  }

  if (res.status === 401 || res.status === 403) {
    process.exit(finishReject("TMC_AUTH_REJECTED"));
  }

  const ct = String(res.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_TMC_CONTENT_TYPES.has(ct)) {
    process.exit(finishReject("TMC_CONTENT_TYPE_REJECTED"));
  }

  const temp = createBoundedTempPath("ndic-inspect-tmc-", { baseDir: work });
  tempDir = temp.dir;
  let streamed;
  try {
    streamed = await streamResponseToFileBounded(res, {
      maxBytes,
      destFile: temp.file,
      signal: ctrl.signal,
    });
  } catch (e) {
    const code = e && e.code === "RESPONSE_TOO_LARGE" ? "TMC_RESPONSE_TOO_LARGE" : INSPECTION_REJECT.INTERNAL_ERROR;
    process.exit(finishReject(code));
  }

  if (!(res.status >= 200 && res.status < 300)) {
    process.exit(finishReject("TMC_HTTP_" + res.status));
  }

  const central = inspectZipFileCentral(temp.file);
  const existingTaskOwnedBytes = measureTaskOwnedBytes(work, work);
  const disk = runDiskPreflight({
    checkDir: work,
    downloadedArchiveBytes: streamed.bytes,
    declaredUncompressedBytes: central.declaredUncompressedTotalBytes || 0,
    largestEntryBytes: central.maxDeclaredUncompressedEntryBytes || 0,
    zipAlreadyOnDisk: true,
    existingTaskOwnedBytes,
  });
  if (!disk.ok) {
    process.exit(
      finishReject(disk.rejectCode || "TMC_DISK_SPACE", {
        diskCheckPathCategory: disk.diskCheckPathCategory,
        filesystemAvailableBytes: disk.filesystemAvailableBytes,
        filesystemRequiredBytes: disk.filesystemRequiredBytes,
      })
    );
  }

  const report = await inspectTmcZipFormatFromFile(temp.file, {
    workDir: work,
    signal: ctrl.signal,
  });
  report.liveNetworkInspection = true;
  report.livePathImplemented = true;
  report.downloadSuccess = true;
  report.downloadedBytes = streamed.bytes;
  report.diskPreflightPassed = true;
  report.importerActivated = false;
  report.resolverActivated = false;
  report.publishActivated = false;
  report.productionWrite = false;
  report.authoritativeFormat = "UNVERIFIED";
  report.authoritativeFormatVerified = false;
  finalizeInspectionOutcome(report);

  const written = writeReport(work, report);
  emitEnvelope({
    ok: report.ok === true,
    mode: INSPECTION_MODE,
    inspectionOutcome: report.inspectionOutcome,
    reportSafety: written.reportSafety,
    rejectCode: report.rejectCode || null,
    reportBytes: written.bytes,
    reportTruncated: written.truncated,
    workDirCategory: report.workDirCategory,
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
    sanitized_report_ready: written.sanitizedReady,
  });
  exitCode = exitForOutcome(report.inspectionOutcome, written.reportSafety);
} catch (e) {
  const code = String((e && e.code) || INSPECTION_REJECT.INTERNAL_ERROR);
  try {
    const report = finalizeInspectionOutcome({
      ok: false,
      mode: INSPECTION_MODE,
      rejectCode: code,
      severity: "internal_failure",
      inspectionOutcome: INSPECTION_OUTCOME.TECHNICAL_FAILURE,
      liveNetworkInspection: true,
      importerActivated: false,
      resolverActivated: false,
      publishActivated: false,
      productionWrite: false,
      authoritativeFormat: "UNVERIFIED",
      authoritativeFormatVerified: false,
      workDirCategory: categorizePath(work),
    });
    report.inspectionOutcome = INSPECTION_OUTCOME.TECHNICAL_FAILURE;
    const written = writeReport(work, report);
    emitEnvelope({
      ok: false,
      mode: INSPECTION_MODE,
      inspectionOutcome: INSPECTION_OUTCOME.TECHNICAL_FAILURE,
      reportSafety: written.reportSafety,
      rejectCode: code,
      reportBytes: written.bytes,
      reportTruncated: written.truncated,
      workDirCategory: report.workDirCategory,
      authoritativeFormat: "UNVERIFIED",
      authoritativeFormatVerified: false,
      importerActivated: false,
      resolverActivated: false,
      publishActivated: false,
      productionWrite: false,
      sanitized_report_ready: written.sanitizedReady,
    });
  } catch (_) {
    console.error(code);
  }
  exitCode = 1;
} finally {
  wipeTree(tempDir);
  try {
    for (const name of fs.readdirSync(work)) {
      if (name === "ndic-inspect-report") continue;
      wipeTree(path.join(work, name));
    }
  } catch (_) {}
}

void fileURLToPath;
process.exit(exitCode);
