import assert from "node:assert/strict";
import { publishedCoverageKey } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";
import { updateCumulativeCoverage } from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

const nowIso = "2026-11-26T23:00:00.000Z";
const rows = [
  { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" },
  { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR" },
  { advertiserId: "111", productId: "ONLY", currency: "EUR" },
];
assert.deepEqual(rows.map((row) => publishedCoverageKey(row)), ["111|SAME|v", "111|SAME|w", "111|ONLY"]);
assert.equal(publishedCoverageKey({
  advertiserId: "111",
  productId: "SAME",
  productVariant: "v",
  sourceIdentity: "111|SAME",
  currency: "EUR",
}), "111|SAME|v");
assert.equal(publishedCoverageKey({
  advertiserId: "111",
  productId: "SAME",
  productVariant: "v",
  sourceIdentity: "111|SAME|v",
}), "111|SAME|v");
assert.equal(publishedCoverageKey({
  advertiserId: "111",
  productId: "ONLY",
  sourceIdentity: "111|ONLY",
}), "111|ONLY");

const cumulative = updateCumulativeCoverage(null, {
  nowIso,
  publishedKeys: rows.map((row) => publishedCoverageKey(row)),
  matchedKeys: ["111|SAME|v"],
});
assert.equal(cumulative.lastPass.publishedUnique, 3);
assert.equal(cumulative.lastPass.passMatchedUnique, 1);
assert.equal(cumulative.lastPass.cumulativeMatchedUnique, 1);
assert.equal(cumulative.everMatchedUniqueKeys.includes("111|SAME|v"), true);
assert.equal(cumulative.everMatchedUniqueKeys.includes("111|SAME|w"), false);
assert.equal(cumulative.everMatchedUniqueKeys.includes("111|SAME"), false);
assert.equal(rows[0].currency, "EUR");
assert.equal(rows[1].currency, "EUR");

process.stdout.write("IU_CJ_COVERAGE_PUBLISHED_VARIANT_SELFTEST PASS\n");
