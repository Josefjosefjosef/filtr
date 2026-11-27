import assert from "node:assert/strict";
import {
  indexOffersByAdvertiser,
  reconProductKey,
} from "./iu-cj-affiliate-joined-partner-recon-export-v1.mjs";

assert.equal(reconProductKey("111", { productId: "SAME" }), "111|SAME");
assert.equal(reconProductKey("111", { productId: "SAME", productVariant: "v" }), "111|SAME|v");

const indexed = indexOffersByAdvertiser({
  sections: [
    {
      sectionKey: "aff-nabytek",
      products: [
        { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" },
        { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR" },
        { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" },
      ],
    },
  ],
});
const bucket = indexed.byAdv.get("111");
assert.equal(bucket.productKeys.size, 2);
assert.equal(bucket.productPlacements, 3);
assert.equal(bucket.productKeys.has("111|SAME|v"), true);
assert.equal(bucket.productKeys.has("111|SAME|w"), true);
assert.equal(bucket.productKeys.has("111|SAME"), false);

process.stdout.write("IU_CJ_RECON_VARIANT_KEY_SELFTEST PASS\n");
