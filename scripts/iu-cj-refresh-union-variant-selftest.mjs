import assert from "node:assert/strict";
import { unionPublishedSectionsForRefresh } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const secondary = {
  liveEnabled: true,
  sections: [{
    sectionKey: "aff-nabytek",
    products: [
      { advertiserId: "111", productId: "SAME", productVariant: "v", currentPrice: 1, currency: "EUR", availability: "in stock" },
      { advertiserId: "111", productId: "SAME", productVariant: "w", currentPrice: 2, currency: "EUR", availability: "preorder" },
      { advertiserId: "222", productId: "SAME", currentPrice: 3, currency: "EUR", availability: "in stock" },
    ],
  }],
};
const primary = {
  liveEnabled: true,
  sections: [{
    sectionKey: "aff-nabytek",
    products: [
      { advertiserId: "111", productId: "SAME", productVariant: "v", currentPrice: 9, currency: "EUR", availability: "in stock" },
      { advertiserId: "111", productId: "ONLY", currentPrice: 4, currency: "EUR", availability: "backorder" },
    ],
  }],
};
const merged = unionPublishedSectionsForRefresh(primary, secondary);
const products = merged.sections.flatMap((section) => section.products);
const byKey = new Map(products.map((row) => {
  const variant = String(row.productVariant || "").trim();
  const key = String(row.advertiserId) + "|" + String(row.productId) + (variant ? "|" + variant : "");
  return [key, row];
}));
assert.equal(byKey.size, 4);
assert.equal(byKey.get("111|SAME|v").currentPrice, 9);
assert.equal(byKey.get("111|SAME|v").currency, "EUR");
assert.equal(byKey.get("111|SAME|w").currentPrice, 2);
assert.equal(byKey.get("111|SAME|w").availability, "preorder");
assert.equal(byKey.get("111|SAME|w").currency, "EUR");
assert.equal(byKey.get("111|ONLY").currentPrice, 4);
assert.equal(byKey.get("111|ONLY").availability, "backorder");
assert.equal(byKey.get("222|SAME").currentPrice, 3);
assert.equal(byKey.get("222|SAME").currency, "EUR");

process.stdout.write("IU_CJ_REFRESH_UNION_VARIANT_SELFTEST PASS\n");
