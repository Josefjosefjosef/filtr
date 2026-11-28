import assert from "node:assert/strict";
import {
  productKey,
  reconcilePublishedProductEvidence,
} from "./iu-cj-affiliate-phase3z-product-evidence-v36.mjs";
import { REFRESH_RESULT } from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

assert.equal(productKey("A", "1"), "A|1");
assert.equal(productKey("A", "1", ""), "A|1");
assert.equal(productKey("A", "1", "v"), "A|1|v");

const nowIso = "2026-11-26T12:00:00.000Z";
const { doc: out, evidence } = reconcilePublishedProductEvidence({
  nowIso,
  doc: {
    sections: [
      {
        sectionKey: "aff-nabytek",
        products: [
          {
            advertiserId: "111",
            productId: "SAME",
            productVariant: "v",
            currency: "EUR",
            currentPrice: 10,
          },
          {
            advertiserId: "111",
            productId: "SAME",
            productVariant: "w",
            currency: "EUR",
            currentPrice: 12,
            lastSuccessfulRefreshAt: "2026-11-01T00:00:00.000Z",
          },
        ],
      },
    ],
  },
  coverageByKey: new Map([
    [
      "111|SAME|v",
      {
        refreshResult: REFRESH_RESULT.SUCCESSFULLY_REFRESHED,
        refreshReason: "productId_matched_in_scan_window",
        lastSuccessfulRefreshAt: "2026-11-04T01:00:00.000Z",
      },
    ],
  ]),
  refreshedByKey: new Map([["111|SAME|v", { advertiserId: "111", productId: "SAME", productVariant: "v" }]]),
});

const products = out.sections[0].products;
assert.equal(products.length, 2);
assert.equal(products[0].productKey, "111|SAME|v");
assert.equal(products[1].productKey, "111|SAME|w");
assert.notEqual(products[0].productKey, products[1].productKey);
assert.equal(products[0].lastSuccessfulRefreshAt, nowIso);
assert.equal(products[1].lastSuccessfulRefreshAt, "2026-11-01T00:00:00.000Z");
assert.equal(products[0].currency, "EUR");
assert.equal(products[1].currency, "EUR");
assert.equal(evidence.publishedCatalog.uniqueKeys, 2);

process.stdout.write("IU_CJ_EVIDENCE_VARIANT_KEY_SELFTEST PASS\n");
