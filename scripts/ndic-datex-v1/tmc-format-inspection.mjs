/**
 * Safe TMC v11 format-inspection (content peek only).
 * Never implements importer/resolver. Never dumps raw rows, basenames, coords, or LCDs.
 * TEST disk/measure inject only via direct API (createTestDiskStatsProvider) — never env.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { inspectZipFileCentral, TMC_FORMAT, TMC_CID_EXPECTED, TMC_TABCD_EXPECTED } from "./tmc-archive-stream.mjs";
import { classifyZipPath, TMC_PATH_REJECT } from "./tmc-zip.mjs";
import { assertNoTestDiskProviderEnv, classifyDiskPath } from "./disk-preflight.mjs";
import {
  PATH_CATEGORY,
  categorizePath,
  assertReportPathSafe,
  containsForbiddenPathLeak,
} from "./tmc-path-redaction.mjs";

export const INSPECTION_MODE = "format_inspection";
export const INSPECTION_REPORT_MAX_BYTES = 64 * 1024;
export const INSPECTION_TEXT_PEEK_BYTES = 4 * 1024;
export const INSPECTION_MAX_TEXT_LINES = 8;
export const INSPECTION_CPG_MAX_BYTES = 64;
export const INSPECTION_HEADER_MAX_BYTES = 1024;
export const INSPECTION_TIMEOUT_MS = 120_000;
export const INSPECTION_SHP_HEADER_BYTES = 100;
export const INSPECTION_SQLITE_MAGIC_BYTES = 16;
export const INSPECTION_MAX_PEEK_ENTRIES = 64;
export const INSPECTION_MAX_TOTAL_PEEK_BYTES = 2 * 1024 * 1024;

/** Allowlisted top-level keys for sanitised inspection reports (upload gate). */
export const INSPECTION_REPORT_ALLOWED_KEYS = Object.freeze([
  "ok",
  "mode",
  "severity",
  "rejectCode",
  "warnings",
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
});

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
  const base = path.basename(String(entryPath || "")).replace(/\.[^.]+$/, "");
  const ext = (String(entryPath || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (ext === "pdf" || ext === "html" || ext === "htm") return "documentation";
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif") return "image";
  if (ext === "kml") return "ignored_other";
  if (ext === "dbf") return "dbf_layer";
  if (ext === "shp" || ext === "shx" || ext === "prj" || ext === "sbn" || ext === "sbx") return "shp_layer";
  if (ext === "db" || ext === "sqlite" || ext === "sqlite3") return "sqlite_candidate";
  if (ext === "cpg") return "encoding_cpg";
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
    lineEnding: "unknown",
    delimiter: "unknown",
    quoteStyle: "none",
    escapeStyle: "unknown",
    hasHeader: false,
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

  let start = 0;
  if (out.bom === "utf8") start = 3;
  else if (out.bom === "utf16le" || out.bom === "utf16be") start = 2;

  // Prefer UTF-8 decode; binary-safe fallback latin1 for structure only (values never emitted).
  let text;
  try {
    text = buf.slice(start, Math.min(buf.length, INSPECTION_TEXT_PEEK_BYTES)).toString("utf8");
    out.encodingCandidate = out.bom === "utf8" ? "UTF-8" : "UTF-8";
  } catch (_) {
    text = buf.slice(start, Math.min(buf.length, INSPECTION_TEXT_PEEK_BYTES)).toString("latin1");
    out.encodingCandidate = "UNKNOWN";
  }

  if (/\r\n/.test(text)) out.lineEnding = "crlf";
  else if (/\n/.test(text)) out.lineEnding = "lf";
  else if (/\r/.test(text)) out.lineEnding = "cr";

  if (text.includes('"')) out.quoteStyle = "double";
  else if (text.includes("'")) out.quoteStyle = "single";

  const lines = text.split(/\r?\n/).filter((l) => l.length > 0).slice(0, INSPECTION_MAX_TEXT_LINES);
  if (!lines.length) return out;

  out.delimiter = detectDelimiter(lines[0]);
  const fieldRows = lines.map((l) => splitFields(l, out.delimiter));
  out.maxFieldCountInSample = Math.max(...fieldRows.map((r) => r.length));
  const first = fieldRows[0];
  out.hasHeader = looksLikeHeader(first);
  out.positional = !out.hasHeader;
  out.headerFieldCount = out.hasHeader ? first.length : 0;
  out.fieldCount = first.length;
  out.firstDataFieldCount = out.hasHeader && fieldRows[1] ? fieldRows[1].length : first.length;
  out.consistentFieldCount = fieldRows.every((r) => r.length === first.length);

  if (out.hasHeader) {
    for (const f of first) bump(out.headerRoleCounts, normalizeHeaderRole(f));
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
  for (const row of fieldRows) {
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i]).trim();
      if (cell === "11") {
        out.cid11Seen = true;
        out.cidEvidence = out.hasHeader && i < first.length && normalizeHeaderRole(first[i]) === "cid_field" ? "header_column" : "data_token";
      }
      if (cell === "25") {
        out.tabcd25Seen = true;
        out.tabcdEvidence =
          out.hasHeader && i < first.length && normalizeHeaderRole(first[i]) === "tabcd_field" ? "header_column" : "data_token";
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
  out.cidUnambiguous = out.cid11Seen === true && out.cidEvidence !== "none";
  out.tabcdUnambiguous = out.tabcd25Seen === true && out.tabcdEvidence !== "none";

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
  // Force immutable safety flags
  out.mode = INSPECTION_MODE;
  out.authoritativeFormat = "UNVERIFIED";
  out.authoritativeFormatVerified = false;
  out.importerActivated = false;
  out.resolverActivated = false;
  out.publishActivated = false;
  out.productionWrite = false;
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
 * @param {{ role: string, ext: string, buf: Buffer, schemaHints?: object }[]} entries
 * @param {{ centralMeta?: object, startedAt?: number, timeoutMs?: number }} [opts]
 */
export function inspectFormatFromEntryPeeks(entries, opts = {}) {
  const started = opts.startedAt || Date.now();
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : INSPECTION_TIMEOUT_MS;
  const warnings = [];
  const roleCounts = Object.create(null);
  const sizeByRole = Object.create(null);
  let cid11 = false;
  let tabcd25 = false;
  let cidMismatch = false;
  let tabcdMismatch = false;
  let peeks = { cidOk: false, coordsFromDat: false, coordsFromShp: false };
  const encodings = new Set();
  let sqlite = null;
  let duplicateRequired = false;
  const requiredSeen = Object.create(null);

  for (const ent of entries) {
    if (Date.now() - started > timeoutMs) {
      return failReport(INSPECTION_REJECT.TIMEOUT, "timeout", opts.centralMeta);
    }
    const role = ent.role || classifyEntryRole("x." + (ent.ext || "dat"));
    bump(roleCounts, role);
    sizeByRole[role] = (sizeByRole[role] || 0) + (ent.buf ? ent.buf.length : 0);

    if (["points", "names", "roads", "segments"].includes(role)) {
      if (requiredSeen[role]) duplicateRequired = true;
      requiredSeen[role] = true;
    }

    const ext = String(ent.ext || "").toLowerCase();
    if (ext === "cpg") {
      const c = inspectCpgPeek(ent.buf);
      encodings.add(c.encodingNormalized);
      continue;
    }
    if (ext === "dbf") {
      inspectDbfHeader(ent.buf);
      continue;
    }
    if (ext === "shp" || ext === "shx") {
      const sh = inspectShpHeader(ent.buf, ext);
      if (sh.validHeader && sh.boundingBoxCountryCheck === "plausible_czech_extent") peeks.coordsFromShp = true;
      continue;
    }
    if (ext === "db" || ext === "sqlite" || ext === "sqlite3") {
      sqlite = inspectSqliteHeader(ent.buf, ent.schemaHints || null);
      continue;
    }
    if (ext === "dat" || ext === "txt" || ext === "csv") {
      if (ent.buf && ent.buf.length > INSPECTION_TEXT_PEEK_BYTES) {
        warnings.push({ code: INSPECTION_REJECT.READ_LIMIT, severity: "warning" });
      }
      const peek = inspectTextPeek(ent.buf ? ent.buf.slice(0, INSPECTION_TEXT_PEEK_BYTES) : Buffer.alloc(0));
      if (peek.cid11Seen) {
        cid11 = true;
        peeks.cidOk = peek.cidUnambiguous;
      }
      if (peek.tabcd25Seen) tabcd25 = true;
      // Wrong CID/TABCD: numeric 12 or 26 etc. — detect via hasHeader cid field with non-11
      if (peek.hasHeader && peek.headerRoleCounts.cid_field && !peek.cid11Seen) {
        // header present but no 11 in sample → insufficient, not necessarily mismatch
      }
      if (peek.candidateCoordinateColumns) peeks.coordsFromDat = true;
      if (peek.encodingCandidate && peek.encodingCandidate !== "UNKNOWN") encodings.add(peek.encodingCandidate);
    }
  }

  if (encodings.has("UNKNOWN") && encodings.size > 1) encodings.delete("UNKNOWN");
  let encodingNorm = "UNKNOWN";
  if (encodings.size === 1) encodingNorm = [...encodings][0];
  else if (encodings.size > 1) encodingNorm = "CONFLICT";

  const central = opts.centralMeta || {};
  const candidate = buildCandidateFormatFromCentral({
    ...central,
    datFileCount: central.datFileCount || roleCounts.points || roleCounts.unknown_dat || 0,
    txtFileCount: central.txtFileCount || roleCounts.unknown_txt || 0,
    candidateLayers: central.candidateLayers || { tisaNameHint: roleCounts.points ? 1 : 0 },
  });

  // Authoritative remains UNVERIFIED unless full contract: CID+TABCD+points role+consistent text structure
  let authoritativeFormat = "UNVERIFIED";
  let authoritativeFormatVerified = false;
  // Content peeks alone never flip verified in this module without explicit contract completeness.
  // (Importer still blocked; inspection only gathers evidence.)

  const board = buildSourceAuthorityBoard(roleCounts, peeks);
  const severity = duplicateRequired
    ? "archive_reject"
    : cidMismatch || tabcdMismatch
      ? "archive_reject"
      : "insufficient_evidence";

  let rejectCode = null;
  if (duplicateRequired) rejectCode = INSPECTION_REJECT.DUPLICATE_REQUIRED_ROLE;
  else if (cidMismatch) rejectCode = INSPECTION_REJECT.CID_MISMATCH;
  else if (tabcdMismatch) rejectCode = INSPECTION_REJECT.TABCD_MISMATCH;
  else if (sqlite && !sqlite.sqliteVerified && roleCounts.sqlite_candidate) {
    rejectCode = null; // DB_FORMAT_UNVERIFIED is informational
    warnings.push({ code: INSPECTION_REJECT.SQLITE_UNVERIFIED, severity: "insufficient_evidence" });
  }

  const report = {
    ok: rejectCode == null,
    mode: INSPECTION_MODE,
    severity,
    rejectCode,
    warnings,
    ...candidate,
    authoritativeFormat,
    authoritativeFormatVerified,
    cidExpected: TMC_CID_EXPECTED,
    tabcdExpected: TMC_TABCD_EXPECTED,
    cid11Detected: cid11,
    tabcd25Detected: tabcd25,
    encodingNormalized: encodingNorm,
    structuralRoleCounts: roleCounts,
    structuralRoleBytes: sizeByRole,
    sourceAuthority: board,
    sqlite,
    importerActivated: false,
    resolverActivated: false,
    publishActivated: false,
    productionWrite: false,
    reportTruncated: false,
  };
  return report;
}

function failReport(code, severity, centralMeta) {
  return {
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
  };
}

function peekBudgetForExt(ext) {
  if (ext === "cpg") return INSPECTION_CPG_MAX_BYTES;
  if (ext === "dbf" || ext === "shp" || ext === "shx") return INSPECTION_HEADER_MAX_BYTES;
  if (ext === "db" || ext === "sqlite" || ext === "sqlite3") return 16;
  return INSPECTION_TEXT_PEEK_BYTES;
}

/**
 * Collect allowlisted peek targets from ZIP central directory (roles only; no report names).
 * @param {string} zipPath
 * @param {object} [lim]
 */
export function collectInspectionPeekTargets(zipPath, lim = {}) {
  const limits = { maxEntries: 5000, maxNameLen: 256, maxPathDepth: 8, ...lim };
  const st = fs.statSync(zipPath);
  const targets = [];
  const ignoredCategoryCounts = Object.create(null);
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
      const role = classified.ok ? classifyEntryRole(classified.path) : "ignored_other";
      const ext = classified.ok
        ? (String(classified.path).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ""
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
      });
    }
    return { ok: true, rejectCode: null, targets, ignoredCategoryCounts };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Peek at most maxOut uncompressed bytes from a ZIP entry (store or deflate).
 * @param {number} fd
 * @param {{ localOffset: number, method: number, comp: number, uncomp: number }} target
 * @param {number} maxOut
 */
export function peekZipEntryBytes(fd, target, maxOut) {
  const max = Math.max(1, Math.min(maxOut, INSPECTION_TEXT_PEEK_BYTES));
  const lh = Buffer.alloc(30);
  const n = fs.readSync(fd, lh, 0, 30, target.localOffset);
  if (n < 30 || lh.readUInt32LE(0) !== LOCAL_SIG) {
    throw Object.assign(new Error("bad_local_header"), { code: INSPECTION_REJECT.FORMAT_UNVERIFIED });
  }
  const nameLen = lh.readUInt16LE(26);
  const extraLen = lh.readUInt16LE(28);
  if (nameLen > 512 || extraLen > INSPECTION_HEADER_MAX_BYTES) {
    throw Object.assign(new Error("header_too_large"), { code: INSPECTION_REJECT.ENTRY_TOO_LARGE });
  }
  const dataStart = target.localOffset + 30 + nameLen + extraLen;
  const method = target.method;
  if (method === 0) {
    const want = Math.min(max, target.uncomp || max);
    const buf = Buffer.alloc(want);
    const got = fs.readSync(fd, buf, 0, want, dataStart);
    return buf.slice(0, got);
  }
  if (method === 8) {
    const compWant = Math.min(target.comp || max * 4, max * 8 + 256);
    const compBuf = Buffer.alloc(compWant);
    const got = fs.readSync(fd, compBuf, 0, compWant, dataStart);
    try {
      return zlib.inflateRawSync(compBuf.slice(0, got), { maxOutputLength: max });
    } catch (e) {
      throw Object.assign(new Error("inflate_peek_failed"), {
        code: INSPECTION_REJECT.READ_LIMIT,
        cause: e,
      });
    }
  }
  throw Object.assign(new Error("unsupported_method"), { code: INSPECTION_REJECT.ENTRY_NOT_ALLOWED });
}

/**
 * Live/offline ZIP format inspection from on-disk archive (peek only).
 * Never activates importer/resolver/publish. Never embeds raw rows or basenames.
 * @param {string} zipPath
 * @param {{ workDir?: string, timeoutMs?: number, startedAt?: number }} [opts]
 */
export function inspectTmcZipFormatFromFile(zipPath, opts = {}) {
  const started = opts.startedAt || Date.now();
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : INSPECTION_TIMEOUT_MS;
  const workDir = opts.workDir || path.dirname(zipPath);

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
  const fd = fs.openSync(zipPath, "r");
  try {
    for (const t of collected.targets) {
      if (Date.now() - started > timeoutMs) {
        return failReport(INSPECTION_REJECT.TIMEOUT, "timeout", central);
      }
      const budget = peekBudgetForExt(t.ext);
      if (totalPeek + budget > INSPECTION_MAX_TOTAL_PEEK_BYTES) {
        return failReport(INSPECTION_REJECT.MEMORY_LIMIT, "archive_reject", central);
      }
      try {
        const buf = peekZipEntryBytes(fd, t, budget);
        totalPeek += buf.length;
        entries.push({ role: t.role, ext: t.ext, buf });
      } catch (e) {
        const code = e && e.code ? String(e.code) : INSPECTION_REJECT.READ_LIMIT;
        if (code === INSPECTION_REJECT.ENTRY_TOO_LARGE || code === INSPECTION_REJECT.MEMORY_LIMIT) {
          return failReport(code, "archive_reject", central);
        }
        // record/layer soft skip
        entries.push({ role: t.role, ext: t.ext, buf: Buffer.alloc(0) });
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  const report = inspectFormatFromEntryPeeks(entries, {
    centralMeta: central,
    startedAt: started,
    timeoutMs,
  });
  report.candidateEvidenceSource = entries.length
    ? "content_peek"
    : report.candidateEvidenceSource || "central_directory";
  if (report.candidateEvidenceSource === "content_peek") {
    report.candidateFormatConfidence = "content_peek_limited";
  }
  report.authoritativeFormat = "UNVERIFIED";
  report.authoritativeFormatVerified = false;
  report.liveNetworkInspection = false;
  report.ignoredCategoryCounts = collected.ignoredCategoryCounts;
  report.peekEntryCount = entries.length;
  report.peekTotalBytes = totalPeek;
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
  return report;
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
