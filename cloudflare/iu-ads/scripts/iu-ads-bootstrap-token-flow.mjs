/**
 * Bootstrap token workflow helpers (no secret values).
 * Used by CI workflow + unit tests. Never logs Authorization or token material.
 */
import fs from "node:fs";

/** Safe order after permanent auth secrets are present. */
export const SAFE_BOOTSTRAP_TOKEN_STEPS = Object.freeze([
  "d1_precheck",
  "generate_ephemeral_token_in_memory",
  "mask_token_in_logs",
  "deploy_worker_apis_on",
  "secret_put_ADS_BOOTSTRAP_TOKEN",
  "verify_secret_put_exit_0",
  "readiness_until_configured",
  "call_bootstrap_endpoint",
  "d1_readback",
  "activation_artifact_on_success_only",
  "secret_delete_ADS_BOOTSTRAP_TOKEN",
  "verify_endpoint_unusable",
  "health_gate",
]);

/**
 * Forbidden relative order: first name must not appear after second.
 * Pair [earlierForbiddenAfter, mustComeBeforeIt] — if A index > B index, fail.
 * Root cause: secret_put then deploy loses ADS_BOOTSTRAP_TOKEN binding (wrangler race).
 */
export const FORBIDDEN_ORDER_PAIRS = Object.freeze([
  ["secret_put_ADS_BOOTSTRAP_TOKEN", "deploy_worker_apis_on"],
  ["call_bootstrap_endpoint", "secret_put_ADS_BOOTSTRAP_TOKEN"],
  ["call_bootstrap_endpoint", "readiness_until_configured"],
  ["activation_artifact_on_success_only", "d1_readback"],
  ["health_gate", "secret_delete_ADS_BOOTSTRAP_TOKEN"],
]);

/**
 * @param {string[]} steps
 * @returns {{ ok: true } | { ok: false; reason: string; pair?: string[] }}
 */
export function assertSafeBootstrapTokenOrder(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, reason: "empty_steps" };
  }
  const index = new Map(steps.map((s, i) => [s, i]));
  for (const [mustBeBefore, mustBeAfter] of FORBIDDEN_ORDER_PAIRS) {
    // Naming: pair means mustBeBefore must occur before mustBeAfter is wrong...
    // FORBIDDEN means: if both present, mustBeBefore's index must be < mustBeAfter's index
    // Wait — pair ["secret_put", "deploy"] means secret_put must NOT come after deploy is wrong.
    // We want: deploy BEFORE secret_put. Forbidden is secret_put index > deploy? No —
    // Forbidden: secret_put appears BEFORE deploy is actually what we had (broken).
    // Broken order: put then deploy. So put index < deploy index is FORBIDDEN.
    // Pair [put, deploy] with rule: if index(put) < index(deploy) → fail? That's the broken order.
    // Actually broken: put then deploy. Safe: deploy then put.
    // So forbidden when: index(put) < index(deploy).
    if (index.has(mustBeBefore) && index.has(mustBeAfter)) {
      if (index.get(mustBeBefore) < index.get(mustBeAfter)) {
        return { ok: false, reason: "forbidden_order", pair: [mustBeBefore, mustBeAfter] };
      }
    }
  }
  return { ok: true };
}

/**
 * Classify readiness probe (wrong bearer, never the real token).
 * @param {number} http
 * @param {unknown} body
 */
export function classifyBootstrapReadiness(http, body) {
  const err =
    body && typeof body === "object" && body !== null && "error" in body
      ? String(/** @type {{ error?: unknown }} */ (body).error || "")
      : "";
  if (http === 503 && err === "bootstrap_token_not_configured") {
    return { state: "NOT_READY", reason: "bootstrap_token_not_configured" };
  }
  if (http === 401 && (err === "unauthorized" || err === "")) {
    return { state: "READY", reason: "token_configured_auth_rejected_probe" };
  }
  if (http === 409 || http === 400 || http === 405) {
    return { state: "READY", reason: "token_configured_non_auth_status_" + http };
  }
  if (http === 503 && err === "auth_not_configured") {
    return { state: "NOT_READY", reason: "auth_not_configured" };
  }
  if (http === 200 || http === 201) {
    return { state: "UNSAFE", reason: "probe_must_not_succeed" };
  }
  return { state: "UNKNOWN", reason: "http_" + http + "_error_" + (err || "none") };
}

