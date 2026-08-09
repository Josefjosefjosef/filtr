/**
 * NDIC DATEX II v1 — config + kill switch.
 *
 * Server/CI env only (never frontend / localStorage / public JSON):
 *   IU_NDIC_DATEX_V1_MODE=off|shadow|active|format_inspection
 *   IU_NDIC_PULL_URL          — authenticated PULL endpoint (subscription-specific)
 *   IU_NDIC_PULL_USER         — Basic Auth user (subscription-generated)
 *   IU_NDIC_PULL_PASS         — Basic Auth password
 *   IU_NDIC_TMC_PULL_URL      — authenticated TMC v11.0 PULL URL (separate subscription)
 *   IU_NDIC_TMC_PULL_USER     — primary TMC Basic Auth user (empty → fallback IU_NDIC_PULL_USER)
 *   IU_NDIC_TMC_PULL_PASS     — primary TMC Basic Auth password (empty → fallback IU_NDIC_PULL_PASS)
 *   IU_NDIC_SYNC_INTERVAL_MIN — default 5 (DATEX traffic snapshot cadence)
 *
 * MobilityData subscriber id (ops only, never logged to client):
 *   IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID — e.g. A99101DA
 *
 * Approved TMC parameters:
 *   Alert-C country code (DATEX): 2
 *   TISA CID (location table): 11
 *   TABCD / location table number: 25
 */

import { DATEX_MAX_RESPONSE_BYTES } from "./bounded-fetch.mjs";
import { clampDatexMaxResponseBytes, DATEX_LIMIT_DEFAULT_BYTES } from "./growth-health.mjs";

export const NDIC_PUBLIC_PORTAL_URL = "https://www.dopravniinfo.cz/";
export const NDIC_REGISTRY_COMMON_PULL =
  "https://registr.dopravniinfo.cz/cs/sources/cz-ndic_d2-common-pull/";
export const NDIC_REGISTRY_TMC_V11 =
  "https://registr.dopravniinfo.cz/cs/sources/cz-ndic_tmc-location-table-v11.0/";
export const NDIC_MOBILITYDATA_PORTAL = "https://mobilitydata.rsd.cz/";
export const NDIC_SYNC_UA =
  "InfoUzel-NDIC-Sync/1.0 (+https://infouzel.cz/; contact: info@infouzel.cz)";
export const NDIC_ATTRIBUTION_SHORT = "Zdroj: NDIC";
export const NDIC_ATTRIBUTION_FULL =
  "Zdrojem digitalizovaných informací o silničním provozu je NDIC.";
export const NDIC_SOURCE_ID = "ndic";
export const NDIC_ADAPTER_OWNER = "ndic-datex-v1";
export const NDIC_ID_PREFIX = "ie-ndic-v1-";
export const PARSER_VERSION = "ndic-datex-v1.0.0";

/** Approved TMC table identity (subscription terms). */
export const TMC_COUNTRY_CODE = 2;
/** TISA Country ID (CID) for Czech location table v11.0 — distinct from Alert-C CC. */
export const TMC_CID = 11;
export const TMC_LOCATION_TABLE_NUMBER = 25;
export const TMC_TABCD = TMC_LOCATION_TABLE_NUMBER;

export const ALLOWED_PULL_HOSTS = Object.freeze(["mobilitydata.rsd.cz"]);

export const DEFAULT_LIMITS = Object.freeze({
  /**
   * HTTP body ceiling (DATEX XML / shared pull). See DATEX_MAX_RESPONSE_BYTES docs
   * in bounded-fetch.mjs (default 80 MiB; clamp 16–96 MiB via IU_NDIC_MAX_BYTES).
   * Previous shadow hard-cap was 32 MiB.
   */
  maxResponseBytes: DATEX_LIMIT_DEFAULT_BYTES || DATEX_MAX_RESPONSE_BYTES,
  maxXmlDepth: 60,
  /**
   * Raised after shadow #6 (~56 MiB SituationPublication): 500k was insufficient
   * for full DOM of national snapshot; still finite for 1 GiB VPS with streaming download.
   */
  maxElements: 1_500_000,
  maxTextFieldChars: 12000,
  maxSituations: 20000,
  maxRecordsPerSituation: 50,
  maxLocationsPerRecord: 40,
  maxTmcPoints: 500000,
  maxTmcNames: 500000,
});

