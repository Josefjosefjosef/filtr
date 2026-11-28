#!/usr/bin/env node
import { buildProductIdentityLedger } from "./iu-cj-affiliate-phase3z-product-identity-v50.mjs";

const ledger = buildProductIdentityLedger({
  fetchedRows: [
    { advertiserId: "1", productId: "P", productVariant: "v" },
    { advertiserId: "1", productId: "P", productVariant: "w" },
    { advertiserId: "1", productId: "P", productVariant: "v" },
  ],
  publishedDoc: {
    sections: [
      {
        products: [
          { advertiserId: "1", productId: "P", productVariant: "v" },
          { advertiserId: "1", productId: "P", productVariant: "w" },
        ],
      },
    ],
  },
  runId: "identity-variant",
});

const keys = ledger.rows.map((row) => row.compoundIdentity).sort();
if (ledger.accounting.uniqueIdentitiesInRun !== 2) {
  console.error("unique");
  process.exit(1);
}
if (keys.join(",") !== "1|P|v,1|P|w") {
  console.error(keys.join(","));
  process.exit(1);
}
const again = ledger.rows.find((row) => row.compoundIdentity === "1|P|v");
if (!again || again.occurrenceCount !== 2 || again.published !== true) {
  console.error("occurrence");
  process.exit(1);
}
console.log(JSON.stringify({
  PRODUCT_IDENTITY_VARIANT_SELFTEST: "PASS",
  unique: ledger.accounting.uniqueIdentitiesInRun,
  keys,
}));
