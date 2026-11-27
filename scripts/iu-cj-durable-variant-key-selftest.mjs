import assert from "node:assert/strict";
import {
  evaluatePublicPopulationGates,
  mergeIntoDurableCatalog,
} from "./iu-cj-affiliate-phase3z-durable-catalog-v51.mjs";

const nowIso = "2026-11-26T23:00:00.000Z";
const url = "https://www.kqzyfj.com/click-101883843-1001";
const merged = mergeIntoDurableCatalog(null, [
  { advertiserId: "111", productId: "SAME", productVariant: "v", currentPrice: 9, currency: "EUR", availability: "in stock", affiliateUrl: url },
  { advertiserId: "111", productId: "SAME", productVariant: "w", currentPrice: 2, currency: "EUR", availability: "preorder", affiliateUrl: url },
  { advertiserId: "111", productId: "ONLY", currentPrice: 4, currency: "EUR", availability: "backorder", affiliateUrl: url },
], { nowIso });
const products = merged.doc?.products || merged.products;
assert.ok(products["111|SAME|v"]);
assert.ok(products["111|SAME|w"]);
assert.ok(products["111|ONLY"]);
assert.equal(products["111|SAME"], undefined);
assert.equal(products["111|SAME|v"].currentPrice, 9);
assert.equal(products["111|SAME|v"].currency, "EUR");
assert.equal(products["111|SAME|v"].productVariant, "v");
assert.equal(products["111|SAME|w"].currentPrice, 2);
assert.equal(products["111|SAME|w"].availability, "preorder");
assert.equal(products["111|SAME|w"].currency, "EUR");
assert.equal(products["111|ONLY"].availability, "backorder");
assert.equal(products["111|ONLY"].currency, "EUR");

const population = evaluatePublicPopulationGates({ sections: [] }, {
  sections: [{
    products: [
      { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", publicationReady: true, publicOffer: true },
      { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR", availability: "preorder", publicationReady: true, publicOffer: true },
      { advertiserId: "111", productId: "ONLY", currency: "EUR", availability: "backorder", publicationReady: true, publicOffer: true },
    ],
  }],
}, { maxGrowthAbs: 10, maxGrowthRatio: 1 });
assert.equal(population.added, 3);
assert.equal(population.growth, 3);

process.stdout.write("IU_CJ_DURABLE_VARIANT_KEY_SELFTEST PASS\n");
