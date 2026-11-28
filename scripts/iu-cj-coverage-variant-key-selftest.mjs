import assert from "node:assert/strict";
import {
  REFRESH_RESULT,
  buildRefreshCoverageLedger,
  coverageIdentityKey,
} from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

assert.equal(coverageIdentityKey({ advertiserId: "111", productId: "SAME" }), "111|SAME");
assert.equal(coverageIdentityKey({ advertiserId: "111", productId: "SAME", productVariant: "v" }), "111|SAME|v");

const nowIso = "2026-11-26T23:00:00.000Z";
const ledger = buildRefreshCoverageLedger({
  nowIso,
  keys: [
    { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", sectionKey: "aff-nabytek" },
    { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR", sectionKey: "aff-nabytek" },
    { advertiserId: "111", productId: "ONLY", currency: "EUR", sectionKey: "aff-nabytek" },
  ],
  matchedKeys: new Set(["111|SAME|v", "111|ONLY"]),
  scannedAdvertisers: new Set(["111"]),
  prevByKey: new Map([
    ["111|SAME|w", { lastSuccessfulRefreshAt: "2026-11-01T00:00:00.000Z" }],
  ]),
});
assert.equal(ledger.rows.length, 3);
const byKey = new Map(ledger.rows.map((row) => [row.sourceIdentity, row]));
const variantV = byKey.get("111|SAME|v");
const variantW = byKey.get("111|SAME|w");
const only = byKey.get("111|ONLY");
assert.equal(variantV.refreshResult, REFRESH_RESULT.SUCCESSFULLY_REFRESHED);
assert.equal(variantV.lastSuccessfulRefreshAt, nowIso);
assert.equal(variantV.currency, "EUR");
assert.equal(variantW.refreshResult, REFRESH_RESULT.NOT_IN_SCAN_WINDOW);
assert.equal(variantW.lastSuccessfulRefreshAt, "2026-11-01T00:00:00.000Z");
assert.equal(variantW.currency, "EUR");
assert.equal(variantW.productVariant, "w");
assert.equal(only.refreshResult, REFRESH_RESULT.SUCCESSFULLY_REFRESHED);
assert.equal(only.productVariant, null);
assert.equal(only.currency, "EUR");

process.stdout.write("IU_CJ_COVERAGE_VARIANT_KEY_SELFTEST PASS\n");
