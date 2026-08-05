/**
 * SP08001 / LTEF 2.6 format-contract promotion (opaque tableCode only).
 * Conservative Table 4-2 complete-schema policy — all 25 standard DAT exports required.
 * Separates FORMAT_CONTRACT_CONFIRMED from DATASET_INTEGRITY (never verified here).
 * Not an importer. Not a relationship checker.
 */
import {
  SP08001_EXCHANGE_FORMAT_VERSION,
  SP08001_PHYSICAL,
  SP08001_TABLE_CODES,
  SP08001_STANDARD_TABLE_COUNT,
  getSp08001Table,
} from "./tmc-sp08001-contract.mjs";

export const PROMOTION_POLICY_VERSION = "sp08001-v2.6-table4-2-complete-schema-2";

export const FORMAT_CONTRACT_STATE = Object.freeze({
  FORMAT_CONTRACT_CONFIRMED: "FORMAT_CONTRACT_CONFIRMED",
  FORMAT_CONTRACT_UNCONFIRMED: "FORMAT_CONTRACT_UNCONFIRMED",
});

export const DATASET_INTEGRITY_STATE = Object.freeze({
  NOT_TESTED: "NOT_TESTED",
  UNVERIFIED: "UNVERIFIED",
  VERIFIED: "VERIFIED",
});

/**
 * Closed per-table state enum (one state per table; priority selects winner).
 * Lower priority number wins when multiple candidates apply.
 */
export const TABLE_STATE = Object.freeze({
  missing_required_file: "missing_required_file",
  duplicate_exact_tablecode: "duplicate_exact_tablecode",
  malformed_empty_file: "malformed_empty_file",
  missing_complete_header: "missing_complete_header",
  delimiter_mismatch: "delimiter_mismatch",
  newline_mismatch: "newline_mismatch",
  encoding_unresolved: "encoding_unresolved",
  decode_error: "decode_error",
  field_count_mismatch: "field_count_mismatch",
  field_order_mismatch: "field_order_mismatch",
  missing_required_field: "missing_required_field",
  unexpected_field: "unexpected_field",
  duplicate_field: "duplicate_field",
  cid_mismatch: "cid_mismatch",
  tabcd_mismatch: "tabcd_mismatch",
  no_limited_data_row: "no_limited_data_row",
  schema_and_limited_content_verified: "schema_and_limited_content_verified",
  schema_verified_empty: "schema_verified_empty",
  exact_header_match: "exact_header_match",
  supplementary_non_authoritative: "supplementary_non_authoritative",
});

export const TABLE_STATE_PRIORITY = Object.freeze({
  [TABLE_STATE.missing_required_file]: 10,
  [TABLE_STATE.duplicate_exact_tablecode]: 20,
  [TABLE_STATE.malformed_empty_file]: 30,
  [TABLE_STATE.decode_error]: 40,
  [TABLE_STATE.encoding_unresolved]: 50,
  [TABLE_STATE.delimiter_mismatch]: 60,
  [TABLE_STATE.newline_mismatch]: 70,
  [TABLE_STATE.missing_complete_header]: 80,
  [TABLE_STATE.duplicate_field]: 90,
  [TABLE_STATE.field_count_mismatch]: 100,
  [TABLE_STATE.missing_required_field]: 110,
  [TABLE_STATE.unexpected_field]: 120,
  [TABLE_STATE.field_order_mismatch]: 130,
  [TABLE_STATE.cid_mismatch]: 140,
  [TABLE_STATE.tabcd_mismatch]: 150,
  [TABLE_STATE.no_limited_data_row]: 160,
  [TABLE_STATE.schema_and_limited_content_verified]: 200,
  [TABLE_STATE.schema_verified_empty]: 210,
  [TABLE_STATE.exact_header_match]: 220,
  [TABLE_STATE.supplementary_non_authoritative]: 900,
});

export const FILE_PRESENCE_CLASS = Object.freeze({
  MISSING_FILE: "MISSING_FILE",
  ZERO_BYTE_FILE: "ZERO_BYTE_FILE",
  HEADER_ONLY: "HEADER_ONLY",
  HEADER_AND_ROWS: "HEADER_AND_ROWS",
});

