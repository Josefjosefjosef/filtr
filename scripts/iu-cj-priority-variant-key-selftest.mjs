import assert from "node:assert/strict";
import { planPriorityRefresh } from "./iu-cj-affiliate-phase3z-source-current-priority-refresh-v51-8.mjs";

const nowMs = Date.parse("2026-11-26T23:00:00.000Z");

function card(variant) {
  return {
    advertiserId: "111",
    productId: "SAME",
    productVariant: variant,
    currency: "EUR",
    currentPrice: 10,
    freshnessStatus: "UNVERIFIED",
  };
}

const doc = { sections: [{ sectionKey: "aff-nabytek", products: [card("v"), card("w")] }] };
const plan = planPriorityRefresh(doc, { nowMs, limit: 10 });
const ranked = plan.planned;
assert.equal(ranked.length, 2);
assert.equal(ranked[0].key, "111|SAME|v");
assert.equal(ranked[1].key, "111|SAME|w");
assert.equal(ranked[0].productVariant, "v");
assert.equal(ranked[1].productVariant, "w");
assert.equal(doc.sections[0].products[0].currency, "EUR");
assert.equal(doc.sections[0].products[1].currency, "EUR");
assert.equal(ranked.some((row) => row.key === "111|SAME"), false);

process.stdout.write("IU_CJ_PRIORITY_VARIANT_KEY_SELFTEST PASS\n");
