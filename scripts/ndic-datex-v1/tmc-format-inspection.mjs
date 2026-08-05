/**
 * Safe TMC v11 format-inspection (content peek only).
 * Never implements importer/resolver. Never dumps raw rows, basenames, coords, or LCDs.
 * TEST disk/measure inject only via direct API (createTestDiskStatsProvider) — never env.
 */
import fs from "node:fs";
import path from "node:path";
import { inspectZipFileCentral, TMC_FORMAT, TMC_CID_EXPECTED, TMC_TABCD_EXPECTED } from "./tmc-archive-stream.mjs";
import { classifyZipPath, TMC_PATH_REJECT } from "./tmc-zip.mjs";
import { assertNoTestDiskProviderEnv, classifyDiskPath } from "./disk-preflight.mjs";
import {
  PATH_CATEGORY,
  categorizePath,
  assertReportPathSafe,
  containsForbiddenPathLeak,
} from "./tmc-path-redaction.mjs";
import {
  SP08001_EXCHANGE_FORMAT_VERSION,
  SP08001_STANDARD_TABLE_COUNT,
  SP08001_PHYSICAL,
  SP08001_TABLE_CODES,
  resolveSp08001TableCodeFromBasename,
} from "./tmc-sp08001-contract.mjs";
import {
  DATASET_INTEGRITY_STATE,
  REQUIRED_FOR_FORMAT_IDENTIFICATION,
  REQUIRED_STANDARD_TABLES,
  PROMOTION_POLICY_VERSION,
  TABLE_STATE,
  README_PARSE_STATE,
  DAT_ENCODING_SOURCE,
  evaluateFormatContractPromotion,
  emptyTableAssessment,
  buildTableAssessmentReportRow,
  HEADER_MATCH_STATE,
  CONTENT_VERIFIED_STATE,
  TABLE_MISMATCH_REASON,
  classifySp08001TableAssessmentClass,
  COMPANION_NON_AUTHORITATIVE,
  ALLOWED_EMPTY_TABLES,
  isAllowedEmptyTable,
} from "./tmc-sp08001-format-promotion.mjs";
import {
  assessSp08001ContentContract,
  detectDatEncodingFromBytes,
  ENCODING_LAYER,
  parseSp08001HeaderLine,
  parseReadmeDatStructural,
  resolveEncodingLayers,
  splitSp08001Fields,
  sp08001PhysicalContract,
} from "./tmc-sp08001-header.mjs";
import {
  PEEK_STATUS,
  PEEK_COMPRESSED_READ_CHUNK,
  PEEK_INFLATE_HIGH_WATER,
  peekZipEntryBytesStreaming,
  extractFirstLogicalHeaderLine,
} from "./tmc-zip-entry-peek.mjs";

export const INSPECTION_MODE = "format_inspection";
export const REPORT_SCHEMA_VERSION = "tmc-format-inspection-report-v3";
export const INSPECTION_VERSION = "sp08001-v2.6-table4-2-complete-schema-2";
export {
  DATASET_INTEGRITY_STATE,
  REQUIRED_FOR_FORMAT_IDENTIFICATION,
  REQUIRED_STANDARD_TABLES,
  PROMOTION_POLICY_VERSION,
  TABLE_STATE,
  README_PARSE_STATE,
  DAT_ENCODING_SOURCE,
  evaluateFormatContractPromotion,
  HEADER_MATCH_STATE,
  CONTENT_VERIFIED_STATE,
  TABLE_MISMATCH_REASON,
  ALLOWED_EMPTY_TABLES,
};
export const INSPECTION_REPORT_MAX_BYTES = 64 * 1024;
/** Closed upper bound for per-table candidateCount in report v3. */
export const INSPECTION_TABLE_CANDIDATE_COUNT_MAX = 1024;
export const INSPECTION_TEXT_PEEK_BYTES = 4 * 1024;
export const INSPECTION_MAX_TEXT_LINES = 8;
export const INSPECTION_CPG_MAX_BYTES = 64;
export const INSPECTION_HEADER_MAX_BYTES = 1024;
export const INSPECTION_HEADER_FIELD_LIMIT = 64;
export const INSPECTION_TIMEOUT_MS = 120_000;
export const INSPECTION_SHP_HEADER_BYTES = 100;
export const INSPECTION_SQLITE_MAGIC_BYTES = 16;
export const INSPECTION_MAX_PEEK_ENTRIES = 64;
export const INSPECTION_MAX_TOTAL_PEEK_BYTES = 2 * 1024 * 1024;
/** Sequential peeks only — never concurrent inflate of multiple entries. */
export const INSPECTION_PEEK_CONCURRENCY = 1;

export const REJECT_PHASE = Object.freeze({
  FORMAT_CONTRACT_VERIFICATION: "format_contract_verification",
  ARCHIVE_REJECT: "archive_reject",
  SECURITY: "security",
  INTERNAL: "internal",
  NOT_APPLICABLE: "not_applicable",
});

export { PEEK_STATUS, PEEK_COMPRESSED_READ_CHUNK, PEEK_INFLATE_HIGH_WATER, extractFirstLogicalHeaderLine };

export const INSPECTION_OUTCOME = Object.freeze({
  SUCCESS: "success",
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
  EXPECTED_REJECT: "expected_reject",
  TECHNICAL_FAILURE: "technical_failure",
  SECURITY_FAILURE: "security_failure",
});

export const REPORT_SAFETY = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  NOT_CREATED: "not_created",
});

export const INSPECTION_WARNING = Object.freeze({
  MULTIPLE_ROLE_CANDIDATES: "TMC_INSPECTION_MULTIPLE_ROLE_CANDIDATES",
  FORMAT_EVIDENCE_INSUFFICIENT: "TMC_INSPECTION_FORMAT_EVIDENCE_INSUFFICIENT",
  READ_LIMIT: "TMC_INSPECTION_READ_LIMIT",
  SQLITE_UNVERIFIED: "TMC_INSPECTION_SQLITE_UNVERIFIED",
});

/** Broad structural roles that may have multiple candidates without fatal reject. */
export const REQUIRED_SINGLETON_ROLES = Object.freeze(["points", "names", "roads", "segments"]);

export const STRUCTURAL_ROLE_ALLOWLIST = Object.freeze([
  "points",
  "names",
  "roads",
  "segments",
  "locations",
  "offsets",
  "areas",
  "administrative",
  "coordinates",
  "metadata",
  "documentation",
  "image",
  "ignored_other",
  "dbf_layer",
  "shp_layer",
  "sqlite_candidate",
  "encoding_cpg",
  "unknown_dat",
  "unknown_txt",
]);

export const ROLE_EVIDENCE_LEVEL = Object.freeze({
  FILENAME_HINT: "filename_hint",
  METADATA_ONLY: "metadata_only",
  HEADER_CONTRACT: "header_contract",
  CONTENT_VERIFIED: "content_verified",
});

export const EXT_CATEGORY_ALLOWLIST = Object.freeze([
  "dat",
  "txt",
  "csv",
  "cpg",
  "dbf",
  "shp",
  "shx",
  "sqlite",
  "other",
]);

/** Allowlisted top-level keys for sanitised inspection reports (upload gate). */
export const INSPECTION_REPORT_ALLOWED_KEYS = Object.freeze([
  "ok",
  "mode",
  "severity",
  "rejectCode",
  "warnings",
  "inspectionOutcome",
  "reportSafety",
  "candidateFormat",
  "candidateFormatConfidence",
  "candidateEvidenceSource",
  "authoritativeFormat",
  "authoritativeFormatVerified",
  "cidExpected",
  "tabcdExpected",
  "cid11Detected",
  "tabcd25Detected",
  "encodingNormalized",
  "structuralRoleCounts",
  "structuralRoleBytes",
  "roleCandidateCounts",
  "roleEvidenceLevelCounts",
  "roleContentVerifiedCounts",
  "roleHeaderContractMatchCounts",
  "roleCidMatchCounts",
  "roleTabcdMatchCounts",
  "roleConflictCounts",
  "roleExtensionCategoryCounts",
  "duplicateRequiredRoleCount",
  "multipleCandidateRoleCount",
  "unresolvedRoleCount",
  "sourceAuthority",
  "sqlite",
  "importerActivated",
  "resolverActivated",
  "publishActivated",
  "productionWrite",
  "reportTruncated",
  "liveNetworkInspection",
  "livePathImplemented",
  "offlineReady",
  "ignoredCategoryCounts",
  "peekEntryCount",
  "peekTotalBytes",
  "centralDirectory",
  "workDirCategory",
  "downloadSuccess",
  "downloadedBytes",
  "diskPreflightPassed",
  "diskCheckPathCategory",
  "filesystemAvailableBytes",
  "filesystemRequiredBytes",
  "note",
  "authoritativeLayer",
  "exchangeFormatContractVersion",
  "tableContractCount",
  "contentVerifiedTableCount",
  "delimiterNormalized",
  "headerState",
  "fieldCountAggregate",
  "requiredTablesPresent",
  "optionalTablesPresent",
  "unknownSupplementaryTables",
  "cidMatchState",
  "tabcdMatchState",
  "coordinateSource",
  "relationshipIntegrity",
  "encodingDatLayer",
  "encodingCpgLayer",
  "encodingFalseConflictAvoided",
  "reportSchemaVersion",
  "inspectionVersion",
  "rejectPhase",
  "softEmptyPeekCount",
  "decompressionErrorCount",
  "truncatedPeekCount",
  "completeHeaderCount",
  "tableCodeMappedCount",
  "tableCodeUnknownCount",
  "peekStatusCounts",
  "readmeEncodingState",
  "readmeParseState",
  "readmeMappedCount",
  "readmeBomPresent",
  "readmeNonEmptyLineCount",
  "readmeMetaFieldObservedCount",
  "datEncodingSource",
  "datDecodeSuccessCount",
  "datDecodeFailureCount",
  "companionEncodingIgnoredForDatCount",
  "metadataFileCount",
  "formatConfirmed",
  "formatContractConfirmed",
  "datasetIntegrityState",
  "importerIntegrityRequired",
  "importerIntegrityConfirmed",
  "promotionPolicyVersion",
  "promotionBlockers",
  "tableAssessments",
  "tableCodeConflictCount",
  "exactTableCodeResolvedCount",
  "exactTableCodeConflictCount",
  "broadCandidateSupersededCount",
  "unresolvedExactTableCount",
  "missingRequiredStandardTableCount",
  "schemaVerifiedEmptyTableCount",
  "schemaVerifiedTableCount",
  "limitedContentVerifiedTableCount",
  "opaqueTableCodeVerifiedCount",
  "standardTableHeaderMatchCount",
  "identificationTablesPresentCount",
  "identificationTablesVerifiedCount",
  "cleanupAttestation",
  "cleanupScriptExecuted",
  "taskWorkdirRemoved",
  "taskZipRemoved",
  "stagingRemoved",
  "reportHandedOffBeforeCleanup",
  "foreignPathTouched",
]);

export const STDOUT_ENVELOPE_ALLOWED_KEYS = Object.freeze([
  "ok",
  "mode",
  "inspectionOutcome",
  "reportSafety",
  "rejectCode",
  "reportBytes",
  "reportTruncated",
  "workDirCategory",
  "authoritativeFormat",
  "authoritativeFormatVerified",
  "formatConfirmed",
  "formatContractConfirmed",
  "datasetIntegrityState",
  "promotionPolicyVersion",
  "importerActivated",
  "resolverActivated",
  "publishActivated",
  "productionWrite",
  "sanitized_report_ready",
]);


const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const PEEK_EXTS = new Set(["dat", "txt", "csv", "cpg", "dbf", "shp", "shx", "db", "sqlite", "sqlite3"]);
const NESTED_ARCHIVE_EXTS = new Set(["zip", "7z", "rar", "gz", "tgz", "bz2"]);

