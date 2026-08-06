#!/usr/bin/env node
/**
 * Attestation contract fixtures (offline, no GitHub API required).
 */
import {
  PREFLIGHT_STATUS_CONTEXT,
  buildAttestationDescription,
  parseAttestationDescription,
  verifyAttestationStatus,
  computeExpiresAtIso,
  buildAttestationId,
  DEFAULT_TTL_SECONDS,
} from "./ndic-staging-preflight-attestation.mjs";

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

const HEAD = "d".repeat(40);
const OTHER = "e".repeat(40);
const NOW = Date.parse("2026-08-06T12:00:00.000Z");

function goodDesc(overrides = {}) {
  const exp = overrides.expiresAtIso || computeExpiresAtIso(NOW, DEFAULT_TTL_SECONDS);
  return buildAttestationDescription({
    headSha: overrides.headSha || HEAD,
    runId: overrides.runId || "31118898675",
    expiresAtIso: exp,
    attestationId: overrides.attestationId || buildAttestationId(31118898675, 1),
  });
}

ok("context_constant", PREFLIGHT_STATUS_CONTEXT === "ndic-staging-preflight");
ok("build_parse_roundtrip", parseAttestationDescription(goodDesc()).ok);

ok(
  "success_correct_head",
  verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "success",
    description: goodDesc(),
    expectedHeadSha: HEAD,
    nowMs: NOW + 60_000,
  }).ok
);

ok(
  "wrong_head_rejected",
  verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "success",
    description: goodDesc(),
    expectedHeadSha: OTHER,
    nowMs: NOW + 60_000,
  }).errors.includes("HEAD_MISMATCH")
);

const expiredDesc = goodDesc({ expiresAtIso: computeExpiresAtIso(NOW - 10_000_000, 300) });
ok(
  "expired_rejected",
  verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "success",
    description: expiredDesc,
    expectedHeadSha: HEAD,
    nowMs: NOW,
  }).errors.includes("EXPIRED")
);

ok(
  "missing_rejected",
  verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "success",
    description: "",
    expectedHeadSha: HEAD,
    nowMs: NOW,
  }).errors.includes("DESCRIPTION_PARSE_FAIL")
);

ok(
  "cancelled_or_failure_rejected",
  verifyAttestationStatus({
    context: PREFLIGHT_STATUS_CONTEXT,
    state: "failure",
    description: goodDesc(),
    expectedHeadSha: HEAD,
    nowMs: NOW + 1000,
  }).errors.includes("STATE_NOT_SUCCESS")
);

ok(
  "wrong_context_rejected",
  verifyAttestationStatus({
    context: "repo-guard",
    state: "success",
    description: goodDesc(),
    expectedHeadSha: HEAD,
    nowMs: NOW + 1000,
  }).errors.includes("WRONG_CONTEXT")
);

ok(
  "fake_aid_parse_requires_fields",
  !parseAttestationDescription("pass=1|head=deadbeef|run=1|exp=nope|aid=").ok
);

let threw = false;
try {
  buildAttestationDescription({
    headSha: "short",
    runId: "1",
    expiresAtIso: computeExpiresAtIso(NOW, 600),
    attestationId: "x",
  });
} catch {
  threw = true;
}
ok("invalid_head_throws", threw);

ok("ttl_default_sane", DEFAULT_TTL_SECONDS >= 300 && DEFAULT_TTL_SECONDS <= 86400);

const report = { ok: fails.length === 0, passCount, failCount: fails.length, fails };
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
