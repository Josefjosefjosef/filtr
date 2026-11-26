import assert from "node:assert/strict";
import { auditLkgFromOffersDoc } from "./iu-cj-affiliate-phase3z-lkg-rootcause-audit-v51-8.mjs";

const nowMs = Date.parse("2026-11-26T23:00:00.000Z");

function held(variant) {
  return {
    advertiserId: "111",
    productId: "SAME",
    productVariant: variant,
    currency: "EUR",
    currentPrice: 10,
    lkgPublicHold: true,
  };
}

const audit = auditLkgFromOffersDoc(
  { sections: [{ sectionKey: "aff-nabytek", products: [held("v"), held("w"), held("")] }] },
  { nowMs }
);

assert.equal(audit.hold.length, 3);
const keys = audit.hold.map((row) => row.key);
assert.equal(keys.includes("111|SAME|v"), true);
assert.equal(keys.includes("111|SAME|w"), true);
assert.equal(keys.includes("111|SAME"), true);
assert.equal(new Set(keys).size, 3);
assert.equal(audit.hold.every((row) => row.currency === "EUR"), true);
assert.equal(audit.at, "2026-11-26T23:00:00.000Z");

process.stdout.write("IU_CJ_LKG_AUDIT_VARIANT_KEY_SELFTEST PASS\n");
