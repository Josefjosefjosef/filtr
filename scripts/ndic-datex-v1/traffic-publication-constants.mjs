/**
 * Offline traffic publication-layer constants.
 * PUBLICATION_ENABLED / PUBLIC_API / TRAFFIC_UI remain false.
 */
export const PUBLICATION_LAYER_FLAGS = Object.freeze({
  PUBLICATION_ENABLED: false,
  PUBLIC_API_ENABLED: false,
  TRAFFIC_UI_ENABLED: false,
  TRAFFIC_CARDS_LIVE_ENABLED: false,
  DELAY_ESTIMATION_ENABLED: false,
  TRAVEL_TIME_ESTIMATION_ENABLED: false,
  QUEUE_LENGTH_ESTIMATION_ENABLED: false,
  FUZZY_DEDUPLICATION_ENABLED: false,
  HEURISTIC_MAP_LINK_ENABLED: false,
});

export const PUBLICATION_ELIGIBILITY = Object.freeze({
  ELIGIBLE_FOR_PUBLICATION: "ELIGIBLE_FOR_PUBLICATION",
  INELIGIBLE_UNRESOLVED_LOCATION: "INELIGIBLE_UNRESOLVED_LOCATION",
  INELIGIBLE_INVALID_LOCATION: "INELIGIBLE_INVALID_LOCATION",
  INELIGIBLE_AMBIGUOUS_LOCATION: "INELIGIBLE_AMBIGUOUS_LOCATION",
  INELIGIBLE_CONFLICT: "INELIGIBLE_CONFLICT",
  INELIGIBLE_UNSUPPORTED_RELATIONSHIP: "INELIGIBLE_UNSUPPORTED_RELATIONSHIP",
  INELIGIBLE_INVALID_TIME: "INELIGIBLE_INVALID_TIME",
  INELIGIBLE_INVALID_EVENT_TYPE: "INELIGIBLE_INVALID_EVENT_TYPE",
  INELIGIBLE_STALE_SOURCE: "INELIGIBLE_STALE_SOURCE",
  INELIGIBLE_MISSING_REQUIRED_FIELDS: "INELIGIBLE_MISSING_REQUIRED_FIELDS",
  INELIGIBLE_SECURITY_BLOCKER: "INELIGIBLE_SECURITY_BLOCKER",
});

export const LIFECYCLE_STATUS = Object.freeze({
  NEW: "NEW",
  CHANGED: "CHANGED",
  ACTIVE: "ACTIVE",
  FUTURE: "FUTURE",
  ENDED: "ENDED",
  CANCELLED: "CANCELLED",
});

export const CHANGE_STATUS = Object.freeze({
  NEW: "NEW",
  CHANGED: "CHANGED",
  UNCHANGED: "UNCHANGED",
  ENDED: "ENDED",
  CANCELLED: "CANCELLED",
  REOPENED: "REOPENED",
});

export const FEED_CHANGE_TYPE = Object.freeze({
  EVENT_CREATED: "EVENT_CREATED",
  EVENT_UPDATED: "EVENT_UPDATED",
  VALIDITY_START_CHANGED: "VALIDITY_START_CHANGED",
  VALIDITY_EXTENDED: "VALIDITY_EXTENDED",
  VALIDITY_SHORTENED: "VALIDITY_SHORTENED",
  SEVERITY_CHANGED: "SEVERITY_CHANGED",
  LOCATION_CHANGED: "LOCATION_CHANGED",
  DIRECTION_CHANGED: "DIRECTION_CHANGED",
  ROAD_CHANGED: "ROAD_CHANGED",
  SECTION_CHANGED: "SECTION_CHANGED",
  IMPACT_CHANGED: "IMPACT_CHANGED",
  EVENT_ENDED: "EVENT_ENDED",
  EVENT_CANCELLED: "EVENT_CANCELLED",
  EVENT_REOPENED: "EVENT_REOPENED",
});

export const CONFIDENCE_CLASS = Object.freeze({
  VERIFIED_SOURCE_FIELD: "VERIFIED_SOURCE_FIELD",
  VERIFIED_RESOLVED_BASIC: "VERIFIED_RESOLVED_BASIC",
  VERIFIED_DERIVED_DIFF: "VERIFIED_DERIVED_DIFF",
  NOT_PUBLIC: "NOT_PUBLIC",
});

export const MAP_LINK_TYPE = Object.freeze({
  OFFICIAL_EVENT: "OFFICIAL_EVENT",
  VERIFIED_LOCATION: "VERIFIED_LOCATION",
  GENERAL_RSD_MAP: "GENERAL_RSD_MAP",
  NONE: "NONE",
});

