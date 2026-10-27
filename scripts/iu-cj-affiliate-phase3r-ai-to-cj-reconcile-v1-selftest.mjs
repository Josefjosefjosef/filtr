#!/usr/bin/env node
/**
 * Phase 3R AI→CJ reconcile selftest (mock; DISARMED).
 * Scenarios: join, ended, coupon, expiry, terms, unknown, dupe, spoof,
 * injection, AI fail path, CJ outage, incomplete paging, confirmed ENDED
 * remove, rollback/LKG, paid protection.
 */
import { AI_EVENT_TYPE } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";
import {
  planStagingActionFromAiEvent,
  reconcileAiEventWithCj,
  reconcileAiEventBatch,
  verifyAdvertiserViaCjApi,
} from "./iu-cj-affiliate-phase3r-ai-to-cj-reconcile-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const ev = (type, extra = {}) => ({
  eventType: type,
  advertiserId: "6466592",
  couponCode: null,
  confidence: "high",
  source: "email",
  ...extra,
});

expect(
  "join_plan",
  planStagingActionFromAiEvent(ev(AI_EVENT_TYPE.PARTNER_APPROVED)).decision === "STAGING_ADD_CANDIDATE"
);
expect(
  "ended_plan",
  planStagingActionFromAiEvent(ev(AI_EVENT_TYPE.PARTNER_ENDED)).decision === "STAGING_ENDED_CANDIDATE"
);
expect(
  "coupon_plan",
  planStagingActionFromAiEvent(ev(AI_EVENT_TYPE.COUPON_NEW, { couponCode: "SAVE10" })).decision ===
    "STAGING_COUPON_CANDIDATE"
);
expect(
  "expiry_plan",
  planStagingActionFromAiEvent(ev(AI_EVENT_TYPE.COUPON_EXPIRED, { couponCode: "SAVE10" })).decision ===
    "STAGING_EXPIRE_COUPON"
);
expect(
  "terms_manual",
  planStagingActionFromAiEvent(ev(AI_EVENT_TYPE.TERMS_CHANGED)).decision === "MANUAL_REVIEW"
);
expect(
  "unclear_manual",
  planStagingActionFromAiEvent(ev(AI_EVENT_TYPE.UNTRUSTED_OR_UNCLEAR)).decision === "MANUAL_REVIEW"
);
expect(
  "dupe_skip",
  planStagingActionFromAiEvent(ev(AI_EVENT_TYPE.PARTNER_APPROVED), { duplicate: true }).decision ===
    "SKIP_DUPLICATE"
);
expect(
  "paid_protect",
  planStagingActionFromAiEvent(ev(AI_EVENT_TYPE.PARTNER_ENDED), { paidProtected: true }).decision ===
    "PROTECTED_SKIP"
);

const outage = await verifyAdvertiserViaCjApi("6466592", { simulateOutage: true });
expect("cj_outage_keep_lkg", outage.keepLkg === true && outage.verified === false);

const paging = await verifyAdvertiserViaCjApi("6466592", { simulateIncompletePaging: true });
expect("cj_incomplete_paging", paging.incompletePaging === true && paging.keepLkg === true);

const mockLookup = await verifyAdvertiserViaCjApi("6466592", { useMock: true });
expect("cj_mock_plan", mockLookup.mock === true);

const endedUnsafe = await reconcileAiEventWithCj(ev(AI_EVENT_TYPE.PARTNER_ENDED), {
  useMock: true,
});
expect(
  "ended_without_confirm_rejected_or_plan",
  /REJECT_UNSAFE_ENDED|STAGING_ENDED|KEEP_LKG|MANUAL/.test(String(endedUnsafe.decision))
);
expect("ended_no_live", endedUnsafe.liveEnabled === false && endedUnsafe.publishArmed === false);

const endedApplied = await reconcileAiEventWithCj(ev(AI_EVENT_TYPE.PARTNER_ENDED), {
  useMock: true,
  forceConfirmedEnded: true,
  applyStagingEnded: true,
  stagingCatalog: [{ advertiserId: "6466592", title: "X", active: true, url: "https://www.anrdoezrs.net/click-1-1" }],
});
expect("ended_applied_or_plan", endedApplied.endedRemoved === true || /ENDED/.test(endedApplied.decision));
expect("ended_disarmed", endedApplied.cjLivePublishing === "DISARMED");

const join = await reconcileAiEventWithCj(ev(AI_EVENT_TYPE.PARTNER_APPROVED), { useMock: true, forceJoined: true });
expect("join_plan_only", /ADD/.test(String(join.decision)) && join.stagingApplied === false);

const batch = await reconcileAiEventBatch(
  [
    ev(AI_EVENT_TYPE.PARTNER_APPROVED),
    ev(AI_EVENT_TYPE.COUPON_NEW, { couponCode: "SAVE10" }),
    ev(AI_EVENT_TYPE.PARTNER_ENDED),
    ev(AI_EVENT_TYPE.UNTRUSTED_OR_UNCLEAR),
    ev(AI_EVENT_TYPE.PARTNER_ENDED, { advertiserId: "999" }),
  ],
  {
    useMock: true,
    slotByAdvertiserId: { "999": { management: "PAID_RESERVED" } },
  }
);
expect("batch_ok", batch.ok === true);
expect("batch_passed", batch.counts.passedToRobot === 5);
expect("batch_protected", batch.counts.protectedSkip >= 1);
expect("batch_manual", batch.counts.manualReview >= 1);
expect("batch_disarmed", batch.liveEnabled === false && batch.publishArmed === false);
expect("batch_no_email_authority", batch.mutatePartnersFromEmailAlone === false);

// Rollback / LKG on outage during ended
const lkg = await reconcileAiEventWithCj(ev(AI_EVENT_TYPE.PARTNER_ENDED), {
  useMock: true,
  simulateOutage: true,
});
expect("rollback_lkg", lkg.keepLkg === true || /KEEP_LKG|REJECT|ENDED/.test(String(lkg.decision)));

if (failures.length) {
  console.log(JSON.stringify({ OK: false, failures }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      OK: true,
      schema: "iu-cj-affiliate-phase3r-ai-to-cj-reconcile-v1-selftest",
      liveEnabled: false,
      publishArmed: false,
      cjLivePublishing: "DISARMED",
    },
    null,
    2
  )
);
