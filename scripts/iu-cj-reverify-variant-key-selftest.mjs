import assert from "node:assert/strict";
import {
  buildProductReverifyLedger,
  indexProductsByCompoundIdentity,
  reverifyIdentityKey,
} from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";

assert.equal(reverifyIdentityKey("111", "SAME"), "111|SAME");
assert.equal(reverifyIdentityKey("111", "SAME", "v"), "111|SAME|v");

const doc = {
  sections: [
    {
      sectionKey: "aff-nabytek",
      products: [
        { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", currentPrice: 10 },
        { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR", currentPrice: 12 },
        { advertiserId: "111", productId: "ONLY", currency: "EUR", currentPrice: 8 },
      ],
    },
  ],
};
const ledger = buildProductReverifyLedger({ doc, nowIso: "2026-11-26T23:00:00.000Z", runId: "run-variant" });
const identities = ledger.rows.map((row) => row.compoundIdentity);
assert.deepEqual(identities, ["111|SAME|v", "111|SAME|w", "111|ONLY"]);
assert.equal(ledger.rows[0].currency, "EUR");
assert.equal(ledger.rows[1].currency, "EUR");
assert.equal(ledger.rows[0].productVariant, "v");
assert.equal(ledger.rows[1].productVariant, "w");
assert.equal(ledger.rows[2].productVariant, null);

const indexed = indexProductsByCompoundIdentity(doc);
assert.equal(indexed.size, 3);
assert.equal(indexed.get("111|SAME|v").currentPrice, 10);
assert.equal(indexed.get("111|SAME|w").currentPrice, 12);

process.stdout.write("IU_CJ_REVERIFY_VARIANT_KEY_SELFTEST PASS\n");
