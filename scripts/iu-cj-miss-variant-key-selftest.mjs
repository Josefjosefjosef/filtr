import assert from "node:assert/strict";
import {
  MISS_DECISION,
  buildMissProductAudit,
  missIdentityKey,
} from "./iu-cj-affiliate-phase3z-miss-products-v38.mjs";
import { applyMissDecisionsToDoc } from "./iu-cj-affiliate-phase3z-miss-reverify-v38.mjs";

assert.equal(missIdentityKey({ advertiserId: "111", productId: "SAME" }), "111|SAME");
assert.equal(missIdentityKey({ advertiserId: "111", productId: "SAME", productVariant: "v" }), "111|SAME|v");

const nowIso = "2026-11-26T23:00:00.000Z";
const audit = buildMissProductAudit({
  nowIso,
  hideAfterHours: 24,
  hideAfterConsecutiveMisses: 3,
  products: [
    {
      advertiserId: "111",
      productId: "SAME",
      productVariant: "v",
      currency: "EUR",
      currentPrice: 10,
      lastSuccessfulRefreshAt: "2026-11-01T00:00:00.000Z",
      refreshResult: "NOT_IN_SCAN_WINDOW",
    },
    {
      advertiserId: "111",
      productId: "SAME",
      productVariant: "w",
      currency: "EUR",
      currentPrice: 12,
      lastSuccessfulRefreshAt: "2026-11-26T22:00:00.000Z",
      refreshResult: "NOT_IN_SCAN_WINDOW",
    },
  ],
  prevMissByKey: new Map([["111|SAME|v", { consecutiveMisses: 2 }]]),
});
assert.equal(audit.rows.length, 2);
const byVariant = new Map(audit.rows.map((row) => [row.productVariant, row]));
assert.equal(byVariant.get("v").sourceIdentity, "111|SAME|v");
assert.equal(byVariant.get("w").sourceIdentity, "111|SAME|w");
assert.equal(byVariant.get("v").decision, MISS_DECISION.TEMPORARILY_HIDE);
assert.equal(byVariant.get("w").decision, MISS_DECISION.KEEP_PENDING);

const applied = applyMissDecisionsToDoc(
  {
    sections: [
      {
        sectionKey: "aff-nabytek",
        products: [
          { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", currentPrice: 10, publicationReady: true },
          { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR", currentPrice: 12, publicationReady: true },
        ],
      },
    ],
  },
  audit
);
const products = applied.doc.sections[0].products;
assert.equal(products[0].priceHidden, true);
assert.equal(products[0].publicationReady, false);
assert.equal(products[0].currency, "EUR");
assert.equal(products[1].priceHidden, undefined);
assert.equal(products[1].publicationReady, true);
assert.equal(products[1].currency, "EUR");
assert.equal(products[1].productVariant, "w");

process.stdout.write("IU_CJ_MISS_VARIANT_KEY_SELFTEST PASS\n");
