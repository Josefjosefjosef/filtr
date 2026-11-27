import assert from "node:assert/strict";
import { applyPublishedRefreshToDoc } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const nowIso = "2026-11-26T23:00:00.000Z";
const doc = {
  sections: [{
    sectionKey: "aff-nabytek",
    products: [
      { advertiserId: "111", productId: "SAME", productVariant: "v", currentPrice: 1, currency: "EUR", availability: "in stock" },
      { advertiserId: "111", productId: "SAME", productVariant: "w", currentPrice: 2, currency: "EUR", availability: "preorder" },
      { advertiserId: "111", productId: "ONLY", currentPrice: 4, currency: "EUR", availability: "backorder" },
    ],
  }],
};
const productLevel = applyPublishedRefreshToDoc(doc, new Map([
  ["111|SAME", { currentPrice: 9, currency: "EUR", availability: "in stock" }],
  ["111|ONLY", { currentPrice: 8, currency: "EUR", availability: "backorder" }],
]), nowIso);
const rows = productLevel.doc.sections[0].products;
const byVariant = new Map(rows.map((row) => [String(row.productVariant || ""), row]));
assert.equal(byVariant.get("v").currentPrice, 1);
assert.equal(byVariant.get("v").currency, "EUR");
assert.equal(byVariant.get("v").refreshResult, "NOT_ATTEMPTED");
assert.equal(byVariant.get("w").currentPrice, 2);
assert.equal(byVariant.get("w").availability, "preorder");
assert.equal(byVariant.get("w").currency, "EUR");
assert.equal(byVariant.get("").currentPrice, 8);
assert.equal(byVariant.get("").currency, "EUR");
assert.equal(byVariant.get("").availability, "backorder");
assert.equal(byVariant.get("").refreshResult, "SUCCESSFULLY_REFRESHED");

const named = applyPublishedRefreshToDoc(doc, new Map([
  ["111|SAME|v", { currentPrice: 9, currency: "EUR", availability: "in stock" }],
]), nowIso);
const namedRows = new Map(named.doc.sections[0].products.map((row) => [String(row.productVariant || ""), row]));
assert.equal(namedRows.get("v").currentPrice, 9);
assert.equal(namedRows.get("v").currency, "EUR");
assert.equal(namedRows.get("v").refreshResult, "SUCCESSFULLY_REFRESHED");
assert.equal(namedRows.get("w").currentPrice, 2);
assert.equal(namedRows.get("w").currency, "EUR");
assert.equal(namedRows.get("w").availability, "preorder");
assert.equal(named.stats.merged, 1);

process.stdout.write("IU_CJ_REFRESH_APPLY_VARIANT_SELFTEST PASS\n");
