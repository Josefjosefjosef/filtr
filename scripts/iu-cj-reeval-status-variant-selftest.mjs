#!/usr/bin/env node
import assert from "node:assert/strict";
import { reevalProductIdRef, reevalProductStatusRow } from "./iu-cj-reeval-product-status-row.mjs";

const named = reevalProductStatusRow({
  productId: "P",
  productVariant: "v",
  eligibility: "ineligible",
  eligibilityReason: "scope",
});
assert.equal(named.productVariant, "v");
assert.equal(named.eligibility, "ineligible");
assert.equal(named.reason, "scope");
assert.equal(reevalProductIdRef({ productId: "P", productVariant: "v" }), "P|v");
assert.equal(reevalProductIdRef({ productId: "P", productVariant: "w" }), "P|w");

const bare = reevalProductStatusRow({ productId: "P", eligibility: "unknown", eligibilityReason: "x" });
assert.equal(Object.hasOwn(bare, "productVariant"), false);
assert.equal(reevalProductIdRef({ productId: "P" }), "P");
assert.notEqual(reevalProductIdRef({ productId: "P", productVariant: "v" }), reevalProductIdRef({ productId: "P", productVariant: "w" }));

console.log(JSON.stringify({
  REEVAL_STATUS_VARIANT_SELFTEST: "PASS",
  named: reevalProductIdRef({ productId: "P", productVariant: "v" }),
  bare: reevalProductIdRef({ productId: "P" }),
}));
