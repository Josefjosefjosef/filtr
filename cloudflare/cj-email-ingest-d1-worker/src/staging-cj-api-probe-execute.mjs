/**
 * Staging-only CJ Link Search probe (coupon page 1). Uses Worker runtime PAT — never logged.
 */
import {
  resolveStagingCjArchiveGate,
  trimPat,
  validateCjPublisherIdentityFields,
} from "./staging-cj-api-archive-gate.mjs";

export const CJ_LINK_SEARCH_BASE = "https://link-search.api.cj.com/v2/link-search";
export const STAGING_CJ_PROBE_LOCK_KEY = "link_search_coupon_v1";

const PAT_KEYS = ["CJ_API_PAT", "IU_CJ_PAT", "CJ_PERSONAL_ACCESS_TOKEN"];
const RFC6750_B64TOKEN_RE = /^[A-Za-z0-9\-._~+/]+=*$/;

export function readCjPatFromWorkerEnv(env = {}) {
  for (const key of PAT_KEYS) {
    const v = trimPat(env[key]);
    if (v) return v;
  }
  return "";
}

export function validatePatFormat(patTrimmed) {
  if (!patTrimmed) {
    return { ok: false, reason: "empty" };
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(patTrimmed)) {
    return { ok: false, reason: "control_char" };
  }
  if (/\s/.test(patTrimmed)) {
    return { ok: false, reason: "inner_whitespace" };
  }
  if (!RFC6750_B64TOKEN_RE.test(patTrimmed)) {
    return { ok: false, reason: "invalid_bearer_char" };
  }
  return { ok: true };
}

export function classifyCjXmlAuth(text, httpStatus) {
  const body = String(text || "");
  const lower = body.toLowerCase();
  if (httpStatus === 401 || /not authenticated/i.test(body)) {
    return { authenticated: false, reason: "not_authenticated", httpStatus };
  }
  if (httpStatus === 403 || /not authorized/i.test(body)) {
    return { authenticated: false, reason: "not_authorized", httpStatus };
  }
  if (httpStatus >= 400) {
    return { authenticated: false, reason: "http_error", httpStatus };
  }
  if (/<links[\s>]/i.test(body) || /<link>/i.test(body) || /<cj-api/i.test(body)) {
    return { authenticated: true, reason: "xml_ok", httpStatus };
  }
  if (lower.includes("incorrect resource url")) {
    return { authenticated: false, reason: "bad_resource_url", httpStatus };
  }
  return {
    authenticated: httpStatus >= 200 && httpStatus < 300,
    reason: "unknown_shape",
    httpStatus,
  };
}

export function countCouponLinkBlocks(xml) {
  const re = /<link>([\s\S]*?)<\/link>/gi;
  let count = 0;
  while (re.exec(String(xml || "")) !== null) count += 1;
  return count;
}

export function mapProbeConnectionState({
  httpStatus,
  auth,
  recordCount,
  networkError,
  redirectStatus,
  patFormatInvalid,
}) {
  if (patFormatInvalid) return "RESPONSE_FORMAT_FAILED";
  if (networkError) return "NETWORK_FAILED";
  if (redirectStatus) return "RESPONSE_FORMAT_FAILED";
  if (httpStatus === 401) return "AUTHENTICATION_FAILED";
  if (httpStatus === 403) return "AUTHORIZATION_FAILED";
  if (!auth?.authenticated) {
    if (auth?.reason === "unknown_shape") return "RESPONSE_FORMAT_FAILED";
    return "RESPONSE_FORMAT_FAILED";
  }
  if (recordCount === 0 && httpStatus >= 200 && httpStatus < 300) {
    return "EMPTY_RESULT_VERIFIED";
  }
  if (httpStatus >= 200 && httpStatus < 300 && recordCount > 0) {
    return "API_CONNECTED";
  }
  return "RESPONSE_FORMAT_FAILED";
}

