/**
 * Proof harness — explicit error classification policy.
 * Single source of truth: what is app_error (never ignore), what is local-only noise.
 *
 * WHY THIS EXISTS
 * Local proof runs against a static server; 503s and missing feeds are harness noise, not app bugs.
 * Production proof must never use local noise policy — consoleErrorsCount=0 must be real.
 *
 * WHAT IS COVERED (local-only noise, only when isProduction=false)
 * - LOCAL_STATIC_SERVER_503: local server returns 503
 * - LOCAL_ARTICLE_FEED_UNAVAILABLE: articles/feed request fails on local
 * - LOCAL_NAMEDAYS_UNAVAILABLE: namedays/feed request fails on local
 * - NON_APP_LOCALHOST_REQUEST: request to localhost that is not app.js/feature runtime
 * - ALLOWED_LOCAL_PROOF_NOISE: explicit allowlist pattern (e.g. favicon, known local gaps)
 *
 * WHAT IS NEVER IGNORED (always app_error → FAIL)
 * - app.js runtime errors, uncaught exceptions, rejected promises from app flow
 * - DOM/render errors from feature code
 * - Any error on production origin (https://infouzel.cz)
 * - Errors related to nakup tool flow
 *
 * DO NOT use this policy to mask real app errors. Production proof must remain strict.
 */

export const ERROR_CLASSIFICATION = Object.freeze({
  APP_ERROR: "app_error",
  APP_WARNING: "app_warning",
  LOCAL_HARNESS_NOISE: "local_harness_noise",
  NETWORK_NOISE_LOCAL_ONLY: "network_noise_local_only",
  IGNORED_BY_POLICY: "ignored_by_policy",
});

export const ALLOWED_LOCAL_NOISE_REASONS = Object.freeze({
  LOCAL_STATIC_SERVER_503: "LOCAL_STATIC_SERVER_503",
  LOCAL_ARTICLE_FEED_UNAVAILABLE: "LOCAL_ARTICLE_FEED_UNAVAILABLE",
  LOCAL_NAMEDAYS_UNAVAILABLE: "LOCAL_NAMEDAYS_UNAVAILABLE",
  NON_APP_LOCALHOST_REQUEST: "NON_APP_LOCALHOST_REQUEST",
  ALLOWED_LOCAL_PROOF_NOISE: "ALLOWED_LOCAL_PROOF_NOISE",
});

const PROD_ORIGIN = "https://infouzel.cz";
const APP_JS_PATTERN = /assets\/app\.js|app\.js\b/i;
const NAKUP_PATTERN = /iuNakup|nakup|iu-mmQuickLinks.*nakup/i;
const LOCAL_FEED_PATTERNS = [
  /\/articles\.json|\/data\/articles\/|\/feed/i,
  /namedays|svátky|brief\.json/i,
];
const LOCALHOST_ORIGIN = /^https?:\/\/127\.0\.0\.1|^https?:\/\/localhost/i;

/**
 * Classify a console message. Returns { classification, reason }.
 * On production: only ALLOWED_LOCAL_PROOF_NOISE (e.g. favicon) may be ignored; everything else is app_error or app_warning.
 * @param {string} text - msg.text() from Playwright console event
 * @param {string} type - msg.type() from Playwright console event
 */
export function classifyConsoleError(text, type, context = {}) {
  const isProduction = context.isProduction === true;
  const t = String(text ?? "");
  const lvl = (type ?? "error").toLowerCase();

  if (lvl !== "error" && lvl !== "warning") {
    return { classification: ERROR_CLASSIFICATION.IGNORED_BY_POLICY, reason: "non-error-level" };
  }

  if (isProduction) {
    if (/favicon|\.ico/i.test(t)) {
      return { classification: ERROR_CLASSIFICATION.IGNORED_BY_POLICY, reason: ALLOWED_LOCAL_NOISE_REASONS.ALLOWED_LOCAL_PROOF_NOISE };
    }
    return { classification: lvl === "error" ? ERROR_CLASSIFICATION.APP_ERROR : ERROR_CLASSIFICATION.APP_WARNING, reason: "production" };
  }

  if (/favicon|\.ico/i.test(t)) {
    return { classification: ERROR_CLASSIFICATION.LOCAL_HARNESS_NOISE, reason: ALLOWED_LOCAL_NOISE_REASONS.ALLOWED_LOCAL_PROOF_NOISE };
  }
  if (/503|Service Unavailable|ECONNREFUSED|ETIMEDOUT/i.test(t) && /127\.0\.0\.1|localhost/i.test(t)) {
    return { classification: ERROR_CLASSIFICATION.NETWORK_NOISE_LOCAL_ONLY, reason: ALLOWED_LOCAL_NOISE_REASONS.LOCAL_STATIC_SERVER_503 };
  }
  if (APP_JS_PATTERN.test(t) || NAKUP_PATTERN.test(t)) {
    return { classification: ERROR_CLASSIFICATION.APP_ERROR, reason: "app_runtime" };
  }
  if (/ReferenceError|TypeError|SyntaxError|uncaught|Uncaught/i.test(t)) {
    return { classification: ERROR_CLASSIFICATION.APP_ERROR, reason: "uncaught" };
  }
  const isFeedRequest = LOCAL_FEED_PATTERNS.some((p) => p.test(t));
  if (isFeedRequest && /fetch|load|failed|404|503/i.test(t)) {
    return { classification: ERROR_CLASSIFICATION.NETWORK_NOISE_LOCAL_ONLY, reason: ALLOWED_LOCAL_NOISE_REASONS.LOCAL_ARTICLE_FEED_UNAVAILABLE };
  }
  if (/namedays|svátky|brief/i.test(t) && /fetch|failed|404|503/i.test(t)) {
    return { classification: ERROR_CLASSIFICATION.NETWORK_NOISE_LOCAL_ONLY, reason: ALLOWED_LOCAL_NOISE_REASONS.LOCAL_NAMEDAYS_UNAVAILABLE };
  }

  return { classification: lvl === "error" ? ERROR_CLASSIFICATION.APP_ERROR : ERROR_CLASSIFICATION.APP_WARNING, reason: "unclassified" };
}