export const INSPECTION_REJECT = Object.freeze({
  PATH_INVALID: "TMC_INSPECTION_PATH_INVALID",
  ENTRY_NOT_ALLOWED: "TMC_INSPECTION_ENTRY_NOT_ALLOWED",
  ENTRY_TOO_LARGE: "TMC_INSPECTION_ENTRY_TOO_LARGE",
  READ_LIMIT: "TMC_INSPECTION_READ_LIMIT",
  ENCODING_UNVERIFIED: "TMC_INSPECTION_ENCODING_UNVERIFIED",
  FORMAT_UNVERIFIED: "TMC_INSPECTION_FORMAT_UNVERIFIED",
  CID_MISMATCH: "TMC_INSPECTION_CID_MISMATCH",
  TABCD_MISMATCH: "TMC_INSPECTION_TABCD_MISMATCH",
  DUPLICATE_REQUIRED_ROLE: "TMC_INSPECTION_DUPLICATE_REQUIRED_ROLE",
  SOURCE_CONFLICT: "TMC_INSPECTION_SOURCE_CONFLICT",
  SQLITE_UNVERIFIED: "TMC_INSPECTION_SQLITE_UNVERIFIED",
  MEMORY_LIMIT: "TMC_INSPECTION_MEMORY_LIMIT",
  TIMEOUT: "TMC_INSPECTION_TIMEOUT",
  REPORT_LIMIT: "TMC_INSPECTION_REPORT_LIMIT",
  INTERNAL_ERROR: "TMC_INSPECTION_INTERNAL_ERROR",
  FORMAT_EVIDENCE_INSUFFICIENT: "TMC_INSPECTION_FORMAT_EVIDENCE_INSUFFICIENT",
});

const HARD_ARCHIVE_REJECTS = new Set([
  INSPECTION_REJECT.PATH_INVALID,
  INSPECTION_REJECT.ENTRY_NOT_ALLOWED,
  INSPECTION_REJECT.ENTRY_TOO_LARGE,
  INSPECTION_REJECT.CID_MISMATCH,
  INSPECTION_REJECT.TABCD_MISMATCH,
  INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE,
  INSPECTION_REJECT.SOURCE_CONFLICT,
  INSPECTION_REJECT.MEMORY_LIMIT,
  INSPECTION_REJECT.TIMEOUT,
  INSPECTION_REJECT.REPORT_LIMIT,
  INSPECTION_REJECT.INTERNAL_ERROR,
  INSPECTION_REJECT.ENCODING_UNVERIFIED,
  INSPECTION_REJECT.FORMAT_UNVERIFIED,
  INSPECTION_REJECT.SQLITE_UNVERIFIED,
  INSPECTION_REJECT.READ_LIMIT,
]);

export function extCategoryOf(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "dat") return "dat";
  if (e === "txt") return "txt";
  if (e === "csv") return "csv";
  if (e === "cpg") return "cpg";
  if (e === "dbf") return "dbf";
  if (e === "shp") return "shp";
  if (e === "shx") return "shx";
  if (e === "db" || e === "sqlite" || e === "sqlite3") return "sqlite";
  return "other";
}

/**
 * Non-authoritative broad-role → table hint only. Must NEVER confirm content_verified
 * or supply tableCode for SP08001 matcher. Opaque tableCode comes solely from basename resolve.
 */
export const ROLE_TO_SP08001_TABLE_HINT = Object.freeze({
  points: "POINTS",
  names: "NAMES",
  roads: "ROADS",
  segments: "SEGMENTS",
});

const SP08001_CODE_TO_ROLE = Object.freeze({
  POINTS: "points",
  NAMES: "names",
  ROADS: "roads",
  SEGMENTS: "segments",
  POFFSETS: "offsets",
  SOFFSETS: "offsets",
  ADMINISTRATIVEAREA: "administrative",
  OTHERAREAS: "areas",
  LOCATIONCODES: "locations",
  INTERSECTIONS: "locations",
  JUNCTIONS: "locations",
  LOCATIONDATASETS: "metadata",
  COUNTRIES: "metadata",
  CLASSES: "metadata",
  TYPES: "metadata",
  SUBTYPES: "metadata",
  LANGUAGES: "metadata",
  EUROROADNO: "metadata",
  NAMETRANSLATIONS: "metadata",
  SUBTYPETRANSLATION: "metadata",
  ERNO_BELONGS_TO_CO: "metadata",
  ROAD_NETWORK_LEVEL_TYPES: "metadata",
  SEG_HAS_ERNO: "metadata",
  DLRS: "metadata",
  DLR_DESC: "metadata",
  README: "metadata",
});

/**
 * Content contract for required singleton roles via SP08001 exact headers (no raw values).
 * Filename hints never content-verify. Archive-level 11/25 alone never verifies a table.
 * @param {string} role
 * @param {object} peek from inspectTextPeek
 * @param {{ tableCode?: string, expectedCid?: number, expectedTabcd?: number }} [opts]
 */
export function assessSingletonContentContract(role, peek, opts = {}) {
  // Authoritative tableCode must be opaque allowlisted enum from basename resolve — never broad-role fallback.
  const rawCode = opts.tableCode || null;
  const tableCode =
    rawCode && SP08001_TABLE_CODES.includes(rawCode) ? rawCode : null;
  if (tableCode) {
    const a = assessSp08001ContentContract(tableCode, peek, opts);
    return {
      headerContractMatch: a.headerContractMatch,
      cidMatch: a.cidMatch,
      tabcdMatch: a.tabcdMatch,
      contentVerified: a.contentVerified,
      evidenceLevel: a.evidenceLevel,
      headerState: a.headerState,
      tableCode: a.tableCode,
      delimiter: a.delimiter,
      fieldCount: a.fieldCount,
    };
  }
  const p = peek || {};
  let evidenceLevel = ROLE_EVIDENCE_LEVEL.FILENAME_HINT;
  if (p.hasHeader || p.positional) evidenceLevel = ROLE_EVIDENCE_LEVEL.METADATA_ONLY;
  return {
    headerContractMatch: false,
    cidMatch: false,
    tabcdMatch: false,
    contentVerified: false,
    evidenceLevel,
    headerState: "UNVERIFIED",
    tableCode: null,
    broadRoleHint: ROLE_TO_SP08001_TABLE_HINT[role] || null,
  };
}

function emptyRoleMap() {
  return Object.create(null);
}

function sanitizeRoleCountMap(map) {
  const out = Object.create(null);
  for (const [k, v] of Object.entries(map || {})) {
    if (!STRUCTURAL_ROLE_ALLOWLIST.includes(k)) {
      throw Object.assign(new Error("TMC_INSPECTION_REPORT_UNKNOWN_ROLE"), {
        code: "TMC_INSPECTION_REPORT_UNKNOWN_ROLE",
        key: k,
      });
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
        code: "TMC_INSPECTION_REPORT_SCHEMA",
        key: k,
      });
    }
    out[k] = n;
  }
  return out;
}

/**
 * Minimal stdout envelope (never the full report).
 * @param {object} fields
 */
export function buildStdoutEnvelope(fields) {
  const out = {};
  for (const key of STDOUT_ENVELOPE_ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) out[key] = fields[key];
  }
  out.mode = INSPECTION_MODE;
  out.authoritativeFormat = fields.authoritativeFormat === "TISA_DAT_CSV" ? "TISA_DAT_CSV" : "UNVERIFIED";
  out.authoritativeFormatVerified = fields.authoritativeFormatVerified === true;
  out.formatConfirmed = fields.formatConfirmed === true;
  out.datasetIntegrityState = DATASET_INTEGRITY_STATE.NOT_TESTED;
  out.importerActivated = false;
  out.resolverActivated = false;
  out.publishActivated = false;
  out.productionWrite = false;
  return out;
}

/**
 * Derive inspectionOutcome from a built report (mutates report fields).
 * @param {object} report
 */
export function finalizeInspectionOutcome(report) {
  const r = report || {};
  r.reportSchemaVersion = r.reportSchemaVersion || REPORT_SCHEMA_VERSION;
  r.inspectionVersion = r.inspectionVersion || INSPECTION_VERSION;
  r.promotionPolicyVersion = r.promotionPolicyVersion || PROMOTION_POLICY_VERSION;
  r.importerActivated = false;
  r.resolverActivated = false;
  r.publishActivated = false;
  r.productionWrite = false;
  // Dataset integrity is never claimed by format inspection (no full-table import).
  r.datasetIntegrityState = DATASET_INTEGRITY_STATE.NOT_TESTED;
  // relationshipIntegrity must not block format confirmation.
  if (r.relationshipIntegrity == null) r.relationshipIntegrity = "UNVERIFIED";

  const hard =
    r.rejectCode &&
    r.rejectCode !== INSPECTION_REJECT.FORMAT_EVIDENCE_INSUFFICIENT &&
    (HARD_ARCHIVE_REJECTS.has(r.rejectCode) ||
      (typeof r.rejectCode === "string" && /^TMC_HTTP_\d+$/.test(r.rejectCode)) ||
      r.rejectCode === "TMC_AUTH_REJECTED" ||
      r.rejectCode === "TMC_CONTENT_TYPE_REJECTED" ||
      r.rejectCode === "TMC_RESPONSE_TOO_LARGE");
  if (hard) {
    r.formatConfirmed = false;
    r.authoritativeFormat = "UNVERIFIED";
    r.authoritativeFormatVerified = false;
    r.inspectionOutcome = INSPECTION_OUTCOME.EXPECTED_REJECT;
    r.ok = false;
    if (!r.severity) r.severity = "archive_reject";
    if (!r.rejectPhase) r.rejectPhase = REJECT_PHASE.ARCHIVE_REJECT;
  } else if (r.formatConfirmed === true && r.authoritativeFormatVerified === true) {
    r.inspectionOutcome = INSPECTION_OUTCOME.SUCCESS;
    r.ok = true;
    r.severity = "ok";
    r.rejectCode = null;
    r.rejectPhase = REJECT_PHASE.NOT_APPLICABLE;
  } else {
    r.formatConfirmed = false;
    r.authoritativeFormat = "UNVERIFIED";
    r.authoritativeFormatVerified = false;
    r.inspectionOutcome = INSPECTION_OUTCOME.INSUFFICIENT_EVIDENCE;
    r.ok = false;
    r.severity = r.severity || "insufficient_evidence";
    r.rejectCode = INSPECTION_REJECT.FORMAT_EVIDENCE_INSUFFICIENT;
    r.rejectPhase = REJECT_PHASE.FORMAT_CONTRACT_VERIFICATION;
    const hasWarn =
      Array.isArray(r.warnings) &&
      r.warnings.some((w) => w && w.code === INSPECTION_WARNING.FORMAT_EVIDENCE_INSUFFICIENT);
    if (!hasWarn) {
      if (!Array.isArray(r.warnings)) r.warnings = [];
      r.warnings.push({
        code: INSPECTION_WARNING.FORMAT_EVIDENCE_INSUFFICIENT,
        severity: "insufficient_evidence",
      });
    }
  }
  return r;
}

/** Allowlisted structural basename roles (never emit original names). */
const ROLE_PATTERNS = [
  [/points?|nodes?/i, "points"],
  [/names?/i, "names"],
  [/roads?|routes?/i, "roads"],
  [/segments?|links?|linear/i, "segments"],
  [/location(code|s|datasets?)?/i, "locations"],
  [/poffsets?|soffsets?|offsets?/i, "offsets"],
  [/otherareas?|areas?/i, "areas"],
  [/admin(istrative)?/i, "administrative"],
  [/coord|geo/i, "coordinates"],
  [/countries|languages|classes|subtypes|metadata|table|locationdatasets/i, "metadata"],
];

