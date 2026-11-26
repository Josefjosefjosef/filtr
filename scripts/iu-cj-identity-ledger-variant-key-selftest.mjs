import assert from "node:assert/strict";
import {
  buildProductIdentityLedger,
  identityCompoundKey,
} from "./iu-cj-affiliate-phase3z-product-identity-v50.mjs";

assert.equal(identityCompoundKey("111", "SAME"), "111|SAME");
assert.equal(identityCompoundKey("111", "SAME", "v"), "111|SAME|v");

const ledger = buildProductIdentityLedger({
  nowIso: "2026-11-26T23:00:00.000Z",
  runId: "run-variant",
  fetchedRows: [
    { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", feedId: "F1" },
    { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR", feedId: "F1" },
    { advertiserId: "111", productId: "ONLY", currency: "EUR", feedId: "F2" },
  ],
  publishedDoc: {
    sections: [
      {
        products: [
          { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" },
          { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR" },
        ],
      },
    ],
  },
});
assert.equal(ledger.accounting.uniqueIdentitiesInRun, 3);
assert.equal(ledger.accounting.publishedUnique, 2);
assert.equal(ledger.accounting.crossPartnerSameProductIdCount, 0);
const byKey = new Map(ledger.rows.map((row) => [row.compoundIdentity, row]));
assert.deepEqual(byKey.get("111|SAME|v").currencies, ["EUR"]);
assert.deepEqual(byKey.get("111|SAME|w").currencies, ["EUR"]);
assert.equal(byKey.get("111|SAME|v").productVariant, "v");
assert.equal(byKey.get("111|SAME|w").productVariant, "w");
assert.equal(byKey.get("111|ONLY").productVariant, null);
assert.equal(byKey.get("111|SAME|v").published, true);
assert.equal(byKey.get("111|ONLY").published, false);

process.stdout.write("IU_CJ_IDENTITY_LEDGER_VARIANT_KEY_SELFTEST PASS\n");
