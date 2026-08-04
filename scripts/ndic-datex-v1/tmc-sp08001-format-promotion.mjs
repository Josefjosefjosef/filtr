/**
 * SP08001 / LTEF 2.6 format-contract promotion (opaque tableCode only).
 * Separates FORMAT_CONTRACT_CONFIRMED from DATASET_INTEGRITY (never verified here).
 * Source: SP08001 exchangeFormatVersion 2.6 / Table 4-2 / physical encoding rules.
 * Not an importer. Not a relationship checker.
 */
import {
  SP08001_EXCHANGE_FORMAT_VERSION,
  SP08001_PHYSICAL,
  SP08001_TABLE_CODES,
  SP08001_TABLES,
  getSp08001Table,
} from "./tmc-sp08001-contract.mjs";

export const DATASET_INTEGRITY_STATE = Object.freeze({
  NOT_TESTED: "NOT_TESTED",
  UNVERIFIED: "UNVERIFIED",
  VERIFIED: "VERIFIED",
});

/**
 * SP08001 Table 4-2 + §4.4: minimum opaque codes that identify a Location Table
 * exchange (dataset identity + country + core network/name/point structure).
 * Not the legacy broad-role quartet alone — includes LOCATIONDATASETS + COUNTRIES.
 */
export const REQUIRED_FOR_FORMAT_IDENTIFICATION = Object.freeze([
  "LOCATIONDATASETS", // SP08001 §4.4 / Table 4-2 — LTN/TABCD dataset identity
  "COUNTRIES", // SP08001 §4.4 / Table 4-2 — CID country context
  "POINTS", // SP08001 §4.4 / Table 4-2 — point locations + coordinates
  "NAMES", // SP08001 §4.4 / Table 4-2 — location names
  "ROADS", // SP08001 §4.4 / Table 4-2 — road network
  "SEGMENTS", // SP08001 §4.4 / Table 4-2 — segment topology
]);

/** All Table 4-2 standard DAT codes — required only for full dataset import (later). */
export const REQUIRED_FOR_DATASET_IMPORT = Object.freeze([...SP08001_TABLE_CODES]);

/**
 * Header-only may satisfy format identification when rows are absent.
 * SP08001 allows empty fields via ;; ; empty row sets are not forbidden for optional content.
 * Format inspection never proves row completeness.
 */
export const ALLOWED_EMPTY = Object.freeze([
  "DLRS", // SP08001 §4.4.6 — diversion may be empty in a given release
  "DLR_DESC", // SP08001 §4.4.5 — diversion descriptions may be empty
  "NAMETRANSLATIONS", // SP08001 Table 4-2 — optional translations
  "SUBTYPETRANSLATION", // SP08001 Table 4-2 — optional translations
  "ERNO_BELONGS_TO_CO", // SP08001 Table 4-2 — may be empty if no Euroroad links
  "SEG_HAS_ERNO", // SP08001 Table 4-2 — may be empty if no Euroroad links
]);

/** Columns may be optional (;;); row presence not required for format ID. */
export const OPTIONAL_ROWS = Object.freeze([...ALLOWED_EMPTY]);

/**
 * Companion GIS/SQLite layers never authorize the TISA DAT CSV layer.
 * SP08001 authoritativeLayer = TISA_DAT_CSV (physical contract).
 */
export const COMPANION_NON_AUTHORITATIVE = Object.freeze([
  "encoding_cpg",
  "dbf_layer",
  "shp_layer",
  "sqlite_candidate",
]);

export const TABLE_MISMATCH_REASON = Object.freeze({
  NONE: "none",
  UNKNOWN_TABLE: "unknown_table",
  EMPTY_HEADER: "empty_header",
  FIELD_COUNT: "field_count",
  COLUMN_ORDER_OR_CODE: "column_order_or_code",
  NOT_ASSESSED: "not_assessed",
  ABSENT_FROM_ARCHIVE: "absent_from_archive",
});

export const HEADER_MATCH_STATE = Object.freeze({
  MATCH: "MATCH",
  MISMATCH: "MISMATCH",
  ABSENT: "ABSENT",
  NOT_ASSESSED: "NOT_ASSESSED",
});

export const CONTENT_VERIFIED_STATE = Object.freeze({
  YES: "YES",
  NO: "NO",
});

export const TABLE_ASSESSMENT_CLASS = Object.freeze({
  REQUIRED_FOR_FORMAT_IDENTIFICATION: "REQUIRED_FOR_FORMAT_IDENTIFICATION",
  REQUIRED_FOR_DATASET_IMPORT: "REQUIRED_FOR_DATASET_IMPORT",
  ALLOWED_EMPTY: "ALLOWED_EMPTY",
  OPTIONAL_ROWS: "OPTIONAL_ROWS",
  COMPANION_NON_AUTHORITATIVE: "COMPANION_NON_AUTHORITATIVE",
  STANDARD_OTHER: "STANDARD_OTHER",
});