/**
 * @param {number} http
 * @param {unknown} body
 */
export function classifyBootstrapCallResult(http, body) {
  const err =
    body && typeof body === "object" && body !== null && "error" in body
      ? String(/** @type {{ error?: unknown }} */ (body).error || "")
      : "";
  const ok =
    body && typeof body === "object" && body !== null && "ok" in body
      ? /** @type {{ ok?: unknown }} */ (body).ok === true
      : false;
  if (http === 503 && err === "bootstrap_token_not_configured") {
    return { ok: false, code: "TOKEN_NOT_CONFIGURED", failClosed: true };
  }
  if (http === 401) {
    return { ok: false, code: "WRONG_OR_MISSING_TOKEN", failClosed: true };
  }
  if (http === 503) {
    return { ok: false, code: "BOOTSTRAP_HTTP_503", failClosed: true, error: err || "unknown" };
  }
  if (http !== 200 && http !== 201) {
    return { ok: false, code: "UNEXPECTED_HTTP", failClosed: true, http, error: err || "unknown" };
  }
  if (!ok) {
    return { ok: false, code: "INVALID_RESPONSE", failClosed: true };
  }
  const activationUrl =
    body && typeof body === "object" && body !== null && "activationUrl" in body
      ? /** @type {{ activationUrl?: unknown }} */ (body).activationUrl
      : null;
  if (typeof activationUrl !== "string" || activationUrl.indexOf("activate=") < 0) {
    return { ok: false, code: "INVALID_RESPONSE_MISSING_ACTIVATION", failClosed: true };
  }
  return { ok: true, code: "BOOTSTRAP_OK" };
}

/**
 * @param {unknown} listJson
 * @param {string} name
 */
export function secretListHasName(listJson, name) {
  if (!Array.isArray(listJson)) return false;
  return listJson.some((row) => row && typeof row === "object" && /** @type {{ name?: unknown }} */ (row).name === name);
}

/**
 * @param {unknown} listJson
 */
export function bootstrapTokenConfiguredByName(listJson) {
  return secretListHasName(listJson, "ADS_BOOTSTRAP_TOKEN");
}

/**
 * @param {number} putExitCode
 */
export function classifySecretPutExit(putExitCode) {
  if (putExitCode === 0) return { ok: true, status: "BOOTSTRAP_SECRET_PUT=SUCCESS" };
  return { ok: false, status: "BOOTSTRAP_SECRET_PUT=FAIL", failClosed: true };
}

/**
 * @param {{ bootstrapOutcome: string; cleanupOutcome: string; originalError?: string }} input
 */
export function classifyCleanupAfterFailure(input) {
  const bootstrapFailed = input.bootstrapOutcome !== "success";
  const cleanupOk = input.cleanupOutcome === "success";
  if (!bootstrapFailed) {
    return {
      jobFailed: input.cleanupOutcome !== "success",
      preserveOriginalError: true,
      primary: cleanupOk ? "success" : "cleanup_failed",
    };
  }
  return {
    jobFailed: true,
    preserveOriginalError: true,
    primary: input.originalError || "bootstrap_failed",
    cleanup: cleanupOk ? "BOOTSTRAP_SECRET_DELETE=SUCCESS" : "BOOTSTRAP_SECRET_DELETE=FAIL",
  };
}

/**
 * @param {string} artifactText
 * @param {string} token
 */
export function artifactContainsToken(artifactText, token) {
  if (!token || token.length < 8) return false;
  return String(artifactText || "").includes(token);
}

