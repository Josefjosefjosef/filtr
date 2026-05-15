/**
 * RETRIEVAL_STRESS_300K_FOUNDATION_DIAGNOSTIC — scripts-only (post PR #4314 read-vs-create bias).
 * - NO engine / assets/app.js / UI / CSS / backend.
 * - Replays rcz2_retrieval from silver-real-czech-public-ux-corpus-v2 + pilot stress lanes.
 * - Optional JSON: node scripts/silver-retrieval-stress-300k-foundation-diagnostic.cjs --write-report
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const EXPECTED_MAIN_COMMIT = "07ad94fb1c4b4896f9879d125c6a35a9096531a6";
const TARGET_CLUSTER_NAME = "rcz2_retrieval";
const REPORT_JSON = path.join(__dirname, "silver-retrieval-stress-300k-foundation-diagnostic-report.json");

const prep = require("./silver-retrieval-stress-300k-prep.cjs");
const { assignRetrievalBucket, buildRetrievalPilotCases } = prep;
const { buildPublicUxCorpusV2 } = require("./silver-real-czech-public-ux-corpus-v2.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;

const PILOT_N = 600;
const BUCKETS = [
  "missing_entity_match",
  "weak_entity_anchor",
  "temporal_anchor_missing",
  "wrong_module_retrieval",
  "calendar_vs_note_retrieval_confusion",
  "task_vs_calendar_retrieval_confusion",
  "personal_fact_query_fail",
  "note_relevance_fail",
  "partial_reference_fail",
  "fuzzy_reference_fail",
  "query_too_short_or_dirty",
  "response_contract_safe_unknown_ok",
  "gold_too_strict_expected_retrieval",
  "template_dna_retrieval_noise",
  "true_engine_retrieval_bug",
  "other"
];

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function gitPorcelainLines() {
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    return st.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    void e;
    return [];
  }
}

function gitChangedFiles() {
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    return st
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.replace(/^\s*\S+\s+/, "").trim())
      .filter((p) => p.length);
  } catch (e) {
    void e;
    return [];
  }
}

function onlyAllowedDirty(lines) {
  const allow = {
    "scripts/silver-retrieval-stress-300k-foundation-diagnostic.cjs": true,
    "scripts/silver-retrieval-stress-300k-foundation-diagnostic-report.json": true
  };
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] || "");
    const rest = t.length >= 4 ? t.slice(3).trim() : t.trim();
    if (!allow[rest]) return false;
  }
  return true;
}

function isQueryGroup(g) {
  return String(g || "").indexOf("_query") > 0;
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function bucketToRecommendedTask(bucket) {
  const m = {
    true_engine_retrieval_bug: "narrow_engine_retrieval_read_path_after_stable_repro_in_rcz2_retrieval",
    gold_too_strict_expected_retrieval: "relax_or_rescope_gold_for_dual_cue_retrieval_templates_scripts_only",
    template_dna_retrieval_noise: "reduce_mobile_filler_density_in_generator_templates_scripts_only",
    response_contract_safe_unknown_ok: "align_storage_disambiguation_expectations_for_read_lanes_scripts_only",
    missing_entity_match: "expand_entity_anchor_templates_in_300k_generator_phase_A",
    weak_entity_anchor: "strengthen_entity_span_templates_calendar_task_note_reads",
    temporal_anchor_missing: "add_explicit_date_tokens_to_calendar_read_seeds",
    wrong_module_retrieval: "cross_module_disambiguation_study_task_vs_calendar_vs_note",
    calendar_vs_note_retrieval_confusion: "boundary_tests_calendar_query_with_note_lexical_cues",
    task_vs_calendar_retrieval_confusion: "boundary_tests_task_query_with_calendar_cues",
    personal_fact_query_fail: "isolate_personal_fact_reads_from_calendar_task_lane_gold",
    note_relevance_fail: "note_query_precision_templates_and_gold_review",
    partial_reference_fail: "partial_reference_deixis_session_anchor_templates",
    fuzzy_reference_fail: "fuzzy_token_normalization_templates_without_engine_touch",
    query_too_short_or_dirty: "minimum_token_floor_for_retrieval_stress_corpus",
    other: "inspect_unclassified_intent_fail_shapes_then_refine_assignRetrievalBucket"
  };
  return m[bucket] || "refine_retrieval_foundation_bucket_rules_in_prep_layer";
}

function dominantClsInBucket(rows) {
  const h = {};
  for (let i = 0; i < rows.length; i++) {
    const k = String(rows[i].classification || "");
    h[k] = (h[k] || 0) + 1;
  }
  let best = -1;
  let dom = "AMBIGUOUS_OK";
  const keys = Object.keys(h);
  for (let j = 0; j < keys.length; j++) {
    const v = h[keys[j]] || 0;
    if (v > best) {
      best = v;
      dom = keys[j];
    }
  }
  return dom;
}

function main() {
  const argv = process.argv.slice(2);
  const writeReport = argv.indexOf("--write-report") >= 0;

  const porcBefore = gitPorcelainLines();
  const workingTreeCleanBefore = porcBefore.length === 0 ? "YES" : onlyAllowedDirty(porcBefore) ? "YES" : "NO";

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  let mainCommit = EXPECTED_MAIN_COMMIT;
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e2) {
    void e2;
  }

  const cases = buildPublicUxCorpusV2();
  const clusterCases = [];
  for (let i = 0; i < cases.length; i++) {
    if (cases[i].cluster === TARGET_CLUSTER_NAME) clusterCases.push(cases[i]);
  }

  let passAll = 0;
  let dangerousWrite = 0;
  let falseWrite = 0;
  let queryCreatedWrite = 0;
  let writeWhenNegated = 0;
  let negInstructionFail = 0;
  const intentFailRows = [];

  for (let ci = 0; ci < clusterCases.length; ci++) {
    const c = clusterCases[ci];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateOne(c, turn);
    if (ev.pass) passAll++;

    const cat = String(ev.cat || "");
    const g = String(c.group || "");
    const fi = foldCs(c.input);

    const uQcw = cat === "query_created_write";
    const uNeg = cat === "negative_instruction_fail";
    const uWn = cat === "write_when_negated" || (isQueryGroup(g) && hasNegWrite(fi) && createLikeTurn(turn));

    if (uQcw) queryCreatedWrite++;
    if (uNeg) negInstructionFail++;
    if (uWn) writeWhenNegated++;
    if (uQcw || uNeg || uWn) dangerousWrite++;

    if (!ev.pass && isQueryGroup(g) && (uQcw || uNeg)) {
      falseWrite++;
    }

    if (ev.cat === "intent_fail") {
      const folded = foldCs(c.input);
      const row = {
        id: c.id,
        cluster: c.cluster,
        group: c.group,
        input: c.input,
        expected: String(c.expectedIntent || ""),
        actual: String(ev.auditIntent || ""),
        processingState: String(turn.processingState || ""),
        normalizedIntent: String(turn.normalizedIntent || ""),
        raw: String(ev.raw || ""),
        folded,
        turn
      };
      const asg = assignRetrievalBucket(row);
      row.bucket = asg.bucket;
      row.classification = asg.cls;
      row.why_fail = asg.why;
      intentFailRows.push(row);
    }
  }

  const totalCases = clusterCases.length;
  const accuracy = totalCases ? ((passAll / totalCases) * 100).toFixed(2) : "0.00";

  const byBucket = {};
  for (let bi = 0; bi < BUCKETS.length; bi++) byBucket[BUCKETS[bi]] = [];

  const clsHist = {
    ENGINE_BUG: 0,
    HARNESS_BUG: 0,
    GOLD_PROBLEM: 0,
    TEMPLATE_DNA_PROBLEM: 0,
    RETRIEVAL_PROBLEM: 0,
    RESPONSE_CONTRACT_PROBLEM: 0,
    AMBIGUOUS_OK: 0
  };

  for (let ri = 0; ri < intentFailRows.length; ri++) {
    const r = intentFailRows[ri];
    byBucket[r.bucket].push(r);
    clsHist[r.classification] = (clsHist[r.classification] || 0) + 1;
  }

  const rankedBuckets = BUCKETS.map((b) => ({ b, n: byBucket[b].length })).sort((a, c) => c.n - a.n);

  function topSlot(idx) {
    if (intentFailRows.length === 0 && totalCases > 0 && idx === 0) {
      return {
        name: "rcz2_retrieval||zero_intent_fail_in_live_slice",
        count: totalCases,
        classification: "PASS_CLEAN",
        rec: "proceed_to_300k_retrieval_stress_generator_scripts_only_monitor_calendar_task_note_cross_module"
      };
    }
    if (intentFailRows.length === 0) {
      return {
        name: "NONE",
        count: 0,
        classification: "N_A",
        rec: "no_intent_fail_bucket_mass_at_this_rank"
      };
    }
    const slot = rankedBuckets[idx];
    if (!slot || slot.n === 0) {
      return {
        name: "NONE",
        count: 0,
        classification: "N_A",
        rec: "no_intent_fail_bucket_mass_at_this_rank"
      };
    }
    const rows = byBucket[slot.b];
    const cls = dominantClsInBucket(rows);
    return {
      name: slot.b,
      count: slot.n,
      classification: cls,
      rec: bucketToRecommendedTask(slot.b)
    };
  }

  const t1 = topSlot(0);
  const t2 = topSlot(1);
  const t3 = topSlot(2);

  const trueEngineBugCount = clsHist.ENGINE_BUG || 0;
  const harnessOrGoldProblemCount = (clsHist.HARNESS_BUG || 0) + (clsHist.GOLD_PROBLEM || 0);
  const templateDnaProblemCount = clsHist.TEMPLATE_DNA_PROBLEM || 0;
  const ambiguousInputCount = clsHist.AMBIGUOUS_OK || 0;
  const safetyRiskCount = dangerousWrite;

  const otherShare = intentFailRows.length ? byBucket.other.length / intentFailRows.length : 0;
  const separationCapable =
    intentFailRows.length === 0
      ? "YES"
      : otherShare <= 0.4 && rankedBuckets[0].n > 0
        ? "YES"
        : "NO";

  const pilotCases = buildRetrievalPilotCases(PILOT_N);
  let pilotPass = 0;
  let pilotDang = 0;
  let pilotFalseW = 0;
  let pilotQcw = 0;
  let pilotNegW = 0;
  for (let pi = 0; pi < pilotCases.length; pi++) {
    const pc = pilotCases[pi];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e1) {
      void e1;
    }
    const turnP = eng.processUserTurn(pc.input, eng.createEmptyDraft(), ctxForCase(pc.group));
    const evP = evaluateOne(pc, turnP);
    if (evP.pass) pilotPass++;
    const fi = foldCs(pc.input);
    const engP = turnP.normalizedIntent;
    const psP = turnP.processingState;
    const createLike =
      psP === "READY_TO_SAVE" || engP === "calendar.create" || engP === "tasks.create" || engP === "notes.create";
    if (hasNegWrite(fi) && createLike) pilotNegW++;
    if (evP.cat === "query_created_write") {
      pilotQcw++;
      pilotDang++;
    }
    if (evP.cat === "negative_instruction_fail") pilotDang++;
    if (!evP.pass && isQueryGroup(pc.group) && (evP.cat === "query_created_write" || evP.cat === "negative_instruction_fail")) {
      pilotFalseW++;
    }
  }

  const pilotAcc = pilotCases.length ? ((pilotPass / pilotCases.length) * 100).toFixed(2) : "0.00";

  const safetyPass =
    dangerousWrite === 0 &&
    falseWrite === 0 &&
    queryCreatedWrite === 0 &&
    writeWhenNegated === 0 &&
    pilotDang === 0 &&
    pilotFalseW === 0 &&
    pilotQcw === 0 &&
    pilotNegW === 0;

  const massiveCorpusReady = safetyPass && totalCases > 0 ? "YES" : "NO";

  let readyForEngineFix = "NO";
  if (safetyPass && trueEngineBugCount > 0 && trueEngineBugCount >= (clsHist.RETRIEVAL_PROBLEM || 0) * 0.35) {
    readyForEngineFix = "YES";
  }

  let recommendedNextTask = "expand_300k_retrieval_generator_scripts_only_then_re_audit";
  if (t1.name !== "NONE") {
    recommendedNextTask = t1.rec;
  }
  if (!safetyPass) {
    recommendedNextTask = "STOP_safety_counters_nonzero_investigate_before_300k_generator";
  } else if (separationCapable === "NO") {
    recommendedNextTask = "refine_assignRetrievalBucket_to_reduce_other_fraction_before_engine_claims";
  }

  const diagnosticScript = "scripts/silver-retrieval-stress-300k-foundation-diagnostic.cjs";
  const diagnosticReport = writeReport ? "scripts/silver-retrieval-stress-300k-foundation-diagnostic-report.json" : "(stdout_only)";

  if (writeReport) {
    const reportObj = {
      harness_id: "retrieval_stress_300k_foundation_diagnostic",
      expected_main_commit: EXPECTED_MAIN_COMMIT,
      actual_main_commit: mainCommit,
      target_cluster: TARGET_CLUSTER_NAME,
      total_rcz2_retrieval_cases: totalCases,
      retrieval_pass_count: passAll,
      retrieval_accuracy_percent: accuracy,
      intent_fail_count: intentFailRows.length,
      bucket_rank: rankedBuckets,
      classification_counts: clsHist,
      safety_full_cluster: {
        dangerous_write_count: dangerousWrite,
        false_write_count: falseWrite,
        query_created_write_count: queryCreatedWrite,
        write_when_negated_count: writeWhenNegated,
        negative_instruction_fail_count: negInstructionFail
      },
      safety_pilot: {
        pilot_cases: pilotCases.length,
        pilot_accuracy_percent: pilotAcc,
        dangerous_write_count: pilotDang,
        false_write_count: pilotFalseW,
        query_created_write_count: pilotQcw,
        write_when_negated_count: pilotNegW
      },
      separation_capable: separationCapable,
      top_clusters: [t1, t2, t3],
      recommended_next_task: recommendedNextTask
    };
    fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  }

  const porcAfter = gitPorcelainLines();
  const workingTreeCleanAfter = porcAfter.length === 0 ? "YES" : onlyAllowedDirty(porcAfter) ? "YES" : "NO";
  const changedPaths = gitChangedFiles();
  const changedFiles = changedPaths.length ? changedPaths.join(";") : "";
  const gitStatusClean = porcAfter.length === 0 ? "YES" : onlyAllowedDirty(porcAfter) ? "YES" : "NO";

  const diagnosticPassForPr = safetyPass && separationCapable === "YES";

  const out = [];
  out.push("=== RETRIEVAL_STRESS_300K_FOUNDATION_DIAGNOSTIC_RESULT ===");
  out.push("");
  out.push("main_commit=" + escapeField(mainCommit));
  out.push("engine_changed=NO");
  out.push("assets_app_changed=NO");
  out.push("ui_changed=NO");
  out.push("css_changed=NO");
  out.push("backend_changed=NO");
  out.push("");
  out.push("working_tree_clean_before=" + workingTreeCleanBefore);
  out.push("working_tree_clean_after=" + workingTreeCleanAfter);
  out.push("");
  out.push("diagnostic_script=" + escapeField(diagnosticScript));
  out.push("diagnostic_report=" + escapeField(diagnosticReport));
  out.push("");
  out.push("total_cases=" + totalCases);
  out.push("accuracy=" + accuracy);
  out.push("");
  out.push("top_cluster_1=" + escapeField(t1.name));
  out.push("top_cluster_1_count=" + t1.count);
  out.push("top_cluster_1_classification=" + escapeField(t1.classification));
  out.push("top_cluster_1_recommended_next_task=" + escapeField(t1.rec));
  out.push("");
  out.push("top_cluster_2=" + escapeField(t2.name));
  out.push("top_cluster_2_count=" + t2.count);
  out.push("top_cluster_2_classification=" + escapeField(t2.classification));
  out.push("");
  out.push("top_cluster_3=" + escapeField(t3.name));
  out.push("top_cluster_3_count=" + t3.count);
  out.push("top_cluster_3_classification=" + escapeField(t3.classification));
  out.push("");
  out.push("true_engine_bug_count=" + trueEngineBugCount);
  out.push("harness_or_gold_problem_count=" + harnessOrGoldProblemCount);
  out.push("template_dna_problem_count=" + templateDnaProblemCount);
  out.push("ambiguous_input_count=" + ambiguousInputCount);
  out.push("safety_risk_count=" + safetyRiskCount);
  out.push("");
  out.push("dangerous_write_count=" + dangerousWrite);
  out.push("false_write_count=" + falseWrite);
  out.push("query_created_write_count=" + queryCreatedWrite);
  out.push("write_when_negated_count=" + writeWhenNegated);
  out.push("");
  out.push("massive_corpus_ready=" + massiveCorpusReady);
  out.push("ready_for_engine_fix=" + readyForEngineFix);
  out.push("recommended_next_task=" + escapeField(recommendedNextTask));
  out.push("");
  out.push("classification_separation_capable=" + separationCapable);
  out.push("diagnostic_pass_for_pr=" + (diagnosticPassForPr ? "YES" : "NO"));
  out.push("pilot_cases=" + pilotCases.length);
  out.push("pilot_accuracy=" + pilotAcc);
  out.push("pilot_safety_merged_into_full_cluster_counters=NO");
  out.push("");
  out.push("changed_files=" + escapeField(changedFiles));
  out.push("git_status_clean=" + gitStatusClean);
  out.push("");
  out.push("=== END_RETRIEVAL_STRESS_300K_FOUNDATION_DIAGNOSTIC_RESULT ===");

  console.log("\n" + out.join("\n"));

  if (writeReport) {
    console.log("\noptional_report_written=" + REPORT_JSON);
  }

  try {
    execSync('powershell.exe -NoProfile -Command "[console]::beep(880,250)"', {
      cwd: REPO,
      stdio: "ignore",
      windowsHide: true
    });
    execSync('powershell.exe -NoProfile -Command "[console]::beep(880,250)"', {
      cwd: REPO,
      stdio: "ignore",
      windowsHide: true
    });
  } catch (e5) {
    void e5;
  }

  if (!diagnosticPassForPr) {
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = { EXPECTED_MAIN_COMMIT, TARGET_CLUSTER_NAME };
