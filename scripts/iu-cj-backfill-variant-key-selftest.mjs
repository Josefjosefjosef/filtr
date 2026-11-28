import assert from "node:assert/strict";
import { backfillAvailabilityFromPrevious } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const doc = {
  sections: [{
    products: [
      { advertiserId: "111", productId: "SAME", productVariant: "v", availability: null, currency: "EUR", currentPrice: 9 },
      { advertiserId: "111", productId: "SAME", productVariant: "w", availability: null, currency: "EUR", currentPrice: 2 },
      { advertiserId: "111", productId: "ONLY", availability: null, currency: "EUR", currentPrice: 4 },
    ],
  }],
};
const previous = {
  sections: [{
    products: [
      { advertiserId: "111", productId: "SAME", productVariant: "v", availability: "in stock", currency: "EUR" },
      { advertiserId: "111", productId: "SAME", productVariant: "w", availability: "preorder", currency: "EUR" },
      { advertiserId: "111", productId: "ONLY", availability: "backorder", currency: "EUR" },
      { advertiserId: "111", productId: "SAME", availability: "in stock", currency: "EUR" },
    ],
  }],
};
const result = backfillAvailabilityFromPrevious(doc, previous, { nowMs: Date.parse("2026-11-26T23:00:00.000Z") });
const rows = doc.sections[0].products;
assert.equal(result.backfilled, 3);
assert.equal(rows[0].availability, "in stock");
assert.equal(rows[0].currency, "EUR");
assert.equal(rows[1].availability, "preorder");
assert.equal(rows[1].currency, "EUR");
assert.equal(rows[2].availability, "backorder");
assert.equal(rows[2].currency, "EUR");

const variantOnly = {
  sections: [{ products: [{ advertiserId: "111", productId: "SAME", productVariant: "v", availability: null, currency: "EUR" }] }],
};
const productLevel = {
  sections: [{ products: [{ advertiserId: "111", productId: "SAME", availability: "in stock", currency: "EUR" }] }],
};
const blocked = backfillAvailabilityFromPrevious(variantOnly, productLevel, { nowMs: Date.parse("2026-11-26T23:00:00.000Z") });
assert.equal(blocked.backfilled, 0);
assert.equal(variantOnly.sections[0].products[0].availability, null);
assert.equal(variantOnly.sections[0].products[0].currency, "EUR");

process.stdout.write("IU_CJ_BACKFILL_VARIANT_KEY_SELFTEST PASS\n");
