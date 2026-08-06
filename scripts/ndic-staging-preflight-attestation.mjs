#!/usr/bin/env node
/**
 * HEAD-bound short-lived NDIC staging preflight attestation contract (offline-capable).
 * No NDIC network. No secrets. Used by publish/verify helpers and synthetic fixtures.
 */
export const PREFLIGHT_STATUS_CONTEXT = "ndic-staging-preflight";
export const DEFAULT_TTL_SECONDS = 7200;
export const MAX_TTL_SECONDS = 86400;
export const MIN_TTL_SECONDS = 300;

/**
 * @param {{ headSha: string, runId: string|number, expiresAtIso: string, attestationId: string }} p
 */
export function buildAttestationDescription(p) {
  const head = String(p.headSha || "").trim().toLowerCase();
  const runId = String(p.runId || "").trim();
  const exp = String(p.expiresAtIso || "").trim();
  const aid = String(p.attestationId || "").trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("INVALID_HEAD_SHA");
  if (!/^\d+$/.test(runId)) throw new Error("INVALID_RUN_ID");
  if (!aid) throw new Error("INVALID_ATTESTATION_ID");
  if (!exp || Number.isNaN(Date.parse(exp))) throw new Error("INVALID_EXPIRES_AT");
  return `pass=1|head=${head}|run=${runId}|exp=${exp}|aid=${aid}`;
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
  return new Date(nowMs + ttl * 1000).toISOString();
}

export function buildAttestationId(runId, jobId) {
  return `ndic-pf-${String(runId)}-${String(jobId || "0")}`;
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
