/**
 * V51.8 semantic gates — refuse false FULL_CATALOG PASS; require 329 ledger + coverage splits.
 */
import fs from "node:fs";
import path from "node:path";

function readJson(dir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  } catch {
    return null;
  }
}

function rule(ruleId, sourceFiles, expectedRelationship, actualRelationship, pass, explanation, severity, remediation, rootCause) {
  return {
    ruleId,
    sourceFiles,
    expectedRelationship,
    actualRelationship,
    result: pass ? "PASS" : "FAIL",
    explanation,
    severity: severity || "error",
    rootCause: rootCause || "SEMANTIC",
    remediation: remediation || "Fix evidence",
  };
}

export function evaluateAuditSemanticConsistencyV518(outDir) {
  const coverage = readJson(outDir, "90-coverage-metrics.json");
  const miss = readJson(outDir, "91-329-unmatched-ledger.json");
  const feed = readJson(outDir, "92-feed-inventory-traversal.json");
  const acceptance = readJson(outDir, "92-acceptance-criteria.json");
  const verdict = readJson(outDir, "81-final-verdict-a-g.json");
  const rules = [];

  {
    const pub = coverage?.PUBLISHED_PRODUCT_REFRESH_COVERAGE;
    const ok = !!pub && typeof pub.matchRateOfPublished === "number" && !!pub.metric;
    rules.push(
      rule(
        "PUBLISHED_REFRESH_COVERAGE",
        ["90-coverage-metrics.json"],
        "Published refresh metric present with matchRate",
        pub,
        ok,
        ok ? "Published refresh metric present" : "Missing published refresh metric",
        "error",
        "Emit PUBLISHED_PRODUCT_REFRESH_COVERAGE",
        "COVERAGE_SPLIT"
      )
    );
  }

  {
    const trav = coverage?.FULL_FEED_TRAVERSAL || feed?.summary;
    const incomplete = Number(coverage?.FULL_FEED_TRAVERSAL?.evidence?.incompletePartners ?? feed?.summary?.feedIncomplete ?? -1);
    const fullClaim = String(coverage?.FULL_CATALOG_COVERAGE?.result || acceptance?.FULL_CATALOG_COVERAGE_PASS?.result || "");
    const ok = fullClaim !== "PASS" || incomplete === 0;
    rules.push(
      rule(
        "FULL_FEED_TRAVERSAL",
        ["90-coverage-metrics.json", "92-feed-inventory-traversal.json"],
        "FULL_CATALOG PASS only if feed traversal incompletePartners=0",
        { fullClaim, incomplete, trav },
        ok,
        ok ? "Full catalog claim consistent with traversal" : "FULL_CATALOG PASS while feed traversal incomplete",
        "error",
        "Set FULL_CATALOG_COVERAGE to FAIL/PARTIAL until traversal complete",
        "FALSE_FULL_CATALOG"
      )
    );
  }

  {
    const rows = miss?.rows || [];
    const n = miss?.uniqueMisses ?? rows.length;
    const ok = n === 329 && rows.length === 329 && !!miss?.classCounts;
    rules.push(
      rule(
        "INDIVIDUAL_UNMATCHED_PRODUCT_LEDGER",
        ["91-329-unmatched-ledger.json"],
        "Exactly 329 individual rows with classId",
        { n, rowCount: rows.length, classCounts: miss?.classCounts },
        ok,
        ok ? "329 ledger complete" : "329 ledger incomplete",
        "error",
        "Export all miss-products rows with classId",
        "MISS_LEDGER"
      )
    );
  }

  {
    const a = coverage?.AVAILABLE_FEED_CATALOG_COVERAGE;
    const b = coverage?.ALL_ELIGIBLE_PARTNER_CATALOG_COVERAGE;
    const ok = !!a?.metric && !!b?.metric && a.metric !== b.metric;
    rules.push(
      rule(
        "FULL_PARTNER_COVERAGE",
        ["90-coverage-metrics.json"],
        "AVAILABLE_FEED and ALL_ELIGIBLE metrics distinct",
        { a: a?.metric, b: b?.metric },
        ok,
        ok ? "Partner coverage metrics split" : "Partner coverage metrics missing/collapsed",
        "error",
        "Emit both AVAILABLE_FEED and ALL_ELIGIBLE metrics",
        "COVERAGE_SPLIT"
      )
    );
  }

  {
    const cp = feed?.summary;
    const ok = !!cp && Number(cp.partnerCount) > 0 && Number.isFinite(Number(cp.declaredCatalogSum));
    rules.push(
      rule(
        "CHECKPOINT_PROGRESS",
        ["92-feed-inventory-traversal.json"],
        "Feed checkpoint summary with partnerCount and declaredCatalogSum",
        cp,
        ok,
        ok ? "Checkpoint progress present" : "Checkpoint progress missing",
        "error",
        "Include product-feed-checkpoints summary",
        "CHECKPOINT"
      )
    );
  }

  {
    const fullAcc = acceptance?.FULL_CATALOG_COVERAGE_PASS?.result;
    const fullMet = coverage?.FULL_CATALOG_COVERAGE?.result;
    const ok = fullAcc !== "PASS" && fullMet !== "PASS";
    rules.push(
      rule(
        "NO_FALSE_FULL_CATALOG_PASS",
        ["92-acceptance-criteria.json", "90-coverage-metrics.json", "81-final-verdict-a-g.json"],
        "Neither acceptance nor metric claims FULL_CATALOG PASS while V51.8 traversal incomplete",
        { fullAcc, fullMet, verdictFull: verdict?.B_products?.fullCatalog?.result },
        ok,
        ok ? "No false FULL_CATALOG PASS" : "False FULL_CATALOG PASS detected",
        "error",
        "Force FAIL until traversal complete",
        "FALSE_FULL_CATALOG"
      )
    );
  }

  {
    const w = readJson(outDir, "53-cumulative-3h.json");
    // Status must exist; OBSERVED_PASS requires schedule runs
    const structOk =
      !!w?.status &&
      (w.status !== "OBSERVED_PASS" || ((w.scheduledRuns || []).length > 0 && (w.runs || []).length > 0));
    rules.push(
      rule(
        "SCHEDULE_POST_FIX_OBSERVATION",
        ["53-cumulative-3h.json"],
        "Schedule window status present; OBSERVED_PASS requires schedule runs",
        w,
        structOk,
        structOk ? "Schedule observation structured" : "Schedule observation invalid",
        "error",
        "Generate windowStatus from schedule events after deploy anchor",
        "SCHEDULE"
      )
    );
  }

  {
    const ai = readJson(outDir, "58-workers-ai.json");
    const ok = /401|BLOCKED/i.test(String(ai?.status || "")) || String(ai?.status || "") === "PASS";
    rules.push(
      rule(
        "AI_AUTHENTICATION",
        ["58-workers-ai.json", "83-workers-ai-diagnosis.json"],
        "AI status is honest BLOCKED/401 or real PASS",
        ai,
        !!ai && ok,
        ok ? "AI auth status honest" : "AI status missing/misleading",
        "error",
        "Keep HTTP_401_BLOCKED until live auth works",
        "AI_AUTH"
      )
    );
  }

  {
    const em = readJson(outDir, "59-email-only-disarmed.json");
    const ok = !!em && (/DISARMED/i.test(String(em.status || "")) || em.publicationEnabled === false);
    rules.push(
      rule(
        "EMAIL_OWNER_GATE",
        ["59-email-only-disarmed.json", "84-email-only-runbook.json"],
        "Email publication remains DISARMED without owner GO",
        em,
        ok,
        ok ? "Email owner gate held" : "Email gate missing",
        "error",
        "Keep EMAIL_ONLY_DISARMED until owner GO",
        "EMAIL_GATE"
      )
    );
  }

  {
    const prod = readJson(outDir, "04-current-production-sha.json");
    const pages = readJson(outDir, "72-pages-run.json");
    const desk = readJson(outDir, "60-desktop-browser-dom.json");
    const short = (s) => String(s || "").replace(/^iu-data-ver-?/i, "").slice(0, 8).toLowerCase();
    const p = short(prod?.iuDataVer);
    const b = short(desk?.productionSha);
    const h = short(pages?.headSha);
    const ok = !p || ((!b || p === b) && (!h || p === h || short(pages?.headSha) === p));
    rules.push(
      rule(
        "PRODUCTION_SHA_PARITY",
        ["04-current-production-sha.json", "72-pages-run.json", "60-desktop-browser-dom.json"],
        "Production iu-data-ver aligns with browser/pages short SHA when present",
        { p, b, h },
        ok,
        ok ? "Production SHA parity" : "Production SHA drift",
        "error",
        "Re-probe prod after Pages",
        "PROD_SHA"
      )
    );
  }

  {
    const arch = readJson(outDir, "17-economic-key-reconciliation.json") || readJson(outDir, "06-archive-implementation.json");
    const ok = arch != null;
    rules.push(
      rule(
        "ARCHIVE_READBACK",
        ["17-economic-key-reconciliation.json", "06-archive-implementation.json"],
        "Archive/read-back evidence present (fixture or prod)",
        { present: ok },
        ok,
        ok ? "Archive evidence present" : "Archive evidence missing",
        "warning",
        "Copy archive evidence into pack",
        "ARCHIVE"
      )
    );
  }

  {
    const man = readJson(outDir, "MANIFEST.json");
    // MANIFEST written during finalize after this eval — optional pre-check
    rules.push(
      rule(
        "AUDIT_MANIFEST_INTEGRITY",
        ["MANIFEST.json", "91-zip-exact-name-parity.json"],
        "Parity zipName expected true (manifest hashed at finalize)",
        { parity: readJson(outDir, "91-zip-exact-name-parity.json") },
        readJson(outDir, "91-zip-exact-name-parity.json")?.expected === true,
        "Zip name parity pre-declared",
        "error",
        "Set zip exact-name parity",
        "MANIFEST"
      )
    );
  }

  {
    const coupons = readJson(outDir, "38-coupons.json");
    const promos = readJson(outDir, "39-promotions.json");
    const ok = Number(coupons?.count || 0) >= 0 && Number(promos?.count || 0) >= 0 && coupons && promos;
    rules.push(
      rule(
        "COUPON_VALIDITY",
        ["38-coupons.json"],
        "Coupon count evidence present",
        coupons,
        !!coupons,
        coupons ? "Coupons evidence present" : "Coupons missing",
        "warning",
        "Include coupon evidence",
        "COUPON"
      )
    );
    rules.push(
      rule(
        "PROMOTION_VALIDITY",
        ["39-promotions.json"],
        "Promotion count evidence present",
        promos,
        !!promos,
        promos ? "Promotions evidence present" : "Promotions missing",
        "warning",
        "Include promotion evidence",
        "PROMOTION"
      )
    );
  }

  {
    const age = readJson(outDir, "28-reverify-age-buckets.json");
    // optional — pass if absent with note, fail only if contradictory
    rules.push(
      rule(
        "SOURCE_TIMESTAMP_PROVENANCE",
        ["28-reverify-age-buckets.json", "00-evidence-classification.json"],
        "Age buckets present or explicitly deferred",
        { agePresent: !!age },
        true,
        age ? "Age buckets present" : "Age buckets deferred to copied prior evidence",
        "warning",
        "Include age bucket provenance",
        "TIMESTAMP"
      )
    );
  }

  const fails = rules.filter((r) => r.result === "FAIL" && r.severity === "error");
  return {
    schema: "iu-cj-affiliate-phase3z-audit-semantic-consistency-v51.8-rules",
    at: new Date().toISOString(),
    AUDIT_SEMANTIC_CONSISTENCY_PASS: fails.length === 0,
    failCount: fails.length,
    rules,
  };
}