const HEADER_ROLE_PATTERNS = [
  [/^cid$|country.?id|countryno/i, "cid_field"],
  [/^tabcd$|table.?code|tableno|ltn/i, "tabcd_field"],
  [/^lcd$|location.?code|loccode/i, "location_code_field"],
  [/^class$|^tcd$|^type$/i, "type_field"],
  [/^stcd$|subtype/i, "subtype_field"],
  [/road|rnid|roa_/i, "road_field"],
  [/n1id|n2id|^name|nameref/i, "name_reference_field"],
  [/pol_|admin|area/i, "admin_reference_field"],
  [/posoff|positive|outpos|inpos|presentpos/i, "positive_offset_field"],
  [/negoff|negative|outneg|inneg|presentneg/i, "negative_offset_field"],
  [/parent|pol_lcd/i, "parent_field"],
  [/^next$/i, "next_field"],
  [/^prev|previous/i, "previous_field"],
  [/xcoord|^lat$|latitude/i, "latitude_field"],
  [/ycoord|^lon$|longitude|^long$/i, "longitude_field"],
];

const CPG_NORMALIZE = Object.freeze({
  "utf-8": "UTF-8",
  utf8: "UTF-8",
  "utf8": "UTF-8",
  "windows-1250": "WINDOWS-1250",
  "cp1250": "WINDOWS-1250",
  "1250": "WINDOWS-1250",
  "iso-8859-2": "ISO-8859-2",
  "latin2": "ISO-8859-2",
  "utf-16le": "UTF-16LE",
  "utf-16be": "UTF-16BE",
});

export function classifyEntryRole(entryPath) {
  const full = String(entryPath || "");
  const baseWithExt = path.basename(full);
  const base = baseWithExt.replace(/\.[^.]+$/, "");
  const ext = (full.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (ext === "pdf" || ext === "html" || ext === "htm") return "documentation";
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif") return "image";
  if (ext === "kml") return "ignored_other";
  if (ext === "dbf") return "dbf_layer";
  if (ext === "shp" || ext === "shx" || ext === "prj" || ext === "sbn" || ext === "sbx") return "shp_layer";
  if (ext === "db" || ext === "sqlite" || ext === "sqlite3") return "sqlite_candidate";
  if (ext === "cpg") return "encoding_cpg";
  // Prefer exact SP08001 export names over broad basename heuristics.
  const spCode = resolveSp08001TableCodeFromBasename(baseWithExt);
  if (spCode && SP08001_CODE_TO_ROLE[spCode]) return SP08001_CODE_TO_ROLE[spCode];
  for (const [re, role] of ROLE_PATTERNS) {
    if (re.test(base)) return role;
  }
  if (ext === "dat") return "unknown_dat";
  if (ext === "txt" || ext === "csv") return "unknown_txt";
  return "ignored_other";
}

function normalizeHeaderRole(token) {
  const t = String(token || "").trim();
  if (!t) return "unknown_field";
  for (const [re, role] of HEADER_ROLE_PATTERNS) {
    if (re.test(t)) return role;
  }
  return "unknown_field";
}

function bump(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}

function detectBom(buf) {
  if (!buf || buf.length < 2) return "none";
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return "utf8";
  if (buf[0] === 0xff && buf[1] === 0xfe) return "utf16le";
  if (buf[0] === 0xfe && buf[1] === 0xff) return "utf16be";
  return "none";
}

function isMostlyText(buf) {
  if (!buf || !buf.length) return false;
  let ctrl = 0;
  const n = Math.min(buf.length, 512);
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) ctrl += 1;
  }
  return ctrl / n < 0.05;
}

function detectDelimiter(sample) {
  const line = String(sample || "").split(/\r?\n/).find((l) => l.trim()) || "";
  const counts = {
    semicolon: (line.match(/;/g) || []).length,
    comma: (line.match(/,/g) || []).length,
    tab: (line.match(/\t/g) || []).length,
    pipe: (line.match(/\|/g) || []).length,
  };
  let best = "unknown";
  let max = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  if (max === 0) {
    // fixed-width heuristic: long line without delimiters
    if (line.length >= 40 && !/[;,\t|]/.test(line)) return "fixed_width_candidate";
    return "unknown";
  }
  return best;
}

function splitFields(line, delim) {
  if (delim === "semicolon") return line.split(";");
  if (delim === "comma") return line.split(",");
  if (delim === "tab") return line.split("\t");
  if (delim === "pipe") return line.split("|");
  return [line];
}

function looksLikeHeader(fields) {
  if (!fields.length) return false;
  let alpha = 0;
  for (const f of fields) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(f).trim())) alpha += 1;
  }
  return alpha >= Math.ceil(fields.length * 0.6);
}

/**
 * Inspect a DAT/TXT peek buffer (never returns raw text).
 * @param {Buffer} buf
 */
export function inspectTextPeek(buf) {
  const out = {
    textBinary: isMostlyText(buf) ? "text" : "binary",
    bom: detectBom(buf),
    encodingCandidate: "UNKNOWN",
    encodingLayer: ENCODING_LAYER.DAT_DETECTED,
    lineEnding: "unknown",
    delimiter: "unknown",
    quoteStyle: "none",
    escapeStyle: "unknown",
    hasHeader: false,
    headerCodes: [],
    fieldCount: 0,
    headerFieldCount: 0,
    firstDataFieldCount: 0,
    consistentFieldCount: true,
    maxFieldCountInSample: 0,
    headerRoleCounts: Object.create(null),
    positional: false,
    cid11Seen: false,
    tabcd25Seen: false,
    cidEvidence: "none",
    tabcdEvidence: "none",
    cidUnambiguous: false,
    tabcdUnambiguous: false,
    candidateCoordinateColumns: false,
    candidateOffsetColumns: false,
    candidateRelationshipColumns: false,
    candidateRoadNameAdminColumns: false,
  };
  if (out.textBinary !== "text") return out;

  const detected = detectDatEncodingFromBytes(buf);
  out.encodingCandidate =
    detected.encoding === "ASCII_OR_UTF8"
      ? "ASCII_OR_UTF8"
      : detected.encoding === "NON_UTF8"
        ? "NON_UTF8"
        : detected.encoding;
  out.bomPresent = detected.bom === true;

  let start = 0;
  if (out.bom === "utf8") start = 3;
  else if (out.bom === "utf16le" || out.bom === "utf16be") start = 2;

  // Decode for structure only. Do NOT auto-label as UTF-8 solely because decode succeeded.
  let text;
  if (detected.encoding === "NON_UTF8") {
    text = buf.slice(start, Math.min(buf.length, INSPECTION_TEXT_PEEK_BYTES)).toString("latin1");
  } else {
    text = buf.slice(start, Math.min(buf.length, INSPECTION_TEXT_PEEK_BYTES)).toString("utf8");
  }

  if (/\r\n/.test(text)) out.lineEnding = "crlf";
  else if (/\n/.test(text)) out.lineEnding = "lf";
  else if (/\r/.test(text)) out.lineEnding = "cr";

  if (text.includes('"')) out.quoteStyle = "double";
  else if (text.includes("'")) out.quoteStyle = "single";

  const lines = text.split(/\r?\n/).filter((l) => l.length > 0).slice(0, INSPECTION_MAX_TEXT_LINES);
  if (!lines.length) return out;

  out.delimiter = detectDelimiter(lines[0]);
  const fieldRows = lines.map((l) =>
    out.delimiter === "semicolon" ? splitSp08001Fields(l) : splitFields(l, out.delimiter)
  );
  out.maxFieldCountInSample = Math.max(...fieldRows.map((r) => r.length));
  const first = fieldRows[0];
  const headerParse = out.delimiter === "semicolon" ? parseSp08001HeaderLine(lines[0]) : { ok: false };
  out.hasHeader = headerParse.ok === true || looksLikeHeader(first);
  out.headerParseReason = headerParse.ok ? null : headerParse.reason || null;
  out.positional = !out.hasHeader;
  out.headerFieldCount = out.hasHeader ? first.length : 0;
  out.fieldCount = first.length;
  out.dataRowCount = out.hasHeader ? Math.max(0, fieldRows.length - 1) : 0;
  out.firstDataFieldCount = out.hasHeader && fieldRows[1] ? fieldRows[1].length : 0;
  out.hasDataRow = out.dataRowCount > 0;
  out.byteLength = buf ? buf.length : 0;
  out.consistentFieldCount = fieldRows.every((r) => r.length === first.length);

  if (out.hasHeader) {
    out.headerCodes = headerParse.ok
      ? headerParse.codes
      : first.map((f) => String(f || "").trim().toUpperCase());
    for (const f of out.headerCodes) bump(out.headerRoleCounts, normalizeHeaderRole(f));
    if (out.headerRoleCounts.latitude_field || out.headerRoleCounts.longitude_field) {
      out.candidateCoordinateColumns = true;
    }
    if (out.headerRoleCounts.positive_offset_field || out.headerRoleCounts.negative_offset_field) {
      out.candidateOffsetColumns = true;
    }
    if (
      out.headerRoleCounts.parent_field ||
      out.headerRoleCounts.next_field ||
      out.headerRoleCounts.previous_field
    ) {
      out.candidateRelationshipColumns = true;
    }
    if (
      out.headerRoleCounts.road_field ||
      out.headerRoleCounts.name_reference_field ||
      out.headerRoleCounts.admin_reference_field
    ) {
      out.candidateRoadNameAdminColumns = true;
    }
  }

  // CID/TABCD detection without emitting values: scan tokens as numbers only for exact 11/25 in likely columns.
  for (let li = 0; li < fieldRows.length; li++) {
    const row = fieldRows[li];
    for (let i = 0; i < row.length; i++) {
      const tok = String(row[i] || "").trim();
      if (tok === "11") {
        out.cid11Seen = true;
        out.cidEvidence =
          out.hasHeader && i < first.length && normalizeHeaderRole(first[i]) === "cid_field"
            ? "header_column"
            : "data_token";
      }
      if (tok === "25") {
        out.tabcd25Seen = true;
        out.tabcdEvidence =
          out.hasHeader && i < first.length && normalizeHeaderRole(first[i]) === "tabcd_field"
            ? "header_column"
            : "data_token";
      }
    }
  }
  // Header name tokens CID/TABCD without requiring value on same line
  if (out.hasHeader) {
    if (out.headerRoleCounts.cid_field) {
      out.cidEvidence = out.cidEvidence === "none" ? "header_name" : out.cidEvidence;
    }
    if (out.headerRoleCounts.tabcd_field) {
      out.tabcdEvidence = out.tabcdEvidence === "none" ? "header_name" : out.tabcdEvidence;
    }
  }
  out.cidUnambiguous = out.cid11Seen && out.cidEvidence !== "none";
  out.tabcdUnambiguous = out.tabcd25Seen && out.tabcdEvidence !== "none";
  return out;
}

/**
 * @param {Buffer} buf
 */
export function inspectCpgPeek(buf) {
  const raw = buf.slice(0, INSPECTION_CPG_MAX_BYTES).toString("utf8").trim().toLowerCase().replace(/\0/g, "");
  const key = raw.replace(/\s+/g, "");
  if (!key) return { encodingNormalized: "UNKNOWN" };
  if (CPG_NORMALIZE[key]) return { encodingNormalized: CPG_NORMALIZE[key] };
  // Partial matches
  if (/1250|windows.?1250|cp1250/.test(key)) return { encodingNormalized: "WINDOWS-1250" };
  if (/8859.?2|latin.?2|iso.?8859.?2/.test(key)) return { encodingNormalized: "ISO-8859-2" };
  if (/utf.?8/.test(key)) return { encodingNormalized: "UTF-8" };
  if (/utf.?16le/.test(key)) return { encodingNormalized: "UTF-16LE" };
  if (/utf.?16be/.test(key)) return { encodingNormalized: "UTF-16BE" };
  return { encodingNormalized: "UNKNOWN" };
}

/**
 * DBF header only (no records).
 * @param {Buffer} buf
 */
