#!/usr/bin/env node
/**
 * Phase 3S — explain CJ reconcile counters from live run 40514297668.
 * Plans ≠ confirmed mutations. Email/AI never alone END a partner.
 */
export function explainCjCounts(c = {}) {
  return {
    schema: "iu-cj-affiliate-phase3s-cj-counts-explain-v1",
    input: c,
    meaning: {
      passedToRobot: "Every AI/fallback event handed to reconcileAiEventBatch (hint queue).",
      verifiedViaCjApi:
        "Subset where advertiser-lookup HTTP returned and status was parsed (not mock). Low vs passed means most events lacked CID or CJ HTTP skipped/failed per event.",
      stagingAddPlans: "JOINED candidates planned for staging only — not public catalog writes.",
      stagingUpdatePlans: "Coupon/product/terms candidates planned — still require CJ evidence before any apply.",
      stagingEndedPlans:
        "ENDED candidates planned. Without forceConfirmedEnded + CJ ended status these stay PLAN_ONLY / REJECT_UNSAFE_ENDED. Email alone never removes buttons.",
    },
    safety: {
      mutatePartnersFromEmailAlone: false,
      liveEnabled: false,
      publishArmed: false,
      cjLivePublishing: "DISARMED",
      endedRequires: ["CJ confirmed ended/absent", "complete paging", "not paid/manual protected"],
    },
    liveRun40514297668Interpretation: {
      passedToRobot: 296,
      verifiedViaCjApi: 7,
      stagingAddPlans: 0,
      stagingUpdatePlans: 95,
      stagingEndedPlans: 14,
      note:
        "14 ENDED plans are candidates for manual/CJ confirmation — not executed removals. 7 verified lookups ≠ 14 ended confirms.",
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("iu-cj-affiliate-phase3s-cj-counts-explain-v1.mjs")) {
  console.log(
    JSON.stringify(
      explainCjCounts({
        passedToRobot: 296,
        verifiedViaCjApi: 7,
        stagingAddPlans: 0,
        stagingUpdatePlans: 95,
        stagingEndedPlans: 14,
      }),
      null,
      2
    )
  );
}
