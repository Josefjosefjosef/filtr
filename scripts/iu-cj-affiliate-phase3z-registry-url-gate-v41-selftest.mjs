#!/usr/bin/env node
/**
 * V41 — partner-registry CI gate must accept the same URL evidence as
 * urlEvidenceSufficientForReady (WAF 403 / 429 / click-timeout identity paths).
 */
import { urlEvidenceSufficientForReady } from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";
import { URL_VERIFY_CLASS } from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Mirror of workflow Python gate (must stay in sync).
function urlEvidenceSufficientGate(b) {
  const uv = b.urlVerification || {};
  const st = uv.status;
  const mrs = b.merchantReviewStatus;
  if (st === "VERIFIED_HTTP_OK") return true;
  if (
    st === "HTTP_FORBIDDEN" &&
    mrs === "IDENTITY_VERIFIED_WAF" &&
    (uv.classification === "BOT_BLOCK_SUSPECTED" || uv.clientBlockedPossible === true)
  ) {
    return true;
  }
  if (
    st === "HTTP_NOT_OK" &&
    uv.httpStatus === 429 &&
    mrs === "IDENTITY_VERIFIED_RATE_LIMITED" &&
    uv.classification === "RATE_LIMITED"
  ) {
    return true;
  }
  if (
    (st === "NOT_VERIFIED" || st === "ERROR") &&
    mrs === "IDENTITY_VERIFIED_CLICK_TIMEOUT" &&
    String(uv.note || "").includes("click_probe_timeout_identity_preserved")
  ) {
    return true;
  }
  return false;
}

const httpOk = {
  publishability: "READY_FOR_REVIEW",
  urlVerification: { status: "VERIFIED_HTTP_OK" },
};
assert(urlEvidenceSufficientGate(httpOk) === true, "http ok gate");
assert(urlEvidenceSufficientForReady(httpOk) === true, "http ok lib");

const waf = {
  publishability: "READY_FOR_REVIEW",
  merchantReviewStatus: "IDENTITY_VERIFIED_WAF",
  urlVerification: {
    status: "HTTP_FORBIDDEN",
    httpStatus: 403,
    classification: URL_VERIFY_CLASS.BOT_BLOCK_SUSPECTED || "BOT_BLOCK_SUSPECTED",
    clientBlockedPossible: true,
  },
};
assert(urlEvidenceSufficientGate(waf) === true, "waf gate accepts READY");
assert(urlEvidenceSufficientForReady(waf) === true, "waf lib accepts READY");

const bare403 = {
  publishability: "READY_FOR_REVIEW",
  merchantReviewStatus: "UNKNOWN",
  urlVerification: { status: "HTTP_FORBIDDEN", httpStatus: 403 },
};
assert(urlEvidenceSufficientGate(bare403) === false, "bare 403 rejected");
assert(urlEvidenceSufficientForReady(bare403) === false, "bare 403 lib rejected");

// Historical failure mode: HTTP_OK-only assert would reject WAF READY (30× on run 41822352852).
assert(
  (waf.urlVerification || {}).status !== "VERIFIED_HTTP_OK" && urlEvidenceSufficientGate(waf),
  "documents root cause of AssertionError on schedule 41822352852"
);

console.log(
  JSON.stringify({
    IU_CJ_REGISTRY_URL_GATE_V41_SELFTEST: "PASS",
    rootCauseRun: "41822352852",
    fix: "READY gate accepts urlEvidenceSufficientForReady statuses, not HTTP_OK-only",
  })
);
