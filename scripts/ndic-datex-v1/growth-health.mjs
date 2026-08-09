/**
 * DATEX growth limits, retry policy, and health state (server/CI only).
 * Never accepts unbounded or user-controlled public input for max bytes.
 */
import {
  DATEX_MAX_RESPONSE_BYTES,
  DATEX_PREV_RESPONSE_BYTES,
} from "./bounded-fetch.mjs";

/** Absolute floor / ceiling for server env override (bytes). */
export const DATEX_LIMIT_MIN_BYTES = 16 * 1024 * 1024;
export const DATEX_LIMIT_MAX_BYTES = 96 * 1024 * 1024;
export const DATEX_LIMIT_DEFAULT_BYTES = DATEX_MAX_RESPONSE_BYTES;

export const DATEX_WARN_THRESHOLDS = Object.freeze([0.7, 0.8, 0.9]);

export const RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  jitterRatio: 0.2,
  /** Only transient network classes may retry */
  retryableCodes: Object.freeze([
    "NETWORK_ERROR",
    "TIMEOUT",
    "DNS_ERROR",
    "CONNECTION_RESET",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
  ]),
  nonRetryableCodes: Object.freeze([
    "RESPONSE_TOO_LARGE",
    "AUTH_REJECTED",
    "HTTP_401",
    "HTTP_403",
    "XML_UNSAFE",
    "XML_ENTITY",
    "XML_ELEMENTS",
    "XML_DEPTH",
    "XML_PARSE",
    "PARSER_INCOMPATIBLE",
    "TMC_ZIP_BOMB",
    "TMC_ZIP_RATIO",
    "TMC_ZIP_ENTRY_TOO_LARGE",
    "TMC_ZIP_BAD_PATH",
    "SSRF_BLOCKED",
    "REDIRECT_BLOCKED",
  ]),
});

/**
 * Clamp server-configured max response bytes. Rejects non-finite / unlimited.
 * @param {unknown} raw
 * @param {number} [fallback]
 */
export function clampDatexMaxResponseBytes(raw, fallback = DATEX_LIMIT_DEFAULT_BYTES) {
  if (raw == null || raw === "") {
    return { ok: true, value: fallback, warning: null };
  }
  if (typeof raw === "string" && /^(inf|infinity|unlimited|max|none)$/i.test(raw.trim())) {
    return { ok: false, value: fallback, errorCode: "LIMIT_UNBOUNDED_REJECTED" };
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, value: fallback, errorCode: "LIMIT_NON_NUMERIC_REJECTED" };
  }
  if (n < DATEX_LIMIT_MIN_BYTES) {
    return { ok: false, value: DATEX_LIMIT_MIN_BYTES, errorCode: "LIMIT_BELOW_MIN", requested: Math.floor(n) };
  }
  if (n > DATEX_LIMIT_MAX_BYTES) {
    return { ok: false, value: DATEX_LIMIT_MAX_BYTES, errorCode: "LIMIT_ABOVE_MAX", requested: Math.floor(n) };
  }
  return { ok: true, value: Math.floor(n), warning: null };
}

/**
 * @param {number} received
 * @param {number} maxBytes
 */
export function limitUtilization(received, maxBytes) {
  const max = Number(maxBytes) > 0 ? Number(maxBytes) : DATEX_LIMIT_DEFAULT_BYTES;
  const rec = Math.max(0, Number(received) || 0);
  const ratio = max > 0 ? rec / max : 1;
  const pct = Math.min(100, Math.round(ratio * 1000) / 10);
  /** @type {number[]} */
  const warnings = [];
  for (const t of DATEX_WARN_THRESHOLDS) {
    if (ratio >= t && ratio < 1) warnings.push(Math.round(t * 100));
  }
  return {
    receivedBytes: rec,
    maxBytes: max,
    utilizationPercent: pct,
    warningThresholdsHit: warnings,
    atLimit: ratio >= 1,
    previousHardCapBytes: DATEX_PREV_RESPONSE_BYTES,
  };
}

/**
 * @param {{ code?: string }} err
 */
export function isRetryableShadowError(err) {
  const code = String((err && err.code) || "");
  if (!code) return false;
  if (RETRY_POLICY.nonRetryableCodes.includes(code)) return false;
  if (RETRY_POLICY.retryableCodes.includes(code)) return true;
  if (/^HTTP_5\d\d$/.test(code)) return true;
  return false;
}

/**
 * Exponential backoff with jitter (deterministic optional seed for tests).
 * @param {number} attemptZeroBased
 * @param {{ random?: () => number }} [opts]
 */
export function retryDelayMs(attemptZeroBased, opts = {}) {
  const rnd = typeof opts.random === "function" ? opts.random : Math.random;
  const exp = Math.min(
    RETRY_POLICY.maxDelayMs,
    RETRY_POLICY.baseDelayMs * Math.pow(2, Math.max(0, attemptZeroBased))
  );
  const jitter = exp * RETRY_POLICY.jitterRatio * rnd();
  return Math.min(RETRY_POLICY.maxDelayMs, Math.floor(exp + jitter));
}

/**
 * @typedef {'healthy'|'degraded'|'stale'|'blocked'} NdicHealth
 */

/**
 * @param {{
 *   consecutiveFailures?: number,
 *   lastSuccessfulFetchAt?: string|null,
 *   lastSuccessfulParseAt?: string|null,
 *   lastGoodDataAgeMs?: number|null,
 *   staleSoftMs?: number,
 *   staleHardMs?: number,
 *   blocked?: boolean,
 * }} s
 */
export function computeHealthState(s) {
  if (s.blocked) return "blocked";
  const fails = Number(s.consecutiveFailures) || 0;
  if (fails >= 5) return "blocked";
  if (fails >= 2) return "degraded";
  const age = s.lastGoodDataAgeMs;
  if (age != null && Number.isFinite(age)) {
    if (age > (s.staleHardMs || 45 * 60 * 1000)) return "stale";
    if (age > (s.staleSoftMs || 15 * 60 * 1000)) return "degraded";
  }
  if (!s.lastSuccessfulFetchAt || !s.lastSuccessfulParseAt) return "degraded";
  return "healthy";
}

/**
 * Mutable shadow/ops counters — never overwrite last-good payload here.
 */
export function createLifecycleTracker(initial = {}) {
  return {
    consecutiveFailures: Number(initial.consecutiveFailures) || 0,
    lastSuccessfulFetchAt: initial.lastSuccessfulFetchAt || null,
    lastSuccessfulParseAt: initial.lastSuccessfulParseAt || null,
    lastGoodDataAgeMs: initial.lastGoodDataAgeMs != null ? initial.lastGoodDataAgeMs : null,
    health: computeHealthState(initial),
  };
}

export function noteFetchSuccess(tracker, iso = new Date().toISOString()) {
  tracker.lastSuccessfulFetchAt = iso;
  tracker.health = computeHealthState(tracker);
  return tracker;
}

export function noteParseSuccess(tracker, iso = new Date().toISOString()) {
  tracker.consecutiveFailures = 0;
  tracker.lastSuccessfulParseAt = iso;
  tracker.lastGoodDataAgeMs = 0;
  tracker.health = computeHealthState(tracker);
  return tracker;
}

export function noteFailure(tracker) {
  tracker.consecutiveFailures = (Number(tracker.consecutiveFailures) || 0) + 1;
  tracker.health = computeHealthState(tracker);
  return tracker;
}