export function classifySp08001TableAssessmentClass(tableCode) {
  if (REQUIRED_FOR_FORMAT_IDENTIFICATION.includes(tableCode)) {
    return TABLE_ASSESSMENT_CLASS.REQUIRED_FOR_FORMAT_IDENTIFICATION;
  }
  if (ALLOWED_EMPTY.includes(tableCode)) return TABLE_ASSESSMENT_CLASS.ALLOWED_EMPTY;
  if (OPTIONAL_ROWS.includes(tableCode)) return TABLE_ASSESSMENT_CLASS.OPTIONAL_ROWS;
  if (SP08001_TABLE_CODES.includes(tableCode)) return TABLE_ASSESSMENT_CLASS.REQUIRED_FOR_DATASET_IMPORT;
  return TABLE_ASSESSMENT_CLASS.STANDARD_OTHER;
}

/**
 * @param {{
 *   tableAssessments?: object[],
 *   exchangeFormatContractVersion?: string,
 *   authoritativeLayer?: string,
 *   delimiterNormalized?: string,
 *   decompressionErrorCount?: number,
 *   tableCodeConflictCount?: number,
 *   readmeEncodingState?: string,
 *   encodingDatLayer?: string,
 *   cidMatchState?: string,
 *   tabcdMatchState?: string,
 * }} input
 */
export function evaluateFormatContractPromotion(input) {
  const assessments = Array.isArray(input.tableAssessments) ? input.tableAssessments : [];
  const byCode = Object.create(null);
  for (const a of assessments) {
    if (a && a.tableCode) byCode[a.tableCode] = a;
  }

  const reasons = [];
  if (input.exchangeFormatContractVersion !== SP08001_EXCHANGE_FORMAT_VERSION) {
    reasons.push("exchange_format_version");
  }
  if (input.authoritativeLayer !== SP08001_PHYSICAL.authoritativeLayer) {
    reasons.push("authoritative_layer");
  }
  if (input.delimiterNormalized !== SP08001_PHYSICAL.delimiter) {
    reasons.push("delimiter");
  }
  if ((input.decompressionErrorCount || 0) > 0) {
    reasons.push("decompression_error");
  }
  if ((input.tableCodeConflictCount || 0) > 0) {
    reasons.push("tablecode_content_conflict");
  }
  const readme = input.readmeEncodingState || "ABSENT";
  if (readme === "ABSENT" || readme === "CONFLICT") {
    reasons.push("readme_encoding");
  }
  const datEnc = input.encodingDatLayer || "UNKNOWN";
  if (datEnc === "CONFLICT" || datEnc === "UNKNOWN" || datEnc === "UNVERIFIED" || datEnc === "ABSENT") {
    reasons.push("dat_encoding");
  }
  if (input.cidMatchState !== "MATCHED_IN_CONTRACT") {
    reasons.push("cid_contract");
  }
  if (input.tabcdMatchState !== "MATCHED_IN_CONTRACT") {
    reasons.push("tabcd_contract");
  }

  for (const code of REQUIRED_FOR_FORMAT_IDENTIFICATION) {
    const a = byCode[code];
    if (!a) {
      reasons.push("missing_identification_table");
      continue;
    }
    const headerOk = a.headerMatchState === HEADER_MATCH_STATE.MATCH;
    const cvOk = a.contentVerifiedState === CONTENT_VERIFIED_STATE.YES;
    // Format ID: header contract required; content_verified preferred but ALLOWED_EMPTY may be header-only.
    if (!headerOk) {
      reasons.push("identification_header_mismatch");
    } else if (!cvOk && !ALLOWED_EMPTY.includes(code)) {
      // Identification set tables define CID and/or structural identity — require content_verified
      // (header + peeked CID/TABCD where the table defines those columns).
      const table = getSp08001Table(code);
      const needsValue =
        table &&
        (table.headerCodes.includes("CID") || table.headerCodes.includes("TABCD"));
      if (needsValue) reasons.push("identification_not_content_verified");
    }
  }

  // Every other standard DAT that was assessed must not be a hard header mismatch
  // (present but wrong). Absent non-identification tables do not block format ID.
  for (const a of assessments) {
    if (!a || !SP08001_TABLE_CODES.includes(a.tableCode)) continue;
    if (REQUIRED_FOR_FORMAT_IDENTIFICATION.includes(a.tableCode)) continue;
    if (a.headerMatchState === HEADER_MATCH_STATE.MISMATCH) {
      reasons.push("present_standard_header_mismatch");
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const formatConfirmed = uniqueReasons.length === 0;
  return {
    formatConfirmed,
    authoritativeFormatVerified: formatConfirmed,
    authoritativeFormat: formatConfirmed ? SP08001_PHYSICAL.authoritativeLayer : "UNVERIFIED",
    datasetIntegrityState: DATASET_INTEGRITY_STATE.NOT_TESTED,
    promotionBlockers: uniqueReasons,
    identificationTableCount: REQUIRED_FOR_FORMAT_IDENTIFICATION.length,
    requiredForDatasetImportCount: REQUIRED_FOR_DATASET_IMPORT.length,
  };
}

export function emptyTableAssessment(tableCode, extras = {}) {
  return {
    tableCode,
    assessmentClass: classifySp08001TableAssessmentClass(tableCode),
    headerMatchState: HEADER_MATCH_STATE.NOT_ASSESSED,
    contentVerifiedState: CONTENT_VERIFIED_STATE.NO,
    mismatchReason: TABLE_MISMATCH_REASON.NOT_ASSESSED,
    ...extras,
  };
}
