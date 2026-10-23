#!/usr/bin/env node
/** Offline: CJ Link Search v2 query params (promotion-type=coupon, not link-type=coupon). */
import {
  buildCjLinkSearchProbePage1QueryString,
  buildCjLinkSearchQueryParams,
} from "./iu-cj-affiliate-cj-link-search-query-v1.mjs";
import { buildCjLinkSearchQueryParams as adapterReexport } from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const couponQs = buildCjLinkSearchQueryParams("101883843", 1, { promotionType: "coupon" }).toString();
expect("promotion_type_coupon", couponQs.includes("promotion-type=coupon"));
expect("no_link_type_coupon", !couponQs.includes("link-type=coupon"));
expect("website_id", couponQs.includes("website-id=101883843"));
expect("advertiser_joined", couponQs.includes("advertiser-ids=joined"));
expect("page_one", couponQs.includes("page-number=1"));
expect("records_ten", couponQs.includes("records-per-page=10"));

const probeQs = buildCjLinkSearchProbePage1QueryString("101883843");
expect("probe_matches_coupon", probeQs === couponQs);

const bannerQs = buildCjLinkSearchQueryParams("999", 2, { linkType: "Banner" }).toString();
expect("link_type_banner", bannerQs.includes("link-type=Banner"));
expect("banner_no_promotion_type", !bannerQs.includes("promotion-type="));

expect("adapter_reexport", adapterReexport === buildCjLinkSearchQueryParams);

console.log(
  JSON.stringify({
    IU_CJ_LINK_SEARCH_QUERY_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    CJ_LIVE_HTTP_CALLS: 0,
  })
);
process.exit(failures.length ? 1 : 0);
