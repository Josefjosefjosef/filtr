#!/usr/bin/env node
/**
 * HEAD-bound short-lived NDIC staging preflight attestation contract (offline-capable).
 * No NDIC network. No secrets. Used by publish/verify helpers and synthetic fixtures.
 */
export const PREFLIGHT_STATUS_CONTEXT = "ndic-staging-preflight";
export const DEFAULT_TTL_SECONDS = 7200;
export const MAX_TTL_SECONDS = 86400;
export const MIN_TTL_SECONDS = 300;
/** GitHub commit status `description` hard limit (REST statuses API). */
export const GITHUB_COMMIT_STATUS_DESCRIPTION_MAX = 140;

/**
 * Compact ISO-8601 UTC (no milliseconds) — keeps attestation descriptions under 140 chars.
 * @param {string|number|Date} value
 */
export function toCompactExpiresAtIso(value) {
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(ms) || Number.isNaN(ms)) throw new Error("INVALID_EXPIRES_AT");
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * @param {{ headSha: string, runId: string|number, expiresAtIso: string, attestationId: string }} p
 */
export function buildAttestationDescription(p) {
  const head = String(p.headSha || "").trim().toLowerCase();
  const runId = String(p.runId || "").trim();
  const exp = toCompactExpiresAtIso(String(p.expiresAtIso || "").trim());
  const aid = String(p.attestationId || "").trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("INVALID_HEAD_SHA");
  if (!/^\d+$/.test(runId)) throw new Error("INVALID_RUN_ID");
  if (!aid) throw new Error("INVALID_ATTESTATION_ID");
  const description = `pass=1|head=${head}|run=${runId}|exp=${exp}|aid=${aid}`;
  if (description.length > GITHUB_COMMIT_STATUS_DESCRIPTION_MAX) {
    throw new Error(
      `DESCRIPTION_TOO_LONG:${description.length}>${GITHUB_COMMIT_STATUS_DESCRIPTION_MAX}`
    );
  }
  return description;
}

/** @param {string} description */
export function parseAttestationDescription(description) {
  const raw = String(description || "").trim();
  const out = { pass: null, head: null, run: null, exp: null, aid: null, ok: false };
  if (!raw) return out;
  for (const part of raw.split("|")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "pass") out.pass = v;
    else if (k === "head") out.head = v.toLowerCase();
    else if (k === "run") out.run = v;
    else if (k === "exp") out.exp = v;
    else if (k === "aid") out.aid = v;
  }
  out.ok =
    out.pass === "1" &&
    /^[0-9a-f]{40}$/.test(String(out.head || "")) &&
    /^\d+$/.test(String(out.run || "")) &&
    Boolean(out.aid) &&
    Boolean(out.exp) &&
    !Number.isNaN(Date.parse(out.exp));
  return out;
}

/**
 * @param {{
 *   context: string,
 *   state: string,
 *   description: string,
 *   expectedHeadSha: string,
 *   nowMs?: number,
 * }} input
 */
export function verifyAttestationStatus(input) {
  const errors = [];
  if (String(input.context || "") !== PREFLIGHT_STATUS_CONTEXT) {
    errors.push("WRONG_CONTEXT");
  }
  if (String(input.state || "").toLowerCase() !== "success") {
    errors.push("STATE_NOT_SUCCESS");
  }
  const parsed = parseAttestationDescription(input.description);
  if (!parsed.ok) errors.push("DESCRIPTION_PARSE_FAIL");
  const expected = String(input.expectedHeadSha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expected)) errors.push("EXPECTED_HEAD_INVALID");
  if (parsed.ok && parsed.head !== expected) errors.push("HEAD_MISMATCH");
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  if (parsed.ok) {
    const expMs = Date.parse(parsed.exp);
    if (!(expMs > nowMs)) errors.push("EXPIRED");
  }
  return {
    ok: errors.length === 0,
    errors,
    parsed,
  };
}

export function computeExpiresAtIso(nowMs, ttlSeconds) {
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    throw new Error("INVALID_TTL");
  }
  return toCompactExpiresAtIso(nowMs + ttl * 1000);
}

/**
 * Short job slug so `aid=` fits GitHub's 140-char status description with full HEAD SHA.
 * @param {string|number} jobId
 */
export function shortAttestationJobSlug(jobId) {
  const raw = String(jobId || "0").trim() || "0";
  if (raw === "scheduled-preflight") return "spf";
  if (/^\d+$/.test(raw)) return raw;
  // Keep stable, compact, description-safe slug (no pipes/= which break the encoding).
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
  return slug || "0";
}

export function buildAttestationId(runId, jobId) {
  return `ndic-pf-${String(runId)}-${shortAttestationJobSlug(jobId)}`;
}

function main() {
  // Self-check when executed directly
  const head = "a".repeat(40);
  const exp = computeExpiresAtIso(Date.now(), 3600);
  const desc = buildAttestationDescription({
    headSha: head,
    runId: "123",
    expiresAtIso: exp,
    attestationId: buildAttestationId(123, 456),
  });
  const v = verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "success",
    description: desc,
    expectedHeadSha: head,
  });
  if (!v.ok) {
    console.error(JSON.stringify({ ok: false, errors: v.errors }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, self_check: "PASS" }));
}

const isDirect =
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith("ndic-staging-preflight-attestation.mjs");
if (isDirect) main();
