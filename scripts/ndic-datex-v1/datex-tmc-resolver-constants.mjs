/**
 * DATEX → basic TMC resolver constants (fail-closed feature flags).
 */
export const RESOLVER_STATUS = Object.freeze({
  RESOLVED_BASIC: "RESOLVED_BASIC",
  UNRESOLVED_MISSING_REFERENCE: "UNRESOLVED_MISSING_REFERENCE",
  UNRESOLVED_INVALID_REFERENCE: "UNRESOLVED_INVALID_REFERENCE",
  UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP: "UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP",
  UNRESOLVED_AMBIGUOUS: "UNRESOLVED_AMBIGUOUS",
  REJECTED_INVALID_INPUT: "REJECTED_INVALID_INPUT",
});

export const PUBLIC_ELIGIBILITY = Object.freeze({
  RESOLVED_BASIC: true,
  UNRESOLVED_MISSING_REFERENCE: false,
  UNRESOLVED_INVALID_REFERENCE: false,
  UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP: false,
  UNRESOLVED_AMBIGUOUS: false,
  REJECTED_INVALID_INPUT: false,
});

export const LOCATION_INPUT_TYPE = Object.freeze({
  TMC_POINT: "TMC_POINT",
  TMC_LINEAR: "TMC_LINEAR",
  TMC_AREA: "TMC_AREA",
  TMC_SECONDARY_POINT: "TMC_SECONDARY_POINT",
  TMC_POSITIVE_OFFSET: "TMC_POSITIVE_OFFSET",
  TMC_NEGATIVE_OFFSET: "TMC_NEGATIVE_OFFSET",
  DIRECT_COORDINATE: "DIRECT_COORDINATE",
  UNSUPPORTED_LOCATION_TYPE: "UNSUPPORTED_LOCATION_TYPE",
});

export const DIRECTION = Object.freeze({
  POSITIVE: "POSITIVE",
  NEGATIVE: "NEGATIVE",
  BOTH: "BOTH",
  UNKNOWN: "UNKNOWN",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  CONFLICT: "CONFLICT",
});

export const MULTI_RESOLUTION_KIND = Object.freeze({
  SINGLE_RESOLUTION: "SINGLE_RESOLUTION",
  MULTIPLE_CONSISTENT_RESOLUTIONS: "MULTIPLE_CONSISTENT_RESOLUTIONS",
  MULTIPLE_DISTINCT_RESOLUTIONS: "MULTIPLE_DISTINCT_RESOLUTIONS",
  CONFLICTING_RESOLUTIONS: "CONFLICTING_RESOLUTIONS",
  NO_RESOLUTION: "NO_RESOLUTION",
});

export const COORD_COMPARE = Object.freeze({
  CONSISTENT: "CONSISTENT",
  PARTIAL: "PARTIAL",
  CONFLICT: "CONFLICT",
  NOT_COMPARABLE: "NOT_COMPARABLE",
});

export const KILOMETER_STATUS = Object.freeze({
  PROVEN: "PROVEN",
  NOT_AVAILABLE: "NOT_AVAILABLE",
  CONFLICT: "CONFLICT",
  INVALID: "INVALID",
});

export const FRESHNESS = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  EXPIRED: "EXPIRED",
  UNKNOWN: "UNKNOWN",
});

export const RESOLVER_FEATURE_FLAGS = Object.freeze({
  RNLT_ADVANCED_RELATIONSHIPS_ENABLED: false,
  PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED: false,
  LANGUAGES_FIFTH_FIELD_USED: false,
  FUZZY_LOCATION_MATCHING_ENABLED: false,
  KILOMETER_ESTIMATION_ENABLED: false,
  COORDINATE_INTERPOLATION_ENABLED: false,
  UNPROVEN_FIELDS_INFERRED: false,
});

/**
 * Documented NDIC DATEX Alert-C defaults (regression-tested).
 * Alert-C country code 2 ↔ TISA CID 11; LTN/TABCD 25.
 */
export const NDIC_DATEX_ALERTC_CONTRACT = Object.freeze({
  alertCCountryCode: 2,
  tisaCid: 11,
  tabcd: 25,
  tableVersion: 11,
  missingAlertCDefaultsAllowed: true,
  defaultSource: "ndic_datex_alertc_contract",
});

export const RESOLVER_LIMITS = Object.freeze({
  maxLocationCodeDigits: 5,
  maxOffsetAbs: 100_000,
  maxRelationshipDepth: 4,
  maxBatchEvents: 10_000,
  maxRefsPerEvent: 40,
  maxCoordDeltaDegrees: 0.5,
  czechLatMin: 48.5,
  czechLatMax: 51.1,
  czechLonMin: 12.0,
  czechLonMax: 18.9,
});

export function fieldProvenance(value, source, sourceUpdatedAt, validationStatus) {
  return Object.freeze({
    value: value === undefined ? null : value,
    source: source || null,
    sourceUpdatedAt: sourceUpdatedAt || null,
    validationStatus: validationStatus || "unchecked",
  });
}