/**
 * SP08001 §§4.4.5–4.4.6 and tables that may legitimately export HEADER_ONLY
 * (zero data rows) while still exporting the full schema header
 * (HEADER_ONLY → schema_verified_empty).
 * Absence of the whole export file is NOT allowed (Table 4-2 complete schema).
 * ROAD_NETWORK_LEVEL_TYPES stays excluded: ROADS.PES_LEV is mandatory, so an
 * empty levels table would weaken relationship evidence (keep fail-closed).
 */
export const ALLOWED_EMPTY_TABLES = Object.freeze([
  "DLRS", // SP08001 §4.4.6 — diversion may have zero data rows
  "DLR_DESC", // SP08001 §4.4.5 — diversion descriptions may have zero data rows
  "NAMETRANSLATIONS", // SP08001 Table 4-2 — optional translation rows
  "SUBTYPETRANSLATION", // SP08001 Table 4-2 — optional translation rows
  "ERNO_BELONGS_TO_CO", // SP08001 Table 4-2 — may have zero Euroroad country links
  "SEG_HAS_ERNO", // SP08001 Table 4-2 — may have zero Euroroad segment links
  "EUROROADNO", // SP08001 §4.4.8 — European road numbers used in dataset (zero used ⇒ zero rows)
  "JUNCTIONS", // SP08001 §4.4.10 — only for P5.8 Isolated parking POIs; otherwise HEADER_ONLY
  "OTHERAREAS", // SP08001 §4.4.16 — other areas present in dataset (none ⇒ zero rows)
]);

/** @deprecated alias — empty-row policy only; never means missing file */
export const ALLOWED_EMPTY = ALLOWED_EMPTY_TABLES;
export const OPTIONAL_ROWS = ALLOWED_EMPTY_TABLES;

/** All 25 Table 4-2 standard DAT codes are required export files for format confirmation. */
export const REQUIRED_STANDARD_TABLES = Object.freeze([...SP08001_TABLE_CODES]);

/**
 * @deprecated Removed as authoritative identification shortcut.
 * Kept as alias to REQUIRED_STANDARD_TABLES so callers cannot silently use a 6-table set.
 */
export const REQUIRED_FOR_FORMAT_IDENTIFICATION = REQUIRED_STANDARD_TABLES;

export const REQUIRED_FOR_DATASET_IMPORT = Object.freeze([...SP08001_TABLE_CODES]);

export const COMPANION_NON_AUTHORITATIVE = Object.freeze([
  "encoding_cpg",
  "dbf_layer",
  "shp_layer",
  "sqlite_candidate",
]);

export const README_PARSE_STATE = Object.freeze({
  mapped_and_parsed: "mapped_and_parsed",
  mapped_default_encoding: "mapped_default_encoding",
  mapped_invalid_encoding: "mapped_invalid_encoding",
  missing_default_allowed: "missing_default_allowed",
  missing_fail_closed: "missing_fail_closed",
  decode_error: "decode_error",
  structural_mismatch: "structural_mismatch",
});

export const DAT_ENCODING_SOURCE = Object.freeze({
  readme_declared: "readme_declared",
  sp08001_default: "sp08001_default",
  unresolved: "unresolved",
});

/** Legacy mismatch reasons (still accepted in older paths). Prefer TABLE_STATE. */
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
  REQUIRED_STANDARD: "REQUIRED_STANDARD",
  ALLOWED_EMPTY: "ALLOWED_EMPTY",
  COMPANION_NON_AUTHORITATIVE: "COMPANION_NON_AUTHORITATIVE",
  STANDARD_OTHER: "STANDARD_OTHER",
  /** @deprecated */
  REQUIRED_FOR_FORMAT_IDENTIFICATION: "REQUIRED_STANDARD",
  /** @deprecated */
  REQUIRED_FOR_DATASET_IMPORT: "REQUIRED_STANDARD",
  /** @deprecated */
  OPTIONAL_ROWS: "ALLOWED_EMPTY",
});

export function isAllowedEmptyTable(tableCode) {
  return ALLOWED_EMPTY_TABLES.includes(tableCode);
}

export function classifySp08001TableAssessmentClass(tableCode) {
  if (ALLOWED_EMPTY_TABLES.includes(tableCode)) return TABLE_ASSESSMENT_CLASS.ALLOWED_EMPTY;
  if (SP08001_TABLE_CODES.includes(tableCode)) return TABLE_ASSESSMENT_CLASS.REQUIRED_STANDARD;
  return TABLE_ASSESSMENT_CLASS.STANDARD_OTHER;
}

