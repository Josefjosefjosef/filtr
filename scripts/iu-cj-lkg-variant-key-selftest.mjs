import assert from "node:assert/strict";
import {
  collectUniqueProductMap,
  compoundProductKey,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

assert.equal(compoundProductKey("111", "SAME", "v"), "111|SAME|v");
assert.equal(compoundProductKey("111", "SAME", "w"), "111|SAME|w");
assert.equal(compoundProductKey("111", "SAME"), "111|SAME");
assert.equal(compoundProductKey("111", "ONLY", "  "), "111|ONLY");

const doc = {
  sections: [{
    sectionKey: "aff-nabytek",
    products: [
      { advertiserId: "111", productId: "SAME", productVariant: "v", currentPrice: 9, currency: "EUR", publicationReady: true },
      { advertiserId: "111", productId: "SAME", productVariant: "w", currentPrice: 2, currency: "EUR", availability: "preorder", publicationReady: true },
      { advertiserId: "111", productId: "ONLY", currentPrice: 4, currency: "EUR", availability: "backorder", publicationReady: true },
    ],
  }],
};
const map = collectUniqueProductMap(doc);
assert.equal(map.size, 3);
assert.equal(map.get("111|SAME|v").product.currentPrice, 9);
assert.equal(map.get("111|SAME|v").product.currency, "EUR");
assert.equal(map.get("111|SAME|w").product.currentPrice, 2);
assert.equal(map.get("111|SAME|w").product.availability, "preorder");
assert.equal(map.get("111|SAME|w").product.currency, "EUR");
assert.equal(map.get("111|ONLY").product.availability, "backorder");
assert.equal(map.get("111|ONLY").product.currency, "EUR");
assert.equal(map.has("111|SAME"), false);

process.stdout.write("IU_CJ_LKG_VARIANT_KEY_SELFTEST PASS\n");
