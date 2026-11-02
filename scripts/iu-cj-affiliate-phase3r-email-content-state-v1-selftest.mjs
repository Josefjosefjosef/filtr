#!/usr/bin/env node
import {
  EMAIL_CONTENT_STATE,
  resolveEmailContentState,
  summarizeEmailContentStates,
} from "./iu-cj-affiliate-phase3r-email-content-state-v1.mjs";
import { AI_OUTCOME } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

expect(
  "auth_401_retry",
  resolveEmailContentState({
    uid: 1,
    aiOutcome: AI_OUTCOME.AI_AUTH_FAILED,
    aiError: "http_401",
  }).state === EMAIL_CONTENT_STATE.RETRY_PENDING
);

expect(
  "live_ai_analyzed",
  resolveEmailContentState({
    uid: 2,
    aiOutcome: AI_OUTCOME.AI_LIVE_SUCCESS,
  }).state === EMAIL_CONTENT_STATE.ANALYZED
);

expect(
  "fallback_not_analyzed",
  resolveEmailContentState({
    uid: 3,
    aiOutcome: AI_OUTCOME.AI_FALLBACK_USED,
    aiError: "http_401",
  }).state === EMAIL_CONTENT_STATE.RETRY_PENDING
);

expect(
  "fallback_parsed_when_no_auth_error",
  resolveEmailContentState({
    uid: 4,
    aiOutcome: AI_OUTCOME.AI_FALLBACK_USED,
    aiError: "ai_unavailable",
  }).state === EMAIL_CONTENT_STATE.PARSED
);

expect(
  "reconciled",
  resolveEmailContentState({
    uid: 5,
    aiOutcome: AI_OUTCOME.AI_LIVE_SUCCESS,
    reconciled: true,
  }).state === EMAIL_CONTENT_STATE.RECONCILED
);

expect(
  "hold",
  resolveEmailContentState({
    uid: 6,
    aiOutcome: AI_OUTCOME.AI_LIVE_SUCCESS,
    hold: true,
  }).state === EMAIL_CONTENT_STATE.HOLD
);

const sum = summarizeEmailContentStates([
  { contentState: EMAIL_CONTENT_STATE.RETRY_PENDING },
  { contentState: EMAIL_CONTENT_STATE.ANALYZED, aiActuallyRan: true },
]);
expect("summary_total", sum.total === 2);
expect("summary_retry", sum.counts[EMAIL_CONTENT_STATE.RETRY_PENDING] === 1);

console.log(
  JSON.stringify({
    IU_CJ_EMAIL_CONTENT_STATE_V1_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
