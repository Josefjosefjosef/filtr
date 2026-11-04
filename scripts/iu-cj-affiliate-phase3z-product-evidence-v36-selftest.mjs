#!/usr/bin/env node
/**
 * V36 — product evidence reconciliation selftest (offline).
 */
import {
  PRODUCT_EVIDENCE_SCHEMA,
  REFRESH_RESULT_V36,
  auditReconcilePublicDoc,
  occurrenceId,
  productKey,
  reconcilePublishedProductEvidence,
} from "./iu-cj-affiliate-phase3z-product-evidence-v36.mjs";
import { REFRESH_RESULT } from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const coverageByKey = new Map([
  [
    "A|1",
    {
      sourceIdentity: "A|1",
      refreshResult: REFRESH_RESULT.SUCCESSFULLY_REFRESHED,
      refreshReason: "productId_matched_in_scan_window",
      lastRefreshAttemptAt: "2026-11-04T01:00:00.000Z",
      lastSuccessfulRefreshAt: "2026-11-04T01:00:00.000Z",
    },
  ],
  [
    "A|2",
    {
      sourceIdentity: "A|2",
      refreshResult: REFRESH_RESULT.NOT_IN_SCAN_WINDOW,
      refreshReason: "advertiser_scanned_productId_not_in_window",
      lastRefreshAttemptAt: "2026-11-04T01:00:00.000Z",
    },
  ],
]);
const refreshedByKey = new Map([
  ["A|1", { productId: "1", advertiserId: "A", currentPrice: 10 }],
]);

const doc = {
  sections: [
    {
      sectionKey: "aff-moda",
      products: [
        { advertiserId: "A", productId: "1", currentPrice: 9, publicationReady: true },
        { advertiserId: "A", productId: "2", currentPrice: 5, publicationReady: true },
        { advertiserId: "B", productId: "9", currentPrice: 1, publicationReady: true }, // new this pass
      ],
    },
    {
      sectionKey: "aff-boty",
      products: [
        // cross-category occurrence of A|1
        { advertiserId: "A", productId: "1", currentPrice: 9, publicationReady: true, sectionKeys: ["aff-moda", "aff-boty"] },
      ],
    },
  ],
};

const { doc: out, evidence } = reconcilePublishedProductEvidence({
  doc,
  nowIso: "2026-11-04T01:00:00.000Z",
  snapshotId: "snap-1",
  coverageByKey,
  refreshedByKey,
  targetPassCounts: { publishedProducts: 2, successfullyRefreshed: 1, notInScanWindow: 1 },
});

assert(evidence.schema === PRODUCT_EVIDENCE_SCHEMA, "schema");
assert(evidence.reconcileOk === true, "reconcileOk " + JSON.stringify(evidence.invariants));
assert(evidence.publishedCatalog.occurrences === 4, "4 occurrences");
assert(evidence.publishedCatalog.uniqueKeys === 3, "3 unique keys");
assert(evidence.publishedCatalog.successfullyRefreshedUnique === 1, "1 unique success");
assert(evidence.publishedCatalog.successfullyRefreshedOccurrences === 2, "A|1 in 2 sections");
assert(evidence.publishedCatalog.notInScanWindowUnique === 1, "A|2 window");
assert(evidence.publishedCatalog.notInRefreshTargetSetUnique === 1, "B|9 new");

const byOcc = evidence.publishedCatalog.occurrenceByStatus;
assert(byOcc[REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED] === 2, "occ success");
assert(byOcc[REFRESH_RESULT_V36.NOT_IN_SCAN_WINDOW] === 1, "occ window");
assert(byOcc[REFRESH_RESULT_V36.NOT_IN_REFRESH_TARGET_SET] === 1, "occ new");
assert(
  Object.values(byOcc).reduce((a, b) => a + b, 0) === 4,
  "occurrence status sum"
);

// Stamps on cards match evidence
const stamps = [];
for (const s of out.sections) for (const p of s.products) stamps.push(p.refreshResult);
assert(stamps.filter((x) => x === REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED).length === 2, "card stamps");
assert(out.refreshCoverage.counts.successfullyRefreshed === 1, "coverage unique success");
assert(out.refreshCoverage.reconcileOk === true, "doc reconcileOk");
assert(out.productEvidence.reconcileOk === true, "productEvidence");

const audit = auditReconcilePublicDoc(out);
assert(audit.ok === true, "auditReconcile " + JSON.stringify(audit.mismatches));

// Intentional mismatch detection
const broken = structuredClone(out);
broken.sections[0].products[0].refreshResult = REFRESH_RESULT_V36.NOT_ATTEMPTED;
const bad = auditReconcilePublicDoc(broken);
assert(bad.ok === false, "detect mismatch");

assert(productKey("A", "1") === "A|1", "key");
assert(occurrenceId("A", "1", "aff-moda", 0).includes("aff-moda"), "occ id");

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: PRODUCT_EVIDENCE_SCHEMA,
      publishedCatalog: evidence.publishedCatalog,
      invariants: evidence.invariants,
      mismatchDetected: bad.ok === false,
    },
    null,
    2
  )
);
