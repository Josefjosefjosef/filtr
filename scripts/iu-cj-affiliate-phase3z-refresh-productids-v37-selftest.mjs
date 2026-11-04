#!/usr/bin/env node
/**
 * V37 — productIds refresh capacity + cumulative coverage (offline; no PAT).
 */
import {
  REFRESH_MODE,
  REFRESH_RESULT,
  buildRefreshCoverageLedger,
  emptyCumulativeCoverage,
  estimateFullCoverageHours,
  updateCumulativeCoverage,
} from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";
import { buildPublisherProductsQuery } from "./iu-cj-affiliate-phase2-product-api.mjs";
import { CJ_CALL_MIN_INTERVAL_MS } from "./iu-cj-affiliate-phase1-lib.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const q = buildPublisherProductsQuery("7991692", "4883722", "101883843", 25, {
  productIds: ["p1", "p2", "p3"],
});
assert(/productIds:\s*\["p1",\s*"p2",\s*"p3"\]/.test(q), "productIds in GraphQL");

const keys = [
  { advertiserId: "DEEP", productId: "x1" },
  { advertiserId: "DEEP", productId: "x2" },
  { advertiserId: "DEEP", productId: "miss" },
];
const matchedKeys = new Set(["DEEP|x1", "DEEP|x2"]);
const ledger = buildRefreshCoverageLedger({
  keys,
  matchedKeys,
  scannedAdvertisers: new Set(["DEEP"]),
  errorAdvertisers: new Set(),
  prevByKey: new Map(),
  nowIso: "2026-11-04T08:00:00.000Z",
  refreshMode: REFRESH_MODE.PRODUCT_IDS,
});
assert(ledger.counts.successfullyRefreshed === 2, "2 matched via productIds");
assert(ledger.counts.notInScanWindow === 1, "1 miss kept as window/miss status");
const miss = ledger.rows.find((r) => r.productId === "miss");
assert(miss.refreshReason.includes("productIds_query_miss"), "honest productIds miss reason");
assert(miss.refreshResult === REFRESH_RESULT.NOT_IN_SCAN_WINDOW, "miss not deleted");

const cap = estimateFullCoverageHours({
  mode: REFRESH_MODE.PRODUCT_IDS,
  advertisers: 133,
  publishedProducts: 3284,
  productIdsBatchSize: 100,
  callIntervalMs: CJ_CALL_MIN_INTERVAL_MS,
});
assert(cap.mode === REFRESH_MODE.PRODUCT_IDS, "capacity mode");
assert(cap.passesNeeded === 1, "productIds needs 1 pass");
assert(cap.meetsAllProductsEvery3h === true, "133 calls @2.6s fits in 3h");
assert(/productIds/i.test(cap.caveat), "productIds caveat");

const scanCap = estimateFullCoverageHours({
  mode: REFRESH_MODE.SCAN_WINDOW,
  advertisers: 133,
  maxPartnerCatalogDepth: 5000,
  refreshPageSize: 100,
  refreshMaxPages: 5,
  callIntervalMs: CJ_CALL_MIN_INTERVAL_MS,
});
assert(scanCap.meetsAllProductsEvery3h === false, "scan window still cannot claim 3h full");

const t0 = "2026-11-04T06:00:00.000Z";
const published = ["A|1", "A|2", "B|1", "B|2"];
let cum = emptyCumulativeCoverage();
cum = updateCumulativeCoverage(cum, {
  nowIso: t0,
  publishedKeys: published,
  matchedKeys: ["A|1"],
  refreshMode: REFRESH_MODE.PRODUCT_IDS,
  apiRequests: 2,
});
assert(cum.horizons["1pass"].status === "MEASURED", "1pass measured");
assert(cum.horizons["3h"].status === "PENDING_OBSERVATION", "3h pending after first pass");
assert(cum.lastPass.passCoveragePct === 25, "25% first pass");

cum = updateCumulativeCoverage(cum, {
  nowIso: "2026-11-04T07:00:00.000Z",
  publishedKeys: published,
  matchedKeys: ["A|1", "A|2", "B|1"],
  refreshMode: REFRESH_MODE.PRODUCT_IDS,
});
assert(cum.lastPass.cumulativeCoveragePct === 75, "cumulative 3/4");
assert(cum.horizons["3h"].status === "PENDING_OBSERVATION", "still pending <3h");

cum = updateCumulativeCoverage(cum, {
  nowIso: "2026-11-04T09:30:00.000Z",
  publishedKeys: published,
  matchedKeys: ["A|1", "A|2", "B|1", "B|2"],
  refreshMode: REFRESH_MODE.PRODUCT_IDS,
});
assert(cum.horizons["3h"].status === "MEASURED", "3h measured after elapsed");
assert(cum.horizons["3h"].cumulativeCoveragePct === 100, "full cumulative at 3h horizon");
assert(cum.horizons["6h"].status === "PENDING_OBSERVATION", "6h still pending");

// Starvation / deep catalog: productIds capacity independent of 82k totalCount.
assert(cap.windowProducts == null, "no scan window in productIds capacity");

console.log(
  JSON.stringify(
    {
      IU_CJ_REFRESH_PRODUCTIDS_V37_SELFTEST: "PASS",
      capacityProductIds: cap,
      capacityScanWindow: {
        meetsAllProductsEvery3h: scanCap.meetsAllProductsEvery3h,
        passesNeeded: scanCap.passesNeeded,
      },
      cumulative: {
        everMatchedCount: cum.everMatchedCount,
        horizons: {
          "1pass": cum.horizons["1pass"].status,
          "3h": cum.horizons["3h"].status,
          "6h": cum.horizons["6h"].status,
        },
      },
    },
    null,
    2
  )
);