/**
 * @param {string} logText
 * @param {string} token
 */
export function logContainsRawToken(logText, token) {
  if (!token || token.length < 8) return false;
  return String(logText || "").includes(token);
}

/**
 * @param {number} http
 * @param {unknown} body
 */
export function classifyPostDeleteProbe(http, body) {
  const err =
    body && typeof body === "object" && body !== null && "error" in body
      ? String(/** @type {{ error?: unknown }} */ (body).error || "")
      : "";
  if (http === 503 && err === "bootstrap_token_not_configured") {
    return { ok: true, status: "BOOTSTRAP_TOKEN_GONE=CONFIRMED" };
  }
  if (http === 401) {
    return { ok: false, status: "BOOTSTRAP_TOKEN_STILL_PRESENT", failClosed: true };
  }
  return { ok: false, status: "POST_DELETE_PROBE_UNEXPECTED", failClosed: true, http, error: err };
}

/**
 * @param {{ workerName: string; accountId: string; urlHost: string }} actual
 * @param {{ workerName: string; accountId: string; urlHost: string }} expected
 */
export function assertDeployTarget(actual, expected) {
  if (actual.workerName !== expected.workerName) {
    return { ok: false, reason: "wrong_worker", actual: actual.workerName };
  }
  if (actual.accountId !== expected.accountId) {
    return { ok: false, reason: "wrong_account" };
  }
  if (actual.urlHost !== expected.urlHost) {
    return { ok: false, reason: "wrong_url_host", actual: actual.urlHost };
  }
  return { ok: true };
}

export const EXPECTED_ADS_TARGET = Object.freeze({
  workerName: "infouzel-ads",
  accountId: "577868e9aac9c289e9323100f68fad16",
  urlHost: "ads.infouzel.cz",
  secretName: "ADS_BOOTSTRAP_TOKEN",
  apiTokenEnv: "CLOUDFLARE_ADS_API_TOKEN",
});

function isDirectCliRun() {
  const entry = process.argv[1] || "";
  return entry.replace(/\\/g, "/").endsWith("/iu-ads-bootstrap-token-flow.mjs");
}

if (isDirectCliRun()) {
  const cmd = process.argv[2] || "";
  if (cmd === "classify-readiness") {
    const http = Number(process.argv[3] || 0);
    const bodyPath = process.argv[4];
    let body = {};
    if (bodyPath) {
      try {
        body = JSON.parse(fs.readFileSync(bodyPath, "utf8"));
      } catch {
        body = {};
      }
    }
    const r = classifyBootstrapReadiness(http, body);
    console.log("BOOTSTRAP_READINESS=" + r.state);
    console.log("BOOTSTRAP_READINESS_REASON=" + r.reason);
    process.exit(r.state === "READY" ? 0 : r.state === "NOT_READY" ? 2 : 3);
  } else if (cmd === "classify-post-delete") {
    const http = Number(process.argv[3] || 0);
    const bodyPath = process.argv[4];
    let body = {};
    try {
      body = JSON.parse(fs.readFileSync(bodyPath, "utf8"));
    } catch {
      body = {};
    }
    const r = classifyPostDeleteProbe(http, body);
    console.log(r.status);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "secret-list-has") {
    const listPath = process.argv[3];
    const name = process.argv[4] || "ADS_BOOTSTRAP_TOKEN";
    let list;
    try {
      list = JSON.parse(fs.readFileSync(listPath, "utf8"));
    } catch {
      console.log("BOOTSTRAP_SECRET_LIST=UNPARSEABLE");
      process.exit(1);
    }
    const hit = secretListHasName(list, name);
    console.log(hit ? "BOOTSTRAP_SECRET_NAME_PRESENT=1" : "BOOTSTRAP_SECRET_NAME_PRESENT=0");
    process.exit(hit ? 0 : 1);
  } else {
    console.log("USAGE=classify-readiness|classify-post-delete|secret-list-has");
    process.exit(2);
  }
}