export function pickWinningTableState(candidates) {
  let best = null;
  let bestPri = Infinity;
  for (const s of candidates || []) {
    if (!s || !TABLE_STATE[s] && !Object.values(TABLE_STATE).includes(s)) continue;
    const pri = TABLE_STATE_PRIORITY[s];
    if (pri == null) continue;
    if (pri < bestPri) {
      bestPri = pri;
      best = s;
    }
  }
  return best;
}

/**
 * Derive single closed TABLE_STATE from presence + header assessment + content flags.
 */
export function deriveTableState(input) {
  const {
    present = false,
    byteLength = 0,
    duplicateExact = false,
    hasCompleteHeader = false,
    headerMatched = false,
    delimiterOk = true,
    newlineOk = true,
    encodingOk = true,
    decodeOk = true,
    mismatchState = null,
    cidOk = true,
    tabcdOk = true,
    hasLimitedDataRow = false,
    tableCode = null,
  } = input || {};

  const candidates = [];
  if (!present) candidates.push(TABLE_STATE.missing_required_file);
  if (duplicateExact) candidates.push(TABLE_STATE.duplicate_exact_tablecode);
  if (present && byteLength === 0) candidates.push(TABLE_STATE.malformed_empty_file);
  if (present && byteLength > 0 && !hasCompleteHeader) candidates.push(TABLE_STATE.missing_complete_header);
  if (!decodeOk) candidates.push(TABLE_STATE.decode_error);
  if (!encodingOk) candidates.push(TABLE_STATE.encoding_unresolved);
  if (!delimiterOk) candidates.push(TABLE_STATE.delimiter_mismatch);
  if (!newlineOk) candidates.push(TABLE_STATE.newline_mismatch);
  if (mismatchState && Object.values(TABLE_STATE).includes(mismatchState)) {
    candidates.push(mismatchState);
  }
  if (headerMatched && !cidOk) candidates.push(TABLE_STATE.cid_mismatch);
  if (headerMatched && !tabcdOk) candidates.push(TABLE_STATE.tabcd_mismatch);

  if (headerMatched && hasLimitedDataRow) {
    candidates.push(TABLE_STATE.schema_and_limited_content_verified);
  } else if (headerMatched && !hasLimitedDataRow) {
    if (isAllowedEmptyTable(tableCode)) {
      candidates.push(TABLE_STATE.schema_verified_empty);
    } else {
      candidates.push(TABLE_STATE.no_limited_data_row);
    }
  } else if (headerMatched) {
    candidates.push(TABLE_STATE.exact_header_match);
  }

  return pickWinningTableState(candidates) || TABLE_STATE.missing_required_file;
}

export function tableStateFlags(state) {
  const s = state || TABLE_STATE.missing_required_file;
  const headerMatched =
    s === TABLE_STATE.exact_header_match ||
    s === TABLE_STATE.schema_verified_empty ||
    s === TABLE_STATE.schema_and_limited_content_verified ||
    s === TABLE_STATE.cid_mismatch ||
    s === TABLE_STATE.tabcd_mismatch ||
    s === TABLE_STATE.no_limited_data_row;
  const schemaVerified =
    s === TABLE_STATE.schema_verified_empty || s === TABLE_STATE.schema_and_limited_content_verified;
  const limitedContentVerified = s === TABLE_STATE.schema_and_limited_content_verified;
  return { headerMatched, schemaVerified, limitedContentVerified };
}

/**
 * Safe report row for one standard table (no filename/path/raw header/values).
 */
export function buildTableAssessmentReportRow(tableCode, state, candidateCount = 0) {
  const flags = tableStateFlags(state);
  return {
    tableCode,
    state,
    candidateCount: Number.isInteger(candidateCount) && candidateCount >= 0 ? candidateCount : 0,
    headerMatched: flags.headerMatched === true,
    schemaVerified: flags.schemaVerified === true,
    limitedContentVerified: flags.limitedContentVerified === true,
  };
}

