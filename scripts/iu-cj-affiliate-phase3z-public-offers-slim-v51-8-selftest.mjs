#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  leanCumulativeCoverageForPublic,
  slimOffersPublicAuditSidecars,
} from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

const fatCum = {
  schema: "iu-cj-affiliate-phase3z-refresh-coverage-v37",
  everMatchedUniqueKeys: Array.from({ length: 5000 }, (_, i) => `a|${i}`),
  everMatchedCount: 5000,
  firstSeenAtByKey: Object.fromEntries(
    Array.from({ length: 5000 }, (_, i) => [`a|${i}`, "2026-11-01T00:00:00.000Z"]),
  ),
  horizons: { "48h": { status: "PENDING_OBSERVATION" } },
  snapshots: [{ at: "2026-11-22T00:00:00.000Z", publishedUnique: 1 }],
  lastPass: { publishedUnique: 1 },
};

const lean = leanCumulativeCoverageForPublic(fatCum);
assert.equal(lean.mapsOmitted, true);
assert.equal(lean.everMatchedCount, 5000);
assert.equal(lean.firstSeenKeyCount, 5000);
assert.equal(lean.everMatchedUniqueKeys, undefined);
assert.equal(lean.firstSeenAtByKey, undefined);
assert.ok(JSON.stringify(lean).length < 2000);

const fatDoc = {
  schema: "test",
  sections: [{ sectionKey: "aff-x", products: [{ id: "1" }] }],
  refreshCoverage: { cumulative: fatCum, byKey: { "a|1": {} }, partners: { "1": {} } },
  publicGrowthBudget: {
    cumulativeAddedSinceBaseline: 500,
    deferredDecisionLedgerSample: Array.from({ length: 200 }, (_, i) => ({ PRODUCT_ID: String(i) })),
  },
};
const slim = slimOffersPublicAuditSidecars(fatDoc);
assert.equal(slim.refreshCoverage.byKey, undefined);
assert.equal(slim.refreshCoverage.partners, undefined);
assert.equal(slim.refreshCoverage.cumulative.mapsOmitted, true);
assert.equal(slim.publicGrowthBudget.deferredDecisionLedgerSample.length, 50);
assert.equal(slim.publicGrowthBudget.deferredDecisionLedgerSampleTruncated, true);
assert.ok(JSON.stringify(slim).length < JSON.stringify(fatDoc).length / 10);

const labeled = slimOffersPublicAuditSidecars({
  sections: [
    {
      sectionKey: "aff-x",
      products: [
        { id: "recent", freshnessStatus: "FETCH_RECENT_SOURCE_AGE_UNKNOWN", sourceUpdatedAtStatus: "NOT_PROVIDED" },
        { id: "fresh", freshnessStatus: "SOURCE_FRESH", sourceUpdatedAtStatus: "PROVIDED", sourceFreshLabelForbidden: true },
        { id: "plain", idOnly: true },
      ],
    },
  ],
});
assert.equal(labeled.sections[0].products[0].sourceFreshLabelForbidden, true);
assert.equal(labeled.sections[0].products[1].sourceFreshLabelForbidden, false);
assert.equal(labeled.sections[0].products[2].sourceFreshLabelForbidden, undefined);

console.log(
  JSON.stringify({
    IU_CJ_PUBLIC_OFFERS_SLIM_V51_8_SELFTEST: "PASS",
    leanBytes: JSON.stringify(lean).length,
    slimBytes: JSON.stringify(slim).length,
  }),
);
