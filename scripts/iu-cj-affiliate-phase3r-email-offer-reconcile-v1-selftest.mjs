#!/usr/bin/env node
import { reconcileEmailOffersWithCjStaging } from "./iu-cj-affiliate-phase3r-email-offer-reconcile-v1.mjs";
import { AI_EVENT_TYPE } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";
import { EMAIL_CONTENT_STATE } from "./iu-cj-affiliate-phase3r-email-content-state-v1.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

const stagingLinks = [
  {
    advertiserId: "6466592",
    couponCode: "SAVE10",
    linkId: "111",
    clickUrl: "https://www.kqzyfj.com/click-101883843-111",
  },
];

const out = reconcileEmailOffersWithCjStaging({
  events: [
    {
      uid: 1,
      eventType: AI_EVENT_TYPE.COUPON_NEW,
      advertiserId: "6466592",
      couponCode: "SAVE10",
      confidence: "high",
    },
    {
      uid: 2,
      eventType: AI_EVENT_TYPE.COUPON_NEW,
      advertiserId: "6466592",
      couponCode: "ONLYEMAIL",
      confidence: "medium",
    },
    {
      uid: 3,
      eventType: AI_EVENT_TYPE.COUPON_NEW,
      advertiserId: "6",
      couponCode: "BAD",
      confidence: "low",
    },
    {
      uid: 4,
      eventType: AI_EVENT_TYPE.COUPON_NEW,
      advertiserId: "9999999",
      couponCode: "X",
      confidence: "high",
    },
    { uid: 5, eventType: AI_EVENT_TYPE.INFORMATIONAL },
  ],
  stagingLinks,
  managedPartners: [{ advertiserId: "6466592", active: true }],
});

expect("ok", out.ok === true);
expect("no_mutate", out.mutatePartnersFromEmailAlone === false);
expect("corroborated", out.counts.corroborated === 1);
expect("email_only_hold", out.holds.some((h) => h.couponCode === "ONLYEMAIL" && h.contentState === EMAIL_CONTENT_STATE.HOLD));
expect("implausible_hold", out.holds.some((h) => h.reason === "missing_or_implausible_advertiser_id"));
expect("not_joined_hold", out.holds.some((h) => h.reason === "advertiser_not_joined"));
expect("disarmed", out.publishArmed === false && out.cjLivePublishing === "DISARMED");
expect("sources_both", out.corroborated[0]?.sources?.join(",") === "cj,email");

console.log(
  JSON.stringify({
    IU_CJ_EMAIL_OFFER_RECONCILE_V1_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
    counts: out.counts,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