export function emptyTableAssessment(tableCode, extras = {}) {
  const state = extras.state || TABLE_STATE.missing_required_file;
  const row = buildTableAssessmentReportRow(tableCode, state, extras.candidateCount || 0);
  const flags = tableStateFlags(state);
  return {
    ...row,
    assessmentClass: classifySp08001TableAssessmentClass(tableCode),
    headerMatchState: flags.headerMatched ? HEADER_MATCH_STATE.MATCH : HEADER_MATCH_STATE.ABSENT,
    contentVerifiedState: flags.limitedContentVerified
      ? CONTENT_VERIFIED_STATE.YES
      : CONTENT_VERIFIED_STATE.NO,
    mismatchReason:
      state === TABLE_STATE.missing_required_file
        ? TABLE_MISMATCH_REASON.ABSENT_FROM_ARCHIVE
        : flags.headerMatched
          ? TABLE_MISMATCH_REASON.NONE
          : TABLE_MISMATCH_REASON.EMPTY_HEADER,
    ...extras,
    state: row.state,
    tableCode: row.tableCode,
    candidateCount: row.candidateCount,
    headerMatched: row.headerMatched,
    schemaVerified: row.schemaVerified,
    limitedContentVerified: row.limitedContentVerified,
  };
}

function stateBlocksFormat(state) {
  return !(
    state === TABLE_STATE.schema_and_limited_content_verified ||
    state === TABLE_STATE.schema_verified_empty
  );
}

/**
 * @param {{
 *   tableAssessments?: object[],
 *   exchangeFormatContractVersion?: string,
 *   authoritativeLayer?: string,
 *   delimiterNormalized?: string,
 *   decompressionErrorCount?: number,
 *   exactTableCodeConflictCount?: number,
 *   tableCodeConflictCount?: number,
 *   readmeParseState?: string,
 *   datEncodingSource?: string,
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
  const conflict =
    (input.exactTableCodeConflictCount != null
      ? input.exactTableCodeConflictCount
      : input.tableCodeConflictCount) || 0;
  if (conflict > 0) reasons.push("tablecode_content_conflict");

  const readmeParse = input.readmeParseState || README_PARSE_STATE.missing_fail_closed;
  if (
    readmeParse === README_PARSE_STATE.missing_fail_closed ||
    readmeParse === README_PARSE_STATE.decode_error ||
    readmeParse === README_PARSE_STATE.structural_mismatch ||
    readmeParse === README_PARSE_STATE.mapped_invalid_encoding
  ) {
    reasons.push("readme_encoding");
  }

  const datSrc = input.datEncodingSource || DAT_ENCODING_SOURCE.unresolved;
  const datEnc = input.encodingDatLayer || "UNKNOWN";
  if (
    datSrc === DAT_ENCODING_SOURCE.unresolved ||
    datEnc === "CONFLICT" ||
    datEnc === "UNKNOWN" ||
    datEnc === "UNVERIFIED" ||
    datEnc === "ABSENT"
  ) {
    reasons.push("dat_encoding");
  }

  if (input.cidMatchState !== "MATCHED_IN_CONTRACT") reasons.push("cid_contract");
  if (input.tabcdMatchState !== "MATCHED_IN_CONTRACT") reasons.push("tabcd_contract");

  let missingRequiredStandardTableCount = 0;
  let schemaVerifiedEmptyTableCount = 0;
  let schemaVerifiedTableCount = 0;
  let limitedContentVerifiedTableCount = 0;
  let unresolvedExactTableCount = 0;

  for (const code of REQUIRED_STANDARD_TABLES) {
    const a = byCode[code];
    if (!a) {
      missingRequiredStandardTableCount += 1;
      reasons.push("missing_required_standard_table");
      unresolvedExactTableCount += 1;
      continue;
    }
    const state = a.state || deriveTableStateFromLegacy(a);
    if (state === TABLE_STATE.missing_required_file) {
      missingRequiredStandardTableCount += 1;
      reasons.push("missing_required_standard_table");
      unresolvedExactTableCount += 1;
      continue;
    }
    if (state === TABLE_STATE.schema_verified_empty) {
      schemaVerifiedEmptyTableCount += 1;
      schemaVerifiedTableCount += 1;
    } else if (state === TABLE_STATE.schema_and_limited_content_verified) {
      limitedContentVerifiedTableCount += 1;
      schemaVerifiedTableCount += 1;
    } else if (stateBlocksFormat(state)) {
      reasons.push("standard_table_state_blocks");
      unresolvedExactTableCount += 1;
    }
  }

  // Supplementary non-standard never blocks when marked as such.
  for (const a of assessments) {
    if (!a || SP08001_TABLE_CODES.includes(a.tableCode)) continue;
    if (a.tableCode === "README") continue;
    if (a.state && a.state !== TABLE_STATE.supplementary_non_authoritative) {
      // Non-standard must not be claimed as a standard SP08001 table.
      if (a.state !== TABLE_STATE.supplementary_non_authoritative) {
        /* ignore — already not in REQUIRED_STANDARD_TABLES */
      }
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const formatConfirmed = uniqueReasons.length === 0;
  return {
    promotionPolicyVersion: PROMOTION_POLICY_VERSION,
    formatConfirmed,
    formatContractConfirmed: formatConfirmed,
    formatContractState: formatConfirmed
      ? FORMAT_CONTRACT_STATE.FORMAT_CONTRACT_CONFIRMED
      : FORMAT_CONTRACT_STATE.FORMAT_CONTRACT_UNCONFIRMED,
    authoritativeFormatVerified: formatConfirmed,
    authoritativeFormat: formatConfirmed ? SP08001_PHYSICAL.authoritativeLayer : "UNVERIFIED",
    datasetIntegrityState: DATASET_INTEGRITY_STATE.NOT_TESTED,
    importerIntegrityRequired: true,
    importerIntegrityConfirmed: false,
    promotionBlockers: uniqueReasons,
    standardTableCount: SP08001_STANDARD_TABLE_COUNT,
    metadataFileCount: 1,
    requiredStandardTableCount: REQUIRED_STANDARD_TABLES.length,
    missingRequiredStandardTableCount,
    schemaVerifiedEmptyTableCount,
    schemaVerifiedTableCount,
    limitedContentVerifiedTableCount,
    unresolvedExactTableCount,
    /** @deprecated */
    identificationTableCount: REQUIRED_STANDARD_TABLES.length,
    requiredForDatasetImportCount: REQUIRED_FOR_DATASET_IMPORT.length,
  };
}

