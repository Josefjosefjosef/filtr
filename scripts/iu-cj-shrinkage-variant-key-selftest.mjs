import assert from "node:assert/strict";
import { reconcileCatalogShrinkage } from "./iu-cj-affiliate-phase3z-catalog-shrinkage-reconcile-v51-8.mjs";

const nowIso = "2026-11-26T23:00:00.000Z";

function doc(products) {
  return { updatedAt: nowIso, sections: [{ sectionKey: "aff-nabytek", products }] };
}

function row(variant, currency) {
  return {
    advertiserId: "111",
    productId: "SAME",
    productVariant: variant,
    currency,
    currentPrice: 10,
    availability: "in stock",
  };
}

const both = reconcileCatalogShrinkage(doc([row("v", "EUR"), row("w", "EUR")]), doc([row("v", "EUR"), row("w", "EUR")]), { nowIso });
assert.equal(both.at, nowIso);
assert.equal(both.prev.unique, 2);
assert.equal(both.next.unique, 2);
assert.equal(both.deltas.removed, 0);
assert.equal(both.deltas.added, 0);

const dropped = reconcileCatalogShrinkage(doc([row("v", "EUR"), row("w", "EUR")]), doc([row("v", "EUR")]), { nowIso });
assert.equal(dropped.deltas.removed, 1);
assert.equal(dropped.removed[0].key, "111|SAME|w");
assert.equal(dropped.removed[0].currency, "EUR");
assert.equal(dropped.deltas.uniqueDelta, -1);

const currency = reconcileCatalogShrinkage(doc([row("v", "EUR")]), doc([row("v", "CZK")]), { nowIso });
assert.equal(currency.deltas.updated, 1);
assert.equal(currency.updatedSample[0].changes.includes("currency"), true);
assert.equal(currency.updatedSample[0].prev.currency, "EUR");
assert.equal(currency.updatedSample[0].next.currency, "CZK");

process.stdout.write("IU_CJ_SHRINKAGE_VARIANT_KEY_SELFTEST PASS\n");