export async function acquireStagingCjProbeLock(db, lockKey = STAGING_CJ_PROBE_LOCK_KEY) {
  const existing = await db
    .prepare("SELECT lock_key, finished_at FROM staging_cj_api_probe_lock WHERE lock_key = ? LIMIT 1")
    .bind(lockKey)
    .first();
  if (existing?.lock_key) {
    return { ok: false, reason: "probe_already_executed", status: 409 };
  }
  try {
    await db
      .prepare(
        "INSERT INTO staging_cj_api_probe_lock (lock_key, started_at, connection_state, publishable) VALUES (?, ?, ?, 0)"
      )
      .bind(lockKey, new Date().toISOString(), "pending")
      .run();
    return { ok: true };
  } catch {
    return { ok: false, reason: "probe_lock_conflict", status: 409 };
  }
}

export async function finalizeStagingCjProbeLock(db, lockKey, fields) {
  await db
    .prepare(
      "UPDATE staging_cj_api_probe_lock SET finished_at = ?, http_status = ?, record_count = ?, connection_state = ? WHERE lock_key = ?"
    )
    .bind(
      new Date().toISOString(),
      fields.httpStatus ?? null,
      fields.recordCount ?? null,
      fields.connectionState || "unknown",
      lockKey
    )
    .run();
}

export function buildSafeProbeResponse(fields) {
  const connectionState = fields.connectionState || "RESPONSE_FORMAT_FAILED";
  const ok =
    connectionState === "API_CONNECTED" || connectionState === "EMPTY_RESULT_VERIFIED";
  return {
    ok,
    phase: "cj_api_probe",
    publishable: false,
    blocked: false,
    connectionState,
    httpStatus: fields.httpStatus ?? null,
    couponRecordCount: fields.recordCount ?? null,
    responseParsing: fields.responseParsing || "FAIL",
    authOk: fields.authOk === true,
    failureReason: fields.failureReason || null,
    httpRequestCount: fields.httpRequestCount ?? 0,
    identityOk: fields.identityOk === true,
  };
}

/**
 * @param {object} env Worker env (includes CJ_API_PAT secret binding)
 * @param {{ fetch?: typeof fetch }} deps inject mock fetch in tests
 */
