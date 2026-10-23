/**
 * Prepare CJ API response archive payload for a future approved live probe.
 * Offline only: no live HTTP, no real D1/R2 writes.
 * Never stores PAT / Authorization headers.
 */
import { createHash } from "node:crypto";

export const ARCHIVE_RETENTION_DAYS_DEFAULT = 30;

const SECRET_HEADER_RE = /authorization\s*[:=]\s*["']?bearer\s+[^\s"']+/gi;

export function redactSecretsFromText(text) {
  return String(text || "")
    .replace(SECRET_HEADER_RE, "Authorization: Bearer [REDACTED]")
    .replace(/CJ_API_PAT\s*[:=]\s*\S+/gi, "CJ_API_PAT=[REDACTED]")
    .replace(/IU_CJ_PAT\s*[:=]\s*\S+/gi, "IU_CJ_PAT=[REDACTED]");
}

export function assertNoSecretsInArchivePayload(payload) {
  const blob = JSON.stringify(payload);
  if (/Bearer\s+[A-Za-z0-9._-]{8,}/i.test(blob) && !/Bearer \[REDACTED\]/i.test(blob)) {
    return { ok: false, reason: "authorization_bearer_present" };
  }
  if (/CJ_API_PAT\s*[:=]\s*(?!\[REDACTED\])\S+/i.test(blob)) {
    return { ok: false, reason: "pat_env_present" };
  }
  return { ok: true };
}

/**
 * Build archive object from a CJ response body (XML) + safe metadata.
 * Does not write anywhere.
 */
export function prepareCjResponseArchive(input = {}) {
  const httpStatus = Number(input.httpStatus || 0);
  const bodyRaw = String(input.body || "");
  const body = redactSecretsFromText(bodyRaw);
  const observedAt = input.observedAt || new Date().toISOString();
  const auditId = String(input.auditId || "cj-archive-" + observedAt.replace(/[:.]/g, "-"));
  const bodySha256 = createHash("sha256").update(body, "utf8").digest("hex");
  const retentionDays = Number(input.retentionDays || ARCHIVE_RETENTION_DAYS_DEFAULT);

  if (input.networkError || input.timeout) {
    return {
      ok: false,
      stored: false,
      reason: input.timeout ? "timeout" : "network_error",
      publishable: false,
      publicAccess: false,
      CJ_LIVE_HTTP_CALLS: 0,
    };
  }

  if (!(httpStatus >= 200 && httpStatus < 300)) {
    return {
      ok: false,
      stored: false,
      reason: "http_status_not_archivable_as_success",
      httpStatus,
      publishable: false,
      publicAccess: false,
      CJ_LIVE_HTTP_CALLS: 0,
    };
  }

  if (!body.trim()) {
    return {
      ok: false,
      stored: false,
      reason: "empty_body",
      publishable: false,
      publicAccess: false,
      CJ_LIVE_HTTP_CALLS: 0,
    };
  }

  const payload = {
    schemaVersion: 1,
    auditId,
    observedAt,
    environment: "staging",
    source: "cj_link_search",
    httpStatus,
    contentType: input.contentType || "application/xml",
    bodySha256,
    bodyBytes: Buffer.byteLength(body, "utf8"),
    parseStatus: input.parseStatus || "not_parsed",
    recordCount: input.recordCount != null ? Number(input.recordCount) : null,
    probeLockKey: input.probeLockKey || null,
    retention: {
      days: retentionDays,
      deleteAfter: new Date(Date.parse(observedAt) + retentionDays * 86400000).toISOString(),
    },
    storage: {
      target: "staging_private_r2_or_d1",
      publicAccess: false,
      writeExecuted: false,
    },
    // Body allowed in private staging archive only; never log to GHA.
    bodyXmlRedacted: body,
    headersArchived: Object.freeze({
      note: "request Authorization never archived",
      responseContentType: input.contentType || "application/xml",
    }),
    publishable: false,
  };

  const secretCheck = assertNoSecretsInArchivePayload({
    ...payload,
    bodyXmlRedacted: payload.bodyXmlRedacted.slice(0, 200),
  });
  if (!secretCheck.ok) {
    return {
      ok: false,
      stored: false,
      reason: secretCheck.reason,
      failClosed: true,
      publishable: false,
      publicAccess: false,
      CJ_LIVE_HTTP_CALLS: 0,
    };
  }

  return {
    ok: true,
    stored: false,
    reason: "prepared_offline_no_write",
    payload,
    publishable: false,
    publicAccess: false,
    failClosedOnWriteError: true,
    CJ_LIVE_HTTP_CALLS: 0,
  };
}

/** Simulate archive write failure — fail-closed, never partial public leak. */
export function simulateArchiveWrite(prepared, options = {}) {
  if (!prepared?.ok || !prepared.payload) {
    return { ok: false, stored: false, reason: "nothing_to_write", publishable: false };
  }
  if (options.forceError) {
    return {
      ok: false,
      stored: false,
      reason: "archive_write_failed",
      failClosed: true,
      publishable: false,
      publicAccess: false,
      leakedBody: false,
    };
  }
  if (options.executeRealWrite === true) {
    return {
      ok: false,
      stored: false,
      reason: "real_d1_r2_writes_forbidden_in_this_task",
      publishable: false,
    };
  }
  return {
    ok: true,
    stored: false,
    dryRun: true,
    reason: "dry_run_success_no_persistent_write",
    auditId: prepared.payload.auditId,
    publishable: false,
    publicAccess: false,
  };
}
