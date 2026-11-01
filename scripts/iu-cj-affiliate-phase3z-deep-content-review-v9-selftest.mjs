#!/usr/bin/env node
/**
 * Regression: soft HTTP 403 from bare fetch must still attempt browser render;
 * HTTP 429 must not. Never weakens CONTENT_VERIFIED thresholds.
 */
import {
  shouldAttemptBrowserContentRender,
  isTransientProbeFailure,
} from "./iu-cj-affiliate-phase3z-deep-content-review-v9.mjs";

const failures = [];
function expect(name, cond, detail) {
  if (!cond) failures.push({ name, detail: detail || null });
}

expect(
  "403_soft_block_attempts_browser",
  shouldAttemptBrowserContentRender(
    {
      ok: false,
      httpStatus: 403,
      assortmentEvidence: { contentVerified: false, diagnostics: { thinHtml: true, textLen: 40 } },
    },
    { hasBrowser: true }
  ) === true
);

expect(
  "429_does_not_attempt_browser",
  shouldAttemptBrowserContentRender(
    {
      ok: false,
      httpStatus: 429,
      assortmentEvidence: { contentVerified: false, diagnostics: { thinHtml: true, textLen: 40 } },
    },
    { hasBrowser: true }
  ) === false
);

expect(
  "no_browser_skips",
  shouldAttemptBrowserContentRender(
    { ok: false, httpStatus: 403, assortmentEvidence: { diagnostics: { thinHtml: true } } },
    { hasBrowser: false }
  ) === false
);

expect(
  "spa_suspected_attempts",
  shouldAttemptBrowserContentRender(
    {
      ok: true,
      httpStatus: 200,
      assortmentEvidence: {
        contentVerified: false,
        diagnostics: { spaSuspected: true, thinHtml: false, textLen: 5000 },
      },
    },
    { hasBrowser: true }
  ) === true
);

expect(
  "already_verified_fat_html_skips",
  shouldAttemptBrowserContentRender(
    {
      ok: true,
      httpStatus: 200,
      assortmentEvidence: {
        contentVerified: true,
        diagnostics: { spaSuspected: false, thinHtml: false, textLen: 9000 },
      },
    },
    { hasBrowser: true }
  ) === false
);

expect("transient_429", isTransientProbeFailure({ httpStatus: 429, error: null }) === true);
expect(
  "transient_timeout",
  isTransientProbeFailure({ httpStatus: null, error: "probe timeout after 12000ms" }) === true
);
expect(
  "not_transient_403",
  isTransientProbeFailure({ httpStatus: 403, error: "http_403_not_bypassed" }) === false
);

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3Z_DEEP_CONTENT_REVIEW_SELFTEST: ok ? "OK" : "FAIL",
    failures,
  })
);
process.exit(ok ? 0 : 1);