export const METRIC_STATUS = Object.freeze({
  PROVEN: "PROVEN",
  NOT_AVAILABLE: "NOT_AVAILABLE",
  INVALID: "INVALID",
  STALE: "STALE",
  CONFLICT: "CONFLICT",
});

export const EVENT_TYPE_FILTER = Object.freeze({
  ALL: "ALL",
  CLOSURES: "CLOSURES",
  RESTRICTIONS: "RESTRICTIONS",
  ACCIDENTS: "ACCIDENTS",
  ROADWORKS: "ROADWORKS",
  QUEUES: "QUEUES",
  ROAD_AND_WEATHER: "ROAD_AND_WEATHER",
  FUTURE: "FUTURE",
  ENDED: "ENDED",
  SEVERE: "SEVERE",
});

export const PUBLICATION_ERROR = Object.freeze({
  PUB_INPUT_INVALID: "PUB_INPUT_INVALID",
  PUB_INELIGIBLE: "PUB_INELIGIBLE",
  PUB_ALLOWLIST_VIOLATION: "PUB_ALLOWLIST_VIOLATION",
  PUB_FORBIDDEN_FIELD: "PUB_FORBIDDEN_FIELD",
  PUB_SECURITY_CANARY_DETECTED: "PUBLICATION_SECURITY_CANARY_DETECTED",
  PUB_PARTIAL_SNAPSHOT: "PUB_PARTIAL_SNAPSHOT",
  PUB_SNAPSHOT_TOO_LARGE: "PUB_SNAPSHOT_TOO_LARGE",
  PUB_MEMORY_LIMIT: "PUB_MEMORY_LIMIT",
  PUB_STAGING_FAILED: "PUB_STAGING_FAILED",
  PUB_CLEANUP_FAILED: "PUB_CLEANUP_FAILED",
  PUB_ENABLED_FORBIDDEN: "PUB_ENABLED_FORBIDDEN",
  PUB_INTERNAL_SAFE_FAILURE: "PUB_INTERNAL_SAFE_FAILURE",
  PUB_SCHEMA_VIOLATION: "PUB_SCHEMA_VIOLATION",
});

/** Structural allowlist for public projection top-level keys. */
export const PUBLIC_PROJECTION_ALLOWLIST = Object.freeze([
  "schema",
  "publicEventId",
  "lifecycleStatus",
  "changeStatus",
  "eventType",
  "eventCategory",
  "severity",
  "roadNumber",
  "roadName",
  "kilometer",
  "sectionLabel",
  "direction",
  "locationLabel",
  "administrativeArea",
  "validFrom",
  "expectedEnd",
  "actualEnd",
  "impactSummary",
  "lastMeaningfulChangeAt",
  "changeTimeSource",
  "measurementTime",
  "sourceUpdatedAt",
  "downloadedAt",
  "publishedSnapshotAt",
  "freshnessStatus",
  "sourceLabel",
  "mapLinkType",
  "safeMapTarget",
  "feedHeadline",
  "feedChangeType",
  "delayStatus",
  "delayMinutes",
  "queueLengthStatus",
  "queueLengthMeters",
  "speedStatus",
  "speedKmh",
  "travelTimeStatus",
  "travelTimeMinutes",
  "fieldProvenance",
  "publicationEligibility",
  "publicationEnabled",
]);

export const FORBIDDEN_PUBLIC_SUBSTRINGS = Object.freeze([
  "locationCode",
  "importRunId",
  "tmcRefs",
  "PES_LEV",
  "RNLT",
  "Authorization",
  "password",
  "Bearer ",
  "<Situation",
  "At line:",
  "C:\\\\Users",
  "C:/Users",
  "/home/",
  "subscription",
]);

export const GENERAL_RSD_MAP_URL = "https://www.dopravniinfo.cz/";

export const PUBLIC_EVENT_ID_VERSION = "peid-v1";

export function publicProvenance(value, source, sourceTimestamp, lastChangedAt, validationStatus, confidenceClass) {
  return Object.freeze({
    value: value === undefined ? null : value,
    source: source || null,
    sourceTimestamp: sourceTimestamp || null,
    lastChangedAt: lastChangedAt || null,
    validationStatus: validationStatus || "unchecked",
    confidenceClass: confidenceClass || CONFIDENCE_CLASS.NOT_PUBLIC,
  });
}
