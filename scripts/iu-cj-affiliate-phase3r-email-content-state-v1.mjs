#!/usr/bin/env node
/**
 * Phase 3R / V30 — explicit email content processing states.
 * IMAP RECEIVED / checkpoint must never imply ANALYZED or PUBLISHED.
 */
import { AI_OUTCOME } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";

export const EMAIL_CONTENT_STATE = Object.freeze({
  RECEIVED: "RECEIVED",
  PARSED: "PARSED",
  ANALYZED: "ANALYZED",
  VALIDATED: "VALIDATED",
  RECONCILED: "RECONCILED",
  PUBLISHED: "PUBLISHED",
  HOLD: "HOLD",
  RETRY_PENDING: "RETRY_PENDING",
  FAILED: "FAILED",
});

/**
 * Map AI classify + reconcile outcomes to a durable content state.
 * HTTP 401/auth failures → RETRY_PENDING (checkpoint of IMAP receipt must not drop retry).
 */
export function resolveEmailContentState(opts = {}) {
  const received = opts.received === true || opts.uid != null;
  if (!received) return { state: EMAIL_CONTENT_STATE.FAILED, reason: "not_received" };

  if (opts.parseError) {
    return { state: EMAIL_CONTENT_STATE.FAILED, reason: "parse_error" };
  }
  if (opts.parsed !== true && opts.parsed !== false) {
    // default: presence of subject/excerpt means parsed enough to classify
  }
  if (opts.parsed === false) {
    return { state: EMAIL_CONTENT_STATE.RECEIVED, reason: "awaiting_parse" };
  }

  const outcome = String(opts.aiOutcome || "");
  if (outcome === AI_OUTCOME.AI_AUTH_FAILED || /http_401|http_403|token_missing|auth/i.test(String(opts.aiError || ""))) {
    return {
      state: EMAIL_CONTENT_STATE.RETRY_PENDING,
      reason: "ai_auth_failed",
      analyzed: false,
      note: "IMAP receipt retained; content not marked ANALYZED until AI succeeds or explicit deterministic-only accept",
    };
  }
  if (outcome === AI_OUTCOME.AI_QUOTA_EXCEEDED) {
    return { state: EMAIL_CONTENT_STATE.RETRY_PENDING, reason: "ai_quota_exceeded", analyzed: false };
  }
  if (opts.aiHardFail === true) {
    return { state: EMAIL_CONTENT_STATE.FAILED, reason: opts.aiError || "ai_failed" };
  }

  const analyzed =
    outcome === AI_OUTCOME.AI_LIVE_SUCCESS ||
    (opts.acceptDeterministicFallback === true &&
      (outcome === AI_OUTCOME.AI_FALLBACK_USED || outcome === AI_OUTCOME.AI_UNAVAILABLE));

  if (!analyzed && outcome === AI_OUTCOME.AI_FALLBACK_USED) {
    // Deterministic fallback ran after AI failure — PARSED with fallback, not ANALYZED.
    if (opts.hold === true) {
      return { state: EMAIL_CONTENT_STATE.HOLD, reason: "fallback_hold", analyzed: false };
    }
    return {
      state: EMAIL_CONTENT_STATE.PARSED,
      reason: "deterministic_fallback_not_ai_analyzed",
      analyzed: false,
    };
  }
  if (!analyzed) {
    return { state: EMAIL_CONTENT_STATE.PARSED, reason: "awaiting_analysis", analyzed: false };
  }

  if (opts.hold === true || opts.decision === "MANUAL_REVIEW" || opts.decision === "HOLD") {
    return { state: EMAIL_CONTENT_STATE.HOLD, reason: opts.holdReason || "hold", analyzed: true };
  }
  if (opts.published === true) {
    return { state: EMAIL_CONTENT_STATE.PUBLISHED, reason: "published_via_cj_authority", analyzed: true };
  }
  if (opts.reconciled === true) {
    return { state: EMAIL_CONTENT_STATE.RECONCILED, reason: "reconciled_awaiting_publish", analyzed: true };
  }
  if (opts.validated === true) {
    return { state: EMAIL_CONTENT_STATE.VALIDATED, reason: "validated", analyzed: true };
  }
  return { state: EMAIL_CONTENT_STATE.ANALYZED, reason: "ai_analyzed", analyzed: true };
}

export function summarizeEmailContentStates(rows = []) {
  const counts = Object.create(null);
  for (const s of Object.values(EMAIL_CONTENT_STATE)) counts[s] = 0;
  for (const r of rows) {
    const st = String(r?.contentState || r?.state || "");
    if (counts[st] == null) counts[st] = 0;
    counts[st] += 1;
  }
  return {
    total: rows.length,
    counts,
    analyzedClaimedWithoutAi: rows.filter(
      (r) => r?.contentState === EMAIL_CONTENT_STATE.ANALYZED && r?.aiActuallyRan !== true
    ).length,
  };
}
