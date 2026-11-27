import assert from "node:assert/strict";
import {
  appendDurablePriceHistory,
  compoundIdentity,
  makePriceEventKey,
} from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";

assert.equal(compoundIdentity("111", "SAME"), "111|SAME");
assert.equal(compoundIdentity("111", "SAME", "v"), "111|SAME|v");

const nowIso = "2026-11-26T23:00:00.000Z";
const price = (variant) => ({
  advertiserId: "111",
  productId: "SAME",
  productVariant: variant,
  currency: "EUR",
  previousNormalizedPrice: "10.00",
  currentNormalizedPrice: "12.00",
  previousMinorUnits: 1000,
  currentMinorUnits: 1200,
  changeClassification: "PRICE_CHANGED",
});

const doc = appendDurablePriceHistory(null, {
  nowIso,
  runId: "run-variant",
  priceChanges: [price("v"), price("w"), price("")],
  availabilityChanges: [
    { advertiserId: "111", productId: "SAME", productVariant: "v", previousAvailability: "in stock", currentAvailability: "low" },
    { advertiserId: "111", productId: "SAME", productVariant: "w", previousAvailability: "in stock", currentAvailability: "low" },
  ],
});

assert.equal(doc.events.length, 3);
const byVariant = new Map(doc.events.map((event) => [event.productVariant, event]));
const variantV = byVariant.get("v");
const variantW = byVariant.get("w");
const variantNone = byVariant.get(null);
assert.equal(variantV.currency, "EUR");
assert.equal(variantW.currency, "EUR");
assert.equal(variantNone.currency, "EUR");
assert.notEqual(variantV.eventKey, variantW.eventKey);
assert.equal(variantV.compoundIdentity, "111|SAME|v");
assert.equal(variantW.compoundIdentity, "111|SAME|w");
assert.equal(variantNone.compoundIdentity, "111|SAME");
assert.equal(variantNone.eventKey, makePriceEventKey(variantNone));
assert.equal(variantNone.eventKey.endsWith("::v"), false);
assert.equal(doc.availabilityEvents.length, 2);
assert.notEqual(doc.availabilityEvents[0].eventKey, doc.availabilityEvents[1].eventKey);

const again = appendDurablePriceHistory(doc, {
  nowIso,
  runId: "run-variant",
  priceChanges: [price("v")],
});
assert.equal(again.events.length, 3);

process.stdout.write("IU_CJ_PRICE_HISTORY_VARIANT_KEY_SELFTEST PASS\n");
