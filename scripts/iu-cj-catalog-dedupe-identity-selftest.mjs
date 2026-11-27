import assert from "node:assert/strict";
import { catalogDedupeKey } from "./iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs";

const base = {
  dataSource: "feed",
  partnerId: "111",
  productId: "SAME",
  offerId: "offer-1",
  offerType: "product",
  productVariant: "v",
  currency: "EUR",
};

const otherAdvertiser = catalogDedupeKey({ ...base, partnerId: "222" });
const otherProduct = catalogDedupeKey({ ...base, productId: "OTHER" });
const otherVariant = catalogDedupeKey({ ...base, productVariant: "w" });
const otherCurrency = catalogDedupeKey({ ...base, currency: "CZK" });
const same = catalogDedupeKey({ ...base });

assert.notEqual(catalogDedupeKey(base), otherAdvertiser);
assert.notEqual(catalogDedupeKey(base), otherProduct);
assert.notEqual(catalogDedupeKey(base), otherVariant);
assert.notEqual(catalogDedupeKey(base), otherCurrency);
assert.equal(catalogDedupeKey(base), same);
assert.equal(catalogDedupeKey(base).includes("EUR"), true);
assert.equal(otherCurrency.endsWith("|CZK"), true);
assert.equal(catalogDedupeKey(base).includes("|222|"), false);

process.stdout.write("IU_CJ_CATALOG_DEDUPE_IDENTITY_SELFTEST PASS\n");
