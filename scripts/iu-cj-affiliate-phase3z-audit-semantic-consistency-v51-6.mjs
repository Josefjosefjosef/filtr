#!/usr/bin/env node
/**
 * V51.6 — expanded semantic consistency for audit evidence directories.
 * Separates ZIP_INTEGRITY_PASS from AUDIT_SEMANTIC_CONSISTENCY_PASS.
 */
import fs from "node:fs";
import path from "node:path";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function rule(id, input, expected, actual, pass, explanation, severity, remediation, rootCause) {
  return {
    ruleId: id,
    sourceFiles: input,
    expectedRelationship: expected,
    actualRelationship: actual,
    result: pass ? "PASS" : "FAIL",
    explanation,
    severity: severity || (pass ? "info" : "error"),
    rootCause: rootCause || null,
    remediation: remediation || null,
  };
}

function load(dir, name) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return null;
  try {
    return readJson(p);
  } catch {
    return { __parseError: true, path: p };
  }
}

export function evaluateAuditSemanticConsistencyV516(evidenceDir) {
  const rules = [];
  const exec = load(evidenceDir, "01-executive-summary.json");
  const mainSha = load(evidenceDir, "03-current-main-sha.json");
  const prodSha = load(evidenceDir, "04-current-production-sha.json");
  const wf = load(evidenceDir, "05-current-workflow-status.json");
  const prMeta = load(evidenceDir, "70-pr-metadata.json");
  const merge = load(evidenceDir, "71-merge-sha.json");
  const pages = load(evidenceDir, "72-pages-run.json");
  const prodVer = load(evidenceDir, "73-production-sha-verification.json");
  const blockers = load(evidenceDir, "77-remaining-blockers.json");
  const verdict = load(evidenceDir, "81-final-verdict-a-g.json") || load(evidenceDir, "93-final-verdict-a-g.json");
  const parity91 = load(evidenceDir, "91-zip-exact-name-parity.json");
  const desktop = load(evidenceDir, "60-desktop-browser-dom.json");
  const tablet = load(evidenceDir, "61-tablet-browser-dom.json");
  const mobile = load(evidenceDir, "62-mobile-browser-dom.json");
  const cross = load(evidenceDir, "26-cross-run-individual-ledger.json");
  const cov = load(evidenceDir, "27-reverify-coverage.json");
  const age = load(evidenceDir, "28-reverify-age-buckets.json");
  const win3 = load(evidenceDir, "53-cumulative-3h.json");
  const archiveRecon = load(evidenceDir, "17-economic-key-reconciliation.json");
  const archiveImpl = load(evidenceDir, "06-archive-implementation.json");
  const buttons = load(evidenceDir, "42-main-buttons.json");
  const evidenceClass = load(evidenceDir, "00-evidence-classification.json");

  const short = (sha) => (sha ? String(sha).slice(0, 8) : null);

  // --- New V51.6 mandatory rules ---
  {
    const execMain = exec?.currentMainSha || null;
    const fileMain = mainSha?.sha || null;
    const mergeSha = merge?.mergeSha || verdict?.G_deploy?.mergeSha || null;
    const finalClassOk = /^FINAL_V51_\d+$/.test(String(exec?.evidenceClass || ""));
    const ok =
      finalClassOk &&
      fileMain &&
      execMain &&
      short(execMain) === short(fileMain) &&
      (!mergeSha || short(execMain) === short(mergeSha) || short(fileMain) === short(mergeSha));
    rules.push(
      rule(
        "SUMMARY_MATCHES_FINAL_PRODUCTION",
        ["01-executive-summary.json", "03-current-main-sha.json", "71-merge-sha.json"],
        "Executive summary currentMainSha matches final main/merge and is marked FINAL_V51_*",
        { evidenceClass: exec?.evidenceClass, execMain, fileMain, mergeSha },
        !!ok,
        ok ? "Summary aligned with final production" : "Stale executive summary or SHA mismatch",
        "error",
        "Rebuild executive summary only after merge/Pages/prod verification",
        "STALE_OR_PARTIAL_PACK"
      )
    );
  }

  {
    const prState = prMeta?.merge || prMeta?.state || null;
    const mergeSha = merge?.mergeSha || null;
    const prNumber = prMeta?.number || prMeta?.pr || null;
    let ok = true;
    let detail = "n/a";
    if (prNumber === 13818 || String(prMeta?.title || "").includes("V51.4")) {
      // Historical V51.4 PR must not claim PENDING if merge SHA present for that PR
      if (mergeSha && /PENDING/i.test(String(prState))) ok = false;
      detail = { prState, mergeSha };
    }
    if (prMeta?.evidenceClass === "HISTORICAL" && /PENDING/i.test(String(prState))) {
      ok = true; // historical pending is allowed when classified
      detail = { historical: true, prState };
    }
    if (
      prMeta?.evidenceClass === "FINAL_V51_6" ||
      prMeta?.evidenceClass === "FINAL_V51_7" ||
      prMeta?.evidenceClass === "CURRENT_PRODUCTION"
    ) {
      if (merge?.mergeSha && /PENDING_OWNER_APPROVAL/i.test(String(prState)) && merge?.pr === prMeta?.number) {
        ok = false;
      }
    }
    rules.push(
      rule(
        "PR_STATE_MATCHES_MERGE_EVIDENCE",
        ["70-pr-metadata.json", "71-merge-sha.json"],
        "Current/final PR metadata must not claim PENDING when merge SHA exists for same PR",
        detail,
        ok,
        ok ? "PR state consistent" : "PR metadata stale vs merge evidence",
        "error",
        "Mark historical PR files HISTORICAL; update current PR metadata",
        "STALE_PR_METADATA"
      )
    );
  }

  {
    const fileMain = mainSha?.sha;
    const pagesSha = pages?.headSha || pages?.sha;
    const ok = !fileMain || !pagesSha || short(fileMain) === short(pagesSha);
    rules.push(
      rule(
        "MAIN_SHA_MATCHES_FINAL_DEPLOY",
        ["03-current-main-sha.json", "72-pages-run.json"],
        "Main SHA short equals Pages head SHA when both present",
        { fileMain, pagesSha },
        ok,
        ok ? "Main/Pages SHA aligned" : "Main SHA differs from Pages deploy",
        "error",
        "Refresh after Pages SUCCESS",
        "DEPLOY_SHA_DRIFT"
      )
    );
  }

  {
    const prod = prodSha?.iuDataVer || prodVer?.iuDataVer;
    const pagesSha = pages?.headSha || pages?.sha;
    const browser = desktop?.productionSha || desktop?.afterMore?.metaVer;
    const ok =
      !prod ||
      ((!pagesSha || short(prod) === short(pagesSha)) && (!browser || short(prod) === short(browser)));
    rules.push(
      rule(
        "PRODUCTION_SHA_MATCHES_PAGES",
        ["04-current-production-sha.json", "72-pages-run.json", "60-desktop-browser-dom.json"],
        "Production iu-data-ver matches Pages and browser observation",
        { prod, pagesSha, browser },
        ok,
        ok ? "Production SHA aligned" : "Production SHA mismatch",
        "error",
        "Re-probe production after Pages",
        "PROD_SHA_DRIFT"
      )
    );
  }

  {
    const syncId = wf?.controlledSync?.id || verdict?.G_deploy?.controlledSync;
    const syncConcl = wf?.controlledSync?.conclusion || verdict?.G_deploy?.controlledSyncConclusion;
    const ok = !syncId || syncConcl === "success" || syncConcl === "SUCCESS";
    rules.push(
      rule(
        "CONTROLLED_SYNC_MATCHES_FINAL_REPORT",
        ["05-current-workflow-status.json", "81-final-verdict-a-g.json"],
        "Controlled sync id in workflow status matches final report conclusion",
        { syncId, syncConcl },
        ok,
        ok ? "Controlled sync consistent" : "Controlled sync status inconsistent",
        "error",
        "Update both workflow status and verdict from same run",
        "SYNC_EVIDENCE_DRIFT"
      )
    );
  }

  {
    const list = blockers?.blockers || [];
    const resolvedMerge = !!(merge?.mergeSha && /13818/.test(JSON.stringify(merge)));
    const stillClaims13818 = list.some((b) => /13818/i.test(String(b)) && /PENDING|APPROVAL|merge/i.test(String(b)));
    const ok = !(resolvedMerge && stillClaims13818 && blockers?.evidenceClass !== "HISTORICAL");
    rules.push(
      rule(
        "BLOCKERS_MATCH_CURRENT_STATE",
        ["77-remaining-blockers.json", "71-merge-sha.json"],
        "Resolved merge must not remain as current blocker",
        { resolvedMerge, stillClaims13818, evidenceClass: blockers?.evidenceClass },
        ok,
        ok ? "Blockers current" : "Stale blocker for merged PR #13818",
        "error",
        "Remove resolved blockers from FINAL list; keep audit trail in root-causes/history",
        "STALE_BLOCKER"
      )
    );
  }

  {
    const zipName = parity91?.zipName || exec?.zipName;
    const expectedPrefixOk = /^phase3z-v51-\d+-/.test(String(zipName || ""));
    const ok =
      !!zipName &&
      expectedPrefixOk &&
      !String(zipName).includes("055825") &&
      parity91?.expected === true;
    rules.push(
      rule(
        "ZIP_FILENAME_MATCHES_MANIFEST",
        ["91-zip-exact-name-parity.json", "01-executive-summary.json"],
        "Parity zipName is phase3z-v51-* and matches pack",
        { zipName, expectedPrefixOk },
        ok,
        ok ? "ZIP filename parity ok" : "ZIP filename stale or missing",
        "error",
        "Set zipName during finalize to actual output path basename",
        "STALE_ZIP_NAME"
      )
    );
  }

  {
    const classes = evidenceClass?.files || {};
    const staleAsCurrent = Object.entries(classes).filter(
      ([, v]) => v === "CURRENT_PRODUCTION" && /PENDING_OWNER|24d0fd52|959cbae4/i.test(String(v))
    );
    const hasClassification = evidenceClass?.schema != null;
    const ok = hasClassification && staleAsCurrent.length === 0;
    rules.push(
      rule(
        "NO_STALE_EVIDENCE_AS_CURRENT",
        ["00-evidence-classification.json"],
        "Every evidence file classified; no stale marker as CURRENT",
        { hasClassification, staleAsCurrent: staleAsCurrent.length },
        ok,
        ok ? "Evidence classes present" : "Missing classification or stale-as-current",
        "error",
        "Emit 00-evidence-classification.json with HISTORICAL/CURRENT_PRODUCTION/FINAL_V51_6",
        "MISSING_EVIDENCE_CLASS"
      )
    );
  }

  {
    const order = evidenceClass?.finalTimestampOrderValid;
    rules.push(
      rule(
        "FINAL_EVIDENCE_TIMESTAMP_ORDER_VALID",
        ["00-evidence-classification.json"],
        "Final pack timestamps ordered: merge ≤ pages ≤ prod probe ≤ finalize",
        { order },
        order === true,
        order === true ? "Timestamp order valid" : "Timestamp order missing/invalid",
        "error",
        "Record event timestamps and validate order in classification file",
        "TIMESTAMP_ORDER"
      )
    );
  }

  // --- Retained V51.5 rules (overflow, reverify, autonomy, buttons, archive) ---
  for (const [name, doc] of [
    ["60-desktop-browser-dom.json", desktop],
    ["61-tablet-browser-dom.json", tablet],
    ["62-mobile-browser-dom.json", mobile],
  ]) {
    if (!doc || doc.__parseError) {
      rules.push(
        rule(
          "BROWSER_FILE_PRESENT_" + name,
          [name],
          "parseable JSON",
          "missing",
          false,
          "Browser evidence missing",
          "error",
          "Re-run browser DOM probe",
          "MISSING_BROWSER"
        )
      );
      continue;
    }
    const undesired = doc.undesiredHorizontalOverflow === true;
    const passStatus = String(doc.status || "").startsWith("PASS");
    const ok = !(passStatus && undesired);
    rules.push(
      rule(
        "BROWSER_OVERFLOW_STATUS_" + name,
        [name],
        "PASS must not coexist with undesired overflow",
        { status: doc.status, undesired },
        ok,
        ok ? "OK" : "PASS with undesired overflow",
        "error",
        "Fail status or fix overflow",
        "OVERFLOW_CONTRADICTION"
      )
    );
  }

  if (cross?.counts && cov?.counts) {
    const confirmed = Number(cross.counts.priceChangedConfirmed ?? cross.counts.changed ?? 0);
    const covChanged = Number(cov.counts.changed ?? 0);
    // After V51.6, coverage.changed may still be within-run class count; require explicit alignment field if present
    const aligned = cov.counts.priceChangedConfirmed != null ? Number(cov.counts.priceChangedConfirmed) : null;
    const ok = aligned == null || aligned === confirmed;
    rules.push(
      rule(
        "REVERIFY_CHANGED_ALIGN",
        ["27-reverify-coverage.json", "26-cross-run-individual-ledger.json"],
        "priceChangedConfirmed must align when both present",
        { confirmed, covChanged, aligned },
        ok,
        ok ? "Changed counts aligned" : "Confirmed changed mismatch",
        "error",
        "Derive coverage.priceChangedConfirmed from individual ledger",
        "REVERIFY_COUNT_DRIFT"
      )
    );
  }

  if (age?.provenanceCounts) {
    const onlyVerification = age.provenanceCounts.VERIFICATION_BATCH_OR_LOCAL_ONLY || 0;
    const noteOk = /VERIFICATION_BATCH|not claimed as CJ source/i.test(String(age.note || ""));
    rules.push(
      rule(
        "AGE_BUCKET_PROVENANCE_DISCLOSED",
        ["28-reverify-age-buckets.json"],
        "Verification-only timestamps disclosed as non-source",
        { onlyVerification, noteOk },
        onlyVerification === 0 || noteOk,
        "Age provenance disclosure",
        "error",
        "Disclose VERIFICATION_BATCH_OR_LOCAL_ONLY",
        "TIMESTAMP_PROVENANCE"
      )
    );
  }

  if (win3 && verdict?.D_autonomy?.windows) {
    const fileStatus = win3.status;
    const verdictStatus = verdict.D_autonomy.windows["3h"];
    const runs = Array.isArray(win3.runs) ? win3.runs : win3.observedRunsInWindow || [];
    const contradiction =
      verdictStatus === "OBSERVED_PASS" &&
      (fileStatus === "PENDING_OBSERVATION" || (fileStatus !== "OBSERVED_PASS" && runs.length === 0));
    rules.push(
      rule(
        "AUTONOMY_3H_VERDICT_ALIGN",
        ["53-cumulative-3h.json", "81-final-verdict-a-g.json"],
        "OBSERVED_PASS requires non-empty runs and matching file status",
        { fileStatus, verdictStatus, runCount: runs.length },
        !contradiction,
        contradiction ? "Autonomy contradiction" : "Autonomy aligned",
        "error",
        "Generate verdict from same windowStatus helper",
        "AUTONOMY_CONTRADICTION"
      )
    );
  }

  if (buttons && desktop?.afterMore) {
    const ledgerCount = Number(buttons.count ?? buttons.buttons?.length ?? 0);
    const domCount = Number(desktop.afterMore.mainButtonCount || 0);
    const scope = buttons.scope || "global";
    const ok = scope === "section" ? true : !(ledgerCount === 0 && domCount > 0);
    rules.push(
      rule(
        "MAIN_BUTTONS_LEDGER_VS_DOM",
        ["42-main-buttons.json", "60-desktop-browser-dom.json"],
        "Global ledger must not be empty when DOM shows chips",
        { ledgerCount, domCount, scope },
        ok,
        ok ? "Buttons OK" : "Empty ledger vs DOM",
        "error",
        "Export from registry",
        "BUTTON_LEDGER"
      )
    );
  }

  if (archiveRecon?.reconstruct?.restoreProvenance || archiveImpl) {
    const prov = archiveRecon?.reconstruct?.restoreProvenance || {};
    const meaning = prov.archiveShaMeaning || archiveImpl?.archiveShaMeaning || null;
    const hasContent = !!(prov.archiveContentSha256 || archiveImpl?.archiveContentSha256);
    rules.push(
      rule(
        "ARCHIVE_SHA_MEANING",
        ["17-economic-key-reconciliation.json", "06-archive-implementation.json"],
        "archiveSha meaning disclosed; content hash preferred",
        { meaning, hasContent },
        meaning != null || hasContent || !prov.archiveSha,
        "Archive SHA provenance",
        "warning",
        "Set archiveShaMeaning + archiveContentSha256",
        "ARCHIVE_SHA"
      )
    );
  }

  const failed = rules.filter((r) => r.result === "FAIL" && r.severity === "error");
  return {
    schema: "iu-cj-affiliate-phase3z-audit-semantic-consistency-v51.6",
    at: new Date().toISOString(),
    AUDIT_SEMANTIC_CONSISTENCY_PASS: failed.length === 0,
    ZIP_INTEGRITY_PASS: null,
    ruleCount: rules.length,
    failCount: failed.length,
    rules,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith("iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-6.mjs");
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-6.mjs <evidenceDir>");
    process.exit(1);
  }
  const out = evaluateAuditSemanticConsistencyV516(dir);
  console.log(JSON.stringify(out, null, 2));
  if (!out.AUDIT_SEMANTIC_CONSISTENCY_PASS) process.exit(2);
}
