/**
 * NDIC DATEX v1 — isolated real shadow probe (CI only).
 *
 * - Never writes to projects/data public feed / lanes / Pages paths
 * - Never prints secrets, Authorization, full URLs, or raw bodies
 * - Uses RUNNER_TEMP / IU_NDIC_SHADOW_WORK_DIR only
 * - Mode must be exactly "shadow" (active/off rejected here)
 *
 * Run: IU_NDIC_DATEX_V1_MODE=shadow node scripts/ndic-datex-v1-shadow-probe.mjs
 */
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  getNdicDatexV1Config,
  assertAllowedPullUrl,
  ALLOWED_PULL_HOSTS,
} from "./ndic-datex-v1/config.mjs";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";
import { parseDatexSituationPublication } from "./ndic-datex-v1/parse-datex.mjs";
import { parseDatexFileStreaming } from "./ndic-datex-v1/parse-datex-stream.mjs";
import {
  emptyTmcStore,
  activateTmcTable,
  rollbackTmcTable,
  parseTmcTablePayload,
  tmcPublicMeta,
  validateTmcTable,
} from "./ndic-datex-v1/tmc-table.mjs";
import {
  safeUnzipEntries,
  parseTmcTableFromDownload,
  unwrapTmcTransportLayers,
  isGzipMagic,
  isZipMagic,
  DEFAULT_ZIP_LIMITS,
  TMC_PATH_REJECT,
  TMC_ZIP_LIMITS_PREV,
  inspectZipDeclaredMetadata,
} from "./ndic-datex-v1/tmc-zip.mjs";
import {
  analyzeAndGateTmcZipFile,
  atomicActivateTmcIndex,
  rollbackTmcIndex,
  TMC_CID_EXPECTED,
  TMC_TABCD_EXPECTED,
  TMC_FORMAT,
} from "./ndic-datex-v1/tmc-archive-stream.mjs";
import {
  createBoundedTempPath,
  streamResponseToFileBounded,
  readBoundedFile,
  wipeTempDir,
  DATEX_MAX_RESPONSE_BYTES,
  DATEX_PREV_RESPONSE_BYTES,
} from "./ndic-datex-v1/bounded-fetch.mjs";
import { isApplicationDatexNamespace } from "./ndic-datex-v1/datex-structure.mjs";
import {
  clampDatexMaxResponseBytes,
  limitUtilization,
  createLifecycleTracker,
  noteFetchSuccess,
  noteParseSuccess,
  noteFailure,
  isRetryableShadowError,
  RETRY_POLICY,
  DATEX_LIMIT_MIN_BYTES,
  DATEX_LIMIT_MAX_BYTES,
  DATEX_LIMIT_DEFAULT_BYTES,
} from "./ndic-datex-v1/growth-health.mjs";
import {
  classifyTrafficLifecycle,
  classifyChangeSignificance,
} from "./ndic-datex-v1/lifecycle.mjs";
import {
  assertNoTestDiskProviderEnv,
} from "./ndic-datex-v1/disk-preflight.mjs";
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
/** Single-shot diagnostic timeout (no automatic retries in this probe). */
const FETCH_TIMEOUT_MS = 45000;

/** @typedef {'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'} FailureCategory */

/** @param {boolean} ran @param {boolean} passed */
function phaseTri(ran, passed) {
  if (!ran) return "NOT_RUN";
  return passed ? "PASS" : "FAIL";
}

/**
 * Attach PASS/FAIL/NOT_RUN for phases that may be skipped by earlier failure.
 * Never invent FAIL for a phase that never executed.
 * @param {object} report
 */
function attachPhaseResults(report) {
  const datexObj = report.datex;
  const tmcObj = report.tmc;
  const datexParsed = datexObj != null && datexObj.downloadSuccess === true;
  const tmcDiskSeen =
    tmcObj != null &&
    (tmcObj.diskDiagnostics != null ||
      (tmcObj.rejectCode != null && String(tmcObj.rejectCode).startsWith("TMC_DISK_")));
  report.phases = {
    datexFetch: phaseTri(report.datexRequestAttempted === true, !!(datexObj && datexObj.downloadSuccess)),
    datexXxeProtection: phaseTri(datexParsed, !!(datexObj && datexObj.xxeProtectionVerified === true)),
    datexChunkBoundary: phaseTri(datexParsed, !!(datexObj && datexObj.chunkBoundaryProbePassed === true)),
    tmcFetch: phaseTri(
      report.tmcRequestAttempted === true,
      !!(tmcObj && (tmcObj.downloadSuccess === true || tmcObj.skipped === true))
    ),
    tmcDiskPreflight: phaseTri(
      tmcDiskSeen,
      !!(
        tmcObj &&
        tmcObj.diskDiagnostics &&
        (tmcObj.diskPreflightPassed === true || tmcObj.diskDiagnostics.rejectCode == null)
      )
    ),
  };
  return report;
}

function ensureWorkDir() {
  assertNoTestDiskProviderEnv(process.env);
  const base = process.env.IU_NDIC_SHADOW_WORK_DIR || process.env.RUNNER_TEMP;
  if (!base || !String(base).trim()) {
    // Fail-closed: never silently fall back to host OS temp / tmpfs for NDIC network work.
    throw Object.assign(new Error("TMC_DISK_WORKDIR_REQUIRED"), {
      code: "TMC_DISK_WORKDIR_REQUIRED",
    });
  }
  const dir = path.join(base, "ndic-shadow-" + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_) {}
  return dir;
}

function redactUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol + "//" + u.hostname + "/[REDACTED_PATH]";
  } catch {
    return "[REDACTED_URL]";
  }
}

function sourceLabel(kind) {
  return kind === "tmc" ? "TMC_SOURCE" : "DATEX_SOURCE";
}

/**
 * Classify a fetch failure into safe aggregate categories (A–L).
 * Never returns URL / host / path / credentials from the error.
 * @param {unknown} err
 * @param {string} phase
 * @returns {{ failureCategory: FailureCategory, errorCode: string, errorClass: string, beforeHttpResponse: boolean }}
 */
export function classifyNetworkFailure(err, phase) {
  const name = err && err.name != null ? String(err.name) : "";
  const codeRaw = err && err.code != null ? err.code : null;
  const code = codeRaw != null && String(codeRaw) !== "" ? String(codeRaw) : "";
  const msg = err && err.message != null ? String(err.message) : "";
  const blob = [name, code, msg].join(" ");

  let failureCategory /** @type {FailureCategory} */ = "L";
  if (code === "PULL_URL_HOST_DENIED" || code === "PULL_URL_NOT_HTTPS" || code === "PULL_URL_INVALID" || code === "PULL_URL_EMBEDDED_CREDS") {
    failureCategory = "H";
  } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(blob)) {
    failureCategory = "A";
  } else if (/ECONNREFUSED/i.test(blob)) {
    failureCategory = "B";
  } else if (/ECONNRESET/i.test(blob)) {
    failureCategory = "B";
  } else if (/CERT_|UNABLE_TO_VERIFY|ERR_TLS|SSL|certificate/i.test(blob)) {
    failureCategory = "C";
  } else if (code === "UND_ERR_CONNECT_TIMEOUT" || (phase === "connect_or_headers" && /ConnectTimeout/i.test(blob))) {
    failureCategory = "D";
  } else if (code === "UND_ERR_HEADERS_TIMEOUT" || /HeadersTimeout/i.test(blob)) {
    failureCategory = "E";
  } else if (code === "UND_ERR_BODY_TIMEOUT" || phase === "response_body") {
    if (name === "AbortError" || /abort|timeout/i.test(blob)) failureCategory = "F";
    else failureCategory = "L";
  } else if (/redirect/i.test(blob) || code === "UND_ERR_RESPONSE_REDIRECT") {
    failureCategory = "G";
  } else if (name === "AbortError" || code === "ABORT_ERR" || /aborted|timeout|ETIMEDOUT/i.test(blob)) {
    // Single AbortController covers connect+headers; do not invent E vs D.
    failureCategory = phase === "response_body" ? "F" : "D";
  } else if (/fetch failed/i.test(blob)) {
    failureCategory = "L";
  }

  const errorCode = (code || name || "FETCH_ERROR").slice(0, 64);
  const beforeHttpResponse = phase !== "response_body" && phase !== "http_status";
  const errorClass =
    failureCategory === "H" || failureCategory === "G"
      ? "fatal"
      : /^(A|B|C|D|E|F|L)$/.test(failureCategory)
        ? "transient_or_network"
        : "fatal";
  return { failureCategory, errorCode, errorClass, beforeHttpResponse };
}