export const DEFAULT_BACKOFF_MINUTES = Object.freeze([5, 10, 20, 40, 80]);
export const DEFAULT_SYNC_INTERVAL_MIN = 5;
export const DEFAULT_JITTER_SEC = 30;
export const DEFAULT_STALE_SOFT_MIN = 15;
export const DEFAULT_STALE_HARD_MIN = 45;
export const DEFAULT_ENDED_UI_HOURS = 12;
export const DEFAULT_REVISION_RETENTION_DAYS = 45;
export const DEFAULT_RAW_RETENTION_HOURS = 48;

/** Sanity guards — configurable ratios, not snapshot-hardcoded counts. */
export const DEFAULT_SANITY = Object.freeze({
  minPrevForDropGuard: 5,
  suspiciousDropRatio: 0.35,
  maxGrowthRatio: 8,
  maxQuarantineRatio: 0.6,
  maxUnlocalizedRatio: 0.85,
  emptySnapshotFail: true,
});

/** @typedef {'off'|'shadow'|'active'|'format_inspection'} NdicDatexV1Mode */

/**
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [env]
 */
export function getNdicDatexV1Config(env = process.env) {
  const e = env || {};
  let mode = String(e.IU_NDIC_DATEX_V1_MODE || "").trim().toLowerCase();
  if (!mode) {
    if (String(e.IU_NDIC_DATEX_V1_ENABLED || "").toLowerCase() === "true") mode = "active";
    else if (String(e.IU_NDIC_DATEX_V1_SHADOW || "").toLowerCase() === "true") mode = "shadow";
    else mode = "off";
  }
  if (mode !== "off" && mode !== "shadow" && mode !== "active" && mode !== "format_inspection") {
    mode = "off";
  }

  const n = (key, fallback) => {
    const v = Number(e[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  const limits = { ...DEFAULT_LIMITS };
  const clamped = clampDatexMaxResponseBytes(e.IU_NDIC_MAX_BYTES, limits.maxResponseBytes);
  limits.maxResponseBytes = clamped.value;
  limits.maxResponseBytesClamp = {
    ok: clamped.ok === true,
    errorCode: clamped.errorCode || null,
    minBytes: 16 * 1024 * 1024,
    maxBytes: 96 * 1024 * 1024,
    defaultBytes: DATEX_LIMIT_DEFAULT_BYTES,
  };
  limits.maxXmlDepth = n("IU_NDIC_MAX_DEPTH", limits.maxXmlDepth);
  limits.maxElements = n("IU_NDIC_MAX_ELEMENTS", limits.maxElements);

  const pullUrl = String(e.IU_NDIC_PULL_URL || "").trim();
  const tmcUrl = String(e.IU_NDIC_TMC_PULL_URL || "").trim();
  const pullUser = String(e.IU_NDIC_PULL_USER || "").trim();
  const pullPass = String(e.IU_NDIC_PULL_PASS || "");
  // Primary: dedicated TMC secrets. Empty string (e.g. unset GHA secret) → DATEX fallback.
  // Never compare secret values; never log lengths or prefixes.
  const tmcUserDedicated = String(e.IU_NDIC_TMC_PULL_USER || "").trim();
  const tmcPassDedicatedPresent =
    e.IU_NDIC_TMC_PULL_PASS != null && String(e.IU_NDIC_TMC_PULL_PASS) !== "";
  const tmcPassDedicated = tmcPassDedicatedPresent ? String(e.IU_NDIC_TMC_PULL_PASS) : "";
  const tmcUsesDedicatedUser = tmcUserDedicated.length > 0;
  const tmcUsesDedicatedPass = tmcPassDedicatedPresent;
  const tmcUser = tmcUsesDedicatedUser ? tmcUserDedicated : pullUser;
  const tmcPass = tmcUsesDedicatedPass ? tmcPassDedicated : pullPass;
  let tmcAuthSource = "datex_fallback";
  if (tmcUsesDedicatedUser && tmcUsesDedicatedPass) tmcAuthSource = "dedicated";
  else if (tmcUsesDedicatedUser || tmcUsesDedicatedPass) tmcAuthSource = "partial_dedicated_with_fallback";

  return {
    mode,
    enabled: mode === "active",
    shadow: mode === "shadow",
    formatInspection: mode === "format_inspection",
    limits,
    backoffMinutes: DEFAULT_BACKOFF_MINUTES.slice(),
    syncIntervalMin: n("IU_NDIC_SYNC_INTERVAL_MIN", DEFAULT_SYNC_INTERVAL_MIN),
    jitterSec: n("IU_NDIC_JITTER_SEC", DEFAULT_JITTER_SEC),
    staleSoftMin: n("IU_NDIC_STALE_SOFT_MIN", DEFAULT_STALE_SOFT_MIN),
    staleHardMin: n("IU_NDIC_STALE_HARD_MIN", DEFAULT_STALE_HARD_MIN),
    endedUiHours: n("IU_NDIC_ENDED_UI_HOURS", DEFAULT_ENDED_UI_HOURS),
    revisionRetentionDays: n("IU_NDIC_REVISION_DAYS", DEFAULT_REVISION_RETENTION_DAYS),
    rawRetentionHours: n("IU_NDIC_RAW_RETENTION_HOURS", DEFAULT_RAW_RETENTION_HOURS),
    sanity: { ...DEFAULT_SANITY },
    pullUrl,
    pullUser,
    pullPass,
    tmcPullUrl: tmcUrl,
    tmcPullUser: tmcUser,
    tmcPullPass: tmcPass,
    tmcAuthSource,
    tmcAuthContract: tmcAuthSource === "dedicated" ? "DEDICATED" : "FALLBACK_ENABLED",
    tmcDatexAuthFallbackEnabled: tmcAuthSource !== "dedicated",
    hasPullCredentials: Boolean(pullUrl && pullUser && pullPass),
    hasTmcCredentials: Boolean(tmcUrl && tmcUser && tmcPass),
    userAgent: NDIC_SYNC_UA,
    attributionShort: NDIC_ATTRIBUTION_SHORT,
    attributionFull: NDIC_ATTRIBUTION_FULL,
    publicPortalUrl: NDIC_PUBLIC_PORTAL_URL,
    tmcCountryCode: TMC_COUNTRY_CODE,
    tmcLocationTableNumber: TMC_LOCATION_TABLE_NUMBER,
    parserVersion: PARSER_VERSION,
    // Never expose subscriber id to public payloads — kept only for ops validation.
    subscriberIdConfigured: Boolean(String(e.IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID || "").trim()),
  };
}

export function shouldPublishNdic(config) {
  return config && config.mode === "active";
}

export function shouldRunShadow(config) {
  return config && (config.mode === "shadow" || config.mode === "active");
}

/** Format inspection never publishes and never runs importer/resolver. */
export function shouldRunFormatInspection(config) {
  return config && config.mode === "format_inspection";
}

/**
 * SSRF guard: only allow HTTPS GET to approved MobilityData hosts.
 * @param {string} url
 */
export function assertAllowedPullUrl(url) {
  let u;
  try {
    u = new URL(String(url || ""));
  } catch {
    throw Object.assign(new Error("pull_url_invalid"), { code: "PULL_URL_INVALID" });
  }
  if (u.protocol !== "https:") {
    throw Object.assign(new Error("pull_url_not_https"), { code: "PULL_URL_NOT_HTTPS" });
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (!ALLOWED_PULL_HOSTS.includes(host)) {
    throw Object.assign(new Error("pull_url_host_denied"), { code: "PULL_URL_HOST_DENIED", host });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error("pull_url_embedded_credentials_forbidden"), {
      code: "PULL_URL_EMBEDDED_CREDS",
    });
  }
  return u.toString();
}
