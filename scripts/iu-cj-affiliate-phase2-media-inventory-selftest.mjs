#!/usr/bin/env node
/** Offline regression for banner inventory classification and time mapping. */
import { classifyTimeWindow } from "./iu-cj-affiliate-phase2-lib.mjs";
import {
  assessActionValidity,
  buildCreativeGroupingStrictKey,
  buildCreativeVariantGroupingEstimateKey,
  classifyBannerRole,
  destinationStorefrontCanonicalString,
  destinationStorefrontGroupingSegment,
  destinationStorefrontKey,
  detectDocumentedOpenEndKind,
} from "./iu-cj-affiliate-phase2-media-inventory-lib.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const ref = new Date("2026-10-17T12:00:00.000Z");

expect("start_only_not_closed_active", classifyTimeWindow("2026-01-01 00:00:00.0", "", ref) === "time_open_end_missing");
expect("end_only_unverified", classifyTimeWindow("", "2030-01-01 00:00:00.0", ref) === "time_unverified");
expect(
  "closed_window_active",
  classifyTimeWindow("2026-10-12 22:00:00.0", "2026-10-18 21:59:00.0", ref) === "time_active"
);

const dimensionOnly = { linkName: "120x600", linkType: "Banner", relationshipStatus: "joined", clickUrl: "x" };
expect("dimension_only_unclassified", classifyBannerRole(dimensionOnly) === "U_unknown_unclassified_banner");

const yves = {
  linkId: "17365226",
  advertiserId: "5124968",
  linkName: "Dny Yves-rocher_1+1 na vybrané produkty",
  linkType: "Banner",
  destination: "https://www.yves-rocher.cz/1-plus-1/c/1plus1-yr-days?cmp=YRDAYS26",
  clickUrl: "https://example.test/click",
  couponCode: "YRDAYS26",
  promotionStartDate: "2026-10-12 22:00:00.0",
  promotionEndDate: "2026-10-18 21:59:00.0",
  targetedCountries: "CZ",
  description: "Dny Yves-rocher_1+1 na vybrané produkty",
  adContent: "",
  relationshipStatus: "joined",
};
expect("yves_coupon_role", classifyBannerRole(yves) === "C_coupon_campaign_banner");
const yvesValidity = assessActionValidity("C_coupon_campaign_banner", yves, ref);
expect("yves_closed_window_active", yvesValidity.state === "documented_active_in_window");

const openEndLink = {
  linkName: "Sale banner",
  description: "20 % off everything today",
  promotionStartDate: "2026-01-01 00:00:00.0",
  promotionEndDate: "",
  relationshipStatus: "joined",
};
const openVal = assessActionValidity("B_specific_discount_action_banner", openEndLink, ref);
expect("open_end_partial_missing_end", openVal.state === "partially_documented_period");
expect("open_end_unverified_at_reference", openVal.currentValidityAtReference === "unverified");
expect("open_end_kind_missing_end", openVal.partialEndKind === "missing_end");

const untilNotice = {
  linkName: "Promo",
  description: "Sleva 15 % platí do odvolání",
  promotionStartDate: "2026-01-01 00:00:00.0",
  promotionEndDate: "",
};
const noticeVal = assessActionValidity("B_specific_discount_action_banner", untilNotice, ref);
expect("until_notice_partial", noticeVal.partialEndKind === "documented_until_notice");
expect("until_notice_still_unverified_now", noticeVal.currentValidityAtReference === "unverified");

expect(
  "detect_until_stock",
  detectDocumentedOpenEndKind({ description: "Akce do vyprodání zásob", linkName: "" })?.partialEndKind ===
    "documented_until_stock"
);

const base = { advertiserId: "1", targetedCountries: "CZ", couponCode: "", promotionStartDate: "", promotionEndDate: "", description: "x", adContent: "", linkName: "728x90" };
const a = { ...base, destination: "https://shop.example/sale?campaign=A&utm_source=x" };
const b = { ...base, destination: "https://shop.example/sale?campaign=B&utm_source=y" };
expect("different_campaign_different_strict", buildCreativeGroupingStrictKey(a) !== buildCreativeGroupingStrictKey(b));

const order1 = { ...base, destination: "https://shop.example/sale?b=2&a=1" };
const order2 = { ...base, destination: "https://shop.example/sale?a=1&b=2" };
expect(
  "param_order_stable_key",
  destinationStorefrontGroupingSegment(order1.destination) === destinationStorefrontGroupingSegment(order2.destination)
);
expect(
  "strict_key_ignores_utm_only",
  buildCreativeGroupingStrictKey({ ...base, destination: "https://shop.example/sale?cmp=Z&utm_medium=email" }) ===
    buildCreativeGroupingStrictKey({ ...base, destination: "https://shop.example/sale?cmp=Z&utm_medium=social" })
);

expect(
  "campaign_value_case_distinct",
  destinationStorefrontCanonicalString("https://shop.example/p?campaign=ABC") !==
    destinationStorefrontCanonicalString("https://shop.example/p?campaign=abc")
);
expect(
  "encoded_value_boundary_distinct",
  destinationStorefrontKey("https://shop.example/p?a=1%26b%3D2") !== destinationStorefrontKey("https://shop.example/p?a=1&b=2")
);
expect(
  "path_case_distinct",
  destinationStorefrontGroupingSegment("https://shop.example/Sale") !== destinationStorefrontGroupingSegment("https://shop.example/sale")
);
expect(
  "repeated_param_value_order_distinct",
  destinationStorefrontKey("https://shop.example/p?tag=a&tag=b") !== destinationStorefrontKey("https://shop.example/p?tag=b&tag=a")
);

const variantA = { ...base, linkName: "728x90", description: "Summer promo 25 % off", promotionStartDate: "2026-01-01 00:00:00.0" };
const variantB = { ...base, linkName: "300x250", description: "Summer promo 25 % off", promotionStartDate: "2026-01-01 00:00:00.0" };
expect(
  "variant_group_same_estimate",
  buildCreativeVariantGroupingEstimateKey(variantA) === buildCreativeVariantGroupingEstimateKey(variantB)
);
expect(
  "strict_key_preserves_dimension_diff",
  buildCreativeGroupingStrictKey(variantA) !== buildCreativeGroupingStrictKey(variantB)
);

if (failures.length) {
  console.log(JSON.stringify({ IU_CJ_MEDIA_INVENTORY_SELFTEST: "FAIL", failures }));
  process.exit(1);
}
console.log(JSON.stringify({ IU_CJ_MEDIA_INVENTORY_SELFTEST: "OK", checks: 22 }));
