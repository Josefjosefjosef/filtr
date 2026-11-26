import assert from "node:assert/strict";
import {
  CONTINUITY_STATUS,
  compoundKey,
  reconstruct329Continuity,
} from "./iu-cj-affiliate-phase3z-329-continuity-v51-8.mjs";

assert.equal(compoundKey("111", "SAME"), "111|SAME");
assert.equal(compoundKey("111", "SAME", "v"), "111|SAME|v");

const collided = reconstruct329Continuity({
  original329: {
    rows: [{ compoundIdentity: "111|SAME", advertiserId: "111", productId: "SAME", decision: "KEEP_PENDING" }],
  },
  liveDoc: {
    sections: [
      {
        products: [
          { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", currentPrice: 10, publicationReady: true },
          { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR", currentPrice: 12, publicationReady: true },
        ],
      },
    ],
  },
});
const collision = collided.timelines[0];
assert.equal(collision.continuityStatus, CONTINUITY_STATUS.IDENTITY_COLLISION);
assert.deepEqual(collision.evidence.variants, ["v", "w"]);
assert.deepEqual(collision.evidence.currencies, ["EUR", "EUR"]);

const single = reconstruct329Continuity({
  original329: {
    rows: [{ compoundIdentity: "111|ONLY", advertiserId: "111", productId: "ONLY", decision: "KEEP_PENDING" }],
  },
  liveDoc: {
    sections: [
      {
        products: [
          { advertiserId: "111", productId: "ONLY", productVariant: "v", currency: "EUR", currentPrice: 10, publicationReady: true },
        ],
      },
    ],
  },
});
assert.equal(single.timelines[0].continuityStatus, CONTINUITY_STATUS.CURRENT_LIVE);
assert.deepEqual(single.timelines[0].evidence.currencies, ["EUR"]);

process.stdout.write("IU_CJ_CONTINUITY_VARIANT_KEY_SELFTEST PASS\n");
