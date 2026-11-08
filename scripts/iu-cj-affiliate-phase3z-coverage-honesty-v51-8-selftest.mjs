#!/usr/bin/env node
/**
 * V51.8 offline: FULL_CATALOG must not PASS when feed traversal incomplete.
 */
import assert from "node:assert/strict";
import { evaluateAuditSemanticConsistencyV518 } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-v518-sem-"));
function w(name, obj) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2));
}

w("90-coverage-metrics.json", {
  PUBLISHED_PRODUCT_REFRESH_COVERAGE: {
    metric: "PUBLISHED_PRODUCT_REFRESH_COVERAGE",
    result: "PASS",
    matchRateOfPublished: 0.9,
  },
  AVAILABLE_FEED_CATALOG_COVERAGE: { metric: "AVAILABLE_FEED_CATALOG_COVERAGE", result: "PARTIAL" },
  ALL_ELIGIBLE_PARTNER_CATALOG_COVERAGE: {
    metric: "ALL_ELIGIBLE_PARTNER_CATALOG_COVERAGE",
    result: "PARTIAL",
  },
  FULL_FEED_TRAVERSAL: {
    metric: "FULL_FEED_TRAVERSAL",
    result: "FAIL",
    evidence: { incompletePartners: 116 },
  },
  FULL_CATALOG_COVERAGE: { metric: "FULL_CATALOG_COVERAGE", result: "FAIL" },
});
w("91-329-unmatched-ledger.json", {
  uniqueMisses: 329,
  classCounts: { TEMPORARILY_UNAVAILABLE: 255 },
  rows: Array.from({ length: 329 }, (_, i) => ({ classId: "TEMPORARILY_UNAVAILABLE", i })),
});
w("92-feed-inventory-traversal.json", {
  summary: { partnerCount: 165, declaredCatalogSum: 1000, feedIncomplete: 116 },
});
w("92-acceptance-criteria.json", { FULL_CATALOG_COVERAGE_PASS: { result: "FAIL" } });
w("81-final-verdict-a-g.json", { B_products: { fullCatalog: { result: "FAIL" } } });
w("53-cumulative-3h.json", { status: "PENDING_OBSERVATION", scheduledRuns: [], runs: [] });
w("58-workers-ai.json", { status: "WORKERS_AI_HTTP_401_BLOCKED" });
w("59-email-only-disarmed.json", { status: "EMAIL_ONLY_DISARMED", publicationEnabled: false });
w("04-current-production-sha.json", { iuDataVer: "a5da007c" });
w("72-pages-run.json", { headSha: "a5da007c8d86f9afd9be5de198046f7696377672" });
w("60-desktop-browser-dom.json", { productionSha: "a5da007c" });
w("38-coupons.json", { count: 43 });
w("39-promotions.json", { count: 98 });
w("91-zip-exact-name-parity.json", { expected: true });
w("06-archive-implementation.json", { ok: true });

const okPack = evaluateAuditSemanticConsistencyV518(dir);
assert.equal(okPack.AUDIT_SEMANTIC_CONSISTENCY_PASS, true, "honest FAIL pack must semantic-pass");

w("90-coverage-metrics.json", {
  PUBLISHED_PRODUCT_REFRESH_COVERAGE: {
    metric: "PUBLISHED_PRODUCT_REFRESH_COVERAGE",
    result: "PASS",
    matchRateOfPublished: 0.9,
  },
  AVAILABLE_FEED_CATALOG_COVERAGE: { metric: "AVAILABLE_FEED_CATALOG_COVERAGE", result: "PARTIAL" },
  ALL_ELIGIBLE_PARTNER_CATALOG_COVERAGE: {
    metric: "ALL_ELIGIBLE_PARTNER_CATALOG_COVERAGE",
    result: "PARTIAL",
  },
  FULL_FEED_TRAVERSAL: {
    metric: "FULL_FEED_TRAVERSAL",
    result: "FAIL",
    evidence: { incompletePartners: 116 },
  },
  FULL_CATALOG_COVERAGE: { metric: "FULL_CATALOG_COVERAGE", result: "PASS" },
});
w("92-acceptance-criteria.json", { FULL_CATALOG_COVERAGE_PASS: { result: "PASS" } });
const lie = evaluateAuditSemanticConsistencyV518(dir);
assert.equal(lie.AUDIT_SEMANTIC_CONSISTENCY_PASS, false, "false FULL_CATALOG PASS must fail semantic");

console.log(
  JSON.stringify({
    V51_8_COVERAGE_HONESTY_SELFTEST: "PASS",
    honestPackPass: okPack.AUDIT_SEMANTIC_CONSISTENCY_PASS,
    lieDetected: !lie.AUDIT_SEMANTIC_CONSISTENCY_PASS,
  })
);
