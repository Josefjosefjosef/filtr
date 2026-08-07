/**
 * Fail-closed allowlists for NDIC isolated-shadow forensic retention.
 * Counts/booleans only — no raw DATEX/TMC/auth payloads.
 */

export const MAX_CARD_PREVIEW_ITEMS = 20;
export const FORENSIC_SCHEMA = "iu-ndic-shadow-forensic-summary-v2";
export const CARD_PREVIEW_SCHEMA = "iu-ndic-shadow-card-preview-v1";
export const VALIDATION_REPORT_SCHEMA = "iu-ndic-shadow-validation-report-v2";

export const FORENSIC_DIR_NAME = "ndic-shadow-forensic";
export const FORENSIC_SUMMARY_FILE = "ndic-shadow-forensic-summary.json";
export const FORENSIC_CARD_PREVIEW_FILE = "ndic-shadow-card-preview.json";
export const FORENSIC_VALIDATION_FILE = "ndic-shadow-validation-report.json";

/** Max DATEX body bytes accepted in forensic summary (real feeds exceed 50MiB). */
export const MAX_DATEX_BYTES_READ = 512_000_000;
export const MAX_EVENT_COUNT = 50_000_000;

/** Card preview fields (publication-safe only). */
export const CARD_PREVIEW_ALLOWLIST = Object.freeze([
  "type",
  "road",
  "km",
  "direction",
  "locality",
  "startsAt",
  "endsAt",
  "status",
  "severity",
  "source",
  "lastChangedAt",
]);

/** Top-level forensic summary allowlist. */
export const FORENSIC_SUMMARY_ALLOWLIST = Object.freeze([
  "schema",
  "RUN_ID",
  "HEAD_SHA",
  "MODE",
  "STARTED_AT",
  "FINISHED_AT",
  "OK",
  "REASON",
  "DATEX_HTTP_STATUS_CLASS",
  "DATEX_CONTENT_TYPE_VALID",
  "DATEX_BYTES_READ",
  "DATEX_XML_PARSE_PASS",
  "TMC_ARCHIVE_USED",
  "TMC_VERSION",
  "TMC_RESOLVER_VERSION",
  "LOADED_EVENTS",
  "ACTIVE_EVENTS",
  "FUTURE_EVENTS",
  "ENDED_EVENTS",
  "REJECTED_EVENTS",
  "RESOLVED_BASIC",
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
  "CARD_VALIDATION_PASS",
  "CARD_PROJECTION_VALIDATION_PASS",
  "CARD_PUBLICATION_ELIGIBILITY_PASS",
  "CARD_LOCATION_VALIDATION_PASS",
  "PROVENANCE_FIELDS_VALID",
  "PROVENANCE_FIELDS_MISSING",
  "PROVENANCE_REJECTED",
  "SOURCE_TIME_VALID",
  "SOURCE_TIME_MISSING",
  "UNVERIFIED_KM_PUBLISHED",
  "UNVERIFIED_DIRECTION_PUBLISHED",
  "UNVERIFIED_LOCATION_PUBLISHED",
  "FUZZY_MATCH_USED",
  "GEOCODING_USED",
  "HEURISTIC_LOCATION_USED",
  "PUBLICATION_ENABLED",
  "PUBLISHED",
  "SHADOW_ISOLATED",
  "MAX_CARD_PREVIEW_ITEMS",
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
]);

export const FORBIDDEN_FORENSIC_KEYS = Object.freeze([
  "rawXml",
  "rawXML",
  "rawDatex",
  "rawTmc",
  "rawBody",
  "rawCsv",
  "rawZip",
  "password",
  "passwd",
  "pullPass",
  "tmcPullPass",
  "authorization",
  "Authorization",
  "cookie",
  "cookies",
  "username",
  "userName",
  "pullUser",
  "tmcPullUser",
  "token",
  "secret",
  "secrets",
  "subscriberId",
  "locationCode",
  "locationCodes",
  "tmcLocationCodes",
  "lat",
  "lon",
  "latitude",
  "longitude",
  "coordinates",
  "stack",
  "stackTrace",
  "pullUrl",
  "tmcPullUrl",
  "endpoint",
  "body",
  "payload",
  "xml",
]);

export const FORBIDDEN_VALUE_RE =
  /<\s*SituationPublication\b|Authorization\s*:|Basic\s+[A-Za-z0-9+/=]{12,}|IU_NDIC_PULL_PASS\s*=|IU_NDIC_TMC_PULL_PASS\s*=|-----BEGIN|locationCode\s*[:=]|file:\/\/\/|\/home\/[^\s"]+|C:\\Users\\/i;

export const HTTP_STATUS_CLASS = Object.freeze({
  "2xx": "2xx",
  "3xx": "3xx",
  "4xx": "4xx",
  "5xx": "5xx",
  none: "none",
  unknown: "unknown",
});

/** Trust values that may project precise public geo fields. */
export const VERIFIED_LOCATION_TRUST = Object.freeze(["tmc", "coordinates"]);
