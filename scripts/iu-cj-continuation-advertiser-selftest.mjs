import assert from "node:assert/strict";
import { proveContinuationBetweenRuns } from "./iu-cj-affiliate-phase3z-product-feed-checkpoint-v31.mjs";

const same = proveContinuationBetweenRuns(
  { advertiserId: "111", startedOffset: 1, nextOffset: 101, productIds: ["p1", "p2"] },
  { advertiserId: "111", startedOffset: 101, nextOffset: 201, productIds: ["p3", "p4"] },
);
assert.equal(same.ok, true);
assert.equal(same.sameAdvertiser, true);
assert.equal(same.proof, "CONTINUATION_PROVEN");
assert.equal(same.overlapProductIds, 0);

const other = proveContinuationBetweenRuns(
  { advertiserId: "111", startedOffset: 1, nextOffset: 101, productIds: ["p1"] },
  { advertiserId: "222", startedOffset: 101, nextOffset: 201, productIds: ["p9"] },
);
assert.equal(other.ok, false);
assert.equal(other.sameAdvertiser, false);
assert.equal(other.proof, "CONTINUATION_NOT_PROVEN");

const variants = proveContinuationBetweenRuns(
  {
    advertiserId: "111",
    startedOffset: 1,
    nextOffset: 3,
    productIds: [
      { productId: "SAME", productVariant: "v", currency: "EUR" },
      { productId: "ONLY" },
    ],
  },
  {
    advertiserId: "111",
    startedOffset: 3,
    nextOffset: 5,
    productIds: [{ productId: "SAME", productVariant: "w", currency: "EUR" }],
  },
);
assert.equal(variants.ok, true);
assert.equal(variants.overlapProductIds, 0);
assert.equal(variants.runACount, 2);
assert.equal(variants.runBCount, 1);

const repeated = proveContinuationBetweenRuns(
  {
    advertiserId: "111",
    startedOffset: 1,
    nextOffset: 3,
    productIds: [{ productId: "SAME", productVariant: "v", currency: "EUR" }],
  },
  {
    advertiserId: "111",
    startedOffset: 3,
    nextOffset: 5,
    productIds: [{ productId: "SAME", productVariant: "v", currency: "EUR" }],
  },
);
assert.equal(repeated.ok, false);
assert.equal(repeated.overlapProductIds, 1);

process.stdout.write("IU_CJ_CONTINUATION_ADVERTISER_SELFTEST PASS\n");
