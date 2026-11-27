import assert from "node:assert/strict";
import { collectPublishedProductKeys } from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";

const keys = collectPublishedProductKeys({
  sections: [
    {
      sectionKey: "aff-nabytek",
      products: [
        { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", currentPrice: 10 },
        { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR", currentPrice: 12 },
        { advertiserId: "111", productId: "SAME", productVariant: "", currency: "EUR", currentPrice: 8 },
      ],
    },
  ],
});
assert.equal(keys.length, 3);
assert.equal(keys[0].productVariant, "v");
assert.equal(keys[1].productVariant, "w");
assert.equal(keys[2].productVariant, null);
assert.equal(keys[0].currency, "EUR");
assert.equal(keys[1].currency, "EUR");
assert.equal(keys[2].currency, "EUR");
const ids = keys.map((row) => row.advertiserId + "|" + row.productId + "|" + (row.productVariant || ""));
assert.deepEqual(ids, ["111|SAME|v", "111|SAME|w", "111|SAME|"]);

process.stdout.write("IU_CJ_PUBLISHED_VARIANT_KEY_SELFTEST PASS\n");