export function inspectDbfHeader(buf) {
  const out = {
    validDbfHeader: false,
    dbfVersionCategory: "unknown",
    declaredRecordCount: 0,
    headerLength: 0,
    recordLength: 0,
    fieldCount: 0,
    normalizedFieldRoleCounts: Object.create(null),
    encodingEvidenceCategory: "UNKNOWN",
    deletionFlagSupported: true,
    memoReferencePresent: false,
    malformedHeader: true,
    sizeConsistency: false,
  };
  if (!buf || buf.length < 32) return out;
  const ver = buf[0];
  if (ver === 0x03) out.dbfVersionCategory = "dbase3";
  else if (ver === 0x83) out.dbfVersionCategory = "dbase3_memo";
  else if (ver === 0x30 || ver === 0x31) out.dbfVersionCategory = "visual_foxpro";
  else out.dbfVersionCategory = "other";

  out.declaredRecordCount = buf.readUInt32LE(4);
  out.headerLength = buf.readUInt16LE(8);
  out.recordLength = buf.readUInt16LE(10);
  if (out.headerLength < 33 || out.recordLength < 1) return out;

  const fieldArea = out.headerLength - 33;
  if (fieldArea % 32 !== 0) return out;
  out.fieldCount = fieldArea / 32;
  out.malformedHeader = false;
  out.validDbfHeader = true;
  out.sizeConsistency = buf.length >= Math.min(buf.length, out.headerLength);
  out.memoReferencePresent = ver === 0x83 || ver === 0xf5;

  const maxFields = Math.min(out.fieldCount, 64);
  for (let i = 0; i < maxFields; i++) {
    const off = 32 + i * 32;
    if (off + 11 > buf.length) break;
    const nameBytes = buf.slice(off, off + 11);
    const name = nameBytes.toString("ascii").replace(/\0.*$/, "").trim();
    bump(out.normalizedFieldRoleCounts, normalizeHeaderRole(name));
  }
  return out;
}

/**
 * SHP / SHX fixed 100-byte header (no geometries).
 * @param {Buffer} buf
 * @param {"shp"|"shx"} kind
 */
export function inspectShpHeader(buf, kind = "shp") {
  const out = {
    validHeader: false,
    shapeTypeCategory: "unknown",
    fileLengthWords: 0,
    boundingBoxCountryCheck: "invalid",
    hasZ: false,
    hasM: false,
    kind,
  };
  if (!buf || buf.length < INSPECTION_SHP_HEADER_BYTES) return out;
  if (buf.readInt32BE(0) !== 9994) return out;
  out.fileLengthWords = buf.readInt32BE(24);
  const shapeType = buf.readInt32LE(32);
  const SHAPES = {
    0: "null",
    1: "point",
    3: "polyline",
    5: "polygon",
    8: "multipoint",
    11: "point_z",
    13: "polyline_z",
    15: "polygon_z",
    18: "multipoint_z",
    21: "point_m",
    23: "polyline_m",
    25: "polygon_m",
  };
  out.shapeTypeCategory = SHAPES[shapeType] || "other";
  out.hasZ = /_z$/.test(out.shapeTypeCategory);
  out.hasM = /_m$/.test(out.shapeTypeCategory) || out.hasZ;
  out.validHeader = true;

  // Bounding box as Czech extent enum only (WGS84 degrees approx).
  const xmin = buf.readDoubleLE(36);
  const ymin = buf.readDoubleLE(44);
  const xmax = buf.readDoubleLE(52);
  const ymax = buf.readDoubleLE(60);
  const finite = [xmin, ymin, xmax, ymax].every((n) => Number.isFinite(n));
  if (!finite) out.boundingBoxCountryCheck = "invalid";
  else if (xmin === 0 && ymin === 0 && xmax === 0 && ymax === 0) out.boundingBoxCountryCheck = "empty";
  else {
    // Rough CZ: lon 12–19, lat 48–51.5 (also accept projected meters heuristically as outside if huge)
    const looksGeo = Math.abs(xmin) <= 180 && Math.abs(xmax) <= 180 && Math.abs(ymin) <= 90 && Math.abs(ymax) <= 90;
    if (!looksGeo) out.boundingBoxCountryCheck = "outside_czech_extent";
    else if (xmin >= 12 && xmax <= 19 && ymin >= 48 && ymax <= 51.6) out.boundingBoxCountryCheck = "plausible_czech_extent";
    else out.boundingBoxCountryCheck = "outside_czech_extent";
  }
  return out;
}

/**
 * SQLite magic + optional schema role counts (no row data, no SQL text emitted).
 * @param {Buffer} headerBuf
 * @param {{ schemaTableNames?: string[], schemaColumnNames?: string[] }} [schemaHints] test-only sanitized names
 */
export function inspectSqliteHeader(headerBuf, schemaHints = null) {
  const out = {
    sqliteVerified: false,
    dbFormat: "DB_FORMAT_UNVERIFIED",
    tableCount: 0,
    indexCount: 0,
    viewCount: 0,
    triggerCount: 0,
    normalizedTableRoleCounts: Object.create(null),
    normalizedColumnRoleCounts: Object.create(null),
    candidateCoordinateSource: false,
    candidateNameSource: false,
    candidateRelationshipSource: false,
    candidateMetadataSource: false,
  };
  if (!headerBuf || headerBuf.length < 16) return out;
  const magic = headerBuf.slice(0, 16).toString("utf8");
  if (!magic.startsWith("SQLite format 3")) {
    out.dbFormat = "DB_FORMAT_UNVERIFIED";
    return out;
  }
  out.sqliteVerified = true;
  out.dbFormat = "sqlite3";
  if (schemaHints && Array.isArray(schemaHints.schemaTableNames)) {
    out.tableCount = schemaHints.schemaTableNames.length;
    for (const n of schemaHints.schemaTableNames) bump(out.normalizedTableRoleCounts, classifyEntryRole(n + ".dat"));
  }
  if (schemaHints && Array.isArray(schemaHints.schemaColumnNames)) {
    for (const n of schemaHints.schemaColumnNames) bump(out.normalizedColumnRoleCounts, normalizeHeaderRole(n));
  }
  const roles = out.normalizedTableRoleCounts;
  out.candidateCoordinateSource = Boolean(roles.points || roles.coordinates || out.normalizedColumnRoleCounts.latitude_field);
  out.candidateNameSource = Boolean(roles.names || out.normalizedColumnRoleCounts.name_reference_field);
  out.candidateRelationshipSource = Boolean(
    roles.segments ||
      out.normalizedColumnRoleCounts.parent_field ||
      out.normalizedColumnRoleCounts.next_field
  );
  out.candidateMetadataSource = Boolean(roles.metadata);
  return out;
}

/**
 * Strip unknown keys, reject path/url/secret-like string leaks, reserialize.
 * @param {object} report
 */
export function validateInspectionReportObject(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
      code: "TMC_INSPECTION_REPORT_SCHEMA",
    });
  }
  const out = {};
  for (const key of Object.keys(report)) {
    if (!INSPECTION_REPORT_ALLOWED_KEYS.includes(key)) {
      throw Object.assign(new Error("TMC_INSPECTION_REPORT_UNKNOWN_KEY"), {
        code: "TMC_INSPECTION_REPORT_UNKNOWN_KEY",
        key,
      });
    }
    out[key] = report[key];
  }
  const roleMaps = [
    "structuralRoleCounts",
    "structuralRoleBytes",
    "roleCandidateCounts",
    "roleContentVerifiedCounts",
    "roleHeaderContractMatchCounts",
    "roleCidMatchCounts",
    "roleTabcdMatchCounts",
    "roleConflictCounts",
  ];
  for (const rk of roleMaps) {
    if (out[rk] != null) out[rk] = sanitizeRoleCountMap(out[rk]);
  }
  if (out.roleEvidenceLevelCounts != null) {
    const allowed = new Set(Object.values(ROLE_EVIDENCE_LEVEL));
    const cleaned = Object.create(null);
    for (const [k, v] of Object.entries(out.roleEvidenceLevelCounts)) {
      if (!allowed.has(k)) {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_UNKNOWN_ROLE"), {
          code: "TMC_INSPECTION_REPORT_UNKNOWN_ROLE",
          key: k,
        });
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), { code: "TMC_INSPECTION_REPORT_SCHEMA" });
      }
      cleaned[k] = n;
    }
    out.roleEvidenceLevelCounts = cleaned;
  }
  if (out.roleExtensionCategoryCounts != null) {
    const cleaned = Object.create(null);
    for (const [role, cats] of Object.entries(out.roleExtensionCategoryCounts)) {
      if (!STRUCTURAL_ROLE_ALLOWLIST.includes(role)) {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_UNKNOWN_ROLE"), {
          code: "TMC_INSPECTION_REPORT_UNKNOWN_ROLE",
          key: role,
        });
      }
      cleaned[role] = Object.create(null);
      for (const [cat, v] of Object.entries(cats || {})) {
        if (!EXT_CATEGORY_ALLOWLIST.includes(cat)) {
          throw Object.assign(new Error("TMC_INSPECTION_REPORT_UNKNOWN_ROLE"), {
            code: "TMC_INSPECTION_REPORT_UNKNOWN_ROLE",
            key: cat,
          });
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), { code: "TMC_INSPECTION_REPORT_SCHEMA" });
        }
        cleaned[role][cat] = n;
      }
    }
    out.roleExtensionCategoryCounts = cleaned;
  }
  if (out.rejectCode != null) {
    const allowedRejects = new Set([...Object.values(INSPECTION_REJECT), "TMC_AUTH_REJECTED", "TMC_CONTENT_TYPE_REJECTED", "TMC_RESPONSE_TOO_LARGE"]);
    if (typeof out.rejectCode === "string" && /^TMC_HTTP_\d+$/.test(out.rejectCode)) {
      // allow
    } else if (!allowedRejects.has(out.rejectCode)) {
      throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
        code: "TMC_INSPECTION_REPORT_SCHEMA",
        key: "rejectCode",
      });
    }
  }
  if (out.inspectionOutcome != null && !Object.values(INSPECTION_OUTCOME).includes(out.inspectionOutcome)) {
    throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
      code: "TMC_INSPECTION_REPORT_SCHEMA",
      key: "inspectionOutcome",
    });
  }
  if (out.rejectPhase != null && !Object.values(REJECT_PHASE).includes(out.rejectPhase)) {
    throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
      code: "TMC_INSPECTION_REPORT_SCHEMA",
      key: "rejectPhase",
    });
  }
  if (out.reportSchemaVersion != null && typeof out.reportSchemaVersion !== "string") {
    throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
      code: "TMC_INSPECTION_REPORT_SCHEMA",
      key: "reportSchemaVersion",
    });
  }
  if (out.reportSafety != null && !Object.values(REPORT_SAFETY).includes(out.reportSafety)) {
    throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
      code: "TMC_INSPECTION_REPORT_SCHEMA",
      key: "reportSafety",
    });
  }
  if (Array.isArray(out.warnings)) {
    for (const w of out.warnings) {
      if (!w || typeof w !== "object") {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), { code: "TMC_INSPECTION_REPORT_SCHEMA" });
      }
      const code = w.code;
      const allowedWarn = new Set([...Object.values(INSPECTION_WARNING), ...Object.values(INSPECTION_REJECT)]);
      if (!allowedWarn.has(code)) {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
          code: "TMC_INSPECTION_REPORT_SCHEMA",
          key: "warnings",
        });
      }
      if (w.role != null && !STRUCTURAL_ROLE_ALLOWLIST.includes(w.role)) {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_UNKNOWN_ROLE"), {
          code: "TMC_INSPECTION_REPORT_UNKNOWN_ROLE",
          key: w.role,
        });
      }
    }
  }
  const blob = JSON.stringify(out);
  if (containsForbiddenPathLeak(blob)) {
    throw Object.assign(new Error("TMC_INSPECTION_REPORT_PATH_LEAK"), {
      code: "TMC_INSPECTION_REPORT_PATH_LEAK",
    });
  }
  if (/https?:\/\//i.test(blob) || /Authorization/i.test(blob) || /Basic\s+[A-Za-z0-9+/=]{8,}/i.test(blob)) {
    throw Object.assign(new Error("TMC_INSPECTION_REPORT_SECRET_LEAK"), {
      code: "TMC_INSPECTION_REPORT_SECRET_LEAK",
    });
  }
  if (/CREATE\s+TABLE|SELECT\s+\*|INSERT\s+INTO/i.test(blob)) {
    throw Object.assign(new Error("TMC_INSPECTION_REPORT_SQL_LEAK"), {
      code: "TMC_INSPECTION_REPORT_SQL_LEAK",
    });
  }
  // Preserve promotion result; never force false here (finalize already decided).
  out.mode = INSPECTION_MODE;
  if (out.formatConfirmed === true && out.authoritativeFormatVerified === true) {
    out.authoritativeFormat = out.authoritativeFormat || "TISA_DAT_CSV";
    out.authoritativeFormatVerified = true;
    out.formatConfirmed = true;
  } else {
    out.formatConfirmed = false;
    out.authoritativeFormat = "UNVERIFIED";
    out.authoritativeFormatVerified = false;
  }
  out.datasetIntegrityState = DATASET_INTEGRITY_STATE.NOT_TESTED;
  out.importerActivated = false;
  out.resolverActivated = false;
  out.publishActivated = false;
  out.productionWrite = false;
  if (Array.isArray(out.tableAssessments)) {
    const allowedCodes = new Set([...SP08001_TABLE_CODES]);
    const allowedStates = new Set(Object.values(TABLE_STATE));
    out.tableAssessments = out.tableAssessments.map((a) => {
      if (!a || typeof a !== "object") {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
          code: "TMC_INSPECTION_REPORT_SCHEMA",
          key: "tableAssessments",
        });
      }
      if (!allowedCodes.has(a.tableCode)) {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
          code: "TMC_INSPECTION_REPORT_SCHEMA",
          key: "tableCode",
        });
      }
      const state = a.state;
      if (!allowedStates.has(state)) {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
          code: "TMC_INSPECTION_REPORT_SCHEMA",
          key: "tableState",
        });
      }
      // Strict number (reject numeric strings, NaN, Infinity, decimals).
      if (
        typeof a.candidateCount !== "number" ||
        !Number.isInteger(a.candidateCount) ||
        a.candidateCount < 0 ||
        a.candidateCount > INSPECTION_TABLE_CANDIDATE_COUNT_MAX
      ) {
        throw Object.assign(new Error("TMC_INSPECTION_REPORT_SCHEMA"), {
          code: "TMC_INSPECTION_REPORT_SCHEMA",
          key: "candidateCount",
        });
      }
      const candidateCount = a.candidateCount;
      const safeInt = (v, max = 512) =>
        typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
      const outRow = {
        tableCode: a.tableCode,
        state,
        candidateCount,
        headerMatched: a.headerMatched === true,
        schemaVerified: a.schemaVerified === true,
        limitedContentVerified: a.limitedContentVerified === true,
      };
      // Count-only schema diagnostics — never field names, values, paths, or licensed rows.
      const expectedFieldCount = safeInt(a.expectedFieldCount);
      const actualFieldCount = safeInt(a.actualFieldCount);
      const unexpectedFieldCount = safeInt(a.unexpectedFieldCount);
      const missingRequiredFieldCount = safeInt(a.missingRequiredFieldCount);
      if (expectedFieldCount != null) outRow.expectedFieldCount = expectedFieldCount;
      if (actualFieldCount != null) outRow.actualFieldCount = actualFieldCount;
      if (unexpectedFieldCount != null) outRow.unexpectedFieldCount = unexpectedFieldCount;
      if (missingRequiredFieldCount != null) outRow.missingRequiredFieldCount = missingRequiredFieldCount;
      if (
        typeof a.filePresenceClass === "string" &&
        /^(ZERO_BYTE_FILE|HEADER_ONLY|HEADER_AND_ROWS)$/.test(a.filePresenceClass)
      ) {
        outRow.filePresenceClass = a.filePresenceClass;
      }
      return outRow;
    });
  }
  if (Array.isArray(out.promotionBlockers)) {
    out.promotionBlockers = out.promotionBlockers.filter((x) => typeof x === "string" && /^[a-z0-9_]{1,64}$/.test(x)).slice(0, 32);
  }
  // Validated allowlisted report with no path/secret leaks ⇒ reportSafety=passed.
  if (out.reportSafety == null) out.reportSafety = REPORT_SAFETY.PASSED;
  return out;
}

