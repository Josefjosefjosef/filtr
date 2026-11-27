import assert from "node:assert/strict";
import { crossCategoryPlacementKey } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const first = { advertiserId: "222", offerId: "1001", currency: "EUR" };
const second = { advertiserId: "333", offerId: "1001", currency: "EUR" };
const repeat = { advertiserId: "222", offerId: "1001", currency: "EUR" };
assert.equal(crossCategoryPlacementKey(first), "222|1001");
assert.equal(crossCategoryPlacementKey(second), "333|1001");
assert.notEqual(crossCategoryPlacementKey(first), crossCategoryPlacementKey(second));
assert.equal(crossCategoryPlacementKey(repeat), crossCategoryPlacementKey(first));
assert.equal(crossCategoryPlacementKey({ offerId: "1001" }), "1001");

const variantV = { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" };
const variantW = { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR" };
const only = { advertiserId: "111", productId: "ONLY", currency: "EUR", availability: "backorder" };
assert.equal(crossCategoryPlacementKey(variantV), "111|SAME|v");
assert.equal(crossCategoryPlacementKey(variantW), "111|SAME|w");
assert.notEqual(crossCategoryPlacementKey(variantV), crossCategoryPlacementKey(variantW));
assert.equal(crossCategoryPlacementKey(only), "111|ONLY");
assert.equal(variantV.currency, "EUR");
assert.equal(variantW.currency, "EUR");
assert.equal(only.currency, "EUR");

process.stdout.write("IU_CJ_CROSS_CATEGORY_IDENTITY_SELFTEST PASS\n");