export async function executeStagingCjLinkSearchProbe(env, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const gate = resolveStagingCjArchiveGate(env);
  if (!gate.mayExecuteHttp) {
    return {
      blocked: true,
      reason: gate.blockReason,
      publishable: false,
      httpRequestCount: 0,
    };
  }

  const publisherCid = String(env.IU_CJ_PUBLISHER_CID || "").trim();
  const websitePid = String(env.IU_CJ_WEBSITE_PID || "").trim();
  const identity = validateCjPublisherIdentityFields(publisherCid, websitePid);
  if (!identity.ok) {
    return {
      blocked: true,
      reason: "publisher_identity_invalid",
      publishable: false,
      httpRequestCount: 0,
    };
  }

  if (!env.DB) {
    return { blocked: true, reason: "d1_binding_missing", publishable: false, httpRequestCount: 0 };
  }

  const lock = await acquireStagingCjProbeLock(env.DB);
  if (!lock.ok) {
    return {
      blocked: true,
      reason: lock.reason,
      publishable: false,
      httpRequestCount: 0,
      status: lock.status || 409,
    };
  }

  const pat = readCjPatFromWorkerEnv(env);
  const patFmt = validatePatFormat(pat);
  if (!patFmt.ok) {
    await finalizeStagingCjProbeLock(env.DB, STAGING_CJ_PROBE_LOCK_KEY, {
      httpStatus: 0,
      recordCount: 0,
      connectionState: "RESPONSE_FORMAT_FAILED",
    });
    return buildSafeProbeResponse({
      connectionState: "RESPONSE_FORMAT_FAILED",
      httpStatus: 0,
      recordCount: 0,
      responseParsing: "FAIL",
      authOk: false,
      failureReason: "pat_format_invalid",
      httpRequestCount: 0,
      identityOk: true,
    });
  }

  const maxReq = Math.min(5, Math.max(1, Number(env.IU_CJ_CJ_API_MAX_REQUESTS_PER_PROBE || 1)));
  if (maxReq !== 1) {
    await finalizeStagingCjProbeLock(env.DB, STAGING_CJ_PROBE_LOCK_KEY, {
      httpStatus: 0,
      recordCount: 0,
      connectionState: "RESPONSE_FORMAT_FAILED",
    });
    return {
      blocked: true,
      reason: "probe_max_requests_must_be_1",
      publishable: false,
      httpRequestCount: 0,
      status: 403,
    };
  }

  const qs = new URLSearchParams({
    "website-id": websitePid,
    "advertiser-ids": "joined",
    "link-type": "coupon",
    "page-number": "1",
    "records-per-page": "10",
  });
  const url = `${CJ_LINK_SEARCH_BASE}?${qs.toString()}`;
  const timeoutMs = Math.min(35000, Math.max(5000, Number(env.IU_CJ_FETCH_TIMEOUT_MS || 30000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let httpRequestCount = 0;
  try {
    httpRequestCount = 1;
    const res = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/xml,text/xml,*/*",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      await finalizeStagingCjProbeLock(env.DB, STAGING_CJ_PROBE_LOCK_KEY, {
        httpStatus: res.status,
        recordCount: 0,
        connectionState: "RESPONSE_FORMAT_FAILED",
      });
      return buildSafeProbeResponse({
        connectionState: "RESPONSE_FORMAT_FAILED",
        httpStatus: res.status,
        recordCount: 0,
        responseParsing: "FAIL",
        authOk: false,
        failureReason: "redirect_not_followed",
        httpRequestCount: 1,
        identityOk: true,
      });
    }

    const body = await res.text();
    const auth = classifyCjXmlAuth(body, res.status);
    const recordCount = countCouponLinkBlocks(body);
    const emptySuspicious = res.ok && auth.authenticated && recordCount === 0 && body.length < 40;
    const connectionState = emptySuspicious
      ? "EMPTY_RESULT_SUSPICIOUS"
      : mapProbeConnectionState({
          httpStatus: res.status,
          auth,
          recordCount,
          networkError: false,
          redirectStatus: false,
          patFormatInvalid: false,
        });

    const responseParsing =
      auth.reason === "unknown_shape" || emptySuspicious
        ? "FAIL"
        : res.status === 401 || res.status === 403
          ? "PASS"
          : "PASS";

    await finalizeStagingCjProbeLock(env.DB, STAGING_CJ_PROBE_LOCK_KEY, {
      httpStatus: res.status,
      recordCount,
      connectionState,
    });

    return buildSafeProbeResponse({
      connectionState,
      httpStatus: res.status,
      recordCount,
      responseParsing,
      authOk: auth.authenticated === true,
      failureReason:
        connectionState === "API_CONNECTED" || connectionState === "EMPTY_RESULT_VERIFIED"
          ? null
          : auth.reason || connectionState.toLowerCase(),
      httpRequestCount: 1,
      identityOk: true,
    });
  } catch (e) {
    const networkError = e?.name === "AbortError" ? "timeout" : "network_error";
    await finalizeStagingCjProbeLock(env.DB, STAGING_CJ_PROBE_LOCK_KEY, {
      httpStatus: 0,
      recordCount: 0,
      connectionState: "NETWORK_FAILED",
    });
    return buildSafeProbeResponse({
      connectionState: "NETWORK_FAILED",
      httpStatus: 0,
      recordCount: 0,
      responseParsing: "NOT_APPLICABLE",
      authOk: false,
      failureReason: networkError,
      httpRequestCount: httpRequestCount || 0,
      identityOk: true,
    });
  } finally {
    clearTimeout(timer);
  }
}
