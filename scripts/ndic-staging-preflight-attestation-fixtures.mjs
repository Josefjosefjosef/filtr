#!/usr/bin/env node
/**
 * Attestation contract fixtures (offline, no GitHub API required).
 */
import {
  PREFLIGHT_STATUS_CONTEXT,
  GITHUB_COMMIT_STATUS_DESCRIPTION_MAX,
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

// GitHub commit status description max is 140. Autonomous schedule uses job
// name "scheduled-preflight" + 11+ digit run ids; must stay under the hard cap.
{
  const scheduledDesc = buildAttestationDescription({
    headSha: HEAD,
    runId: "31323367965",
    expiresAtIso: computeExpiresAtIso(NOW, 1800),
    attestationId: buildAttestationId("31323367965", "scheduled-preflight"),
  });
  ok(
    "github_status_description_max_scheduled",
    scheduledDesc.length <= GITHUB_COMMIT_STATUS_DESCRIPTION_MAX,
    String(scheduledDesc.length)
  );
  ok(
    "scheduled_aid_uses_short_job_slug",
    scheduledDesc.includes("aid=ndic-pf-31323367965-spf"),
    scheduledDesc
  );
  const longRunDesc = buildAttestationDescription({
    headSha: HEAD,
    runId: "9999999999999999",
    expiresAtIso: computeExpiresAtIso(NOW, 1800),
    attestationId: buildAttestationId("9999999999999999", "scheduled-preflight"),
  });
  ok(
    "github_status_description_max_long_run_id",
    longRunDesc.length <= GITHUB_COMMIT_STATUS_DESCRIPTION_MAX,
    String(longRunDesc.length)
  );

  // Exact boundary: a 140-char description must be accepted.
  const padAid = "x".repeat(
    GITHUB_COMMIT_STATUS_DESCRIPTION_MAX -
      `pass=1|head=${HEAD}|run=1|exp=2026-08-06T12:30:00Z|aid=`.length
  );
  const boundaryDesc = buildAttestationDescription({
    headSha: HEAD,
    runId: "1",
    expiresAtIso: "2026-08-06T12:30:00.000Z",
    attestationId: padAid,
  });
  ok(
    "github_status_description_boundary_140",
    boundaryDesc.length === GITHUB_COMMIT_STATUS_DESCRIPTION_MAX,
    String(boundaryDesc.length)
  );

  // Mutation >140 must be rejected by the hard guard (regression lock).
  let overThrew = false;
  let overMsg = "";
  try {
    buildAttestationDescription({
      headSha: HEAD,
      runId: "1",
      expiresAtIso: "2026-08-06T12:30:00.000Z",
      attestationId: padAid + "Y",
    });
  } catch (e) {
    overThrew = true;
    overMsg = String(e && e.message ? e.message : e);
  }
  ok(
    "github_status_description_141_rejected",
    overThrew && overMsg.startsWith("DESCRIPTION_TOO_LONG:"),
    overMsg
  );
}

const report = { ok: fails.length === 0, passCount, failCount: fails.length, fails };
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
