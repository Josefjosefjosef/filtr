import assert from "node:assert/strict";
import { finalSectionProductKey } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const rows = [
  { advertiserId: "111", productId: "SAME", productVariant: "v", currentPrice: 9, currency: "EUR", publicationReady: true },
  { advertiserId: "111", productId: "SAME", productVariant: "w", currentPrice: 2, currency: "EUR", availability: "preorder", publicationReady: true },
  { advertiserId: "111", productId: "ONLY", currentPrice: 4, currency: "EUR", availability: "backorder", publicationReady: true },
];
const unique = new Set();
for (const row of rows) {
  const key = finalSectionProductKey(row);
  if (key === "|") continue;
  if (row.publicationReady === false) continue;
  unique.add(key);
}
assert.equal(unique.size, 3);
assert.equal(unique.has("111|SAME|v"), true);
assert.equal(unique.has("111|SAME|w"), true);
assert.equal(unique.has("111|ONLY"), true);
assert.equal(unique.has("111|SAME"), false);
assert.equal(finalSectionProductKey({ advertiserId: "", productId: "" }), "|");
assert.equal(rows[0].currency, "EUR");
assert.equal(rows[1].currency, "EUR");
assert.equal(rows[1].availability, "preorder");
assert.equal(rows[2].availability, "backorder");

process.stdout.write("IU_CJ_STATS_VARIANT_UNIQUE_SELFTEST PASS\n");
