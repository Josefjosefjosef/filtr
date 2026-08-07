/**
 * Strict fail-closed validators for NDIC shadow forensic JSON (no ajv dependency).
 */
import {
  FORENSIC_SCHEMA,
  CARD_PREVIEW_SCHEMA,
  VALIDATION_REPORT_SCHEMA,
  FORENSIC_SUMMARY_ALLOWLIST,
  CARD_PREVIEW_ALLOWLIST,
  FORBIDDEN_FORENSIC_KEYS,
  FORBIDDEN_VALUE_RE,
  MAX_CARD_PREVIEW_ITEMS,
  MAX_DATEX_BYTES_READ,
  MAX_EVENT_COUNT,
  MAX_RETAINED_IGNORED_ENTRY_METADATA,
  MAX_RETAINED_UNKNOWN_ENTRY_METADATA,
  MAX_ROOT_INVENTORY_ROWS,
  MAX_PREDEFINED_REF_DIGEST_ROWS,
  ENTRY_META_ALLOWLIST,
  ROOT_INVENTORY_ROW_ALLOWLIST,
  PREDEFINED_REF_DIGEST_ROW_ALLOWLIST,
  ENTRY_CLASSIFICATION_ENUM,
  ENTRY_REASON_ENUM,
  HTTP_STATUS_CLASS,
} from "./shadow-forensic-constants.mjs";

function isIso8601(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s) && s.length <= 40;
}

function isSha40(s) {
  return typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
}

function isNonNegInt(n, max = MAX_EVENT_COUNT) {
  return Number.isInteger(n) && n >= 0 && n <= max;
}

function validatePredefinedRefDigestArray(arr, prefix, maxItems, fails) {
  if (!Array.isArray(arr)) {
    fails.push(prefix + "_not_array");
    return;
  }
  if (arr.length > maxItems) {
    fails.push(prefix + "_OVERFLOW");
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      fails.push(prefix + "[" + i + "]");
      continue;
    }
    for (const k of Object.keys(e)) {
      if (!PREDEFINED_REF_DIGEST_ROW_ALLOWLIST.includes(k)) fails.push(prefix + "_extra:" + k);
    }
    if (typeof e.digest !== "string" || !/^[a-f0-9]{16}$/.test(e.digest)) {
      fails.push(prefix + "_digest");
    }
    if (!isNonNegInt(e.count)) fails.push(prefix + "_count");
  }
}

function validateRootInventoryArray(arr, prefix, maxItems, fails) {
  if (!Array.isArray(arr)) {
    fails.push(prefix + "_not_array");
    return;
  }
  if (arr.length > maxItems) {
    fails.push(prefix + "_OVERFLOW");
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      fails.push(prefix + "[" + i + "]");
      continue;
    }
    for (const k of Object.keys(e)) {
      if (!ROOT_INVENTORY_ROW_ALLOWLIST.includes(k)) fails.push(prefix + "_extra:" + k);
    }
    if (typeof e.localName !== "string" || !/^[a-z0-9_]{1,80}$/.test(e.localName)) {
      fails.push(prefix + "_localName");
    }
    if (!isNonNegInt(e.count)) fails.push(prefix + "_count");
  }
}

function validateEntryMetaArray(arr, prefix, maxItems, opts, fails) {
  if (!Array.isArray(arr)) {
    fails.push(prefix);
    return;
  }
  if (arr.length > maxItems) {
    fails.push(prefix + "_OVERFLOW");
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      fails.push(prefix + "[" + i + "]");
      continue;
    }
    for (const k of Object.keys(e)) {
      if (!ENTRY_META_ALLOWLIST.includes(k)) fails.push(prefix + "_extra:" + k);
    }
    if (!(e.basenameDigest === null || (typeof e.basenameDigest === "string" && /^[a-f0-9]{16}$/.test(e.basenameDigest)))) {
      fails.push(prefix + "_digest");
    }
    if (typeof e.extension !== "string" || e.extension.length > 16) fails.push(prefix + "_ext");
    if (!ENTRY_CLASSIFICATION_ENUM.includes(e.classification)) fails.push(prefix + "_class");
    if (!ENTRY_REASON_ENUM.includes(e.reasonCode)) fails.push(prefix + "_reason");
    if (typeof e.resolutionRequired !== "boolean") fails.push(prefix + "_resolutionRequired");
    if (typeof e.authoritative !== "boolean") fails.push(prefix + "_authoritative");
    if (!isNonNegInt(e.entryOrdinal, 1_000_000)) fails.push(prefix + "_entryOrdinal");
    if (e.tableCode != null && (typeof e.tableCode !== "string" || e.tableCode.length > 64)) {
      fails.push(prefix + "_tableCode");
    }
    if (opts.requireResolutionRequiredFalse && e.resolutionRequired !== false) {
      fails.push(prefix + "_resolutionRequiredMustFalse");
    }
    if (opts.requireAuthoritativeFalse && e.authoritative !== false) {
      fails.push(prefix + "_authoritativeMustFalse");
    }
    // Ban raw basename / path shaped values in any string field
    for (const v of Object.values(e)) {
      if (typeof v === "string" && (/[\\/]/.test(v) || /\.(dat|txt|csv)$/i.test(v))) {
        fails.push(prefix + "_raw_name_leak");
      }
    }
  }
}