/**
 * Cap JSON report to max bytes on field boundaries; always validate+reserialize first.
 * @param {object} report
 * @param {number} [maxBytes]
 */
export function serializeInspectionReport(report, maxBytes = INSPECTION_REPORT_MAX_BYTES) {
  const validated = validateInspectionReportObject(report);
  assertReportPathSafe(validated);
  let json = JSON.stringify(validated);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) {
    return { json, truncated: false, bytes: Buffer.byteLength(json, "utf8"), object: validated };
  }
  const slim = {
    ok: validated.ok === true,
    mode: INSPECTION_MODE,
    rejectCode: validated.rejectCode || INSPECTION_REJECT.REPORT_LIMIT,
    severity: validated.severity || "archive_reject",
    inspectionOutcome: validated.inspectionOutcome || INSPECTION_OUTCOME.EXPECTED_REJECT,
    reportSafety: validated.reportSafety || REPORT_SAFETY.PASSED,
    reportTruncated: true,
    candidateFormat: validated.candidateFormat || null,
    candidateFormatConfidence: validated.candidateFormatConfidence || null,
    candidateEvidenceSource: validated.candidateEvidenceSource || null,
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
    workDirCategory: validated.workDirCategory || PATH_CATEGORY.UNKNOWN_SANITIZED,
    cidExpected: TMC_CID_EXPECTED,
    tabcdExpected: TMC_TABCD_EXPECTED,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
  };
  const slimValidated = validateInspectionReportObject(slim);
  json = JSON.stringify(slimValidated);
  if (Buffer.byteLength(json, "utf8") > maxBytes) {
    json = JSON.stringify({
      ok: false,
      mode: INSPECTION_MODE,
      rejectCode: INSPECTION_REJECT.REPORT_LIMIT,
      reportTruncated: true,
      authoritativeFormat: "UNVERIFIED",
      authoritativeFormatVerified: false,
      importerActivated: false,
      publishActivated: false,
      productionWrite: false,
    });
  }
  return { json, truncated: true, bytes: Buffer.byteLength(json, "utf8"), object: slimValidated };
}

/**
 * Build candidate-format metadata from central-directory meta (no content).
 * @param {object} meta
 */
export function buildCandidateFormatFromCentral(meta) {
  const hasTisaLike =
    (meta.datFileCount || 0) > 0 ||
    (meta.csvFileCount || 0) > 0 ||
    (meta.txtFileCount || 0) > 0 ||
    (meta.candidateLayers && meta.candidateLayers.tisaNameHint > 0);
  return {
    candidateFormat: hasTisaLike ? TMC_FORMAT.TISA_DAT_CSV : meta.authoritativeFormat || TMC_FORMAT.UNRESOLVED,
    candidateFormatConfidence: "metadata_only",
    candidateEvidenceSource: "central_directory",
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
  };
}

/**
 * Source-authority board (always unverified until content contracts pass).
 */
export function buildSourceAuthorityBoard(roleAgg, peeks) {
  const mk = (role, evidenceLevel, sufficient) => ({
    candidateRole: role,
    evidenceLevel,
    consistencyStatus: "unknown",
    conflictStatus: "none",
    sufficientForImporter: sufficient === true,
  });
  return {
    identitySourceCandidate: mk(roleAgg.points ? "points" : "UNVERIFIED", peeks.cidOk ? "content_peek" : "metadata_only", false),
    coordinateSourceCandidate: mk(
      peeks.coordsFromDat ? "points" : peeks.coordsFromShp ? "shp_layer" : "UNVERIFIED",
      peeks.coordsFromDat || peeks.coordsFromShp ? "content_peek" : "none",
      false
    ),
    namesSourceCandidate: mk(roleAgg.names ? "names" : "UNVERIFIED", roleAgg.names ? "metadata_only" : "none", false),
    roadSourceCandidate: mk(roleAgg.roads ? "roads" : "UNVERIFIED", roleAgg.roads ? "metadata_only" : "none", false),
    administrativeSourceCandidate: mk(roleAgg.administrative ? "administrative" : "UNVERIFIED", "none", false),
    relationshipSourceCandidate: mk(roleAgg.segments ? "segments" : "UNVERIFIED", "metadata_only", false),
    offsetSourceCandidate: mk(roleAgg.offsets ? "offsets" : "UNVERIFIED", "metadata_only", false),
    versionMetadataSourceCandidate: mk(roleAgg.metadata ? "metadata" : "UNVERIFIED", "metadata_only", false),
  };
}

/**
 * Inspect synthetic or extracted entry buffers (fixtures / controlled peeks).
 * Opaque SP08001 tableCode is authoritative for format confirmation.
 * Broad roles are informational; companions never authorize DAT.
 * Fatal DUPLICATE_REQUIRED_ROLE when ≥2 content-verified instances share the same tableCode.
 * @param {{ role: string, ext: string, buf: Buffer, schemaHints?: object, tableCode?: string }[]} entries
 * @param {{ centralMeta?: object, startedAt?: number, timeoutMs?: number, decompressionErrorCount?: number }} [opts]
 */
