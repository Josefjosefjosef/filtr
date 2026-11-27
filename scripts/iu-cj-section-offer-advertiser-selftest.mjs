import assert from "node:assert/strict";
import {
  buildOffersPublicFromStaging,
  claimSectionOffer,
  sectionOfferSeenKey,
} from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const first = { advertiserId: "222", offerId: "1001", currency: "EUR" };
const second = { advertiserId: "333", offerId: "1001", currency: "EUR" };
const repeat = { advertiserId: "222", offerId: "1001", currency: "EUR" };
const bare = { offerId: "1001", currency: "EUR" };
assert.equal(sectionOfferSeenKey(first), "222|1001");
assert.equal(sectionOfferSeenKey(second), "333|1001");
assert.notEqual(sectionOfferSeenKey(first), sectionOfferSeenKey(second));
assert.equal(sectionOfferSeenKey(repeat), sectionOfferSeenKey(first));
assert.equal(sectionOfferSeenKey(bare), "1001");
assert.equal(first.currency, "EUR");
assert.equal(second.currency, "EUR");

const seen = new Set();
assert.equal(claimSectionOffer(seen, first), true);
assert.equal(claimSectionOffer(seen, second), true);
assert.equal(claimSectionOffer(seen, repeat), false);
const bareSeen = new Set();
assert.equal(claimSectionOffer(bareSeen, bare), true);
assert.equal(claimSectionOffer(bareSeen, { offerId: "1001" }), false);

const goodUrl = "https://www.jdoqocy.com/click-101883843-15735649";
const link = {
  linkId: "9001",
  advertiserId: "100",
  advertiserName: "Same",
  couponCode: "SAVE10",
  clickUrl: goodUrl,
  promotionType: "coupon",
  promotionEndDate: "2027-12-31 23:59:00.0",
  currency: "EUR",
};
const built = buildOffersPublicFromStaging({
  staging: { apiOutage: false, advertisers: [], links: [link, { ...link }] },
  sectionByAdv: { "100": "aff-moda" },
  refDate: new Date("2026-10-28T12:00:00Z"),
});
assert.equal(built.ok, true);
assert.equal(built.doc.sections[0].coupons.length, 1);
assert.equal(built.doc.sections[0].coupons[0].couponCode, "SAVE10");
assert.equal(built.rejectReasons.duplicate_offer_id >= 1, true);

process.stdout.write("IU_CJ_SECTION_OFFER_ADVERTISER_SELFTEST PASS\n");
