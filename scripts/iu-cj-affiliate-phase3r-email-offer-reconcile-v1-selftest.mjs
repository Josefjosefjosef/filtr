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

const partnerAuthorizedUrls = {
  "6466592": "https://www.kqzyfj.com/click-101883843-999001",
};

const baseOut = reconcileEmailOffersWithCjStaging({
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
  partnerAuthorizedUrls,
});

expect("ok", baseOut.ok === true);
expect("no_mutate", baseOut.mutatePartnersFromEmailAlone === false);
expect("corroborated", baseOut.counts.corroborated === 1);
expect(
  "email_only_hold_when_disarmed",
  baseOut.holds.some((h) => h.couponCode === "ONLYEMAIL" && h.contentState === EMAIL_CONTENT_STATE.HOLD)
);
expect("implausible_hold", baseOut.holds.some((h) => h.reason === "missing_or_implausible_advertiser_id"));
expect("not_joined_hold", baseOut.holds.some((h) => h.reason === "advertiser_not_joined"));
expect("disarmed", baseOut.publishArmed === false && baseOut.cjLivePublishing === "DISARMED");
expect("sources_both", baseOut.corroborated[0]?.sources?.join(",") === "cj,email");

const armedOut = reconcileEmailOffersWithCjStaging({
  events: [
    {
      uid: 10,
      eventType: AI_EVENT_TYPE.COUPON_NEW,
      advertiserId: "6466592",
      couponCode: "EMAILONLY25",
      confidence: "high",
      termsSummary: "Platí na celý sortiment mimo výprodej, min. 500 Kč",
      validTo: "2099-12-31T23:59:59Z",
      czUsable: true,
    },
    {
      uid: 11,
      eventType: AI_EVENT_TYPE.PROMO_NEW,
      advertiserId: "6466592",
      confidence: "high",
      title: "Akce -20%",
      termsSummary: "Sleva 20 % na vybrané produkty",
      validTo: "2099-06-01",
      czUsable: true,
    },
    {
      uid: 12,
      eventType: AI_EVENT_TYPE.COUPON_NEW,
      advertiserId: "6466592",
      couponCode: "FORGED",
      confidence: "high",
      termsSummary: "Fake",
      validTo: "2099-01-01",
      forged: true,
    },
    {
      uid: 13,
      eventType: AI_EVENT_TYPE.COUPON_NEW,
      advertiserId: "6466592",
      couponCode: "CONFLICT",
      confidence: "high",
      termsSummary: "Other terms",
      validTo: "2099-01-01",
      conflictWithCj: true,
    },
    {
      uid: 14,
      eventType: AI_EVENT_TYPE.COUPON_NEW,
      advertiserId: "6466592",
      couponCode: "SAVE10",
      confidence: "high",
      termsSummary: "Corroborate",
      validTo: "2099-01-01",
      conflictWithCj: true,
    },
  ],
  stagingLinks,
  managedPartners: [{ advertiserId: "6466592", active: true }],
  partnerAuthorizedUrls,
  emailOfferStagingArmed: true,
});

expect("email_only_coupon_published", armedOut.counts.emailOnlyPublishable >= 1);
expect(
  "email_only_uses_partner_url",
  armedOut.emailOnlyPublishable.some(
    (r) =>
      r.couponCode === "EMAILONLY25" &&
      r.affiliateUrl === partnerAuthorizedUrls["6466592"] &&
      r.decision === "EMAIL_ONLY_PUBLISH_WITH_PARTNER_AUTHORIZED_URL"
  )
);
expect(
  "email_only_action_published",
  armedOut.emailOnlyPublishable.some((r) => r.uid === 11 && r.kind === "action")
);
expect(
  "forged_hold",
  armedOut.holds.some((h) => h.couponCode === "FORGED" && h.reason === "forged_or_spoofed_email")
);
expect(
  "conflict_hold",
  armedOut.conflicts.some((c) => c.couponCode === "SAVE10" && c.decision === "CONFLICT_CJ_EMAIL") ||
    armedOut.holds.some((h) => h.couponCode === "CONFLICT")
);
expect(
  "staging_links_ready",
  (armedOut.emailOnlyStagingLinks || []).some((l) => l.couponCode === "EMAILONLY25" && l.clickUrl)
);
expect("never_invent_url_from_email", !JSON.stringify(armedOut).includes("evil.example"));

console.log(
  JSON.stringify({
    IU_CJ_EMAIL_OFFER_RECONCILE_V1_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
    countsDisarmed: baseOut.counts,
    countsArmed: armedOut.counts,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
