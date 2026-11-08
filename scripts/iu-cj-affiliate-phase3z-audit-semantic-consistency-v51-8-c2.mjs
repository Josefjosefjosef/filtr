#!/usr/bin/env node
/**
 * V51.8 continuation-2 semantic gates — catch SHA/Pages/status/NO_FEED contradictions.
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

function rule(ruleId, sourceFiles, expected, actual, pass, explanation, severity, remediation, rootCause) {
  return {
    ruleId,
    sourceFiles,
    expectedRelationship: expected,
    actualRelationship: actual,
    result: pass ? "PASS" : "FAIL",
    explanation,
    severity: severity || "error",
    rootCause: rootCause || "SEMANTIC",
    remediation: remediation || "Fix evidence",
  };
}

function shortSha(s) {
  return String(s || "")
    .replace(/^iu-data-ver-?/i, "")
    .slice(0, 8)
    .toLowerCase();
}

export function evaluateAuditSemanticConsistencyV518c2(outDir) {
  const rules = [];
  const main = readJson(outDir, "03-current-main-sha.json");
  const prod = readJson(outDir, "04-current-production-sha.json");
  const pages = readJson(outDir, "72-pages-run.json");
  const report = readJson(outDir, "01-executive-summary.json");
  const feed = readJson(outDir, "92-feed-inventory-traversal.json");
  const windows = readJson(outDir, "53-cumulative-3h.json");
  const delta = readJson(outDir, "PRODUCT_PUBLICATION_DELTA_LEDGER.json");
  const parity = readJson(outDir, "91-zip-exact-name-parity.json");

  {
    const m = shortSha(main?.sha || main?.mainSha);
    const p = shortSha(prod?.sha || prod?.productionSha || prod?.iuDataVer);
    const claimed = shortSha(report?.productionSha || report?.mergeSha || prod?.verifiedSha);
    const ok = !m || !p || m === p || prod?.explicitlyStale === true;
    rules.push(
      rule(
        "MAIN_VS_PRODUCTION_SHA",
        ["03-current-main-sha.json", "04-current-production-sha.json"],
        "Main and production SHA equal unless explicitly marked stale with reason",
        { m, p, claimed },
        ok,
        ok ? "SHA pair consistent" : "Main/production SHA mismatch without stale marker",
        "error",
        "Re-probe production or mark timestamped drift",
        "SHA_DRIFT"
      )
    );
  }

  {
    const pagesId = String(pages?.runId || pages?.id || "");
    const claimed = String(report?.pagesRunId || pages?.authoritativeRunId || "");
    const ok =
      !pagesId ||
      !claimed ||
      pagesId === claimed ||
      pages?.includesHistoricalRuns === true;
    rules.push(
      rule(
        "PAGES_RUN_AUTHORITATIVE",
        ["72-pages-run.json", "01-executive-summary.json"],
        "Pages run in evidence matches report authoritative run",
        { pagesId, claimed },
        ok,
        ok ? "Pages run consistent" : "Stale Pages run presented as current",
        "error",
        "Collect Pages run for merge SHA only",
        "PAGES_STALE"
      )
    );
  }

  {
    const partners = feed?.partners || [];
    let bad = 0;
    for (const p of partners) {
      const st = String(p.traversalStatus || "");
      const next = String(p.remainingWork || p.nextAction || "");
      if (/NO_FEED/i.test(st) && /CONTINUE_PAGINATION/i.test(next)) bad += 1;
    }
    rules.push(
      rule(
        "NO_FEED_VS_PAGINATION",
        ["92-feed-inventory-traversal.json"],
        "NO_FEED partners must not request CONTINUE_PAGINATION",
        { bad, checked: partners.length },
        bad === 0,
        bad === 0 ? "NO_FEED actions consistent" : "NO_FEED with pagination remainingWork",
        "error",
        "Set nextAction=NONE_NO_FEED",
        "NO_FEED_LOGIC"
      )
    );
  }

  {
    const hist = feed?.summary?.everCompletedNonempty;
    const cur = feed?.summary?.completeNonempty;
    const ok =
      hist == null ||
      cur == null ||
      feed?.summary?.metricsSeparated === true ||
      Number(hist) >= Number(cur);
    rules.push(
      rule(
        "HISTORICAL_VS_CURRENT_METRICS",
        ["92-feed-inventory-traversal.json"],
        "everCompletedNonempty >= current completeNonempty when both present",
        { hist, cur },
        ok,
        ok ? "Metric layers separated" : "Historical/current metric contradiction",
        "error",
        "Separate EVER_* and CURRENT_WINDOW_* fields",
        "METRIC_MIX"
      )
    );
  }

  {
    const runs = windows?.runs || windows?.scheduledRuns || [];
    let staleInProgress = 0;
    for (const r of runs) {
      if (String(r.status) === "in_progress" && r.conclusion === "success") staleInProgress += 1;
      if (String(r.status) === "in_progress" && r.finalStatus === "completed") staleInProgress += 1;
    }
    rules.push(
      rule(
        "RUN_STATUS_FRESHNESS",
        ["53-cumulative-3h.json"],
        "No run marked in_progress while concluded success",
        { staleInProgress },
        staleInProgress === 0,
        staleInProgress === 0 ? "Run statuses fresh" : "Stale in_progress after completion",
        "error",
        "Refresh workflow status at audit time",
        "RUN_STALE"
      )
    );
  }

  {
    const ok = !!delta && Number.isFinite(Number(delta.removedCount)) && Number.isFinite(Number(delta.addedCount));
    rules.push(
      rule(
        "PRODUCT_DELTA_LEDGER_PRESENT",
        ["PRODUCT_PUBLICATION_DELTA_LEDGER.json"],
        "Publication delta ledger present with removed/added counts",
        { present: !!delta, removed: delta?.removedCount, added: delta?.addedCount },
        ok,
        ok ? "Delta ledger present" : "Missing product delta ledger",
        "error",
        "Emit PRODUCT_PUBLICATION_DELTA_LEDGER.json",
        "DELTA"
      )
    );
  }

  {
    rules.push(
      rule(
        "ZIP_NAME_PARITY",
        ["91-zip-exact-name-parity.json"],
        "expected===true",
        parity,
        parity?.expected === true,
        "Zip name parity",
        "error",
        "Set expected true",
        "MANIFEST"
      )
    );
  }

  const fails = rules.filter((r) => r.result === "FAIL" && r.severity === "error");
  return {
    schema: "iu-cj-affiliate-phase3z-audit-semantic-consistency-v51.8-c2",
    at: new Date().toISOString(),
    AUDIT_SEMANTIC_CONSISTENCY_PASS: fails.length === 0,
    failCount: fails.length,
    rules,
  };
}