export function inspectFormatFromEntryPeeks(entries, opts = {}) {
  const started = opts.startedAt || Date.now();
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : INSPECTION_TIMEOUT_MS;
  const warnings = [];
  const roleCounts = emptyRoleMap();
  const sizeByRole = emptyRoleMap();
  const roleCandidateCounts = emptyRoleMap();
  const roleEvidenceLevelCounts = emptyRoleMap();
  const roleContentVerifiedCounts = emptyRoleMap();
  const roleHeaderContractMatchCounts = emptyRoleMap();
  const roleCidMatchCounts = emptyRoleMap();
  const roleTabcdMatchCounts = emptyRoleMap();
  const roleConflictCounts = emptyRoleMap();
  const roleExtensionCategoryCounts = emptyRoleMap();
  let cid11 = false;
  let tabcd25 = false;
  let cidMismatch = false;
  let tabcdMismatch = false;
  let peeks = { cidOk: false, coordsFromDat: false, coordsFromShp: false };
  const encodingLayers = [];
  let sqlite = null;
  let delimiterVotes = Object.create(null);
  let headerStateVotes = Object.create(null);
  let fieldCountSum = 0;
  let fieldCountN = 0;
  let contentVerifiedTableCount = 0;
  const verifiedTableCodes = new Set();
  const headerMatchedTableCodes = new Set();
  const tableCodeCvCounts = Object.create(null);
  const tableCodePresenceCounts = Object.create(null);
  const tableAssessmentsMap = Object.create(null);
  let requiredTablesPresent = 0;
  let optionalTablesPresent = 0;
  let unknownSupplementaryTables = 0;
  let readmeMappedCount = 0;
  let readmeParseState = null;
  let readmeBomPresent = false;
  let readmeNonEmptyLineCount = 0;
  let readmeMetaFieldObservedCount = 0;
  let datDecodeSuccessCount = 0;
  let datDecodeFailureCount = 0;
  let broadCandidateSupersededCount = 0;

  function upsertAssessment(tableCode, patch) {
    if (!tableCode) return;
    if (!tableAssessmentsMap[tableCode]) {
      tableAssessmentsMap[tableCode] = emptyTableAssessment(tableCode);
    }
    Object.assign(tableAssessmentsMap[tableCode], patch);
  }

  for (const ent of entries) {
    if (Date.now() - started > timeoutMs) {
      return failReport(INSPECTION_REJECT.TIMEOUT, "timeout", opts.centralMeta);
    }
    let role = ent.role || classifyEntryRole(ent.name || "x." + (ent.ext || "dat"));
    if (!STRUCTURAL_ROLE_ALLOWLIST.includes(role)) role = "ignored_other";
    // README is metadata (not in SP08001_TABLE_CODES) but must keep opaque code for encoding bootstrap.
    const tableCode =
      ent.tableCode === "README" || (ent.tableCode && SP08001_TABLE_CODES.includes(ent.tableCode))
        ? ent.tableCode
        : null;
    bump(roleCounts, role);
    bump(roleCandidateCounts, role);
    sizeByRole[role] = (sizeByRole[role] || 0) + (ent.buf ? ent.buf.length : 0);
    const extCat = extCategoryOf(ent.ext);
    if (!roleExtensionCategoryCounts[role]) roleExtensionCategoryCounts[role] = Object.create(null);
    bump(roleExtensionCategoryCounts[role], extCat);

    const ext = String(ent.ext || "").toLowerCase();
    let evidenceLevel = ROLE_EVIDENCE_LEVEL.FILENAME_HINT;

    if (ext === "cpg") {
      const c = inspectCpgPeek(ent.buf);
      encodingLayers.push({ layer: ENCODING_LAYER.CPG_SHP_DBF, encoding: c.encodingNormalized });
      evidenceLevel = ROLE_EVIDENCE_LEVEL.METADATA_ONLY;
      bump(roleEvidenceLevelCounts, evidenceLevel);
      continue;
    }
    if (ext === "dbf") {
      inspectDbfHeader(ent.buf);
      evidenceLevel = ROLE_EVIDENCE_LEVEL.METADATA_ONLY;
      bump(roleEvidenceLevelCounts, evidenceLevel);
      continue;
    }
    if (ext === "shp" || ext === "shx") {
      const sh = inspectShpHeader(ent.buf, ext);
      if (sh.validHeader && sh.boundingBoxCountryCheck === "plausible_czech_extent") peeks.coordsFromShp = true;
      evidenceLevel = ROLE_EVIDENCE_LEVEL.METADATA_ONLY;
      bump(roleEvidenceLevelCounts, evidenceLevel);
      continue;
    }
    if (ext === "db" || ext === "sqlite" || ext === "sqlite3") {
      sqlite = inspectSqliteHeader(ent.buf, ent.schemaHints || null);
      evidenceLevel = ROLE_EVIDENCE_LEVEL.METADATA_ONLY;
      bump(roleEvidenceLevelCounts, evidenceLevel);
      continue;
    }
    if (ext === "dat" || ext === "txt" || ext === "csv") {
      if (ent.buf && ent.buf.length > INSPECTION_TEXT_PEEK_BYTES) {
        warnings.push({ code: INSPECTION_WARNING.READ_LIMIT, severity: "warning" });
      }
      const peek = inspectTextPeek(ent.buf ? ent.buf.slice(0, INSPECTION_TEXT_PEEK_BYTES) : Buffer.alloc(0));
      if (peek.cid11Seen) {
        cid11 = true;
        peeks.cidOk = peek.cidUnambiguous;
      }
      if (peek.tabcd25Seen) tabcd25 = true;
      if (peek.candidateCoordinateColumns) peeks.coordsFromDat = true;
      // README meta must not vote as DAT_DETECTED (SP08001 README is ASCII; DAT default is separate).
      if (peek.encodingCandidate && peek.encodingCandidate !== "UNKNOWN" && tableCode !== "README") {
        encodingLayers.push({ layer: ENCODING_LAYER.DAT_DETECTED, encoding: peek.encodingCandidate });
      }
      if (peek.delimiter && peek.delimiter !== "unknown") bump(delimiterVotes, peek.delimiter);
      if (peek.hasHeader) bump(headerStateVotes, "PRESENT");
      else if (peek.positional) bump(headerStateVotes, "ABSENT");
      if (peek.fieldCount > 0) {
        fieldCountSum += peek.fieldCount;
        fieldCountN += 1;
      }

      if (tableCode === "README") {
        const rm = parseReadmeDatStructural(ent.buf || Buffer.alloc(0));
        readmeMappedCount = rm.readmeMapped ? 1 : 0;
        readmeParseState = rm.readmeParseState;
        readmeBomPresent = rm.readmeBomPresent === true;
        readmeNonEmptyLineCount =
          typeof rm.readmeNonEmptyLineCount === "number" ? rm.readmeNonEmptyLineCount : 0;
        readmeMetaFieldObservedCount =
          typeof rm.readmeMetaFieldObservedCount === "number" ? rm.readmeMetaFieldObservedCount : 0;
        encodingLayers.push({ layer: ENCODING_LAYER.README_DECLARED, encoding: "ASCII" });
        if (rm.datEncodingSource === DAT_ENCODING_SOURCE.readme_declared && rm.declaredEncodingNormalized) {
          encodingLayers.push({
            layer: ENCODING_LAYER.DAT_DECLARED,
            encoding: rm.declaredEncodingNormalized,
            source: "readme_declared",
          });
        } else if (rm.datEncodingSource === DAT_ENCODING_SOURCE.sp08001_default) {
          encodingLayers.push({
            layer: ENCODING_LAYER.DAT_DECLARED,
            encoding: SP08001_PHYSICAL.defaultEncoding || "UTF-8",
            source: "sp08001_default",
          });
        }
        evidenceLevel = ROLE_EVIDENCE_LEVEL.METADATA_ONLY;
        bump(roleEvidenceLevelCounts, evidenceLevel);
        continue;
      }

      if (tableCode && SP08001_TABLE_CODES.includes(tableCode)) {
        tableCodePresenceCounts[tableCode] = (tableCodePresenceCounts[tableCode] || 0) + 1;
        const assessed = assessSp08001ContentContract(tableCode, peek, {
          buf: ent.buf,
          byteLength: ent.buf ? ent.buf.length : 0,
        });
        if (peek.encodingCandidate === "NON_UTF8") datDecodeFailureCount += 1;
        else if (peek.encodingCandidate && peek.encodingCandidate !== "UNKNOWN") datDecodeSuccessCount += 1;
        evidenceLevel =
          assessed.evidenceLevel === "content_verified"
            ? ROLE_EVIDENCE_LEVEL.CONTENT_VERIFIED
            : assessed.evidenceLevel === "header_contract"
              ? ROLE_EVIDENCE_LEVEL.HEADER_CONTRACT
              : peek.hasHeader || peek.positional
                ? ROLE_EVIDENCE_LEVEL.METADATA_ONLY
                : ROLE_EVIDENCE_LEVEL.FILENAME_HINT;
        const state = assessed.tableState || TABLE_STATE.missing_complete_header;
        const row = buildTableAssessmentReportRow(tableCode, state, tableCodePresenceCounts[tableCode]);
        const expectedFieldCount =
          typeof assessed.expectedFieldCount === "number" ? assessed.expectedFieldCount : null;
        const actualFieldCount =
          typeof assessed.actualFieldCount === "number"
            ? assessed.actualFieldCount
            : typeof assessed.fieldCount === "number"
              ? assessed.fieldCount
              : null;
        let unexpectedFieldCount = 0;
        let missingRequiredFieldCount = 0;
        if (
          expectedFieldCount != null &&
          actualFieldCount != null &&
          state === TABLE_STATE.unexpected_field &&
          actualFieldCount > expectedFieldCount
        ) {
          unexpectedFieldCount = actualFieldCount - expectedFieldCount;
        }
        if (state === TABLE_STATE.missing_required_field && expectedFieldCount != null && actualFieldCount != null) {
          missingRequiredFieldCount = Math.max(0, expectedFieldCount - actualFieldCount);
        }
        upsertAssessment(tableCode, {
          ...row,
          headerMatchState: row.headerMatched ? HEADER_MATCH_STATE.MATCH : HEADER_MATCH_STATE.MISMATCH,
          contentVerifiedState: row.limitedContentVerified
            ? CONTENT_VERIFIED_STATE.YES
            : CONTENT_VERIFIED_STATE.NO,
          mismatchReason: assessed.mismatchReason || TABLE_MISMATCH_REASON.EMPTY_HEADER,
          assessmentClass: classifySp08001TableAssessmentClass(tableCode),
          expectedFieldCount,
          actualFieldCount,
          unexpectedFieldCount,
          missingRequiredFieldCount,
          filePresenceClass: assessed.filePresenceClass || null,
        });
        if (row.headerMatched) headerMatchedTableCodes.add(tableCode);
        if (REQUIRED_SINGLETON_ROLES.includes(role)) {
          if (assessed.headerContractMatch) bump(roleHeaderContractMatchCounts, role);
          if (assessed.cidMatch) bump(roleCidMatchCounts, role);
          if (assessed.tabcdMatch) bump(roleTabcdMatchCounts, role);
          if (assessed.contentVerified) bump(roleContentVerifiedCounts, role);
        }
        if (assessed.contentVerified || state === TABLE_STATE.schema_and_limited_content_verified) {
          verifiedTableCodes.add(tableCode);
          tableCodeCvCounts[tableCode] = (tableCodeCvCounts[tableCode] || 0) + 1;
        }
      } else if (REQUIRED_SINGLETON_ROLES.includes(role)) {
        const assessed = assessSingletonContentContract(role, peek, { tableCode: null });
        evidenceLevel = assessed.evidenceLevel;
        unknownSupplementaryTables += 1;
      } else {
        unknownSupplementaryTables += 1;
        evidenceLevel =
          peek.hasHeader || peek.positional ? ROLE_EVIDENCE_LEVEL.METADATA_ONLY : ROLE_EVIDENCE_LEVEL.FILENAME_HINT;
      }
      bump(roleEvidenceLevelCounts, evidenceLevel);
      continue;
    }
    bump(roleEvidenceLevelCounts, evidenceLevel);
  }

  contentVerifiedTableCount = verifiedTableCodes.size;
  const encResolved = resolveEncodingLayers(encodingLayers);
  let encodingNorm = encResolved.datEncoding || "UNKNOWN";
  if (encodingNorm === "UNVERIFIED") encodingNorm = "UNKNOWN";
  const datEncodingSource =
    encResolved.datEncodingSource === "readme_declared"
      ? DAT_ENCODING_SOURCE.readme_declared
      : encResolved.datEncodingSource === "sp08001_default"
        ? DAT_ENCODING_SOURCE.sp08001_default
        : DAT_ENCODING_SOURCE.unresolved;
  if (readmeParseState == null) {
    readmeParseState = README_PARSE_STATE.missing_fail_closed;
  }

  let delimiterNormalized = "UNVERIFIED";
  {
    const keys = Object.keys(delimiterVotes);
    if (keys.length === 1) delimiterNormalized = keys[0];
    else if (keys.length > 1) delimiterNormalized = "CONFLICT";
  }
  let headerState = "UNVERIFIED";
  {
    const keys = Object.keys(headerStateVotes);
    if (keys.length === 1) headerState = keys[0] === "PRESENT" ? "PRESENT" : "ABSENT";
    else if (keys.includes("PRESENT") && keys.includes("ABSENT")) headerState = "MIXED";
  }
  const fieldCountAggregate = fieldCountN ? Math.round(fieldCountSum / fieldCountN) : 0;

  for (const role of REQUIRED_SINGLETON_ROLES) {
    if ((roleCandidateCounts[role] || 0) > 0) requiredTablesPresent += 1;
  }
  optionalTablesPresent = Math.max(0, Object.keys(roleCandidateCounts).length - requiredTablesPresent);

  const central = opts.centralMeta || {};
  const candidate = buildCandidateFormatFromCentral({
    ...central,
    datFileCount: central.datFileCount || roleCounts.points || roleCounts.unknown_dat || 0,
    txtFileCount: central.txtFileCount || roleCounts.unknown_txt || 0,
    candidateLayers: central.candidateLayers || { tisaNameHint: roleCounts.points ? 1 : 0 },
  });

  let duplicateRequired = false;
  let duplicateRequiredRoleCount = 0;
  let multipleCandidateRoleCount = 0;
  let unresolvedRoleCount = 0;
  let tableCodeConflictCount = 0;
  let exactTableCodeConflictCount = 0;

  for (const [code, n] of Object.entries(tableCodePresenceCounts)) {
    if (n >= 2) {
      duplicateRequired = true;
      duplicateRequiredRoleCount += 1;
      tableCodeConflictCount += 1;
      exactTableCodeConflictCount += 1;
      const prev = tableAssessmentsMap[code];
      upsertAssessment(code, {
        ...buildTableAssessmentReportRow(code, TABLE_STATE.duplicate_exact_tablecode, n),
        headerMatchState: HEADER_MATCH_STATE.MISMATCH,
        contentVerifiedState: CONTENT_VERIFIED_STATE.NO,
        mismatchReason: TABLE_MISMATCH_REASON.COLUMN_ORDER_OR_CODE,
        assessmentClass: classifySp08001TableAssessmentClass(code),
        ...(prev || {}),
        state: TABLE_STATE.duplicate_exact_tablecode,
        candidateCount: n,
        headerMatched: false,
        schemaVerified: false,
        limitedContentVerified: false,
      });
      const roleHint = SP08001_CODE_TO_ROLE[code];
      if (roleHint) bump(roleConflictCounts, roleHint, n);
    }
  }

  for (const role of REQUIRED_SINGLETON_ROLES) {
    const candidates = roleCandidateCounts[role] || 0;
    const contentVerified = roleContentVerifiedCounts[role] || 0;
    if (contentVerified >= 1) {
      if (candidates > 1) {
        multipleCandidateRoleCount += 1;
        broadCandidateSupersededCount += 1;
        warnings.push({
          code: INSPECTION_WARNING.MULTIPLE_ROLE_CANDIDATES,
          severity: "warning",
          role,
          candidateCount: candidates,
          contentVerifiedCount: contentVerified,
        });
      }
      continue;
    }
    if (candidates > 1) {
      multipleCandidateRoleCount += 1;
      warnings.push({
        code: INSPECTION_WARNING.MULTIPLE_ROLE_CANDIDATES,
        severity: "insufficient_evidence",
        role,
        candidateCount: candidates,
        contentVerifiedCount: contentVerified,
      });
      unresolvedRoleCount += 1;
    } else if (candidates === 1 && contentVerified < 1) {
      unresolvedRoleCount += 1;
    }
  }

  for (const code of REQUIRED_STANDARD_TABLES) {
    if (!tableAssessmentsMap[code]) {
      upsertAssessment(code, emptyTableAssessment(code, { state: TABLE_STATE.missing_required_file }));
    }
  }
  const tableAssessments = Object.keys(tableAssessmentsMap)
    .filter((k) => SP08001_TABLE_CODES.includes(k))
    .sort()
    .map((k) => {
      const a = tableAssessmentsMap[k];
      const row = buildTableAssessmentReportRow(
        k,
        a.state || TABLE_STATE.missing_required_file,
        a.candidateCount || tableCodePresenceCounts[k] || 0
      );
      // Preserve count-only schema diagnostics (no field names/values).
      if (typeof a.expectedFieldCount === "number") row.expectedFieldCount = a.expectedFieldCount;
      if (typeof a.actualFieldCount === "number") row.actualFieldCount = a.actualFieldCount;
      if (typeof a.unexpectedFieldCount === "number") row.unexpectedFieldCount = a.unexpectedFieldCount;
      if (typeof a.missingRequiredFieldCount === "number") {
        row.missingRequiredFieldCount = a.missingRequiredFieldCount;
      }
      if (typeof a.filePresenceClass === "string") row.filePresenceClass = a.filePresenceClass;
      return row;
    });

  let cidState = "NOT_SEEN";
  let tabcdState = "NOT_SEEN";
  {
    let cidContract = false;
    let tabcdContract = false;
    for (const a of tableAssessments) {
      if (a.state !== TABLE_STATE.schema_and_limited_content_verified) continue;
      const table = SP08001_TABLE_CODES.includes(a.tableCode);
      if (!table) continue;
      // Contract match via limited content on tables that carry CID/TABCD.
      if (["POINTS", "NAMES", "COUNTRIES", "LOCATIONDATASETS", "ROADS", "SEGMENTS", "ADMINISTRATIVEAREA"].includes(a.tableCode)) {
        cidContract = true;
      }
      if (["POINTS", "LOCATIONDATASETS", "ROADS", "SEGMENTS", "ADMINISTRATIVEAREA"].includes(a.tableCode)) {
        tabcdContract = true;
      }
    }
    if (cidContract) cidState = "MATCHED_IN_CONTRACT";
    else if (cid11) cidState = "TOKEN_ONLY_UNVERIFIED";
    if (tabcdContract) tabcdState = "MATCHED_IN_CONTRACT";
    else if (tabcd25) tabcdState = "TOKEN_ONLY_UNVERIFIED";
  }

  const board = buildSourceAuthorityBoard(roleCounts, peeks);

  let rejectCode = null;
  if (duplicateRequired) rejectCode = INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE;
  else if (cidMismatch) rejectCode = INSPECTION_REJECT.CID_MISMATCH;
  else if (tabcdMismatch) rejectCode = INSPECTION_REJECT.TABCD_MISMATCH;
  else if (sqlite && !sqlite.sqliteVerified && roleCounts.sqlite_candidate) {
    warnings.push({ code: INSPECTION_WARNING.SQLITE_UNVERIFIED, severity: "insufficient_evidence" });
  }

  const severity = duplicateRequired
    ? "archive_reject"
    : cidMismatch || tabcdMismatch
      ? "archive_reject"
      : "insufficient_evidence";

  const readmeEncodingState = encResolved.layerStatus
    ? encResolved.layerStatus[ENCODING_LAYER.README_DECLARED] || "ABSENT"
    : "ABSENT";

  const promotion = evaluateFormatContractPromotion({
    tableAssessments,
    exchangeFormatContractVersion: SP08001_EXCHANGE_FORMAT_VERSION,
    authoritativeLayer: SP08001_PHYSICAL.authoritativeLayer,
    delimiterNormalized,
    decompressionErrorCount: opts.decompressionErrorCount || 0,
    exactTableCodeConflictCount,
    tableCodeConflictCount,
    readmeParseState,
    datEncodingSource,
    encodingDatLayer: encodingNorm,
    cidMatchState: cidState,
    tabcdMatchState: tabcdState,
  });

  const formatConfirmed = !duplicateRequired && promotion.formatConfirmed === true;
  const authoritativeFormat = formatConfirmed ? SP08001_PHYSICAL.authoritativeLayer : "UNVERIFIED";
  const authoritativeFormatVerified = formatConfirmed;

  const exactTableCodeResolvedCount = tableAssessments.filter(
    (a) =>
      a.state === TABLE_STATE.schema_and_limited_content_verified ||
      a.state === TABLE_STATE.schema_verified_empty
  ).length;

  const report = {
    ok: rejectCode == null && formatConfirmed,
    mode: INSPECTION_MODE,
    severity: formatConfirmed && !duplicateRequired ? "ok" : severity,
    rejectCode: formatConfirmed && !duplicateRequired ? null : rejectCode,
    warnings,
    ...candidate,
    authoritativeFormat,
    authoritativeFormatVerified,
    formatConfirmed,
    formatContractConfirmed: formatConfirmed,
    datasetIntegrityState: DATASET_INTEGRITY_STATE.NOT_TESTED,
    importerIntegrityRequired: true,
    importerIntegrityConfirmed: false,
    promotionPolicyVersion: PROMOTION_POLICY_VERSION,
    promotionBlockers: promotion.promotionBlockers,
    tableAssessments,
    tableCodeConflictCount,
    exactTableCodeResolvedCount,
    exactTableCodeConflictCount,
    broadCandidateSupersededCount,
    unresolvedExactTableCount: promotion.unresolvedExactTableCount,
    missingRequiredStandardTableCount: promotion.missingRequiredStandardTableCount,
    schemaVerifiedEmptyTableCount: promotion.schemaVerifiedEmptyTableCount,
    schemaVerifiedTableCount: promotion.schemaVerifiedTableCount,
    limitedContentVerifiedTableCount: promotion.limitedContentVerifiedTableCount,
    opaqueTableCodeVerifiedCount: contentVerifiedTableCount,
    standardTableHeaderMatchCount: headerMatchedTableCodes.size,
    identificationTablesPresentCount: exactTableCodeResolvedCount,
    identificationTablesVerifiedCount: promotion.limitedContentVerifiedTableCount,
    cidExpected: TMC_CID_EXPECTED,
    tabcdExpected: TMC_TABCD_EXPECTED,
    cid11Detected: cid11,
    tabcd25Detected: tabcd25,
    encodingNormalized: encodingNorm,
    structuralRoleCounts: roleCounts,
    structuralRoleBytes: sizeByRole,
    roleCandidateCounts,
    roleEvidenceLevelCounts,
    roleContentVerifiedCounts,
    roleHeaderContractMatchCounts,
    roleCidMatchCounts,
    roleTabcdMatchCounts,
    roleConflictCounts,
    roleExtensionCategoryCounts,
    duplicateRequiredRoleCount,
    multipleCandidateRoleCount,
    unresolvedRoleCount,
    sourceAuthority: board,
    sqlite,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
    reportTruncated: false,
    authoritativeLayer: SP08001_PHYSICAL.authoritativeLayer,
    exchangeFormatContractVersion: SP08001_EXCHANGE_FORMAT_VERSION,
    tableContractCount: SP08001_STANDARD_TABLE_COUNT,
    contentVerifiedTableCount,
    delimiterNormalized,
    headerState,
    fieldCountAggregate,
    requiredTablesPresent,
    optionalTablesPresent,
    unknownSupplementaryTables,
    metadataFileCount: readmeMappedCount > 0 ? 1 : 0,
    readmeEncodingState,
    readmeParseState,
    readmeMappedCount,
    readmeBomPresent,
    readmeNonEmptyLineCount,
    readmeMetaFieldObservedCount,
    datEncodingSource,
    datDecodeSuccessCount,
    datDecodeFailureCount,
    companionEncodingIgnoredForDatCount: encResolved.companionEncodingIgnoredForDatCount || 0,
    cidMatchState: cidState,
    tabcdMatchState: tabcdState,
    coordinateSource: peeks.coordsFromDat ? "points_dat" : peeks.coordsFromShp ? "shp_companion" : "UNVERIFIED",
    relationshipIntegrity: "UNVERIFIED",
    encodingDatLayer: encodingNorm,
    encodingCpgLayer: encResolved.cpgEncoding,
    encodingFalseConflictAvoided: encResolved.falseConflictAvoided === true,
  };
  return finalizeInspectionOutcome(report);
}