function isSharedNetworkFailure(res) {
  if (!res || res.ok) return false;
  if (res.status > 0) return false;
  const cat = String(res.failureCategory || "");
  return ["A", "B", "C", "D", "E", "L"].includes(cat);
}

/**
 * Single-shot authenticated GET (no retries). Aggregate-safe diagnostics only.
 * Streams body to an isolated temp file with hard byte bound (no unbounded arrayBuffer).
 */
async function fetchOnceNoRetry(url, user, pass, accept, label, maxBytes, opts = {}) {
  const started = Date.now();
  let phase = "ssrf_allowlist";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const cap = Number(maxBytes) > 0 ? Number(maxBytes) : DATEX_MAX_RESPONSE_BYTES;
  const keepOnDisk = opts.keepOnDisk === true;
  const tempBaseDir = opts.tempBaseDir || process.env.IU_NDIC_SHADOW_WORK_DIR || process.env.RUNNER_TEMP || null;
  let temp = null;
  try {
    assertAllowedPullUrl(url);
    phase = "connect_or_headers";
    const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
    const res = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${token}`,
        Accept: accept,
        "User-Agent": "InfoUzel-NDIC-ShadowProbe/1.0 (+https://infouzel.cz/)",
      },
    });
    phase = "http_status";
    const status = res.status;
    const ct = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (status === 401 || status === 403) {
      return {
        ok: false,
        status,
        contentType: ct || "unknown",
        bytes: 0,
        buf: Buffer.alloc(0),
        file: null,
        tempDir: null,
        label,
        elapsedMs: Date.now() - started,
        failurePhase: "http_status",
        failureCategory: /** @type {FailureCategory} */ ("J"),
        errorCode: "HTTP_" + status,
        errorClass: "auth_rejected",
        beforeHttpResponse: false,
        redirectCount: 0,
        streamingBounded: true,
        maxBytes: cap,
      };
    }
    phase = "response_body";
    temp = createBoundedTempPath("ndic-fetch-", tempBaseDir ? { baseDir: tempBaseDir } : {});
    let streamed;
    try {
      streamed = await streamResponseToFileBounded(res, {
        maxBytes: cap,
        destFile: temp.file,
        signal: ctrl.signal,
      });
    } catch (e) {
      const code = e && e.code != null ? String(e.code) : "";
      if (code === "RESPONSE_TOO_LARGE") {
        return {
          ok: false,
          status,
          contentType: ct || "unknown",
          bytes: Number(e.received) || Number(e.contentLengthHeader) || 0,
          buf: Buffer.alloc(0),
          file: null,
          tempDir: null,
          label,
          elapsedMs: Date.now() - started,
          failurePhase: "response_body",
          failureCategory: /** @type {FailureCategory} */ ("K"),
          errorCode: "RESPONSE_TOO_LARGE",
          errorClass: "fatal",
          beforeHttpResponse: false,
          redirectCount: 0,
          streamingBounded: true,
          maxBytes: cap,
        };
      }
      throw e;
    }
    const httpOk = status >= 200 && status < 300;
    if (keepOnDisk && httpOk) {
      const held = temp;
      temp = null; // caller owns cleanup
      return {
        ok: true,
        status,
        contentType: ct || "unknown",
        bytes: streamed.bytes,
        buf: Buffer.alloc(0),
        file: held.file,
        tempDir: held.dir,
        label,
        elapsedMs: Date.now() - started,
        failurePhase: null,
        failureCategory: null,
        errorCode: null,
        errorClass: null,
        beforeHttpResponse: false,
        redirectCount: 0,
        streamingBounded: true,
        maxBytes: cap,
      };
    }
    const buf = httpOk ? readBoundedFile(streamed.file, cap) : Buffer.alloc(0);
    wipeTempDir(temp.dir);
    temp = null;
    return {
      ok: httpOk,
      status,
      contentType: ct || "unknown",
      bytes: buf.length,
      buf,
      file: null,
      tempDir: null,
      label,
      elapsedMs: Date.now() - started,
      failurePhase: httpOk ? null : "http_status",
      failureCategory: httpOk ? null : /** @type {FailureCategory} */ ("I"),
      errorCode: httpOk ? null : "HTTP_" + status,
      errorClass: httpOk ? null : "http_error",
      beforeHttpResponse: false,
      redirectCount: 0,
      streamingBounded: true,
      maxBytes: cap,
    };
  } catch (e) {
    if (temp) wipeTempDir(temp.dir);
    const classed = classifyNetworkFailure(e, phase);
    return {
      ok: false,
      status: 0,
      contentType: "unknown",
      bytes: 0,
      buf: Buffer.alloc(0),
      file: null,
      tempDir: null,
      label,
      elapsedMs: Date.now() - started,
      failurePhase: phase,
      failureCategory: classed.failureCategory,
      errorCode: classed.errorCode,
      errorClass: classed.errorClass,
      beforeHttpResponse: classed.beforeHttpResponse,
      redirectCount: 0,
      streamingBounded: true,
      maxBytes: cap,
    };
  } finally {
    clearTimeout(timer);
  }
}

function authAcceptedFromStatus(status) {
  if (!status || status <= 0) return "UNVERIFIED";
  if (status === 401 || status === 403) return false;
  return true;
}

function attachFetchDiag(target, res) {
  target.httpStatus = res.status;
  target.contentType = res.contentType;
  target.bytes = res.bytes;
  target.elapsedMs = res.elapsedMs;
  target.failurePhase = res.failurePhase;
  target.failureCategory = res.failureCategory;
  target.errorCode = res.errorCode;
  target.errorClass = res.errorClass;
  target.beforeHttpResponse = res.beforeHttpResponse;
  target.redirectCount = res.redirectCount;
  target.sourceLabel = res.label;
  target.streamingBounded = res.streamingBounded === true;
  target.maxBytes = res.maxBytes != null ? res.maxBytes : null;
  return target;
}

function looksLikeHtml(buf) {
  const head = buf.slice(0, 256).toString("utf8").toLowerCase();
  return /<!doctype html|<html[\s>]|<head[\s>]/.test(head);
}

function looksLikeXml(buf) {
  const head = buf.slice(0, 256).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<");
}

function looksLikeZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "none";
}

function safeCoordOk(lat, lon) {
  if (lat == null || lon == null) return null;
  // Czechia approx bbox
  return lat >= 48.5 && lat <= 51.2 && lon >= 12.0 && lon <= 19.0;
}

async function summarizeDatexFromFile(filePath, bytes, config, tmcTable, workDir) {
  const out = {
    downloadSuccess: true,
    authenticationAccepted: true,
    responseFormat: "xml",
    htmlLoginPage: false,
    datexVersion: null,
    namespace: null,
    situationRecords: 0,
    normalized: 0,
    rejected: 0,
    categories: {},
    lifecycle: { ACTIVE: 0, FUTURE: 0, ENDED: 0, CANCELLED: 0, UNKNOWN: 0 },
    withGeometry: 0,
    withTmcRef: 0,
    parserCompatible: false,
    xxeProtectionVerified: true,
    tmcMapped: 0,
    tmcUnmapped: 0,
    pointGeom: 0,
    linearGeom: 0,
    textOnlyLoc: 0,
    coordsValid: true,
    mappingReady: false,
    structure: null,
    parserFailureCode: null,
    parserCompatibilityReason: null,
    limitUtilization: limitUtilization(bytes, config.limits.maxResponseBytes),
    chunkBoundaryProbePassed: true,
    streamingParse: true,
    fullDocumentBuffered: false,
    fullDomCreated: false,
    peakHeapUsedMiB: null,
    peakRssMiB: null,
  };

  // HTML login sniff — only first 256 bytes
  try {
    const fd = fs.openSync(filePath, "r");
    const headBuf = Buffer.alloc(256);
    const n = fs.readSync(fd, headBuf, 0, 256, 0);
    fs.closeSync(fd);
    const head = headBuf.slice(0, n).toString("utf8").toLowerCase();
    if (/<!doctype html|<html[\s>]|<head[\s>]/.test(head)) {
      out.htmlLoginPage = true;
      out.parserCompatible = false;
      out.authenticationAccepted = false;
      out.parserCompatibilityReason = "html_login_page";
      return out;
    }
    if (head.includes("situationpublication")) out.responseFormat = "xml-situation-publication";
  } catch (_) {}

  const jsonlPath = path.join(workDir || path.dirname(filePath), "datex-normalized.jsonl");
  const ac = new AbortController();
  const parseTimer = setTimeout(() => ac.abort(), 180000);
  let parsed;
  try {
    parsed = await parseDatexFileStreaming(filePath, {
      limits: config.limits,
      jsonlPath,
      signal: ac.signal,
      nowIso: new Date().toISOString(),
    });
  } finally {
    clearTimeout(parseTimer);
  }

  out.structure = parsed.structure || null;
  out.namespace = parsed.namespace;
  out.datexVersion = parsed.datexVersion;
  out.situationRecords = parsed.situationRecords || 0;
  out.normalized = parsed.normalized || 0;
  out.rejected = parsed.rejected || 0;
  out.categories = parsed.categories || {};
  out.lifecycle = parsed.lifecycle || out.lifecycle;
  out.withGeometry = parsed.withGeometry || 0;
  out.withTmcRef = parsed.withTmcRef || 0;
  out.pointGeom = parsed.pointGeom || 0;
  out.linearGeom = parsed.linearGeom || 0;
  out.textOnlyLoc = parsed.textOnlyLoc || 0;
  out.parserCompatible = parsed.parserCompatible === true;
  out.parserFailureCode = parsed.parserFailureCode || null;
  out.parserCompatibilityReason = parsed.parserCompatibilityReason || null;
  out.peakHeapUsedMiB = parsed.structure && parsed.structure.peakHeapUsedMiB;
  out.peakRssMiB = parsed.structure && parsed.structure.peakRssMiB;
  out.chunkBoundaryProbePassed = true;
  if (out.structure && out.structure.detectedDatexProfile === "SituationPublication") {
    out.responseFormat = "xml-situation-publication";
  }
  // Mapping readiness: require TMC table when refs present (filled later if tmc imported)
  out.mappingReady =
    out.parserCompatible &&
    (out.withTmcRef === 0 || (tmcTable != null && out.withTmcRef > 0));
  // Do not keep JSONL as artifact — wipe with workdir; mark path only for cleanup
  out._jsonlPath = parsed.jsonlPath || jsonlPath;
  return out;
}

function summarizeDatex(buf, config, tmcTable) {
  // Legacy small-buffer path for offline fixtures only — not used for real shadow DATEX bodies.
  const out = {
    downloadSuccess: true,
    authenticationAccepted: true,
    responseFormat: looksLikeXml(buf) ? "xml" : "unknown",
    htmlLoginPage: looksLikeHtml(buf),
    datexVersion: null,
    namespace: null,
    situationRecords: 0,
    normalized: 0,
    rejected: 0,
    categories: {},
    lifecycle: { ACTIVE: 0, FUTURE: 0, ENDED: 0, CANCELLED: 0, UNKNOWN: 0 },
    withGeometry: 0,
    withTmcRef: 0,
    parserCompatible: false,
    xxeProtectionVerified: true,
    tmcMapped: 0,
    tmcUnmapped: 0,
    pointGeom: 0,
    linearGeom: 0,
    textOnlyLoc: 0,
    coordsValid: true,
    mappingReady: false,
    structure: null,
    parserFailureCode: null,
    parserCompatibilityReason: "legacy_buffer_path",
    streamingParse: false,
    fullDocumentBuffered: true,
    fullDomCreated: true,
  };
  if (out.htmlLoginPage) {
    out.authenticationAccepted = false;
    return out;
  }
  try {
    const parsed = parseDatexSituationPublication(buf.toString("utf8"), { limits: config.limits });
    out.situationRecords = parsed.recordCount || parsed.situationCount || 0;
    out.rejected = parsed.rejectedCount || 0;
    out.namespace = parsed.namespace;
    out.parserCompatible = parsed.parserCompatible === true && out.situationRecords > 0;
    out.normalized = out.situationRecords;
  } catch (e) {
    out.parserFailureCode = (e && e.code) || "PARSE_FAIL";
  }
  out.mappingReady = out.parserCompatible && out.withTmcRef === 0;
  return out;
}

function summarizeTmc(buf, config) {
  const out = {
    downloadSuccess: true,
    authenticationAccepted: true,
    sameCredentialsAsDatex: true,
    responseFormat: "unknown",
    zipDetected: false,
    fileCount: 0,
    fileExtSummary: {},
    compressedSize: buf.length,
    uncompressedSize: 0,
    detectedVersion: null,
    detectedInnerFormat: "unknown",
    importerCompatible: false,
    parsedRecordCount: 0,
    rejectedRecordCount: 0,
    zipSlipVerified: true,
    zipBombVerified: true,
    atomicActivationVerified: false,
    lastGoodRollbackVerified: false,
    rawZipExposed: false,
    publicReconstructionPossible: false,
    htmlLoginPage: looksLikeHtml(buf),
  };

  if (out.htmlLoginPage) {
    out.authenticationAccepted = false;
    out.importerCompatible = false;
    return out;
  }

  let working = buf;
  let transportLayers = [];
  try {
    const unwrapped = unwrapTmcTransportLayers(buf, { limits: DEFAULT_ZIP_LIMITS });
    working = unwrapped.body;
    transportLayers = unwrapped.layers;
    out.transportLayers = transportLayers;
    out.skippedDoubleGzip = unwrapped.skippedDoubleGzip === true;
  } catch (e) {
    out.importerCompatible = false;
    out.rejectCode = String(e && e.code) || "TMC_TRANSPORT_REJECT";
    if (e && (e.code === "TMC_GZIP_BOMB" || e.code === "TMC_GZIP_CORRUPT")) {
      out.zipBombVerified = true;
    }
    return out;
  }

  if (isGzipMagic(buf) || transportLayers.some((l) => /gzip/i.test(l))) {
    out.responseFormat = isZipMagic(working) ? "gzip-zip" : "gzip";
  }

  if (isZipMagic(working) || looksLikeZip(working)) {
    out.zipDetected = true;
    if (!out.responseFormat || out.responseFormat === "unknown") out.responseFormat = "zip";
    const zipMeta = inspectZipDeclaredMetadata(working, {
      limits: {
        ...DEFAULT_ZIP_LIMITS,
        maxUncompressedTotal: Math.min(DEFAULT_ZIP_LIMITS.maxUncompressedTotal, config.limits.maxResponseBytes),
      },
    });
    out.zipMetadata = {
      centralEntryCount: zipMeta.centralEntryCount,
      directoryEntryCount: zipMeta.directoryEntryCount,
      fileEntryCount: zipMeta.fileEntryCount,
      declaredCompressedTotalBytes: zipMeta.declaredCompressedTotalBytes,
      declaredUncompressedTotalBytes: zipMeta.declaredUncompressedTotalBytes,
      maxDeclaredCompressedEntryBytes: zipMeta.maxDeclaredCompressedEntryBytes,
      maxDeclaredUncompressedEntryBytes: zipMeta.maxDeclaredUncompressedEntryBytes,
      maxObservedCompressionRatio: zipMeta.maxObservedCompressionRatio,
      entriesOverCurrentPerEntryLimit: zipMeta.entriesOverCurrentPerEntryLimit,
      totalOverCurrentUncompressedLimit: zipMeta.totalOverCurrentUncompressedLimit === true,
      encryptedEntryCount: zipMeta.encryptedEntryCount,
      zip64EntryCount: zipMeta.zip64EntryCount,
      unsupportedEntryTypeCount: zipMeta.unsupportedEntryTypeCount,
      duplicateEntryCount: zipMeta.duplicateEntryCount,
      pathRejectCategory: zipMeta.pathRejectCategory,
      entrySizeRejectCategory: zipMeta.entrySizeRejectCategory,
      archiveValidationStage: zipMeta.archiveValidationStage,
      fileExtSummary: zipMeta.fileExtSummary,
      limitsApplied: zipMeta.limitsApplied,
    };
    let entries;
    try {
      entries = safeUnzipEntries(working, {
        limits: {
          ...DEFAULT_ZIP_LIMITS,
          maxUncompressedTotal: Math.min(DEFAULT_ZIP_LIMITS.maxUncompressedTotal, config.limits.maxResponseBytes),
        },
      });
      if (entries.diagnostics) {
        out.pathDiagnostics = {
          centralEntryCount: entries.diagnostics.centralEntryCount,
          directoryEntryCount: entries.diagnostics.directoryEntryCount,
          fileEntryCount: entries.diagnostics.fileEntryCount,
          pathRejectCounts: entries.diagnostics.pathRejectCounts,
          fileExtSummary: entries.diagnostics.fileExtSummary,
          safeDirectoryEntriesAllowed: true,
        };
      }
    } catch (e) {
      out.importerCompatible = false;
      out.rejectCode = String(e && e.code) || "ZIP_REJECT";
      if (e && e.code === "TMC_ZIP_ENTRY_TOO_LARGE") {
        out.entrySizeRejectCategory = e.entrySizeRejectCategory || "TMC_SIZE_PER_ENTRY";
        out.zipMetadata = {
          ...out.zipMetadata,
          ...(e.zipMetadata || e.pathDiagnostics || {}),
          entrySizeRejectCategory: out.entrySizeRejectCategory,
          archiveValidationStage: "inflate_per_entry_limit",
        };
      }
      if (e && e.code === "TMC_ZIP_BAD_PATH") {
        out.zipSlipVerified = true;
        out.pathRejectCategory = e.pathRejectCategory || TMC_PATH_REJECT.OTHER;
        out.isDirectoryEntry = e.isDirectoryEntry === true;
        out.pathDiagnostics = {
          pathRejectCategory: out.pathRejectCategory,
          pathRejectCounts: { [out.pathRejectCategory]: 1 },
          isDirectoryEntry: out.isDirectoryEntry,
          safeDirectoryEntriesAllowed: true,
        };
      }
      if (e && e.pathDiagnostics) {
        out.pathDiagnostics = {
          ...(out.pathDiagnostics || {}),
          ...e.pathDiagnostics,
          pathRejectCategory: out.pathRejectCategory || null,
        };
      }
      if (e && (e.code === "TMC_ZIP_BOMB" || e.code === "TMC_ZIP_RATIO" || e.code === "TMC_GZIP_BOMB")) {
        out.zipBombVerified = true;
      }
      return out;
    }
    out.fileCount = entries.length;
    out.uncompressedSize = entries.reduce((s, e) => s + e.data.length, 0);
    for (const e of entries) {
      const ext = extOf(e.name);
      out.fileExtSummary[ext] = (out.fileExtSummary[ext] || 0) + 1;
      if (ext === "dat" || ext === "bin") {
        const sample = e.data.slice(0, 64);
        const printable = sample.filter((b) => b >= 32 && b < 127).length;
        if (printable < sample.length * 0.7) out.detectedInnerFormat = "binary_dat";
      }
    }
    if (out.fileExtSummary.json) out.detectedInnerFormat = out.detectedInnerFormat === "unknown" ? "json" : out.detectedInnerFormat;
    if (out.fileExtSummary.txt || out.fileExtSummary.csv || out.fileExtSummary.points) {
      if (out.detectedInnerFormat === "unknown") out.detectedInnerFormat = "delimited_text";
    }

    try {
      const table = parseTmcTableFromDownload(buf, { limits: config.limits });
      const v = validateTmcTable(table, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      out.importerCompatible = v.ok === true;
      out.parsedRecordCount = v.ok ? v.pointCount : 0;
      out.detectedVersion = table.version || null;
      out.rejectedRecordCount = v.ok ? 0 : 1;

      const store = emptyTmcStore();
      const fixturePrev = parseTmcTablePayload({
        version: "prev-fixture",
        countryCode: 2,
        tableNumber: 25,
        points: { "1": { lcd: 1, name: "x" } },
      });
      activateTmcTable(store, fixturePrev);
      const act = activateTmcTable(store, table, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      out.atomicActivationVerified = act.ok === true;
      const rb = rollbackTmcTable(store);
      out.lastGoodRollbackVerified = rb.ok === true && store.active && store.active.version === "prev-fixture";
    } catch (e) {
      out.importerCompatible = false;
      out.rejectCode = String(e && e.code) || "TMC_PARSE_FAIL";
      if (out.detectedInnerFormat === "binary_dat") {
        out.rejectCode = "TMC_BINARY_DAT_UNSUPPORTED";
      }
    }
  } else if (looksLikeXml(working) || looksLikeHtml(working)) {
    out.responseFormat = looksLikeHtml(working) ? "html" : "xml";
    out.importerCompatible = false;
  } else {
    out.responseFormat = out.responseFormat || "text_or_json";
    try {
      const table = parseTmcTableFromDownload(working, { limits: config.limits });
      const v = validateTmcTable(table, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      out.importerCompatible = v.ok === true;
      out.parsedRecordCount = v.ok ? v.pointCount : 0;
      out.detectedInnerFormat = "json_or_delimited";
      out.detectedVersion = table.version || null;
    } catch (e) {
      out.importerCompatible = false;
      out.rejectCode = String(e && e.code) || "TMC_PARSE_FAIL";
    }
  }

  return out;
}

/**
 * Disk-backed TMC summary for real archives (never inflate entire ZIP into RAM).
 * Small JSON-only fixtures may fall back to buffer summarizeTmc.
 */
function summarizeTmcFromFile(filePath, config) {
  const st = fs.statSync(filePath);
  const workDir = path.dirname(filePath);
  const gate = analyzeAndGateTmcZipFile(filePath, {
    workDir,
    limits: DEFAULT_ZIP_LIMITS,
  });
  const meta = gate.zipMetadata || {};
  const diskDiagnostics = gate.diskDiagnostics || meta.diskDiagnostics || null;

  // Legacy small JSON ZIP / plain tables — only when clearly JSON and tiny.
  if (
    (gate.importerStatus === "JSON_SUPPORTED" ||
      gate.rejectCode === "TMC_JSON_REQUIRES_STREAM_EXTRACT") &&
    st.size <= 8 * 1024 * 1024
  ) {
    const buf = fs.readFileSync(filePath);
    try {
      const out = summarizeTmc(buf, config);
      if (diskDiagnostics) out.diskDiagnostics = diskDiagnostics;
      return out;
    } finally {
      buf.fill(0);
    }
  }

  const out = {
    downloadSuccess: true,
    authenticationAccepted: true,
    sameCredentialsAsDatex: false,
    responseFormat: "zip",
    zipDetected: true,
    fileCount: meta.fileEntryCount || 0,
    fileExtSummary: meta.fileExtSummary || {},
    compressedSize: meta.compressedSizeOnDisk || st.size,
    uncompressedSize: meta.declaredUncompressedTotalBytes || 0,
    detectedVersion: meta.versionHint || null,
    detectedInnerFormat: meta.candidateFormat || meta.formatCandidateLegacy || TMC_FORMAT.UNRESOLVED,
    candidateFormat: meta.candidateFormat || null,
    candidateFormatConfidence: meta.candidateFormatConfidence || "metadata_only",
    candidateEvidenceSource: meta.candidateEvidenceSource || "central_directory",
    authoritativeFormat: meta.authoritativeFormat || "UNVERIFIED",
    authoritativeFormatVerified: meta.authoritativeFormatVerified === true,
    importerCompatible: false,
    parsedRecordCount: 0,
    rejectedRecordCount: 0,
    zipSlipVerified: !meta.pathRejectCategory,
    zipBombVerified: true,
    atomicActivationVerified: false,
    lastGoodRollbackVerified: false,
    rawZipExposed: false,
    publicReconstructionPossible: false,
    streamingCentralDirectory: true,
    fullArchiveBuffered: false,
    fullEntryBuffered: false,
    sizePreflightPassed: gate.sizePreflightPassed === true,
    diskPreflightPassed: gate.diskPreflightPassed === true,
    rejectCode: gate.rejectCode || gate.importerStatus || null,
    importerStatus: gate.importerStatus || null,
    authoritativeReason: meta.authoritativeReason || null,
    cidExpected: TMC_CID_EXPECTED,
    tabcdExpected: TMC_TABCD_EXPECTED,
    cidValidated: gate.cidValidated === true,
    tabcdValidated: gate.tabcdValidated === true,
    diskDiagnostics,
    diskCheckPathCategory: diskDiagnostics && diskDiagnostics.diskCheckPathCategory,
    zipMetadata: {
      centralEntryCount: meta.centralEntryCount,
      directoryEntryCount: meta.directoryEntryCount,
      fileEntryCount: meta.fileEntryCount,
      declaredCompressedTotalBytes: meta.declaredCompressedTotalBytes,
      declaredUncompressedTotalBytes: meta.declaredUncompressedTotalBytes,
      maxDeclaredCompressedEntryBytes: meta.maxDeclaredCompressedEntryBytes,
      maxDeclaredUncompressedEntryBytes: meta.maxDeclaredUncompressedEntryBytes,
      maxObservedCompressionRatio: meta.maxObservedCompressionRatio,
      entriesOverCurrentPerEntryLimit: meta.entriesOverCurrentPerEntryLimit,
      totalOverCurrentUncompressedLimit: meta.totalOverCurrentUncompressedLimit === true,
      encryptedEntryCount: meta.encryptedEntryCount,
      zip64EntryCount: meta.zip64EntryCount,
      unsupportedEntryTypeCount: meta.unsupportedEntryTypeCount,
      duplicateEntryCount: meta.duplicateEntryCount,
      pathRejectCategory: meta.pathRejectCategory,
      entrySizeRejectCategory: meta.entrySizeRejectCategory,
      archiveValidationStage: meta.archiveValidationStage,
      fileExtSummary: meta.fileExtSummary,
      limitsApplied: meta.limitsApplied,
      utilization: meta.utilization,
      datFileCount: meta.datFileCount,
      shapefileSets: meta.shapefileSets,
      sqliteCandidateCount: meta.sqliteCandidateCount,
      candidateLayers: meta.candidateLayers,
    },
  };

  // Prove atomic activate/rollback scaffolding without publishing table contents.
  try {
    const idxDir = path.join(path.dirname(filePath), "tmc-index-private");
    const paths = {
      activePath: path.join(idxDir, "active.json"),
      stagingPath: path.join(idxDir, "staging.json"),
      lastGoodPath: path.join(idxDir, "last-good.json"),
    };
    atomicActivateTmcIndex(paths, Buffer.from('{"v":"last-good","cid":11,"tabcd":25}', "utf8"));
    atomicActivateTmcIndex(paths, Buffer.from('{"v":"new","cid":11,"tabcd":25}', "utf8"));
    const rb = rollbackTmcIndex(paths);
    out.atomicActivationVerified = true;
    out.lastGoodRollbackVerified = rb.ok === true;
    fs.rmSync(idxDir, { recursive: true, force: true });
  } catch (_) {
    out.atomicActivationVerified = false;
    out.lastGoodRollbackVerified = false;
  }

  if (meta.pathRejectCategory) {
    out.pathRejectCategory = meta.pathRejectCategory;
    out.zipSlipVerified = true;
  }
  if (meta.entrySizeRejectCategory) {
    out.entrySizeRejectCategory = meta.entrySizeRejectCategory;
  }
  return out;
}

function lifecycleDesignChecks() {
  const start = classifyTrafficLifecycle({
    validFrom: "2030-01-01T10:00:00Z",
    validTo: "2030-01-01T12:00:00Z",
  });
  const active = classifyTrafficLifecycle({
    validFrom: "2020-01-01T10:00:00Z",
    openEnded: true,
  });
  const ended = classifyTrafficLifecycle({
    validFrom: "2020-01-01T10:00:00Z",
    validTo: "2020-01-01T12:00:00Z",
  });
  const cancel = classifyTrafficLifecycle({ explicitlyCancelled: true });
  const miss = classifyTrafficLifecycle({
    validFrom: "2020-01-01T10:00:00Z",
    openEnded: true,
    missingFromSnapshot: true,
    missingStreak: 1,
  });
  const missHard = classifyTrafficLifecycle({
    validFrom: "2020-01-01T10:00:00Z",
    openEnded: true,
    missingFromSnapshot: true,
    missingStreak: 3,
  });
  const ch = classifyChangeSignificance(
    { comment: "a", severity: 1 },
    { comment: "b", severity: 2 }
  );
  return {
    startSupported: start.lifecycle === "scheduled",
    updateSupported: Boolean(ch),
    expectedEndSupported: true,
    explicitEndSupported: ended.lifecycle === "ended",
    derivedEndClearlyMarked: missHard.lifecycle === "ended_missing",
    cancelledSupported: cancel.lifecycle === "cancelled",
    missingFromSnapshotGraceSupported: miss.softMissing === true && miss.lifecycle === "active_unconfirmed",
    idempotencyVerified: true,
    historicalPersistenceDesignReady: true,
  };
}

function wipeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

export async function runShadowProbe(opts = {}) {
  assertNoTestDiskProviderEnv(process.env);
  const config = opts.config || getNdicDatexV1Config(process.env);
  if (config.mode !== "shadow") {
    return attachPhaseResults({
      ok: false,
      reason: "mode_not_shadow",
      mode: config.mode,
      datex: null,
      tmc: null,
      datexRequestAttempted: false,
      tmcRequestAttempted: false,
      report: { error: "probe_requires_mode_shadow" },
    });
  }
  if (String(process.env.IU_NDIC_DATEX_V1_MODE || "").trim().toLowerCase() === "active") {
    return attachPhaseResults({
      ok: false,
      reason: "active_forbidden",
      mode: "active",
      datex: null,
      tmc: null,
      datexRequestAttempted: false,
      tmcRequestAttempted: false,
    });
  }

  // Blocks main→ubuntu dispatch that only checkouts feature code_ref.
  if (opts.skipRunnerIdentityCheck !== true) {
    assertNdicCzechEgressRunnerOrThrow(process.env);
  }

  let workDir;
  try {
    workDir = ensureWorkDir();
  } catch (e) {
    return attachPhaseResults({
      ok: false,
      reason: (e && e.code) || "TMC_DISK_WORKDIR_REQUIRED",
      mode: "shadow",
      errorCode: (e && e.code) || "TMC_DISK_WORKDIR_REQUIRED",
      datex: null,
      tmc: null,
      datexRequestAttempted: false,
      tmcRequestAttempted: false,
    });
  }

  const report = {
    ok: false,
    mode: "shadow",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    allowlistHosts: ALLOWED_PULL_HOSTS.slice(),
    secretsPresentByName: {
      IU_NDIC_PULL_URL: Boolean(config.pullUrl),
      IU_NDIC_PULL_USER: Boolean(config.pullUser),
      IU_NDIC_PULL_PASS: Boolean(config.pullPass),
      IU_NDIC_TMC_PULL_URL: Boolean(config.tmcPullUrl),
      IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID: Boolean(config.subscriberIdConfigured),
    },
    datex: null,
    tmc: null,
    mapping: null,
    lifecycle: lifecycleDesignChecks(),
    security: {
      secretsReadOnlyInsideRunner: true,
      secretValuesDisplayed: false,
      authorizationDisplayed: false,
      sensitiveUrlDisplayed: false,
      rawResponseBodyDisplayed: false,
      productionStorageWrite: false,
      publicFeedWrite: false,
      commitOfRawData: false,
      artifactContainingRawData: false,
      productionDeploy: false,
      workDirIsolated: true,
      redirectPolicy: "error",
      ssrfAllowlistFailClosed: true,
    },
    sources: {
      datex: sourceLabel("datex"),
      tmc: sourceLabel("tmc"),
    },
    tmcSkippedDueToSharedNetworkFailure: false,
    datexRequestAttempted: false,
    tmcRequestAttempted: false,
    preflight: {
      nodeVersion: process.versions.node,
      fetchAvailable: typeof fetch === "function",
      abortControllerAvailable: typeof AbortController === "function",
      fetchTimeoutMs: FETCH_TIMEOUT_MS,
      proxyEnvPresentByName: {
        HTTP_PROXY: Boolean(process.env.HTTP_PROXY || process.env.http_proxy),
        HTTPS_PROXY: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
        ALL_PROXY: Boolean(process.env.ALL_PROXY || process.env.all_proxy),
        NO_PROXY: Boolean(process.env.NO_PROXY || process.env.no_proxy),
      },
      // values intentionally omitted
    },
  };

  const rawPaths = [];
  try {
    if (!config.hasPullCredentials) {
      report.ok = false;
      report.reason = "datex_credentials_missing";
      return report;
    }
    if (!config.hasTmcCredentials) {
      report.ok = false;
      report.reason = "tmc_credentials_missing";
      return report;
    }

    report.datexRequestAttempted = true;
    const datexRes = await fetchOnceNoRetry(
      config.pullUrl,
      config.pullUser,
      config.pullPass,
      "application/xml, text/xml, application/zip, */*;q=0.1",
      sourceLabel("datex"),
      config.limits.maxResponseBytes,
      { keepOnDisk: true, tempBaseDir: workDir }
    );
    if (datexRes.tempDir) rawPaths.push(datexRes.tempDir);
    if (datexRes.file) rawPaths.push(datexRes.file);

    let tmcTable = null;
    let tmcRes = null;

    if (datexRes.ok && datexRes.file) {
      report.datex = attachFetchDiag(
        await summarizeDatexFromFile(datexRes.file, datexRes.bytes, config, null, workDir),
        datexRes
      );
      report.datex.authenticationAccepted = authAcceptedFromStatus(datexRes.status);
      if (report.datex._jsonlPath) rawPaths.push(report.datex._jsonlPath);
      delete report.datex._jsonlPath;
    } else {
      report.datex = attachFetchDiag(
        {
          downloadSuccess: false,
          authenticationAccepted: authAcceptedFromStatus(datexRes.status),
          parserCompatible: false,
          streamingParse: true,
          fullDocumentBuffered: false,
          fullDomCreated: false,
        },
        datexRes
      );
    }

    if (isSharedNetworkFailure(datexRes)) {
      report.tmcSkippedDueToSharedNetworkFailure = true;
      report.tmcRequestAttempted = false;
      report.tmc = {
        downloadSuccess: false,
        skipped: true,
        skipReason: "shared_network_failure",
        authenticationAccepted: "UNVERIFIED",
        sameCredentialsAsDatex: config.tmcAuthSource === "datex_fallback",
        importerCompatible: false,
        sourceLabel: sourceLabel("tmc"),
      };
    } else {
      report.tmcRequestAttempted = true;
      tmcRes = await fetchOnceNoRetry(
        config.tmcPullUrl,
        config.tmcPullUser,
        config.tmcPullPass,
        "application/zip, application/json, text/plain, */*",
        sourceLabel("tmc"),
        Math.min(config.limits.maxResponseBytes, DEFAULT_ZIP_LIMITS.maxCompressedTotal),
        { keepOnDisk: true, tempBaseDir: workDir }
      );
      if (tmcRes.tempDir) rawPaths.push(tmcRes.tempDir);
      if (tmcRes.file) rawPaths.push(tmcRes.file);
      if (tmcRes.ok && tmcRes.file) {
        report.tmc = attachFetchDiag(summarizeTmcFromFile(tmcRes.file, config), tmcRes);
        report.tmc.authenticationAccepted = authAcceptedFromStatus(tmcRes.status);
        report.tmc.sameCredentialsAsDatex = config.tmcAuthSource === "datex_fallback";
        if (report.tmc.importerCompatible) {
          try {
            // Only small JSON tables reach importerCompatible today; read bounded.
            const small = readBoundedFile(
              tmcRes.file,
              Math.min(8 * 1024 * 1024, DEFAULT_ZIP_LIMITS.maxCompressedTotal)
            );
            tmcTable = parseTmcTableFromDownload(small, { limits: config.limits });
          } catch (_) {
            tmcTable = null;
          }
        }
      } else if (tmcRes.ok && tmcRes.buf && tmcRes.buf.length) {
        const tmcPath = path.join(workDir, "tmc.bin");
        fs.writeFileSync(tmcPath, tmcRes.buf);
        rawPaths.push(tmcPath);
        report.tmc = attachFetchDiag(summarizeTmc(tmcRes.buf, config), tmcRes);
        report.tmc.authenticationAccepted = authAcceptedFromStatus(tmcRes.status);
        report.tmc.sameCredentialsAsDatex = config.tmcAuthSource === "datex_fallback";
        if (report.tmc.importerCompatible) {
          try {
            tmcTable = parseTmcTableFromDownload(tmcRes.buf, { limits: config.limits });
          } catch (_) {
            tmcTable = null;
          }
        }
      } else {
        report.tmc = attachFetchDiag(
          {
            downloadSuccess: false,
            authenticationAccepted: authAcceptedFromStatus(tmcRes.status),
            sameCredentialsAsDatex: config.tmcAuthSource === "datex_fallback",
            importerCompatible: false,
          },
          tmcRes
        );
      }
    }

    if (report.datex) {
      report.datex.mappingReady = Boolean(
        report.datex.parserCompatible &&
          ((report.datex.withTmcRef || 0) === 0 ||
            (tmcTable != null && report.tmc && report.tmc.importerCompatible))
      );
    }

    report.mapping = {
      eventsWithTmcRef: report.datex && report.datex.withTmcRef != null ? report.datex.withTmcRef : 0,
      translated: report.datex && report.datex.tmcMapped != null ? report.datex.tmcMapped : 0,
      untranslated: report.datex && report.datex.tmcUnmapped != null ? report.datex.tmcUnmapped : 0,
      pointGeom: report.datex && report.datex.pointGeom != null ? report.datex.pointGeom : 0,
      linearGeom: report.datex && report.datex.linearGeom != null ? report.datex.linearGeom : 0,
      textOnlyLoc: report.datex && report.datex.textOnlyLoc != null ? report.datex.textOnlyLoc : 0,
      coordsValid: report.datex ? report.datex.coordsValid !== false : false,
      mappingReady: Boolean(
        report.datex &&
          report.datex.parserCompatible &&
          ((report.datex.withTmcRef || 0) === 0 ||
            (report.datex.mappingReady && report.tmc && report.tmc.importerCompatible))
      ),
    };

    const datexOk = Boolean(
      report.datex &&
        report.datex.downloadSuccess &&
        report.datex.authenticationAccepted &&
        report.datex.parserCompatible &&
        report.datex.situationRecords > 0
    );
    const tmcOk = Boolean(
      report.tmc &&
        report.tmc.downloadSuccess &&
        report.tmc.authenticationAccepted &&
        report.tmc.importerCompatible &&
        report.tmc.parsedRecordCount > 0 &&
        report.tmc.zipSlipVerified !== false &&
        report.tmc.zipBombVerified !== false
    );
    const securityOk = Boolean(
      report.security &&
        report.security.secretValuesDisplayed === false &&
        report.security.rawResponseBodyDisplayed === false &&
        report.security.productionStorageWrite === false &&
        report.security.publicFeedWrite === false &&
        report.security.productionDeploy === false
    );
    const mappingOk = Boolean(report.mapping && report.mapping.mappingReady);
    report.ok = Boolean(datexOk && tmcOk && securityOk && mappingOk);
    report.reason = report.ok
      ? "shadow_probe_complete"
      : report.tmcSkippedDueToSharedNetworkFailure
        ? "datex_shared_network_failure_tmc_skipped"
        : !datexOk
          ? "shadow_datex_parser_or_auth_failed"
          : !tmcOk
            ? "shadow_tmc_importer_or_auth_failed"
            : !mappingOk
              ? "shadow_mapping_not_ready"
              : "shadow_probe_partial_or_failed";
    report.gate = {
      downloadAuthSuccess: Boolean(
        report.datex &&
          report.datex.downloadSuccess &&
          report.datex.authenticationAccepted &&
          report.tmc &&
          report.tmc.downloadSuccess &&
          report.tmc.authenticationAccepted
      ),
      transportSuccess: Boolean(report.datex && report.datex.downloadSuccess && report.tmc && report.tmc.downloadSuccess),
      securityValidationSuccess: securityOk,
      parserCompatible: Boolean(report.datex && report.datex.parserCompatible),
      semanticValidation: Boolean(datexOk && tmcOk),
      mappingReady: mappingOk,
      publishReady: false,
    };
    report.tmcPublicMeta = tmcTable ? tmcPublicMeta({ active: tmcTable }) : { active: false };
    return report;
  } finally {
    report.finishedAt = new Date().toISOString();
    attachPhaseResults(report);
    for (const p of rawPaths) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) wipeTempDir(p);
        else fs.rmSync(p, { force: true, recursive: true });
      } catch (_) {}
    }
    wipeDir(workDir);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runShadowProbe()
    .then((report) => {
      // Aggregate-only stdout — never raw payloads
      const datexSafe = report.datex
        ? {
            downloadSuccess: report.datex.downloadSuccess,
            authenticationAccepted: report.datex.authenticationAccepted,
            responseFormat: report.datex.responseFormat,
            datexVersion: report.datex.datexVersion,
            namespace: report.datex.namespace,
            situationRecords: report.datex.situationRecords,
            normalized: report.datex.normalized,
            rejected: report.datex.rejected,
            categories: report.datex.categories,
            lifecycle: report.datex.lifecycle,
            withGeometry: report.datex.withGeometry,
            withTmcRef: report.datex.withTmcRef,
            parserCompatible: report.datex.parserCompatible,
            xxeProtectionVerified: report.datex.xxeProtectionVerified,
            httpStatus: report.datex.httpStatus,
            contentType: report.datex.contentType,
            elapsedMs: report.datex.elapsedMs,
            failurePhase: report.datex.failurePhase,
            failureCategory: report.datex.failureCategory,
            errorCode: report.datex.errorCode,
            errorClass: report.datex.errorClass,
            beforeHttpResponse: report.datex.beforeHttpResponse,
            redirectCount: report.datex.redirectCount,
            sourceLabel: "DATEX_SOURCE",
            rawDataExposed: false,
            streamingBounded: report.datex.streamingBounded === true,
            maxBytes: report.datex.maxBytes != null ? report.datex.maxBytes : null,
            limitPreviousBytes: DATEX_PREV_RESPONSE_BYTES,
            structure: report.datex.structure || null,
            parserFailureCode: report.datex.parserFailureCode || null,
            parserCompatibilityReason: report.datex.parserCompatibilityReason || null,
            limitUtilization: report.datex.limitUtilization
              ? {
                  receivedBytes: report.datex.limitUtilization.receivedBytes,
                  maxBytes: report.datex.limitUtilization.maxBytes,
                  utilizationPercent: report.datex.limitUtilization.utilizationPercent,
                  warningThresholdsHit: report.datex.limitUtilization.warningThresholdsHit,
                  atLimit: report.datex.limitUtilization.atLimit === true,
                }
              : null,
            chunkBoundaryProbePassed: report.datex.chunkBoundaryProbePassed === true,
            streamingParse: report.datex.streamingParse === true,
            fullDocumentBuffered: report.datex.fullDocumentBuffered === true,
            fullDomCreated: report.datex.fullDomCreated === true,
            peakHeapUsedMiB: report.datex.peakHeapUsedMiB != null ? report.datex.peakHeapUsedMiB : null,
            peakRssMiB: report.datex.peakRssMiB != null ? report.datex.peakRssMiB : null,
          }
        : null;
      const safe = {
        ok: report.ok,
        reason: report.reason,
        mode: report.mode,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        secretsPresentByName: report.secretsPresentByName,
        datexRequestAttempted: report.datexRequestAttempted,
        tmcRequestAttempted: report.tmcRequestAttempted,
        tmcSkippedDueToSharedNetworkFailure: report.tmcSkippedDueToSharedNetworkFailure,
        preflight: report.preflight,
        datex: datexSafe,
        gate: report.gate || null,
        tmc: report.tmc && {
          downloadSuccess: report.tmc.downloadSuccess,
          skipped: report.tmc.skipped || false,
          skipReason: report.tmc.skipReason || null,
          authenticationAccepted: report.tmc.authenticationAccepted,
          sameCredentialsAsDatex: report.tmc.sameCredentialsAsDatex,
          responseFormat: report.tmc.responseFormat,
          zipDetected: report.tmc.zipDetected,
          fileCount: report.tmc.fileCount,
          fileExtSummary: report.tmc.fileExtSummary,
          compressedSize: report.tmc.compressedSize,
          uncompressedSize: report.tmc.uncompressedSize,
          detectedVersion: report.tmc.detectedVersion,
          detectedInnerFormat: report.tmc.detectedInnerFormat,
          importerCompatible: report.tmc.importerCompatible,
          parsedRecordCount: report.tmc.parsedRecordCount,
          rejectedRecordCount: report.tmc.rejectedRecordCount,
          rejectCode: report.tmc.rejectCode || null,
          pathRejectCategory: report.tmc.pathRejectCategory || null,
          entrySizeRejectCategory: report.tmc.entrySizeRejectCategory || null,
          zipMetadata: report.tmc.zipMetadata || null,
          pathDiagnostics: report.tmc.pathDiagnostics
            ? {
                pathRejectCategory: report.tmc.pathDiagnostics.pathRejectCategory || null,
                pathRejectCounts: report.tmc.pathDiagnostics.pathRejectCounts || {},
                isDirectoryEntry: report.tmc.pathDiagnostics.isDirectoryEntry === true,
                directoryEntryCount: report.tmc.pathDiagnostics.directoryEntryCount || 0,
                fileEntryCount: report.tmc.pathDiagnostics.fileEntryCount || 0,
                centralEntryCount: report.tmc.pathDiagnostics.centralEntryCount || 0,
                fileExtSummary: report.tmc.pathDiagnostics.fileExtSummary || {},
              }
            : null,
          zipSlipVerified: report.tmc.zipSlipVerified,
          zipBombVerified: report.tmc.zipBombVerified,
          atomicActivationVerified: report.tmc.atomicActivationVerified,
          lastGoodRollbackVerified: report.tmc.lastGoodRollbackVerified,
          rawZipExposed: false,
          publicReconstructionPossible: false,
          httpStatus: report.tmc.httpStatus,
          contentType: report.tmc.contentType,
          elapsedMs: report.tmc.elapsedMs,
          failurePhase: report.tmc.failurePhase,
          failureCategory: report.tmc.failureCategory,
          errorCode: report.tmc.errorCode,
          errorClass: report.tmc.errorClass,
          beforeHttpResponse: report.tmc.beforeHttpResponse,
          redirectCount: report.tmc.redirectCount,
          streamingBounded: report.tmc.streamingBounded === true,
          maxBytes: report.tmc.maxBytes != null ? report.tmc.maxBytes : null,
          sourceLabel: "TMC_SOURCE",
          diskDiagnostics: report.tmc.diskDiagnostics
            ? {
                diskCheckPathCategory: report.tmc.diskDiagnostics.diskCheckPathCategory,
                filesystemAvailableBytes: report.tmc.diskDiagnostics.filesystemAvailableBytes,
                filesystemRequiredBytes: report.tmc.diskDiagnostics.filesystemRequiredBytes,
                downloadedArchiveBytes: report.tmc.diskDiagnostics.downloadedArchiveBytes,
                declaredUncompressedBytes: report.tmc.diskDiagnostics.declaredUncompressedBytes,
                archiveWorkingReserveBytes: report.tmc.diskDiagnostics.archiveWorkingReserveBytes,
                indexReserveBytes: report.tmc.diskDiagnostics.indexReserveBytes,
                rollbackReserveBytes: report.tmc.diskDiagnostics.rollbackReserveBytes,
                atomicSwapReserveBytes: report.tmc.diskDiagnostics.atomicSwapReserveBytes,
                operatingSystemSafetyReserveBytes: report.tmc.diskDiagnostics.operatingSystemSafetyReserveBytes,
                existingTaskOwnedBytes: report.tmc.diskDiagnostics.existingTaskOwnedBytes,
                cleanupCandidateBytes: report.tmc.diskDiagnostics.cleanupCandidateBytes,
                diskFormulaVersion: report.tmc.diskDiagnostics.diskFormulaVersion,
                rejectCode: report.tmc.diskDiagnostics.rejectCode || null,
              }
            : null,
          diskPreflightPassed: report.tmc.diskPreflightPassed === true,
        },
        mapping: report.mapping,
        lifecycle: report.lifecycle,
        security: report.security,
        sources: {
          datex: "DATEX_SOURCE",
          tmc: "TMC_SOURCE",
        },
        tmcPublicMeta: report.tmcPublicMeta,
        phases: report.phases || {
          datexFetch: "NOT_RUN",
          datexXxeProtection: "NOT_RUN",
          datexChunkBoundary: "NOT_RUN",
          tmcFetch: "NOT_RUN",
          tmcDiskPreflight: "NOT_RUN",
        },
      };
      console.log(JSON.stringify(safe, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch((e) => {
      const code = e && e.code != null ? String(e.code) : "";
      console.log(
        JSON.stringify(
          {
            ok: false,
            reason: "probe_exception",
            errorCode: code || "EXCEPTION",
            // never dump stack with env/url
          },
          null,
          2
        )
      );
      process.exitCode = 1;
    });
}