function walkForbiddenKeys(obj, path, fails) {
  if (obj == null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walkForbiddenKeys(v, path + "[" + i + "]", fails));
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_FORENSIC_KEYS.includes(k)) fails.push("forbidden_key:" + path + "." + k);
    const p = path ? path + "." + k : k;
    if (typeof v === "string" && FORBIDDEN_VALUE_RE.test(v)) fails.push("forbidden_value:" + p);
    if (typeof v === "object" && v) walkForbiddenKeys(v, p, fails);
  }
}

function assertInvariant(cond, code, fails) {
  if (!cond) fails.push(code);
}

/**
 * @returns {{ ok: boolean, fails: string[] }}
 */
export function validateForensicSummary(summary) {
  const fails = [];
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return { ok: false, fails: ["summary_not_object"] };
  }
  for (const k of Object.keys(summary)) {
    if (!FORENSIC_SUMMARY_ALLOWLIST.includes(k)) fails.push("additionalProperty:" + k);
  }
  for (const k of FORENSIC_SUMMARY_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(summary, k)) fails.push("missing:" + k);
  }
  if (summary.schema !== FORENSIC_SCHEMA) fails.push("schema_mismatch");
  if (typeof summary.RUN_ID !== "string" || summary.RUN_ID.length < 1 || summary.RUN_ID.length > 80) fails.push("RUN_ID");
  if (!isSha40(summary.HEAD_SHA)) fails.push("HEAD_SHA");
  if (!["shadow", "off", "active"].includes(summary.MODE)) fails.push("MODE");
  if (!isIso8601(summary.STARTED_AT)) fails.push("STARTED_AT");
  if (!isIso8601(summary.FINISHED_AT)) fails.push("FINISHED_AT");
  if (typeof summary.OK !== "boolean") fails.push("OK");
  if (typeof summary.REASON !== "string" || summary.REASON.length > 120) fails.push("REASON");
  if (!Object.values(HTTP_STATUS_CLASS).includes(summary.DATEX_HTTP_STATUS_CLASS)) fails.push("DATEX_HTTP_STATUS_CLASS");
  if (typeof summary.DATEX_CONTENT_TYPE_VALID !== "boolean") fails.push("DATEX_CONTENT_TYPE_VALID");
  if (!isNonNegInt(summary.DATEX_BYTES_READ, MAX_DATEX_BYTES_READ)) fails.push("DATEX_BYTES_READ");
  if (typeof summary.DATEX_XML_PARSE_PASS !== "boolean") fails.push("DATEX_XML_PARSE_PASS");
  if (typeof summary.TMC_ARCHIVE_USED !== "boolean") fails.push("TMC_ARCHIVE_USED");
  if (typeof summary.TMC_VERSION !== "string" || summary.TMC_VERSION.length > 64) fails.push("TMC_VERSION");
  if (typeof summary.TMC_REASON !== "string" || summary.TMC_REASON.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(summary.TMC_REASON)) {
    fails.push("TMC_REASON");
  }
  if (typeof summary.TMC_ACTIVE !== "boolean") fails.push("TMC_ACTIVE");
  if (!isNonNegInt(summary.TMC_POINT_COUNT, MAX_EVENT_COUNT)) fails.push("TMC_POINT_COUNT");
  if (!isNonNegInt(summary.TMC_NONSTANDARD_IGNORED_COUNT, MAX_EVENT_COUNT)) fails.push("TMC_NONSTANDARD_IGNORED_COUNT");
  if (!isNonNegInt(summary.TMC_REQUIRED_TABLE_COUNT_EXPECTED, MAX_EVENT_COUNT)) fails.push("TMC_REQUIRED_TABLE_COUNT_EXPECTED");
  if (!isNonNegInt(summary.TMC_REQUIRED_TABLE_COUNT_FOUND, MAX_EVENT_COUNT)) fails.push("TMC_REQUIRED_TABLE_COUNT_FOUND");
  if (typeof summary.TMC_REQUIRED_TABLE_SET_COMPLETE !== "boolean") fails.push("TMC_REQUIRED_TABLE_SET_COMPLETE");
  if (typeof summary.TMC_REQUIRED_TABLE_SET_VALID !== "boolean") fails.push("TMC_REQUIRED_TABLE_SET_VALID");
  if (!isNonNegInt(summary.TMC_UNKNOWN_REQUIRED_COUNT, MAX_EVENT_COUNT)) fails.push("TMC_UNKNOWN_REQUIRED_COUNT");
  if (!isNonNegInt(summary.TMC_UNKNOWN_NONCLASSIFIED_COUNT, MAX_EVENT_COUNT)) fails.push("TMC_UNKNOWN_NONCLASSIFIED_COUNT");
  if (!isNonNegInt(summary.TMC_REJECTED_UNSAFE_COUNT, MAX_EVENT_COUNT)) fails.push("TMC_REJECTED_UNSAFE_COUNT");
  if (!isNonNegInt(summary.TMC_UNKNOWN_NONCLASSIFIED_RETAINED_COUNT, MAX_RETAINED_UNKNOWN_ENTRY_METADATA)) {
    fails.push("TMC_UNKNOWN_NONCLASSIFIED_RETAINED_COUNT");
  }
  if (!isNonNegInt(summary.TMC_UNKNOWN_REQUIRED_RETAINED_COUNT, MAX_RETAINED_UNKNOWN_ENTRY_METADATA)) {
    fails.push("TMC_UNKNOWN_REQUIRED_RETAINED_COUNT");
  }
  if (!isNonNegInt(summary.TMC_REJECTED_UNSAFE_RETAINED_COUNT, MAX_RETAINED_UNKNOWN_ENTRY_METADATA)) {
    fails.push("TMC_REJECTED_UNSAFE_RETAINED_COUNT");
  }
  if (!(summary.TMC_CID === null || (Number.isInteger(summary.TMC_CID) && summary.TMC_CID >= 0 && summary.TMC_CID <= 999))) {
    fails.push("TMC_CID");
  }
  if (!(summary.TMC_TABCD === null || (Number.isInteger(summary.TMC_TABCD) && summary.TMC_TABCD >= 0 && summary.TMC_TABCD <= 999))) {
    fails.push("TMC_TABCD");
  }
  if (typeof summary.TMC_RESOLVER_TABLE_ACTIVATED !== "boolean") fails.push("TMC_RESOLVER_TABLE_ACTIVATED");
  if (typeof summary.TMC_IGNORED_ENTRIES_TRUNCATED !== "boolean") fails.push("TMC_IGNORED_ENTRIES_TRUNCATED");
  if (typeof summary.TMC_UNKNOWN_NONCLASSIFIED_ENTRIES_TRUNCATED !== "boolean") {
    fails.push("TMC_UNKNOWN_NONCLASSIFIED_ENTRIES_TRUNCATED");
  }
  if (typeof summary.TMC_UNKNOWN_REQUIRED_ENTRIES_TRUNCATED !== "boolean") {
    fails.push("TMC_UNKNOWN_REQUIRED_ENTRIES_TRUNCATED");
  }
  if (typeof summary.TMC_REJECTED_UNSAFE_ENTRIES_TRUNCATED !== "boolean") {
    fails.push("TMC_REJECTED_UNSAFE_ENTRIES_TRUNCATED");
  }
  validateEntryMetaArray(summary.TMC_IGNORED_ENTRIES, "TMC_IGNORED_ENTRIES", MAX_RETAINED_IGNORED_ENTRY_METADATA, {
    requireResolutionRequiredFalse: true,
    requireAuthoritativeFalse: true,
  }, fails);
  validateEntryMetaArray(
    summary.TMC_UNKNOWN_NONCLASSIFIED_ENTRIES,
    "TMC_UNKNOWN_NONCLASSIFIED_ENTRIES",
    MAX_RETAINED_UNKNOWN_ENTRY_METADATA,
    {},
    fails
  );
  validateEntryMetaArray(
    summary.TMC_UNKNOWN_REQUIRED_ENTRIES,
    "TMC_UNKNOWN_REQUIRED_ENTRIES",
    MAX_RETAINED_UNKNOWN_ENTRY_METADATA,
    {},
    fails
  );
  validateEntryMetaArray(
    summary.TMC_REJECTED_UNSAFE_ENTRIES,
    "TMC_REJECTED_UNSAFE_ENTRIES",
    MAX_RETAINED_UNKNOWN_ENTRY_METADATA,
    {},
    fails
  );
  if (
    Array.isArray(summary.TMC_UNKNOWN_NONCLASSIFIED_ENTRIES) &&
    summary.TMC_UNKNOWN_NONCLASSIFIED_RETAINED_COUNT !== summary.TMC_UNKNOWN_NONCLASSIFIED_ENTRIES.length
  ) {
    fails.push("TMC_UNKNOWN_NONCLASSIFIED_RETAINED_MISMATCH");
  }
  if (
    Array.isArray(summary.TMC_UNKNOWN_REQUIRED_ENTRIES) &&
    summary.TMC_UNKNOWN_REQUIRED_RETAINED_COUNT !== summary.TMC_UNKNOWN_REQUIRED_ENTRIES.length
  ) {
    fails.push("TMC_UNKNOWN_REQUIRED_RETAINED_MISMATCH");
  }
  if (
    Array.isArray(summary.TMC_REJECTED_UNSAFE_ENTRIES) &&
    summary.TMC_REJECTED_UNSAFE_RETAINED_COUNT !== summary.TMC_REJECTED_UNSAFE_ENTRIES.length
  ) {
    fails.push("TMC_REJECTED_UNSAFE_RETAINED_MISMATCH");
  }
  if (typeof summary.TMC_RESOLVER_VERSION !== "string" || summary.TMC_RESOLVER_VERSION.length > 64) fails.push("TMC_RESOLVER_VERSION");

  const intFields = [
    "LOADED_EVENTS",
    "ACTIVE_EVENTS",
    "FUTURE_EVENTS",
    "ENDED_EVENTS",
    "REJECTED_EVENTS",
    "RESOLVED_BASIC",
    "RESOLVED_OPENLR",
    "UNRESOLVED",
    "DUPLICATES_DETECTED",
    "DEDUPLICATED_EVENTS",
    "NORMALIZED_EVENTS",
    "AGGREGATED_EVENTS",
    "DIFF_NEW",
    "DIFF_CHANGED",
    "DIFF_ENDED",
    "DIFF_CANCELLED",
    "PUBLICATION_ITEMS",
    "PUBLICATION_REJECTED",
    "FEED_ITEMS",
    "CARD_PREVIEW_COUNT",
    "PROVENANCE_FIELDS_VALID",
    "PROVENANCE_FIELDS_MISSING",
    "PROVENANCE_REJECTED",
    "SOURCE_TIME_VALID",
    "SOURCE_TIME_MISSING",
    "UNVERIFIED_KM_PUBLISHED",
    "UNVERIFIED_DIRECTION_PUBLISHED",
    "UNVERIFIED_LOCATION_PUBLISHED",
    "PUBLICATION_PROJECTIONS_TOTAL",
    "PUBLICATION_ELIGIBLE_TOTAL",
    "PUBLICATION_BLOCKED_TOTAL",
    "PUBLICATION_BLOCKED_LOCATION",
    "PUBLICATION_BLOCKED_KM",
    "PUBLICATION_BLOCKED_DIRECTION",
    "PUBLICATION_BLOCKED_PROVENANCE",
    "PUBLICATION_WITH_LOCATION",
    "PUBLICATION_WITHOUT_LOCATION",
    "PUBLICATION_WITH_KM",
    "PUBLICATION_WITHOUT_KM",
    "PUBLICATION_WITH_DIRECTION",
    "PUBLICATION_WITHOUT_DIRECTION",
    "RESOLVER_INPUT_TOTAL",
    "RESOLVER_ATTEMPTED_TOTAL",
    "RESOLVED_OTHER_VALID_LOCATION",
    "UNRESOLVED_TOTAL",
    "UNRESOLVED_TMC_REFERENCE",
    "UNRESOLVED_MISSING_REFERENCE",
    "UNRESOLVED_INVALID_REFERENCE",
    "FEED_INTERNAL_ITEMS",
    "FEED_PUBLICATION_ELIGIBLE_ITEMS",
    "FEED_PUBLICATION_BLOCKED_ITEMS",
    "UNRESOLVED_TMC_MISS_CID_MISMATCH",
    "UNRESOLVED_TMC_MISS_TABCD_MISMATCH",
    "UNRESOLVED_TMC_MISS_LCD_NOT_FOUND",
    "UNRESOLVED_TMC_MISS_POINT_LOOKUP_MISS",
    "UNRESOLVED_TMC_MISS_SEGMENT_LOOKUP_MISS",
    "UNRESOLVED_TMC_MISS_AREA_LOOKUP_MISS",
    "UNRESOLVED_TMC_MISS_UNSUPPORTED_REFERENCE_TYPE",
    "UNRESOLVED_TMC_MISS_UNSUPPORTED_DIRECTION",
    "UNRESOLVED_TMC_MISS_UNSUPPORTED_OFFSET",
    "UNRESOLVED_TMC_MISS_OTHER",
    "UNRESOLVED_MISSING_PROFILE_ALERTC_POINT",
    "UNRESOLVED_MISSING_PROFILE_ALERTC_LINEAR",
    "UNRESOLVED_MISSING_PROFILE_TMC_SPECIFIC_LOCATION",
    "UNRESOLVED_MISSING_PROFILE_POINT_COORDINATES",
    "UNRESOLVED_MISSING_PROFILE_OPENLR",
    "UNRESOLVED_MISSING_PROFILE_GML_POINT",
    "UNRESOLVED_MISSING_PROFILE_GML_LINESTRING",
    "UNRESOLVED_MISSING_PROFILE_GML_POLYGON",
    "UNRESOLVED_MISSING_PROFILE_NETWORK_LOCATION",
    "UNRESOLVED_MISSING_PROFILE_SUPPLEMENTARY_POSITIONAL_DESCRIPTION",
    "UNRESOLVED_MISSING_PROFILE_TEXT_ONLY",
    "UNRESOLVED_MISSING_PROFILE_NO_LOCALIZATION_SIGNAL",
    "UNRESOLVED_MISSING_PROFILE_OTHER",
    "LOC_HAS_ALERTC_POINT",
    "LOC_HAS_ALERTC_LINEAR",
    "LOC_HAS_SPECIFIC_LOCATION",
    "LOC_HAS_POINT_COORDINATES",
    "LOC_HAS_OPENLR",
    "LOC_HAS_GML_POINT",
    "LOC_HAS_GML_LINESTRING",
    "LOC_HAS_GML_POLYGON",
    "LOC_HAS_NETWORK_LOCATION",
    "LOC_HAS_SUPPLEMENTARY_POSITIONAL_DESCRIPTION",
    "POINT_COORDINATES_PRESENT_TOTAL",
    "POINT_COORDINATES_PARSED_TOTAL",
    "POINT_COORDINATES_VALID_TOTAL",
    "POINT_COORDINATES_VERIFIED_TRUST_TOTAL",
    "POINT_COORDINATES_BLOCKED_TOTAL",
    "TRUST_BEFORE_TMC",
    "TRUST_BEFORE_TEXT",
    "TRUST_BEFORE_NATIONAL_FALLBACK",
    "TRUST_BEFORE_NONE",
    "TRUST_AFTER_COORDINATES",
    "TRUST_AFTER_OPENLR",
    "TRUST_AFTER_TMC",
    "TRUST_AFTER_TEXT",
    "TRUST_AFTER_NATIONAL_FALLBACK",
    "TRUST_AFTER_NONE",
    "TMC_REF_KIND_POINT",
    "TMC_REF_KIND_LINEAR",
    "TMC_REF_KIND_OTHER",
    "TMC_LOCATION_CLASS_POINT",
    "TMC_LOCATION_CLASS_SEGMENT",
    "TMC_LOCATION_CLASS_AREA",
    "TMC_LOCATION_CLASS_UNKNOWN",
    "TMC_LCD_MISS_POINT_IN_LT",
    "TMC_LCD_MISS_SEGMENT_IN_LT",
    "TMC_LCD_MISS_AREA_IN_LT",
    "TMC_LCD_MISS_IN_CODES_ONLY",
    "TMC_LCD_MISS_ORPHAN_NOT_IN_LT",
    "SUPPLEMENTARY_VERIFIABLE_STANDARD_LOCATION",
    "SUPPLEMENTARY_TEXT_ONLY",
    "SUPPLEMENTARY_INCOMPLETE",
    "NO_SIGNAL_EMPTY_GROUP",
    "NO_SIGNAL_EMPTY_LOCALIZATION",
    "NO_SIGNAL_NO_LOCATION_ELEMENT",
    "NO_SIGNAL_KNOWN_PROFILE_BUT_NO_USABLE_REFERENCE",
    "NO_SIGNAL_UNRECOGNIZED_PROFILE",
    "NO_SIGNAL_UNRECOGNIZED_STANDARD_PROFILE",
    "NO_SIGNAL_UNRECOGNIZED_VENDOR_EXTENSION",
    "NO_SIGNAL_LOCATION_EXTENSION_ONLY",
    "NO_SIGNAL_TEXT_ONLY_LOCATION",
    "NO_SIGNAL_STRUCTURED_BUT_INCOMPLETE",
    "NO_SIGNAL_OTHER",
    "LOC_HAS_ALERTC_AREA",
    "LOC_HAS_TPEG",
    "LOC_HAS_ITINERARY",
    "LOC_HAS_UNRECOGNIZED_LOCATION_PROFILE",
    "STANDARD_ROOT_INVENTORY_SUM",
    "VENDOR_ROOT_INVENTORY_SUM",
    "VENDOR_CLASS_KNOWN_DATEX_PROFILE_INSIDE_EXTENSION",
    "VENDOR_CLASS_KNOWN_DATEX_EXTENSION_TYPE",
    "VENDOR_CLASS_NDIC_VENDOR_EXTENSION",
    "VENDOR_CLASS_OTHER_VENDOR_EXTENSION",
    "VENDOR_CLASS_METADATA_ONLY_EXTENSION",
    "VENDOR_CLASS_STRUCTURED_LOCATION_EXTENSION",
    "VENDOR_CLASS_TEXT_ONLY_EXTENSION",
    "VENDOR_CLASS_UNKNOWN_EXTENSION",
    "VENDOR_CLASS_TOTAL",
    "PREDEFINED_REF_TOTAL",
    "PREDEFINED_REF_HAS_ID",
    "PREDEFINED_REF_HAS_VERSION",
    "PREDEFINED_REF_HAS_SET_HINT",
    "PLS_DATASETS_CHECKED_COUNT",
    "PLS_MATCHED_TO_CATALOG",
    "PLS_UNMATCHED_TO_CATALOG",
    "PLS_MULTIPLE_CATALOG_MATCH",
    "PLS_CATALOG_BINDING_PROVEN_TOTAL",
    "PLS_LOCATION_RECORD_EXISTS_TOTAL",
    "PLS_VERIFIED_LOCATION_POSSIBLE_TOTAL",
    "OPENLR_INPUT_TOTAL",
    "OPENLR_RESOLVED_TOTAL",
    "OPENLR_AMBIGUOUS_TOTAL",
    "OPENLR_INVALID_TOTAL",
    "OPENLR_UNSUPPORTED_TOTAL",
    "OPENLR_REFERENCE_DATA_MISSING_TOTAL",
    "OPENLR_DECODE_FAILED_TOTAL",
    "OPENLR_PUBLICATION_ELIGIBLE_TOTAL",
    "OPENLR_PUBLICATION_BLOCKED_TOTAL",
    "OPENLR_TYPE_LINE",
    "OPENLR_TYPE_POINT",
    "OPENLR_TYPE_GEO",
    "OPENLR_TYPE_AREA",
    "OPENLR_TYPE_BINARY",
    "OPENLR_TYPE_OTHER",
    "OPENLR_ENCODING_XML",
    "OPENLR_ENCODING_BINARY",
  ];
  for (const f of intFields) {
    if (!isNonNegInt(summary[f])) fails.push(f);
  }

  if (typeof summary.STANDARD_ROOT_INVENTORY_TRUNCATED !== "boolean") {
    fails.push("STANDARD_ROOT_INVENTORY_TRUNCATED");
  }
  if (typeof summary.VENDOR_ROOT_INVENTORY_TRUNCATED !== "boolean") {
    fails.push("VENDOR_ROOT_INVENTORY_TRUNCATED");
  }
  if (typeof summary.PREDEFINED_REF_DIGEST_INVENTORY_TRUNCATED !== "boolean") {
    fails.push("PREDEFINED_REF_DIGEST_INVENTORY_TRUNCATED");
  }
  if (typeof summary.PLS_CATALOG_CHECK_PERFORMED !== "boolean") {
    fails.push("PLS_CATALOG_CHECK_PERFORMED");
  }
  if (summary.COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF !== false) {
    fails.push("COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF_must_be_false");
  }
  validateRootInventoryArray(
    summary.STANDARD_ROOT_INVENTORY,
    "STANDARD_ROOT_INVENTORY",
    MAX_ROOT_INVENTORY_ROWS,
    fails
  );
  validateRootInventoryArray(
    summary.VENDOR_ROOT_INVENTORY,
    "VENDOR_ROOT_INVENTORY",
    MAX_ROOT_INVENTORY_ROWS,
    fails
  );
  validatePredefinedRefDigestArray(
    summary.PREDEFINED_REF_DIGEST_INVENTORY,
    "PREDEFINED_REF_DIGEST_INVENTORY",
    MAX_PREDEFINED_REF_DIGEST_ROWS,
    fails
  );
  if (
    Number.isInteger(summary.STANDARD_ROOT_INVENTORY_SUM) &&
    Number.isInteger(summary.NO_SIGNAL_UNRECOGNIZED_STANDARD_PROFILE) &&
    summary.STANDARD_ROOT_INVENTORY_SUM !== summary.NO_SIGNAL_UNRECOGNIZED_STANDARD_PROFILE
  ) {
    fails.push("STANDARD_ROOT_INVENTORY_SUM_MISMATCH");
  }
  if (
    Number.isInteger(summary.VENDOR_ROOT_INVENTORY_SUM) &&
    Number.isInteger(summary.NO_SIGNAL_UNRECOGNIZED_VENDOR_EXTENSION) &&
    summary.VENDOR_ROOT_INVENTORY_SUM !== summary.NO_SIGNAL_UNRECOGNIZED_VENDOR_EXTENSION
  ) {
    fails.push("VENDOR_ROOT_INVENTORY_SUM_MISMATCH");
  }
  if (
    Number.isInteger(summary.VENDOR_CLASS_TOTAL) &&
    Number.isInteger(summary.NO_SIGNAL_UNRECOGNIZED_VENDOR_EXTENSION) &&
    summary.VENDOR_CLASS_TOTAL !== summary.NO_SIGNAL_UNRECOGNIZED_VENDOR_EXTENSION
  ) {
    fails.push("VENDOR_CLASS_TOTAL_MISMATCH");
  }
  if (
    Number.isInteger(summary.PREDEFINED_REF_TOTAL) &&
    Number.isInteger(summary.PLS_MATCHED_TO_CATALOG) &&
    Number.isInteger(summary.PLS_UNMATCHED_TO_CATALOG) &&
    Number.isInteger(summary.PLS_MULTIPLE_CATALOG_MATCH) &&
    summary.PLS_MATCHED_TO_CATALOG +
      summary.PLS_UNMATCHED_TO_CATALOG +
      summary.PLS_MULTIPLE_CATALOG_MATCH !==
      summary.PREDEFINED_REF_TOTAL
  ) {
    fails.push("PLS_MATCH_SUM_MISMATCH");
  }
  if (
    Number.isInteger(summary.PREDEFINED_REF_HAS_ID) &&
    Number.isInteger(summary.PREDEFINED_REF_TOTAL) &&
    summary.PREDEFINED_REF_HAS_ID > summary.PREDEFINED_REF_TOTAL
  ) {
    fails.push("PREDEFINED_REF_HAS_ID_OVERFLOW");
  }

  for (const b of [
    "CARD_VALIDATION_PASS",
    "CARD_PROJECTION_VALIDATION_PASS",
    "CARD_PUBLICATION_ELIGIBILITY_PASS",
    "CARD_LOCATION_VALIDATION_PASS",
    "SHADOW_ISOLATED",
    "GEOCODING_USED",
  ]) {
    if (typeof summary[b] !== "boolean") fails.push(b);
  }
  if (summary.FUZZY_MATCH_USED !== false) fails.push("FUZZY_MATCH_USED_must_be_false");
  if (summary.HEURISTIC_LOCATION_USED !== false) fails.push("HEURISTIC_LOCATION_USED_must_be_false");
  if (summary.PUBLICATION_ENABLED !== false) fails.push("PUBLICATION_ENABLED_must_be_false");
  if (summary.PUBLISHED !== false) fails.push("PUBLISHED_must_be_false");
  if (summary.MAX_CARD_PREVIEW_ITEMS !== MAX_CARD_PREVIEW_ITEMS) fails.push("MAX_CARD_PREVIEW_ITEMS");
  if (summary.CARD_PREVIEW_COUNT > MAX_CARD_PREVIEW_ITEMS) fails.push("CARD_PREVIEW_COUNT_exceeds_max");
  if (summary.UNVERIFIED_KM_PUBLISHED !== 0) fails.push("UNVERIFIED_KM_PUBLISHED_nonzero");
  if (summary.UNVERIFIED_DIRECTION_PUBLISHED !== 0) fails.push("UNVERIFIED_DIRECTION_PUBLISHED_nonzero");
  if (summary.UNVERIFIED_LOCATION_PUBLISHED !== 0) fails.push("UNVERIFIED_LOCATION_PUBLISHED_nonzero");

  // Cross-field invariants (fail-closed publication semantics)
  assertInvariant(
    summary.PUBLICATION_ELIGIBLE_TOTAL + summary.PUBLICATION_BLOCKED_TOTAL === summary.PUBLICATION_PROJECTIONS_TOTAL,
    "invariant_publication_eligible_plus_blocked",
    fails
  );
  assertInvariant(
    summary.PUBLICATION_ITEMS === summary.PUBLICATION_PROJECTIONS_TOTAL,
    "invariant_publication_items_equals_projections",
    fails
  );
  assertInvariant(
    summary.PUBLICATION_WITH_LOCATION + summary.PUBLICATION_WITHOUT_LOCATION === summary.PUBLICATION_PROJECTIONS_TOTAL,
    "invariant_publication_location_split",
    fails
  );
  assertInvariant(
    summary.PUBLICATION_WITH_KM + summary.PUBLICATION_WITHOUT_KM === summary.PUBLICATION_PROJECTIONS_TOTAL,
    "invariant_publication_km_split",
    fails
  );
  assertInvariant(
    summary.PUBLICATION_WITH_DIRECTION + summary.PUBLICATION_WITHOUT_DIRECTION === summary.PUBLICATION_PROJECTIONS_TOTAL,
    "invariant_publication_direction_split",
    fails
  );
  assertInvariant(
    summary.PUBLICATION_WITH_LOCATION <= summary.PUBLICATION_PROJECTIONS_TOTAL,
    "invariant_with_location_lte_total",
    fails
  );
  assertInvariant(
    summary.PUBLICATION_ELIGIBLE_TOTAL <= summary.PUBLICATION_WITH_LOCATION,
    "invariant_eligible_requires_verified_location",
    fails
  );
  assertInvariant(
    summary.FEED_INTERNAL_ITEMS === summary.FEED_ITEMS,
    "invariant_feed_internal_equals_feed_items",
    fails
  );
  assertInvariant(
    summary.FEED_PUBLICATION_ELIGIBLE_ITEMS + summary.FEED_PUBLICATION_BLOCKED_ITEMS === summary.FEED_INTERNAL_ITEMS,
    "invariant_feed_eligible_plus_blocked",
    fails
  );
  assertInvariant(
    summary.RESOLVED_BASIC + summary.RESOLVED_OPENLR + summary.RESOLVED_OTHER_VALID_LOCATION + summary.UNRESOLVED_TOTAL === summary.RESOLVER_INPUT_TOTAL,
    "invariant_resolver_partition",
    fails
  );
  assertInvariant(summary.UNRESOLVED === summary.UNRESOLVED_TOTAL, "invariant_unresolved_alias", fails);
  assertInvariant(
    summary.UNRESOLVED_TMC_REFERENCE + summary.UNRESOLVED_MISSING_REFERENCE + summary.UNRESOLVED_INVALID_REFERENCE <=
      summary.UNRESOLVED_TOTAL,
    "invariant_unresolved_subcats",
    fails
  );
  assertInvariant(
    [
      "UNRESOLVED_TMC_MISS_CID_MISMATCH",
      "UNRESOLVED_TMC_MISS_TABCD_MISMATCH",
      "UNRESOLVED_TMC_MISS_LCD_NOT_FOUND",
      "UNRESOLVED_TMC_MISS_POINT_LOOKUP_MISS",
      "UNRESOLVED_TMC_MISS_SEGMENT_LOOKUP_MISS",
      "UNRESOLVED_TMC_MISS_AREA_LOOKUP_MISS",
      "UNRESOLVED_TMC_MISS_UNSUPPORTED_REFERENCE_TYPE",
      "UNRESOLVED_TMC_MISS_UNSUPPORTED_DIRECTION",
      "UNRESOLVED_TMC_MISS_UNSUPPORTED_OFFSET",
      "UNRESOLVED_TMC_MISS_OTHER",
    ].reduce((sum, key) => sum + summary[key], 0) === summary.UNRESOLVED_TMC_REFERENCE,
    "invariant_unresolved_tmc_miss_reasons",
    fails
  );
  assertInvariant(
    [
      "UNRESOLVED_MISSING_PROFILE_ALERTC_POINT",
      "UNRESOLVED_MISSING_PROFILE_ALERTC_LINEAR",
      "UNRESOLVED_MISSING_PROFILE_TMC_SPECIFIC_LOCATION",
      "UNRESOLVED_MISSING_PROFILE_POINT_COORDINATES",
      "UNRESOLVED_MISSING_PROFILE_OPENLR",
      "UNRESOLVED_MISSING_PROFILE_GML_POINT",
      "UNRESOLVED_MISSING_PROFILE_GML_LINESTRING",
      "UNRESOLVED_MISSING_PROFILE_GML_POLYGON",
      "UNRESOLVED_MISSING_PROFILE_NETWORK_LOCATION",
      "UNRESOLVED_MISSING_PROFILE_SUPPLEMENTARY_POSITIONAL_DESCRIPTION",
      "UNRESOLVED_MISSING_PROFILE_TEXT_ONLY",
      "UNRESOLVED_MISSING_PROFILE_NO_LOCALIZATION_SIGNAL",
      "UNRESOLVED_MISSING_PROFILE_OTHER",
    ].reduce((sum, key) => sum + summary[key], 0) === summary.UNRESOLVED_MISSING_REFERENCE,
    "invariant_unresolved_missing_profiles",
    fails
  );
  assertInvariant(
    summary.CARD_VALIDATION_PASS ===
      (summary.CARD_PROJECTION_VALIDATION_PASS &&
        summary.CARD_PUBLICATION_ELIGIBILITY_PASS &&
        summary.CARD_LOCATION_VALIDATION_PASS),
    "invariant_card_validation_composite",
    fails
  );

  walkForbiddenKeys(summary, "", fails);
  return { ok: fails.length === 0, fails };
}

