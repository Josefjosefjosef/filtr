#!/usr/bin/env node
/**
 * V30 offline: Product Feed Search pagination builders/parsers (no PAT / no HTTP).
 */
import {
  CJ_PRODUCT_SEARCH_MAX_LIMIT,
  CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT,
  buildPublisherProductsQuery,
  buildShoppingProductFeedsQuery,
  clampProductSearchLimit,
  parseShoppingProductsGraphqlResponse,
} from "./iu-cj-affiliate-phase2-product-api.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

expect("clamp_above_max", clampProductSearchLimit(99999) === CJ_PRODUCT_SEARCH_MAX_LIMIT);
expect("clamp_default_page", clampProductSearchLimit(null) === CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT);
expect("no_artificial_ten", clampProductSearchLimit(100) === 100);
expect("allows_1000", clampProductSearchLimit(1000) === 1000);
expect("allows_10000", clampProductSearchLimit(10000) === 10000);

const qFirst = buildPublisherProductsQuery("111", "222", "101883843", 100, {});
expect("query_limit_100", /limit:\s*100/.test(qFirst));
expect("query_first_omits_offset", !/offset:/.test(qFirst));
expect("query_totalCount_resultList", /totalCount/.test(qFirst) && /resultList/.test(qFirst));
expect("query_no_response_page_field", !/\{\s*totalCount count limit page/.test(qFirst));
expect("query_no_ten_cap", !/limit:\s*10\b/.test(qFirst) || /limit:\s*100/.test(qFirst));

const qOff = buildPublisherProductsQuery("111", "222", "101883843", 100, { offset: 101 });
expect("query_offset_when_gt_zero", /offset:\s*101/.test(qOff));

const qIds = buildPublisherProductsQuery("111", "222", "101883843", 25, {
  productIds: ["SKU-A", "SKU-B"],
});
expect("query_productIds_documented", /productIds:\s*\["SKU-A",\s*"SKU-B"\]/.test(qIds));
expect("query_productIds_keeps_partner", /partnerIds:\s*\["222"\]/.test(qIds));

const qPage = buildPublisherProductsQuery("111", "222", "101883843", 10000, { page: "tok123" });
expect("page_token_mode", /page:\s*"tok123"/.test(qPage) && !/offset:/.test(qPage));
expect("page_limit_10k", /limit:\s*10000/.test(qPage));

const feedsQ = buildShoppingProductFeedsQuery("111", "222", 50);
expect("feeds_limit_50", /limit:\s*50/.test(feedsQ));
expect("feeds_country", /advertiserCountry/.test(feedsQ));

const parsed = parseShoppingProductsGraphqlResponse({
  ok: true,
  status: 200,
  gqlErrors: [],
  json: {
    data: {
      shoppingProducts: {
        totalCount: 25,
        count: 10,
        limit: 10,
        page: "NEXT",
        resultList: [{ id: "1" }, { id: "2" }],
      },
    },
  },
});
expect("parse_ok", parsed.ok === true && parsed.kind === "success");
expect("parse_total", parsed.totalCount === 25);
expect("parse_count", parsed.count === 10);
expect("parse_page_token", parsed.page === "NEXT");

const oldTen = buildPublisherProductsQuery("1", "2", "3", 999);
expect("legacy_high_limit_not_capped_at_10", /limit:\s*999/.test(oldTen) || /limit:\s*1000/.test(oldTen) || /limit:\s*10000/.test(oldTen));
expect("high_limit_clamped_to_max_only", clampProductSearchLimit(999) === 999);

console.log(
  JSON.stringify({
    IU_CJ_PRODUCT_API_PAGINATION_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
    documentedMax: CJ_PRODUCT_SEARCH_MAX_LIMIT,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
