#!/usr/bin/env node
/**
 * V51.5 — semantic consistency rules for audit evidence directories.
 * Separates ZIP_INTEGRITY_PASS from AUDIT_SEMANTIC_CONSISTENCY_PASS.
 */
import fs from "node:fs";
import path from "node:path";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function rule(id, input, expected, actual, pass, explanation, severity, remediation) {
  return {
    ruleId: id,
    inputEvidence: input,
    expectedRelationship: expected,
    actualRelationship: actual,
    result: pass ? "PASS" : "FAIL",
    explanation,
    severity: severity || (pass ? "info" : "error"),
    remediation: remediation || null,
  };
}

export function evaluateAuditSemanticConsistency(evidenceDir) {
  const rules = [];
  const load = (name) => {
    const p = path.join(evidenceDir, name);
    if (!fs.existsSync(p)) return null;
    try {
      return readJson(p);
    } catch {
      return { __parseError: true, path: p };
    }
  };

  const desktop = load("60-desktop-browser-dom.json");
  const tablet = load("61-tablet-browser-dom.json");
  const mobile = load("62-mobile-browser-dom.json");
  const cross = load("26-cross-run-individual-ledger.json");
  const cov = load("27-reverify-coverage.json");
  const age = load("28-reverify-age-buckets.json");
  const buttons = load("42-main-buttons.json");
  const win3 = load("53-cumulative-3h.json");
  const verdict = load("81-final-verdict-a-g.json") || load("93-final-verdict-a-g.json");
  const archiveRecon = load("17-economic-key-reconciliation.json");
  const archiveImpl = load("06-archive-implementation.json");

  // Overflow vs status
  for (const [name, doc] of [
    ["60-desktop-browser-dom.json", desktop],
    ["61-tablet-browser-dom.json", tablet],
    ["62-mobile-browser-dom.json", mobile],
  ]) {
    if (!doc || doc.__parseError) {
      rules.push(
        rule(
          "BROWSER_FILE_PRESENT_" + name,
          name,
          "parseable JSON",
          "missing/parseError",
          false,
          "Browser evidence missing",
          "error",
          "Re-run browser DOM probe"
        )
      );
      continue;
    }
    const overflow = doc.horizontalOverflow === true || doc.domInventory?.horizontalOverflow === true;
    const undesired = doc.undesiredHorizontalOverflow === true;
    const passStatus = String(doc.status || "").startsWith("PASS");
    const ok = !(passStatus && undesired);
    rules.push(
      rule(
        "BROWSER_OVERFLOW_STATUS_" + name,
        [name + ".status", name + ".undesiredHorizontalOverflow/horizontalOverflow"],
        "PASS status must not coexist with undesired page overflow",
        { status: doc.status, horizontalOverflow: overflow, undesiredHorizontalOverflow: undesired },
        ok,
        ok
          ? "Status and overflow fields are consistent"
          : "PASS_REAL_BROWSER with undesired overflow is a semantic contradiction",
        "error",
        "Fail browser status or fix overflow; do not invert overflow booleans"
      )
    );
  }

  // Cross-run vs coverage
  if (cross?.counts && cov?.counts) {
    const covChanged = Number(cov.counts.changed || 0);
    const crossChanged = Number(
      cross.counts.withinRunChangedByClassification ?? cross.counts.changed ?? 0
    );
    rules.push(
      rule(
        "REVERIFY_CHANGED_ALIGN",
        ["27-reverify-coverage.json.counts.changed", "26-cross-run-individual-ledger.json.counts.changed"],
        "within-run changed counts must match",
        { coverageChanged: covChanged, crossChanged },
        covChanged === crossChanged,
        covChanged === crossChanged
          ? "Changed counts aligned"
          : "Coverage changed count disagrees with individual ledger",
        "error",
        "Derive ledger changed from within-run classification counts"
      )
    );
    const attempted = Number(cross.counts.reverifyAttempted ?? 0);
    const succ = Number(cross.counts.actuallyReverified ?? 0);
    rules.push(
      rule(
        "REVERIFY_ATTEMPTED_NONEMPTY_WHEN_SUCCESS",
        ["26.counts.reverifyAttempted", "26.counts.actuallyReverified"],
        "If successfully reverified > 0 then reverifyAttempted >= successfullyReverified",
        { attempted, succ },
        !(succ > 0 && attempted < succ),
        "Attempted must cover successes",
        "error",
        "Derive reverifyAttempted from sourceMatch/classification"
      )
    );
  }

  // Age bucket provenance honesty
  if (age?.provenanceCounts) {
    const onlyVerification = age.provenanceCounts.VERIFICATION_BATCH_OR_LOCAL_ONLY || 0;
    const noteOk = /VERIFICATION_BATCH|not claimed as CJ source/i.test(String(age.note || ""));
    rules.push(
      rule(
        "AGE_BUCKET_PROVENANCE_DISCLOSED",
        ["28-reverify-age-buckets.json.provenanceCounts", "note"],
        "Verification-only timestamps must be disclosed as non-source",
        { onlyVerification, noteOk },
        onlyVerification === 0 || noteOk,
        "Age bucket provenance disclosure",
        "error",
        "Use resolveReverifyTimestampProvenance and disclose VERIFICATION_BATCH_OR_LOCAL_ONLY"
      )
    );
  }

  // Autonomy windows vs verdict
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
        ["53-cumulative-3h.json", "93/81-final-verdict D_autonomy.windows.3h"],
        "Verdict OBSERVED_PASS requires non-empty observed runs and matching window file status",
        { fileStatus, verdictStatus, runCount: runs.length },
        !contradiction,
        contradiction
          ? "Final report claimed OBSERVED_PASS while window file is pending/empty"
          : "Autonomy 3h verdict aligned",
        "error",
        "Generate verdict windows from the same windowStatus() helper as evidence files"
      )
    );
  }

  // Main buttons ledger vs DOM
  if (buttons && desktop?.afterMore) {
    const ledgerCount = Number(buttons.count ?? buttons.buttons?.length ?? 0);
    const domCount = Number(desktop.afterMore.mainButtonCount || desktop.domInventory?.mainButtonCount || 0);
    // Allow section-scoped DOM vs global ledger if ledger documents scope.
    const scope = buttons.scope || "global";
    const ok =
      scope === "section"
        ? true
        : !(ledgerCount === 0 && domCount > 0);
    rules.push(
      rule(
        "MAIN_BUTTONS_LEDGER_VS_DOM",
        ["42-main-buttons.json", "60-desktop-browser-dom.json mainButtonCount"],
        "Global button ledger must not be empty when DOM shows main affiliate chips",
        { ledgerCount, domCount, scope },
        ok,
        ok ? "Button evidence consistent" : "Empty button ledger contradicts DOM mainButtonCount",
        "error",
        "Export main buttons from affiliate catalog/registry, not offers section.mainButton"
      )
    );
  }

  // Archive SHA meaning
  if (archiveRecon?.reconstruct?.restoreProvenance || archiveImpl) {
    const prov = archiveRecon?.reconstruct?.restoreProvenance || {};
    const meaning = prov.archiveShaMeaning || archiveImpl?.archiveShaMeaning || null;
    const hasContent = !!(prov.archiveContentSha256 || archiveImpl?.archiveContentSha256);
    rules.push(
      rule(
        "ARCHIVE_SHA_MEANING",
        ["17-economic-key-reconciliation / 06-archive-implementation"],
        "archiveSha must disclose meaning; content hash preferred as archiveContentSha256",
        { meaning, hasContent, archiveSha: prov.archiveSha || null },
        meaning != null || hasContent || !prov.archiveSha,
        "Archive SHA provenance disclosed",
        "warning",
        "Set archiveShaMeaning and archiveContentSha256"
      )
    );
  }

  const failed = rules.filter((r) => r.result === "FAIL");
  return {
    schema: "iu-cj-affiliate-phase3z-audit-semantic-consistency-v51.5",
    at: new Date().toISOString(),
    AUDIT_SEMANTIC_CONSISTENCY_PASS: failed.length === 0,
    ruleCount: rules.length,
    failCount: failed.length,
    rules,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-5.mjs");
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-5.mjs <evidenceDir>");
    process.exit(1);
  }
  const out = evaluateAuditSemanticConsistency(dir);
  console.log(JSON.stringify(out, null, 2));
  if (!out.AUDIT_SEMANTIC_CONSISTENCY_PASS) process.exit(2);
}