/**
 * Classify a pageerror (uncaught exception in page). Never ignore on production.
 */
export function classifyPageError(message, context = {}) {
  const isProduction = context.isProduction === true;
  const text = String(message);

  if (isProduction) {
    return { classification: ERROR_CLASSIFICATION.APP_ERROR, reason: "production" };
  }
  if (/favicon|\.ico/i.test(text)) {
    return { classification: ERROR_CLASSIFICATION.LOCAL_HARNESS_NOISE, reason: ALLOWED_LOCAL_NOISE_REASONS.ALLOWED_LOCAL_PROOF_NOISE };
  }
  if (/Failed to load resource|net::ERR_|503|404/.test(text) && /127\.0\.0\.1|localhost/i.test(text)) {
    return { classification: ERROR_CLASSIFICATION.NETWORK_NOISE_LOCAL_ONLY, reason: ALLOWED_LOCAL_NOISE_REASONS.LOCAL_STATIC_SERVER_503 };
  }
  return { classification: ERROR_CLASSIFICATION.APP_ERROR, reason: "pageerror" };
}

/**
 * Classify a request failure (e.g. response 503). Only local + non-app requests may be noise.
 */
export function classifyRequestFailure(url, statusCode, context = {}) {
  const isProduction = context.isProduction === true;
  const u = String(url || "");

  if (isProduction) {
    return { classification: ERROR_CLASSIFICATION.APP_ERROR, reason: "production" };
  }
  if (!LOCALHOST_ORIGIN.test(u)) {
    return { classification: ERROR_CLASSIFICATION.APP_ERROR, reason: "non_local" };
  }
  if (APP_JS_PATTERN.test(u) || /app\.css/i.test(u)) {
    return { classification: ERROR_CLASSIFICATION.APP_ERROR, reason: "app_asset" };
  }
  if ((statusCode === 503 || statusCode === 502) && LOCAL_FEED_PATTERNS.some((p) => p.test(u))) {
    return { classification: ERROR_CLASSIFICATION.NETWORK_NOISE_LOCAL_ONLY, reason: ALLOWED_LOCAL_NOISE_REASONS.LOCAL_ARTICLE_FEED_UNAVAILABLE };
  }
  if ((statusCode === 503 || statusCode === 502) && /namedays|brief/i.test(u)) {
    return { classification: ERROR_CLASSIFICATION.NETWORK_NOISE_LOCAL_ONLY, reason: ALLOWED_LOCAL_NOISE_REASONS.LOCAL_NAMEDAYS_UNAVAILABLE };
  }
  if (statusCode === 503 || statusCode === 502) {
    return { classification: ERROR_CLASSIFICATION.NETWORK_NOISE_LOCAL_ONLY, reason: ALLOWED_LOCAL_NOISE_REASONS.LOCAL_STATIC_SERVER_503 };
  }
  if (statusCode === 404 && /favicon|\.ico/i.test(u)) {
    return { classification: ERROR_CLASSIFICATION.LOCAL_HARNESS_NOISE, reason: ALLOWED_LOCAL_NOISE_REASONS.ALLOWED_LOCAL_PROOF_NOISE };
  }
  return { classification: ERROR_CLASSIFICATION.APP_ERROR, reason: "request_failure" };
}

/**
 * Returns true if this classification must never be ignored (always FAIL).
 */
export function isNeverIgnore(classification) {
  return classification === ERROR_CLASSIFICATION.APP_ERROR || classification === ERROR_CLASSIFICATION.APP_WARNING;
}

/**
 * Returns true if this classification is allowed local noise (only when isProduction=false).
 */
export function isAllowedLocalNoise(classification) {
  return (
    classification === ERROR_CLASSIFICATION.LOCAL_HARNESS_NOISE ||
    classification === ERROR_CLASSIFICATION.NETWORK_NOISE_LOCAL_ONLY
  );
}
