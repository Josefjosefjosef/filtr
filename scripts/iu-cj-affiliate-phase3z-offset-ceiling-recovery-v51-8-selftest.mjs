#!/usr/bin/env node
/**
 * V51.8 — offset-ceiling recovery (INVALID_FEED@9901 mislabel) selftest.
 */
import assert from "node:assert/strict";
import {
  CJ_PRODUCT_SEARCH_MAX_LIMIT,
  CJ_PRODUCT_SEARCH_OFFSET_FIRST,
  fetchAllShoppingProductsForPartner,
  isProductSearchOffsetCeiling,
} from "./iu-cj-affiliate-phase2-product-api.mjs";
import {
  classifyPartnerFetchError,
  buildPartnerFetchErrorAudit,
  isPartnerOffsetCeilingStuck,
  listInventoryAdIdsForPartner,
} from "./iu-cj-affiliate-offers-live-sync-v1.mjs";
import { auditInvalidFeedCases } from "./iu-cj-affiliate-phase3z-invalid-feed-case-audit-v51-8.mjs";

assert.equal(isProductSearchOffsetCeiling(9901, 100), true);
assert.equal(isProductSearchOffsetCeiling(1, 100), false);
assert.equal(isProductSearchOffsetCeiling(9900, 100), false);

assert.equal(classifyPartnerFetchError("http_400"), "INVALID_FEED");
assert.equal(
  classifyPartnerFetchError("http_400", { resumeOffset: 9901, pageSize: 100 }),
  "OFFSET_CEILING"
);
assert.equal(classifyPartnerFetchError("offset_ceiling_exceeded"), "OFFSET_CEILING");
assert.equal(
  classifyPartnerFetchError("needs_page_token_or_subscription_above_10k"),
  "OFFSET_CEILING"
);

const audit = buildPartnerFetchErrorAudit("http_400", { resumeOffset: 9901, pageSize: 100 });
assert.equal(audit.errorClass, "OFFSET_CEILING");
assert.equal(audit.robotContinuationRequired, true);

assert.equal(
  isPartnerOffsetCeilingStuck({ resumeOffset: 9901, lastError: "http_400", lastFetchedCount: 0 }, 100),
  true
);
assert.equal(
  isPartnerOffsetCeilingStuck({ resumeOffset: 1, lastError: null, lastFetchedCount: 10 }, 100),
  false
);

const ads = listInventoryAdIdsForPartner(
  {
    feeds: [
      { advertiserId: "1", adId: "a" },
      { advertiserId: "1", adId: "a" },
      { advertiserId: "1", adId: "b" },
      { advertiserId: "2", adId: "c" },
    ],
  },
  "1"
);
assert.deepEqual(ads, ["a", "b"]);

const early = await fetchAllShoppingProductsForPartner(
  { pat: "x", publisherCid: "1", websitePid: "1" },
  "999",
  { resumeOffset: CJ_PRODUCT_SEARCH_MAX_LIMIT + 1, pageSize: 100, maxPages: 1 }
);
assert.equal(early.offsetCeiling, true);
assert.equal(early.error, "offset_ceiling_exceeded");
assert.equal(early.fetchedCount, 0);

const cases = auditInvalidFeedCases({
  productMeta: {
    partnerFetchErrorCases: [
      { advertiserId: "1", error: "http_400", errorClass: "INVALID_FEED", resumeOffset: 1 },
      {
        advertiserId: "2",
        error: "offset_ceiling_exceeded",
        errorClass: "OFFSET_CEILING",
        resumeOffset: 9901,
      },
      { advertiserId: "3", error: "http_400", resumeOffset: 9901, offsetCeiling: true },
    ],
  },
});
assert.equal(cases.totalCases, 1, "only true INVALID_FEED remains");
assert.equal(cases.cases[0].advertiserId, "1");

console.log(
  JSON.stringify({
    IU_CJ_OFFSET_CEILING_RECOVERY_V51_8_SELFTEST: "PASS",
    maxLimit: CJ_PRODUCT_SEARCH_MAX_LIMIT,
    first: CJ_PRODUCT_SEARCH_OFFSET_FIRST,
  })
);