function deriveTableStateFromLegacy(a) {
  if (a.mismatchReason === TABLE_MISMATCH_REASON.ABSENT_FROM_ARCHIVE) {
    return TABLE_STATE.missing_required_file;
  }
  if (a.contentVerifiedState === CONTENT_VERIFIED_STATE.YES) {
    return TABLE_STATE.schema_and_limited_content_verified;
  }
  if (a.headerMatchState === HEADER_MATCH_STATE.MATCH) {
    if (isAllowedEmptyTable(a.tableCode)) return TABLE_STATE.schema_verified_empty;
    return TABLE_STATE.no_limited_data_row;
  }
  if (a.headerMatchState === HEADER_MATCH_STATE.MISMATCH) {
    if (a.mismatchReason === TABLE_MISMATCH_REASON.FIELD_COUNT) return TABLE_STATE.field_count_mismatch;
    return TABLE_STATE.field_order_mismatch;
  }
  return TABLE_STATE.missing_complete_header;
}

/**
 * Classify header mismatch into a single TABLE_STATE (no raw headers emitted).
 */
export function classifyHeaderMismatchState(expectedCodes, actualCodes, parseReason) {
  if (parseReason === "duplicate_column") return TABLE_STATE.duplicate_field;
  if (parseReason === "empty_header" || parseReason === "no_fields") return TABLE_STATE.missing_complete_header;
  if (parseReason === "non_code_token") return TABLE_STATE.missing_complete_header;
  const expected = (expectedCodes || []).map((c) => String(c).toUpperCase());
  const actual = (actualCodes || []).map((c) => String(c).toUpperCase());
  if (!actual.length) return TABLE_STATE.missing_complete_header;
  const expSet = new Set(expected);
  const actSet = new Set(actual);
  if (actual.length > expected.length) {
    const allExpectedPresent = expected.every((e) => actSet.has(e));
    if (allExpectedPresent) return TABLE_STATE.unexpected_field;
    return TABLE_STATE.field_count_mismatch;
  }
  if (actual.length < expected.length) {
    for (const e of expected) {
      if (!actSet.has(e)) return TABLE_STATE.missing_required_field;
    }
    return TABLE_STATE.field_count_mismatch;
  }
  for (const e of expected) {
    if (!actSet.has(e)) return TABLE_STATE.missing_required_field;
  }
  for (const a of actual) {
    if (!expSet.has(a)) return TABLE_STATE.unexpected_field;
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) return TABLE_STATE.field_order_mismatch;
  }
  return null;
}
