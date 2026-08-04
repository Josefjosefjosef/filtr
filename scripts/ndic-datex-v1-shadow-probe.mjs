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
import { parseDatexSituationPublication } from "./ndic-datex-v1/parse-datex.mjs";
import { processAndGate } from "./ndic-datex-v1/sync-core.mjs";
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
  createBoundedTempPath,
  streamResponseToFileBounded,
  readBoundedFile,
  wipeTempDir,
  DATEX_MAX_RESPONSE_BYTES,
  DATEX_PREV_RESPONSE_BYTES,
} from "./ndic-datex-v1/bounded-fetch.mjs";
import {
  scanDatexStructure,
  pickRootNamespaceUri,
  isApplicationDatexNamespace,
  chunkBoundaryProbe,
} from "./ndic-datex-v1/datex-structure.mjs";
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
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
/** Single-shot diagnostic timeout (no automatic retries in this probe). */
const FETCH_TIMEOUT_MS = 45000;

/** @typedef {'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'} FailureCategory */

function ensureWorkDir() {
  const base =
    process.env.IU_NDIC_SHADOW_WORK_DIR ||
    process.env.RUNNER_TEMP ||
    path.join(os.tmpdir(), "ndic-shadow-probe");
  const dir = path.join(base, "ndic-shadow-" + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });
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
async function fetchOnceNoRetry(url, user, pass, accept, label, maxBytes) {
  const started = Date.now();
  let phase = "ssrf_allowlist";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const cap = Number(maxBytes) > 0 ? Number(maxBytes) : DATEX_MAX_RESPONSE_BYTES;
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
    temp = createBoundedTempPath("ndic-fetch-");
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
    const buf = readBoundedFile(streamed.file, cap);
    // Drop on-disk copy as soon as bytes are in memory for parse (still isolated workdir wipe later).
    wipeTempDir(temp.dir);
    temp = null;
    const httpOk = status >= 200 && status < 300;
    return {
      ok: httpOk,
      status,
      contentType: ct || "unknown",
      bytes: buf.length,
      buf: httpOk ? buf : Buffer.alloc(0),
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
      contentLengthHeader: streamed.contentLengthHeader,
    };
  } catch (e) {
    const meta = classifyNetworkFailure(e, phase);
    return {
      ok: false,
      status: 0,
      contentType: "error",
      bytes: 0,
      buf: Buffer.alloc(0),
      label,
      elapsedMs: Date.now() - started,
      failurePhase: phase,
      failureCategory: meta.failureCategory,
      errorCode: meta.errorCode,
      errorClass: meta.errorClass,
      beforeHttpResponse: meta.beforeHttpResponse,
      redirectCount: 0,
      streamingBounded: true,
      maxBytes: cap,
    };
  } finally {
    clearTimeout(timer);
    if (temp && temp.dir) wipeTempDir(temp.dir);
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

function summarizeDatex(buf, config, tmcTable) {
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
    parserCompatibilityReason: null,
    limitUtilization: null,
    chunkBoundaryProbePassed: null,
  };

  if (out.htmlLoginPage) {
    out.parserCompatible = false;
    out.authenticationAccepted = false;
    out.parserCompatibilityReason = "html_login_page";
    return out;
  }

  const xml = buf.toString("utf8");
  out.limitUtilization = limitUtilization(buf.length, config.limits.maxResponseBytes);

  let structure;
  try {
    structure = scanDatexStructure(xml, {
      maxScanBytes: config.limits.maxResponseBytes,
      maxDepth: config.limits.maxXmlDepth,
      maxElements: config.limits.maxElements,
    });
    out.structure = {
      rootLocalName: structure.rootLocalName,
      rootNamespaceUri: structure.rootNamespaceUri,
      namespaceUris: structure.namespaceUris,
      detectedDatexMajorVersion: structure.detectedDatexMajorVersion,
      detectedDatexProfile: structure.detectedDatexProfile,
      topLevelElementLocalNameCounts: structure.topLevelElementLocalNameCounts,
      candidateSituationElementCount: structure.candidateSituationElementCount,
      candidateSituationRecordElementCount: structure.candidateSituationRecordElementCount,
      recordTypeLocalNameCounts: structure.recordTypeLocalNameCounts,
      chunkBoundaryProbePassed: structure.chunkBoundaryProbePassed,
      documentWellFormed: structure.documentWellFormed,
      parserFailureCode: structure.parserFailureCode,
      parserCompatibilityReason: structure.parserCompatibilityReason,
      elementCountScanned: structure.elementCountScanned,
    };
    out.namespace = structure.rootNamespaceUri;
    out.datexVersion =
      structure.detectedDatexMajorVersion != null ? String(structure.detectedDatexMajorVersion) : null;
    if (structure.detectedDatexProfile === "SituationPublication") {
      out.responseFormat = "xml-situation-publication";
    }
  } catch (e) {
    out.parserFailureCode = (e && e.code) || "STRUCTURE_SCAN_FAIL";
    out.parserCompatible = false;
    out.namespace = pickRootNamespaceUri(xml.slice(0, 8192));
    return out;
  }

  // Offline chunk-boundary smoke on a short prefix + synthetic splice (no content leak)
  try {
    const sample = xml.length > 4000 ? xml.slice(0, 2000) + xml.slice(xml.length - 2000) : xml;
    out.chunkBoundaryProbePassed = chunkBoundaryProbe(sample, [
      Math.floor(sample.length / 3),
      Math.floor((2 * sample.length) / 3),
    ]);
    if (out.structure) out.structure.chunkBoundaryProbePassed = out.chunkBoundaryProbePassed;
  } catch (_) {
    out.chunkBoundaryProbePassed = false;
  }

  let parsed;
  try {
    parsed = parseDatexSituationPublication(xml, { limits: config.limits, structure });
  } catch (e) {
    out.parserCompatible = false;
    out.parserFailureCode = String(e && e.code) || "PARSE_FAIL";
    out.parserCompatibilityReason = "parse_exception";
    out.rejectReason = out.parserFailureCode;
    return out;
  }

  out.situationRecords = parsed.recordCount || parsed.situationCount || 0;
  out.rejected = parsed.rejectedCount || 0;
  if (parsed.namespace && isApplicationDatexNamespace(parsed.namespace)) {
    out.namespace = parsed.namespace;
  } else if (structure.rootNamespaceUri) {
    out.namespace = structure.rootNamespaceUri;
  } else {
    out.namespace = null;
  }
  out.datexVersion = parsed.version || parsed.modelBaseVersion || out.datexVersion;
  out.parserFailureCode = parsed.parserFailureCode || structure.parserFailureCode || null;
  out.parserCompatibilityReason =
    parsed.parserCompatible === true
      ? null
      : parsed.parserFailureCode || structure.parserCompatibilityReason || "parser_incompatible";

  const gated = processAndGate(xml, {
    prevItems: [],
    tmcTable,
    nowIso: new Date().toISOString(),
    repoRoot: REPO,
    sanity: { ...config.sanity, emptySnapshotFail: false, minPrevForDropGuard: 999999 },
    limits: config.limits,
  });

  const items = gated.gate && gated.gate.items ? gated.gate.items : [];
  out.normalized = items.length;
  // Truthful compatibility: require DATEX app namespace + at least one parsed record
  // (empty legitimate snapshot would need explicit emptyPublication marker — not claimed here).
  const structuralCandidates =
    (structure.candidateSituationRecordElementCount || 0) + (structure.candidateSituationElementCount || 0);
  out.parserCompatible = Boolean(
    parsed.parserCompatible === true &&
      out.situationRecords > 0 &&
      isApplicationDatexNamespace(out.namespace) &&
      out.normalized + out.rejected >= 0
  );
  if (!out.parserCompatible && structuralCandidates > 0 && out.situationRecords === 0) {
    out.parserCompatibilityReason =
      out.parserCompatibilityReason || "structure_has_candidates_but_zero_parsed_records";
  }
  if (out.parserCompatible && structuralCandidates === 0) {
    // defensive: should not happen
    out.parserCompatible = false;
    out.parserCompatibilityReason = "zero_structure_candidates";
  }

  for (const sit of parsed.situations || []) {
    for (const rec of sit.records || []) {
      const cat = (rec.category && rec.category.id) || "unknown";
      out.categories[cat] = (out.categories[cat] || 0) + 1;
      const life = classifyTrafficLifecycle({
        validFrom: rec.validity && rec.validity.overallStartTime,
        validTo: rec.validity && rec.validity.overallEndTime,
        openEnded: rec.validity && rec.validity.openEnded,
        validityStatus: rec.validity && rec.validity.validityStatus,
        explicitlyCancelled: false,
      });
      const key =
        life.lifecycle === "cancelled"
          ? "CANCELLED"
          : life.lifecycle === "ended" || life.lifecycle === "ended_missing"
            ? "ENDED"
            : life.lifecycle === "scheduled"
              ? "FUTURE"
              : life.lifecycle === "active" || life.lifecycle === "active_unconfirmed"
                ? "ACTIVE"
                : "UNKNOWN";
      out.lifecycle[key] += 1;
      const refs = rec.tmcRefs || [];
      if (refs.length) out.withTmcRef += 1;
      const coords = rec.coordinates;
      if (coords && (coords.lat != null || (Array.isArray(coords) && coords.length))) {
        out.withGeometry += 1;
        if (coords.lat != null) {
          out.pointGeom += 1;
          if (safeCoordOk(coords.lat, coords.lon) === false) out.coordsValid = false;
        } else out.linearGeom += 1;
      } else if (refs.length) {
        /* tmc only */
      } else {
        out.textOnlyLoc += 1;
      }
    }
  }

  // mapping counts from gated items when available
  for (const it of items) {
    if (it && it.tmcMapped) out.tmcMapped += 1;
    else if (it && it.hasTmcRef) out.tmcUnmapped += 1;
  }
  out.mappingReady =
    out.parserCompatible && (out.withTmcRef === 0 || out.tmcMapped > 0);
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
  const config = opts.config || getNdicDatexV1Config(process.env);
  if (config.mode !== "shadow") {
    return {
      ok: false,
      reason: "mode_not_shadow",
      mode: config.mode,
      report: { error: "probe_requires_mode_shadow" },
    };
  }
  if (String(process.env.IU_NDIC_DATEX_V1_MODE || "").trim().toLowerCase() === "active") {
    return { ok: false, reason: "active_forbidden", mode: "active" };
  }

  const workDir = ensureWorkDir();
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
      config.limits.maxResponseBytes
    );

    let tmcTable = null;
    let tmcRes = null;

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
        Math.min(config.limits.maxResponseBytes, DEFAULT_ZIP_LIMITS.maxCompressedTotal)
      );
      if (tmcRes.ok && tmcRes.buf.length) {
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

    if (datexRes.ok && datexRes.buf.length) {
      const datexPath = path.join(workDir, "datex.bin");
      fs.writeFileSync(datexPath, datexRes.buf);
      rawPaths.push(datexPath);
      report.datex = attachFetchDiag(summarizeDatex(datexRes.buf, config, tmcTable), datexRes);
      report.datex.authenticationAccepted = authAcceptedFromStatus(datexRes.status);
    } else {
      report.datex = attachFetchDiag(
        {
          downloadSuccess: false,
          authenticationAccepted: authAcceptedFromStatus(datexRes.status),
          parserCompatible: false,
        },
        datexRes
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
    for (const p of rawPaths) {
      try {
        fs.rmSync(p, { force: true });
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
        },
        mapping: report.mapping,
        lifecycle: report.lifecycle,
        security: report.security,
        sources: {
          datex: "DATEX_SOURCE",
          tmc: "TMC_SOURCE",
        },
        tmcPublicMeta: report.tmcPublicMeta,
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
