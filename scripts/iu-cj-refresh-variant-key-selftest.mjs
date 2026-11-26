import assert from "node:assert/strict";
import {
  ATTEMPT_STATUS,
  missingRefreshIdentityKey,
  stampAttemptMetaOnDoc,
} from "./iu-cj-affiliate-phase3z-lkg-missing-refresh-attempt-v51-8.mjs";

assert.equal(missingRefreshIdentityKey({ advertiserId: "111", productId: "SAME" }), "111|SAME");
assert.equal(missingRefreshIdentityKey({ advertiserId: "111", productId: "SAME", productVariant: "v" }), "111|SAME|v");

const nowIso = "2026-11-26T12:00:00.000Z";
const doc = {
  sections: [
    {
      sectionKey: "aff-nabytek",
      products: [
        { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", currentPrice: 10 },
        {
          advertiserId: "111",
          productId: "SAME",
          productVariant: "w",
          currency: "EUR",
          currentPrice: 12,
          nextCheckAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    },
  ],
};

const stamped = stampAttemptMetaOnDoc(
  doc,
  [{ key: "111|SAME|v", status: ATTEMPT_STATUS.RETRY_SCHEDULED, attemptedAt: nowIso }],
  nowIso
);
const products = stamped.doc.sections[0].products;
assert.equal(stamped.stamped, 1);
assert.equal(products[0].refreshAttemptStatus, ATTEMPT_STATUS.RETRY_SCHEDULED);
assert.equal(products[1].refreshAttemptStatus, undefined);
assert.equal(products[1].nextCheckAt, "2026-11-01T00:00:00.000Z");
assert.equal(products[0].currency, "EUR");
assert.equal(products[1].currency, "EUR");
assert.notEqual(products[0].nextCheckAt, products[1].nextCheckAt);

process.stdout.write("IU_CJ_REFRESH_VARIANT_KEY_SELFTEST PASS\n");