/**
 * @returns {{ ok: boolean, fails: string[] }}
 */
export function validateCardPreview(preview) {
  const fails = [];
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) {
    return { ok: false, fails: ["preview_not_object"] };
  }
  const allowedTop = ["schema", "HEAD_SHA", "RUN_ID", "items", "COUNT", "PUBLICATION_ENABLED"];
  for (const k of Object.keys(preview)) {
    if (!allowedTop.includes(k)) fails.push("preview_additional:" + k);
  }
  if (preview.schema !== CARD_PREVIEW_SCHEMA) fails.push("preview_schema");
  if (!isSha40(preview.HEAD_SHA)) fails.push("preview_HEAD_SHA");
  if (typeof preview.RUN_ID !== "string" || preview.RUN_ID.length > 80) fails.push("preview_RUN_ID");
  if (!Array.isArray(preview.items)) fails.push("preview_items");
  if (!isNonNegInt(preview.COUNT)) fails.push("preview_COUNT");
  if (preview.PUBLICATION_ENABLED !== false) fails.push("preview_PUBLICATION_ENABLED");
  if (preview.items && preview.items.length > MAX_CARD_PREVIEW_ITEMS) fails.push("preview_items_exceed_max");
  if (preview.COUNT !== (preview.items ? preview.items.length : -1)) fails.push("preview_COUNT_mismatch");

  for (const [i, item] of (preview.items || []).entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fails.push("preview_item_not_object:" + i);
      continue;
    }
    for (const k of Object.keys(item)) {
      if (!CARD_PREVIEW_ALLOWLIST.includes(k)) fails.push("preview_item_additional:" + i + "." + k);
    }
    for (const k of CARD_PREVIEW_ALLOWLIST) {
      if (!Object.prototype.hasOwnProperty.call(item, k)) fails.push("preview_item_missing:" + i + "." + k);
      const v = item[k];
      if (v !== null && typeof v !== "string") fails.push("preview_item_type:" + i + "." + k);
      if (typeof v === "string" && v.length > 120) fails.push("preview_item_maxlen:" + i + "." + k);
      if (typeof v === "string" && FORBIDDEN_VALUE_RE.test(v)) fails.push("preview_item_forbidden_value:" + i + "." + k);
    }
  }
  walkForbiddenKeys(preview, "preview", fails);
  return { ok: fails.length === 0, fails };
}