function failReport(code, severity, centralMeta) {
  return finalizeInspectionOutcome({
    ok: false,
    mode: INSPECTION_MODE,
    severity,
    rejectCode: code,
    ...buildCandidateFormatFromCentral(centralMeta || {}),
    authoritativeFormat: "UNVERIFIED",
    authoritativeFormatVerified: false,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
  });
}

function peekBudgetForExt(ext) {
  if (ext === "cpg") return INSPECTION_CPG_MAX_BYTES;
  if (ext === "dbf" || ext === "shp" || ext === "shx") return INSPECTION_HEADER_MAX_BYTES;
  if (ext === "db" || ext === "sqlite" || ext === "sqlite3") return 16;
  return INSPECTION_TEXT_PEEK_BYTES;
}

/**
 * Collect allowlisted peek targets. Derives opaque SP08001 tableCode from basename
 * BEFORE discarding the path. Targets never retain filename/path.
 * @param {string} zipPath
 * @param {object} [lim]
 */
export function collectInspectionPeekTargets(zipPath, lim = {}) {
  const limits = { maxEntries: 5000, maxNameLen: 256, maxPathDepth: 8, ...lim };
  const st = fs.statSync(zipPath);
  const targets = [];
  const ignoredCategoryCounts = Object.create(null);
  let tableCodeMappedCount = 0;
  let tableCodeUnknownCount = 0;
  const fd = fs.openSync(zipPath, "r");
  try {
    const tailLen = Math.min(st.size, 65536 + 22);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      return { ok: false, rejectCode: INSPECTION_REJECT.FORMAT_UNVERIFIED, targets: [], ignoredCategoryCounts };
    }
    const totalEntries = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      return { ok: false, rejectCode: INSPECTION_REJECT.FORMAT_UNVERIFIED, targets: [], ignoredCategoryCounts };
    }
    if (cdOffset + cdSize > st.size) {
      return { ok: false, rejectCode: INSPECTION_REJECT.PATH_INVALID, targets: [], ignoredCategoryCounts };
    }
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    let off = 0;
    while (off + 46 <= cd.length && targets.length < INSPECTION_MAX_PEEK_ENTRIES) {
      if (cd.readUInt32LE(off) !== CENTRAL_SIG) {
        off += 1;
        continue;
      }
      const flags = cd.readUInt16LE(off + 8);
      const method = cd.readUInt16LE(off + 10);
      const comp = cd.readUInt32LE(off + 20);
      const uncomp = cd.readUInt32LE(off + 24);
      const nameLen = cd.readUInt16LE(off + 28);
      const extraLen = cd.readUInt16LE(off + 30);
      const commentLen = cd.readUInt16LE(off + 32);
      const externalAttrs = cd.readUInt32LE(off + 38);
      const localOffset = cd.readUInt32LE(off + 42);
      let nameRaw = "";
      try {
        nameRaw = cd.slice(off + 46, off + 46 + nameLen).toString("utf8");
      } catch (_) {
        return { ok: false, rejectCode: INSPECTION_REJECT.PATH_INVALID, targets: [], ignoredCategoryCounts };
      }
      const classified = classifyZipPath(nameRaw, {
        maxDepth: limits.maxPathDepth,
        maxNameLen: limits.maxNameLen,
      });
      const entryPath = classified.ok ? classified.path : "";
      const baseWithExt = entryPath ? path.basename(entryPath) : "";
      // Opaque tableCode BEFORE redacting basename from further pipeline.
      let tableCode = baseWithExt ? resolveSp08001TableCodeFromBasename(baseWithExt) : null;
      if (tableCode && !SP08001_TABLE_CODES.includes(tableCode) && tableCode !== "README") {
        tableCode = null;
      }
      if (tableCode === "README" || (tableCode && SP08001_TABLE_CODES.includes(tableCode))) {
        tableCodeMappedCount += 1;
      } else if (classified.ok && !classified.isDirectory) {
        const extProbe = (String(entryPath).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
        if (extProbe === "dat" || extProbe === "txt" || extProbe === "csv") tableCodeUnknownCount += 1;
      }
      const role = classified.ok ? classifyEntryRole(entryPath) : "ignored_other";
      const ext = classified.ok
        ? (String(entryPath).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ""
        : "";
      nameRaw = "";
      off += 46 + nameLen + extraLen + commentLen;

      if (!classified.ok) {
        bump(ignoredCategoryCounts, "path_reject");
        continue;
      }
      if (classified.isDirectory) continue;
      if (NESTED_ARCHIVE_EXTS.has(ext)) {
        bump(ignoredCategoryCounts, "nested_archive");
        continue;
      }
      if (!PEEK_EXTS.has(ext)) {
        bump(ignoredCategoryCounts, role === "ignored_other" ? "ignored_other" : role);
        continue;
      }
      if (flags & 0x1) {
        bump(ignoredCategoryCounts, "encrypted");
        continue;
      }
      if (method !== 0 && method !== 8) {
        bump(ignoredCategoryCounts, "unsupported_compression");
        continue;
      }
      const mode = (externalAttrs >>> 16) & 0xffff;
      if ((mode & 0xf000) === 0xa000) {
        bump(ignoredCategoryCounts, "symlink");
        continue;
      }
      targets.push({
        role,
        ext,
        method,
        flags,
        comp,
        uncomp,
        localOffset,
        tableCode: tableCode || null,
      });
    }
    return {
      ok: true,
      rejectCode: null,
      targets,
      ignoredCategoryCounts,
      tableCodeMappedCount,
      tableCodeUnknownCount,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @deprecated Do not use for live peek — retained name only to fail closed if called.
 */
export function peekZipEntryBytes() {
  throw Object.assign(new Error("REFUSING_SYNC_INFLATE_PEEK"), {
    code: INSPECTION_REJECT.INTERNAL_ERROR,
  });
}

/**
 * Live/offline ZIP format inspection from on-disk archive (streaming peek only).
 * Never activates importer/resolver/publish. Never embeds raw rows or basenames.
 * @param {string} zipPath
 * @param {{ workDir?: string, timeoutMs?: number, startedAt?: number, signal?: AbortSignal }} [opts]
 */
export async function inspectTmcZipFormatFromFile(zipPath, opts = {}) {
  const started = opts.startedAt || Date.now();
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : INSPECTION_TIMEOUT_MS;
  const workDir = opts.workDir || path.dirname(zipPath);
  const signal = opts.signal || null;

  let central;
  try {
    central = inspectZipFileCentral(zipPath);
  } catch (_) {
    return failReport(INSPECTION_REJECT.PATH_INVALID, "archive_reject", null);
  }

  if (central.entrySizeRejectCategory || central.pathRejectCategory) {
    const report = failReport(
      central.pathRejectCategory
        ? INSPECTION_REJECT.PATH_INVALID
        : INSPECTION_REJECT.ENTRY_TOO_LARGE,
      "archive_reject",
      central
    );
    report.centralDirectory = {
      fileEntryCount: central.fileEntryCount,
      datFileCount: central.datFileCount,
      txtFileCount: central.txtFileCount,
      fileExtSummary: central.fileExtSummary,
      candidateLayers: central.candidateLayers,
    };
    report.workDirCategory = categorizePath(workDir);
    return report;
  }

  const collected = collectInspectionPeekTargets(zipPath);
  if (!collected.ok) {
    return failReport(collected.rejectCode || INSPECTION_REJECT.FORMAT_UNVERIFIED, "archive_reject", central);
  }

  const entries = [];
  let totalPeek = 0;
  const peekStatusCounts = Object.create(null);
  let softEmptyPeekCount = 0;
  let decompressionErrorCount = 0;
  let truncatedPeekCount = 0;
  let completeHeaderCount = 0;

  // Sequential only (INSPECTION_PEEK_CONCURRENCY === 1).
  for (const t of collected.targets) {
    if (Date.now() - started > timeoutMs || (signal && signal.aborted)) {
      return failReport(INSPECTION_REJECT.TIMEOUT, "timeout", central);
    }
    const budget = peekBudgetForExt(t.ext);
    if (totalPeek + budget > INSPECTION_MAX_TOTAL_PEEK_BYTES) {
      return failReport(INSPECTION_REJECT.MEMORY_LIMIT, "archive_reject", central);
    }
    const peeked = await peekZipEntryBytesStreaming(zipPath, t, budget, {
      timeoutMs,
      startedAt: started,
      signal,
    });
    bump(peekStatusCounts, peeked.status);
    if (peeked.status === PEEK_STATUS.EMPTY_ENTRY) softEmptyPeekCount += 1;
    if (peeked.status === PEEK_STATUS.DECOMPRESSION_ERROR) decompressionErrorCount += 1;
    if (peeked.status === PEEK_STATUS.TRUNCATED_AT_LIMIT) truncatedPeekCount += 1;
    if (
      peeked.status === PEEK_STATUS.DECOMPRESSION_ERROR ||
      peeked.status === PEEK_STATUS.STRUCTURAL_ERROR ||
      peeked.status === PEEK_STATUS.UNSUPPORTED_METHOD ||
      peeked.status === PEEK_STATUS.ENCRYPTED_REJECTED ||
      peeked.status === PEEK_STATUS.TIMEOUT
    ) {
      // Distinguished failure — do not disguise as empty success.
      entries.push({
        role: t.role,
        ext: t.ext,
        tableCode: t.tableCode || null,
        buf: Buffer.alloc(0),
        peekStatus: peeked.status,
      });
      continue;
    }
    totalPeek += peeked.buf.length;
    const hdr = extractFirstLogicalHeaderLine(peeked.buf, {
      maxHeaderBytes: INSPECTION_HEADER_MAX_BYTES,
      maxFields: INSPECTION_HEADER_FIELD_LIMIT,
    });
    if (hdr.complete === true) completeHeaderCount += 1;
    entries.push({
      role: t.role,
      ext: t.ext,
      tableCode: t.tableCode || null,
      buf: peeked.buf,
      peekStatus: peeked.status,
      headerLineStatus: hdr.status,
    });
  }

  const report = inspectFormatFromEntryPeeks(entries, {
    centralMeta: central,
    startedAt: started,
    timeoutMs,
    decompressionErrorCount,
  });
  report.candidateEvidenceSource = entries.length
    ? "content_peek"
    : report.candidateEvidenceSource || "central_directory";
  if (report.candidateEvidenceSource === "content_peek") {
    report.candidateFormatConfidence = "content_peek_limited";
  }
  // Do not clobber formatConfirmed / authoritativeFormatVerified from promotion.
  report.liveNetworkInspection = false;
  report.ignoredCategoryCounts = collected.ignoredCategoryCounts;
  report.peekEntryCount = entries.length;
  report.peekTotalBytes = totalPeek;
  report.softEmptyPeekCount = softEmptyPeekCount;
  report.decompressionErrorCount = decompressionErrorCount;
  report.truncatedPeekCount = truncatedPeekCount;
  report.completeHeaderCount = completeHeaderCount;
  report.tableCodeMappedCount = collected.tableCodeMappedCount || 0;
  report.tableCodeUnknownCount = collected.tableCodeUnknownCount || 0;
  report.peekStatusCounts = peekStatusCounts;
  report.centralDirectory = {
    fileEntryCount: central.fileEntryCount,
    datFileCount: central.datFileCount,
    txtFileCount: central.txtFileCount,
    fileExtSummary: central.fileExtSummary,
    candidateLayers: central.candidateLayers,
  };
  report.workDirCategory = categorizePath(workDir);
  report.importerActivated = false;
  report.resolverActivated = false;
  report.publishActivated = false;
  report.productionWrite = false;
  try {
    assertReportPathSafe(report);
  } catch (_) {
    return failReport(INSPECTION_REJECT.INTERNAL_ERROR, "internal_failure", central);
  }
  return finalizeInspectionOutcome(report);
}

/**
 * Refuse test providers / env activation for real inspection entrypoints.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 */
export function assertInspectionProductionSafe(env = process.env, opts = {}) {
  assertNoTestDiskProviderEnv(env);
  if (opts.measureDeps && opts.measureDeps.__ndicTestDiskStatsProvider) {
    const mode = String(env.IU_NDIC_DATEX_V1_MODE || "").toLowerCase();
    if (mode === "shadow" || mode === "active" || mode === "format_inspection") {
      throw Object.assign(new Error("REFUSING_TEST_DISK_PROVIDER_IN_INSPECTION"), {
        code: "REFUSING_TEST_DISK_PROVIDER_IN_INSPECTION",
      });
    }
  }
  if (env.IU_NDIC_TEST_INSPECTION_FIXTURE || env.IU_NDIC_FAKE_TMC_FORMAT) {
    throw Object.assign(new Error("REFUSING_TEST_INSPECTION_ENV"), {
      code: "REFUSING_TEST_INSPECTION_ENV",
    });
  }
  for (const a of process.argv.slice(2)) {
    if (/^--(fixture|fake|test-provider|zip-path)=/i.test(a) || /^--(fixture|fake|test-provider)$/i.test(a)) {
      throw Object.assign(new Error("REFUSING_TEST_INSPECTION_CLI"), {
        code: "REFUSING_TEST_INSPECTION_CLI",
      });
    }
  }
}

export {
  PATH_CATEGORY,
  categorizePath,
  containsForbiddenPathLeak,
  assertReportPathSafe,
  TMC_CID_EXPECTED,
  TMC_TABCD_EXPECTED,
  TMC_FORMAT,
};
