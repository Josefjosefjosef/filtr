#!/usr/bin/env node
/**
 * PRODUCT_HEALTH_BASELINE — read-only snapshot emitter (Variant A audit closure).
 * Usage: node scripts/product-health-baseline.cjs
 * Writes nothing; prints canonical baseline from scripts/product-health-baseline-report.json.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPORT = path.join(__dirname, "product-health-baseline-report.json");

function main() {
  if (!fs.existsSync(REPORT)) {
    console.error("MISSING_BASELINE_REPORT");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  const s = data.productHealthSnapshot || {};
  const p = s.performance || {};
  const a = s.audit || {};
  const c = data.auditPhaseClosure || {};

  console.log("=== PRODUCT_HEALTH_SNAPSHOT ===");
  console.log("dom_before=" + p.domBefore);
  console.log("dom_after=" + p.domAfter);
  console.log("dom_delta=" + p.domDelta);
  console.log("gtmetrix_before_performance=" + (p.gtmetrixBefore && p.gtmetrixBefore.performance));
  console.log("gtmetrix_before_tbt_ms=" + (p.gtmetrixBefore && p.gtmetrixBefore.tbtMs));
  console.log("gtmetrix_before_lcp_s=" + (p.gtmetrixBefore && p.gtmetrixBefore.lcpS));
  console.log("lcp_before_ms=" + p.lcpBeforeMs);
  console.log("lcp_after_ms=" + p.lcpAfterMs);
  console.log("tbt_before_ms=" + p.tbtBeforeMs);
  console.log("tbt_after_ms=" + p.tbtAfterMs);
  console.log("issue_count_before=" + a.issueCountBefore);
  console.log("issue_count_after=" + a.issueCountAfter);
  console.log("false_positives_removed=" + a.falsePositivesRemoved);
  console.log("audit_trustworthiness=" + a.auditTrustworthiness);
  console.log("confirmed_mobile_bugs=" + (s.ux && s.ux.confirmedMobileBugs));
  console.log("confirmed_desktop_bugs=" + (s.ux && s.ux.confirmedDesktopBugs));
  console.log("confirmed_pwa_bugs=" + (s.ux && s.ux.confirmedPwaBugs));
  console.log("confirmed_cache_bugs=" + (s.ux && s.ux.confirmedCacheBugs));
  console.log("=== END_PRODUCT_HEALTH_SNAPSHOT ===");

  console.log("=== AUDIT_PHASE_CLOSURE ===");
  console.log("audit_phase=" + c.auditPhase);
  console.log("status=" + c.status);
  console.log("ready_for_new_feature_work=" + c.readyForNewFeatureWork);
  console.log("=== END_AUDIT_PHASE_CLOSURE ===");

  console.log(JSON.stringify({ reportPath: path.relative(path.join(__dirname, ".."), REPORT), mainCommit: data.mainCommit }));
}

if (require.main === module) {
  main();
}
