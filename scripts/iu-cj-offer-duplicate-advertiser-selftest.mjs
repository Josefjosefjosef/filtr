import assert from "node:assert/strict";
import {
  PUB_STATE,
  classifyOfferPublicationState,
  offerSeenKey,
} from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";

function link(advertiserId, linkId) {
  return {
    linkId,
    advertiserId,
    advertiserName: "Partner",
    linkName: "Sleva",
    couponCode: "TEST",
    clickUrl: "https://www.kqzyfj.com/click-101883843-" + (advertiserId || "0") + "-" + linkId,
    promotionStartDate: "2026-01-01 00:00:00.0",
    promotionEndDate: "2026-12-31 23:59:00.0",
    promotionType: "coupon",
    currency: "EUR",
  };
}

const seen = new Set();
const ctx = { seenOfferIds: seen, sectionByAdv: {}, refDate: new Date("2026-10-25T12:00:00.000Z") };
const first = classifyOfferPublicationState(link("222", "1001"), ctx);
const other = classifyOfferPublicationState(link("333", "1001"), ctx);
const again = classifyOfferPublicationState(link("222", "1001"), ctx);
assert.notEqual(first.state, PUB_STATE.DUPLICATE);
assert.equal(first.offerId, "1001");
assert.equal(first.advertiserId, "222");
assert.notEqual(other.state, PUB_STATE.DUPLICATE);
assert.equal(other.advertiserId, "333");
assert.equal(again.state, PUB_STATE.DUPLICATE);
assert.equal(again.publicationReady, false);
assert.equal(again.offerId, "1001");

const bare = new Set();
const bareCtx = { seenOfferIds: bare, sectionByAdv: {}, refDate: ctx.refDate };
const bareFirst = classifyOfferPublicationState(link("", "1001"), bareCtx);
const bareAgain = classifyOfferPublicationState(link("", "1001"), bareCtx);
assert.notEqual(bareFirst.state, PUB_STATE.DUPLICATE);
assert.equal(bareAgain.state, PUB_STATE.DUPLICATE);

assert.equal(offerSeenKey({ advertiserId: "222", linkId: "1001" }), "222|1001");
assert.equal(offerSeenKey({ advertiserId: "333", linkId: "1001" }), "333|1001");
assert.equal(offerSeenKey({ linkId: "1001" }), "1001");
assert.equal(offerSeenKey({ advertiserId: "222", linkId: "1001" }) === offerSeenKey({ advertiserId: "333", linkId: "1001" }), false);

process.stdout.write("IU_CJ_OFFER_DUPLICATE_ADVERTISER_SELFTEST PASS\n");