/**
 * @returns {{ ok: boolean, fails: string[] }}
 */
export function validateValidationReport(report) {
  const fails = [];
  if (!report || typeof report !== "object") return { ok: false, fails: ["report_not_object"] };
  const allow = [
    "schema",
    "HEAD_SHA",
    "RUN_ID",
    "SUMMARY_SCHEMA_PASS",
    "CARD_PREVIEW_SCHEMA_PASS",
    "CANARY_PASS",
    "FORENSIC_RETENTION_PASS",
    "PUBLICATION_ENABLED",
    "PUBLISHED",
    "FAILS",
  ];
  for (const k of Object.keys(report)) {
    if (!allow.includes(k)) fails.push("report_additional:" + k);
  }
  if (report.schema !== VALIDATION_REPORT_SCHEMA) fails.push("report_schema");
  if (!isSha40(report.HEAD_SHA)) fails.push("report_HEAD_SHA");
  if (typeof report.RUN_ID !== "string") fails.push("report_RUN_ID");
  for (const b of ["SUMMARY_SCHEMA_PASS", "CARD_PREVIEW_SCHEMA_PASS", "CANARY_PASS", "FORENSIC_RETENTION_PASS"]) {
    if (typeof report[b] !== "boolean") fails.push(b);
  }
  if (report.PUBLICATION_ENABLED !== false) fails.push("report_PUBLICATION_ENABLED");
  if (report.PUBLISHED !== false) fails.push("report_PUBLISHED");
  if (!Array.isArray(report.FAILS)) fails.push("report_FAILS");
  if (report.FAILS && report.FAILS.length > 200) fails.push("report_FAILS_too_many");
  for (const f of report.FAILS || []) {
    if (typeof f !== "string" || f.length > 200) fails.push("report_FAIL_entry");
    if (typeof f === "string" && FORBIDDEN_VALUE_RE.test(f)) fails.push("report_FAIL_forbidden");
  }
  walkForbiddenKeys(report, "report", fails);
  return { ok: fails.length === 0, fails };
}

/**
 * Canary: fail on any forbidden key/value in forensic bundle.
 * Walk only — do not JSON.stringify (avoids cross-field false positives on key names).
 */
export function scanForensicCanaries(bundle) {
  const fails = [];
  walkForbiddenKeys(bundle, "bundle", fails);
  return { ok: fails.length === 0, fails };
}
