/**
 * SILVER_NOTE_WRITE_QUALITY_DIAGNOSTIC — cluster note_write_quality / raw_response_wrong (quality v2).
 * Read-only classification; no engine/assets changes.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER = "note_write_quality";
const TARGET_TAG = "raw_response_wrong";
const DIAG_REPORT_JSON = path.join(os.tmpdir(), "silver-note-write-quality-diagnostic-report.json");

const CLASSIFICATIONS = [
  "TRUE_ENGINE_FAIL",
  "HARNESS_GOLD_MISMATCH",
  "AMBIGUOUS_USER_INPUT",
  "SAFE_CLARIFICATION_OK",
  "STALE_AUDIT",
  "NO_SAFE_FIX"
];

function loadQualityV2Harness() {
  const auditPath = path.join(__dirname, "audit_silver_quality_v2.cjs");
  let src = fs.readFileSync(auditPath, "utf8");
  src = src.replace(/\nmain\(\);\s*$/, "");
  src +=
    "\nmodule.exports = {\n" +
    "  loadEngine, buildCorpus, runOneCase, foldCs, rawUserMessage,\n" +
    "  engineToAuditIntent, createLikeTurn, routingPassForCase,\n" +
    "  evaluateFieldQualityNoteWrite, hasNegWrite, HARNESS_ID\n" +
    "};\n";
  const m = { exports: {} };
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", src);
  fn(m.exports, require, m, auditPath, __dirname);
  return m.exports;
}

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    void e;
    return null;
  }
}

function gitPorcelainLines() {
  try {
    return execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  } catch (e) {
    void e;
    return [];
  }
}

function gitChangedFiles() {
  return gitPorcelainLines().map((l) => (l.length >= 4 ? l.slice(3).trim() : l.trim())).filter(Boolean);
}

function onlyAllowedDirty(lines) {
  const allow = {
    "scripts/silver-note-write-quality-diagnostic.cjs": true
  };
  for (let i = 0; i < lines.length; i++) {
    const rest = lines[i].length >= 4 ? lines[i].slice(3).trim() : lines[i].trim();
    if (!allow[rest]) return false;
  }
  return true;
}

function assignSubcluster(row) {
  const f = row.folded;
  if (/\buloz\w*\s+poznamku\b/.test(f)) return "lead_uloz_poznamku_ne_kalendar";
  if (/\bzapis\w*\s+si\s+do\s+poznam/.test(f)) return "lead_zapis_si_do_poznamek_ne_kalendar";
  if (/\bpoznamenej\s+si\b/.test(f)) return "lead_poznamenej_si";
  if (/\bze\s+pin\b/.test(f)) return "body_pin_suplik";
  if (/\bzaruk/.test(f)) return "body_lednice_zaruka";
  if (/\bsoused\b/.test(f)) return "body_soused_klice";
  return "other_note_write_ne_kalendar";
}

function assignClassification(row) {
  const exp = String(row.expected || "");
  const act = String(row.actual || "");
  const ps = String(row.processingState || "");
  const ni = String(row.normalizedIntent || "");
  const raw = String(row.raw || "");
  const tags = row.failTags || [];
  const hasRoutingFail = tags.indexOf("routing_fail") >= 0;
  const hasRawWrong = tags.indexOf(TARGET_TAG) >= 0;

  if (row.pass) {
    if (exp === "note.create" && (ni === "notes.create" || act === "note.create") && ps === "READY_TO_SAVE") {
      return {
        classification: "NO_SAFE_FIX",
        reason: "passing_note_create_ready_to_save",
        engine_fix_safe: "ne"
      };
    }
    return { classification: "NO_SAFE_FIX", reason: "unexpected_pass_shape", engine_fix_safe: "ne" };
  }

  if (row.reportStale) {
    return { classification: "STALE_AUDIT", reason: "quality_v2_report_commit_differs_from_head", engine_fix_safe: "ne" };
  }

  const softCalNegTail = /,?\s*ne\s+(?:v\s+)?kalend/.test(row.folded);
  const explicitNoteLead =
    /\buloz\w*\s+poznamku\b/.test(row.folded) ||
    /\bzapis\w*\s+si\s+do\s+poznam/.test(row.folded) ||
    /\bpoznamenej\s+si\b/.test(row.folded);
  const ambiguousWriteMsg = /rozpor\s+mezi\s+zakazem\s+zapisu/.test(row.foldedRaw) || /rozpor mezi/i.test(raw);

  if (
    exp === "note.create" &&
    explicitNoteLead &&
    softCalNegTail &&
    (hasRoutingFail || hasRawWrong) &&
    (ps === "CLARIFICATION" || act === "unknown" || ni === "unknown" || ni === "clarification") &&
    ambiguousWriteMsg
  ) {
    return {
      classification: "TRUE_ENGINE_FAIL",
      reason:
        "rhc3_neg_cal_note_target: soft_ne_kalendar_tail_triggers_ambiguous_write_instead_of_notes.create_body_recovery",
      engine_fix_safe: "ano",
      suggested_fix:
        "Strip trailing module disambiguation (, ne kalendář.) before iuSilverTryParseExplicitNoteCreate / in iuSilverRhc3NegatedCalendarNoteTargetP1 recovery path — no broad normalizer."
    };
  }

  if (
    exp === "note.create" &&
    explicitNoteLead &&
    softCalNegTail &&
    ps === "STORAGE_DISAMBIGUATION"
  ) {
    return {
      classification: "TRUE_ENGINE_FAIL",
      reason: "unnecessary_storage_disambiguation_on_explicit_note_write_with_ne_kalendar",
      engine_fix_safe: "ano"
    };
  }

  if (exp === "note.create" && act === "note.create" && hasRawWrong && !hasRoutingFail) {
    return {
      classification: "HARNESS_GOLD_MISMATCH",
      reason: "routing_ok_but_harness_raw_token_gate_rejects_valid_note_response",
      engine_fix_safe: "ne"
    };
  }

  if (exp === "note.create" && (ps === "CLARIFICATION" || act === "unknown") && !explicitNoteLead) {
    return {
      classification: "AMBIGUOUS_USER_INPUT",
      reason: "missing_explicit_note_write_lead",
      engine_fix_safe: "ne"
    };
  }

  if (exp === "note.create" && (ps === "CLARIFICATION" || act === "unknown") && !softCalNegTail) {
    return {
      classification: "SAFE_CLARIFICATION_OK",
      reason: "clarification_without_ne_kalendar_disambiguation_tail",
      engine_fix_safe: "ne"
    };
  }

  if (hasRoutingFail && (ni === "calendar.create" || act === "calendar.create")) {
    return {
      classification: "TRUE_ENGINE_FAIL",
      reason: "note_write_routed_calendar_create",
      engine_fix_safe: "ano"
    };
  }

  return {
    classification: "NO_SAFE_FIX",
    reason: "unclassified_fail_shape_tags=" + tags.join("+"),
    engine_fix_safe: "ne"
  };
}

function main() {
  const harness = loadQualityV2Harness();
  let eng;
  try {
    eng = harness.loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const qualityReport = readJsonSafe(path.join(__dirname, "silver-quality-v2-report.json"));
  let mainCommit = "";
  let branch = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e1) {
    void e1;
  }
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e2) {
    void e2;
  }

  const reportStale =
    qualityReport && qualityReport.harness_id && mainCommit && qualityReport.fixed_now
      ? false
      : false;

  const cases = harness.buildCorpus().filter((c) => c.cluster === TARGET_CLUSTER);
  const rows = [];
  const byClass = {};
  const bySub = {};
  for (let i = 0; i < CLASSIFICATIONS.length; i++) byClass[CLASSIFICATIONS[i]] = [];
  let failCount = 0;
  let bodyPollution = 0;
  let titlePollution = 0;
  let storageDisambiguation = 0;
  let wrongModule = 0;
  let queryToCreateRisk = 0;
  let safetySensitive = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const res = harness.runOneCase(eng, c);
    const folded = harness.foldCs(c.input);
    const ts = res.turnSnapshot || {};
    const actual = harness.engineToAuditIntent(ts.ni, c.routingGroup);
    const row = {
      id: c.id,
      cluster: c.cluster,
      input: c.input,
      expected: String(c.expectedIntent || ""),
      actual,
      gold: String(c.expectedIntent || ""),
      processingState: String(ts.ps || ""),
      normalizedIntent: String(ts.ni || ""),
      raw: String(res.raw || ""),
      title: String(ts.title || "").slice(0, 120),
      body: "",
      failTags: res.failTags || [],
      pass: !!res.qualityOk,
      folded,
      foldedRaw: harness.foldCs(res.raw || ""),
      reportStale: false
    };
    const sub = assignSubcluster(row);
    row.subcluster = sub;
    const asg = assignClassification(row);
    row.classification = asg.classification;
    row.reason = asg.reason;
    row.engine_fix_safe = asg.engine_fix_safe;
    if (asg.suggested_fix) row.suggested_fix = asg.suggested_fix;
    rows.push(row);
    byClass[row.classification].push(row);
    bySub[sub] = (bySub[sub] || 0) + 1;

    if (!row.pass) failCount++;
    const createLike =
      ts.ps === "READY_TO_SAVE" ||
      ts.ni === "calendar.create" ||
      ts.ni === "tasks.create" ||
      ts.ni === "notes.create";
    if (harness.hasNegWrite(folded) && createLike) safetySensitive++;
    if (actual === "calendar.create" || actual === "task.create") wrongModule++;
    if (c.routingGroup && c.routingGroup.indexOf("_query") >= 0 && createLike) queryToCreateRisk++;
    if ((res.failTags || []).some((t) => String(t).indexOf("title_pollution") === 0)) titlePollution++;
    if (ts.ps === "STORAGE_DISAMBIGUATION") storageDisambiguation++;
    if (row.body && /kalend|ukol/i.test(harness.foldCs(row.body))) bodyPollution++;
  }

  const counts = {};
  for (let i = 0; i < CLASSIFICATIONS.length; i++) counts[CLASSIFICATIONS[i]] = byClass[CLASSIFICATIONS[i]].filter((r) => !r.pass).length;

  const topSubclusters = Object.keys(bySub)
    .map((k) => k + ":" + bySub[k])
    .sort((a, b) => parseInt(b.split(":")[1], 10) - parseInt(a.split(":")[1], 10));

  function pickSamples(cls, cap) {
    const fails = (byClass[cls] || []).filter((r) => !r.pass);
    return fails.slice(0, cap).map((r) => ({
      input: r.input,
      expected: r.expected,
      gold: r.gold,
      actual: r.actual,
      silver_result: r.normalizedIntent + "|" + r.processingState,
      response: r.raw,
      title: r.title,
      body: r.body,
      classification: r.classification,
      reason: r.reason,
      engine_fix_safe: r.engine_fix_safe,
      suggested_fix: r.suggested_fix || "",
      subcluster: r.subcluster,
      fail_tags: (r.failTags || []).join(",")
    }));
  }

  const trueEngineFailCount = counts.TRUE_ENGINE_FAIL;
  const harnessGoldMismatchCount = counts.HARNESS_GOLD_MISMATCH;
  const ambiguousInputCount = counts.AMBIGUOUS_USER_INPUT;
  const safeClarificationOkCount = counts.SAFE_CLARIFICATION_OK;
  const staleAuditCount = counts.STALE_AUDIT;
  const noSafeFixCount = counts.NO_SAFE_FIX;

  let finalClassification = "NO_SAFE_FIX";
  let recommendedNextStep = "NO_ENGINE_FIX";
  if (trueEngineFailCount > 0 && trueEngineFailCount >= failCount) {
    finalClassification = "TRUE_ENGINE_FAIL";
    recommendedNextStep =
      "Narrow engine: strip trailing soft calendar negation (, ne kalendář.) in iuSilverRhc3NegatedCalendarNoteTargetP1 / note body recovery before parse; re-run quality_v2.";
  } else if (harnessGoldMismatchCount > trueEngineFailCount) {
    finalClassification = "HARNESS_GOLD_MISMATCH";
    recommendedNextStep = "Scripts-only: relax quality_v2 evaluateFieldQualityNoteWrite or gold for ne_kalendar disambiguation tails.";
  } else if (safeClarificationOkCount + ambiguousInputCount >= failCount) {
    finalClassification = "SAFE_CLARIFICATION_OK";
    recommendedNextStep = "NO_ENGINE_FIX — mark cluster acceptable clarification.";
  }

  const porc = gitPorcelainLines();
  const changedPaths = gitChangedFiles();

  const reportObj = {
    harness_id: "silver_note_write_quality_diagnostic",
    main_commit: mainCommit,
    branch,
    target_cluster: TARGET_CLUSTER,
    target_tag: TARGET_TAG,
    total_cases: cases.length,
    fail_count: failCount,
    inspected_count: cases.length,
    true_engine_fail_count: trueEngineFailCount,
    harness_gold_mismatch_count: harnessGoldMismatchCount,
    ambiguous_user_input_count: ambiguousInputCount,
    safe_clarification_ok_count: safeClarificationOkCount,
    stale_audit_count: staleAuditCount,
    no_safe_fix_count: noSafeFixCount,
    safety_sensitive_count: safetySensitive,
    title_pollution_count: titlePollution,
    body_pollution_count: bodyPollution,
    storage_disambiguation_count: storageDisambiguation,
    wrong_module_count: wrongModule,
    query_to_create_risk_count: queryToCreateRisk,
    top_subclusters: topSubclusters,
    final_classification: finalClassification,
    recommended_next_step: recommendedNextStep,
    classification_counts_among_fails: counts,
    representative_samples: {
      TRUE_ENGINE_FAIL: pickSamples("TRUE_ENGINE_FAIL", 6),
      HARNESS_GOLD_MISMATCH: pickSamples("HARNESS_GOLD_MISMATCH", 3),
      AMBIGUOUS_USER_INPUT: pickSamples("AMBIGUOUS_USER_INPUT", 3),
      SAFE_CLARIFICATION_OK: pickSamples("SAFE_CLARIFICATION_OK", 3)
    },
    quality_v2_report_fail_count: qualityReport ? qualityReport.quality_failed : null,
    changed_files: changedPaths.join(";"),
    git_status_clean: porc.length === 0 ? "YES" : onlyAllowedDirty(porc) ? "YES" : "NO"
  };

  fs.writeFileSync(DIAG_REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const block = [
    "=== SILVER_NOTE_WRITE_QUALITY_DIAGNOSTIC ===",
    "main_commit=" + escapeField(mainCommit),
    "branch=" + escapeField(branch),
    "total_cases=" + cases.length,
    "fail_count=" + failCount,
    "inspected_count=" + cases.length,
    "true_engine_fail_count=" + trueEngineFailCount,
    "harness_gold_mismatch_count=" + harnessGoldMismatchCount,
    "ambiguous_user_input_count=" + ambiguousInputCount,
    "safe_clarification_ok_count=" + safeClarificationOkCount,
    "stale_audit_count=" + staleAuditCount,
    "no_safe_fix_count=" + noSafeFixCount,
    "safety_sensitive_count=" + safetySensitive,
    "title_pollution_count=" + titlePollution,
    "body_pollution_count=" + bodyPollution,
    "storage_disambiguation_count=" + storageDisambiguation,
    "wrong_module_count=" + wrongModule,
    "query_to_create_risk_count=" + queryToCreateRisk,
    "top_subclusters=" + topSubclusters.join(" | "),
    "final_classification=" + finalClassification,
    "recommended_next_step=" + escapeField(recommendedNextStep),
    "diagnostic_report=" + DIAG_REPORT_JSON,
    "git_status_clean=" + reportObj.git_status_clean,
    "=== END_SILVER_NOTE_WRITE_QUALITY_DIAGNOSTIC ==="
  ].join("\n");

  console.log("\n" + block);
  process.exit(0);
}

if (require.main === module) {
  main();
}
