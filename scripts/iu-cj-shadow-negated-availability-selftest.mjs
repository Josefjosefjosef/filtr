import assert from "node:assert/strict";
import { validateShadowCandidate } from "./iu-cj-affiliate-phase3z-growth-shadow-mode-v51-8.mjs";

function product(availability) {
  return {
    advertiserId: "111",
    productId: "p",
    affiliateUrl: "https://www.anrdoezrs.net/click-101883843-11",
    currentPrice: 10,
    currency: "EUR",
    availability,
  };
}

for (const availability of ["not in stock", "not available", "unavailable", "není skladem", "neni skladem", "out of stock", null, ""]) {
  const row = product(availability);
  const result = validateShadowCandidate(row);
  assert.equal(result.ok, false, String(availability));
  assert.equal(result.rejectReason, "AVAILABILITY_HOLD", String(availability));
  assert.equal(row.currency, "EUR", String(availability));
}

for (const availability of ["in stock", "preorder", "backorder"]) {
  const row = product(availability);
  const result = validateShadowCandidate(row);
  assert.equal(result.ok, true, availability);
  assert.equal(result.rejectReason, null, availability);
  assert.equal(row.currency, "EUR", availability);
}

process.stdout.write("IU_CJ_SHADOW_NEGATED_AVAILABILITY_SELFTEST PASS\n");
