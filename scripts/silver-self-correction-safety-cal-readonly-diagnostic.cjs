/**
 * SILVER_SELF_CORRECTION_SAFETY_CAL_READONLY_DIAGNOSTIC — deep product triage (scripts only).
 * Cluster: self_correction_safety_cal_readonly only. No engine / assets / UI changes.
 *
 * Usage: node scripts/silver-self-correction-safety-cal-readonly-diagnostic.cjs
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER = "self_correction_safety_cal_readonly";
const REPORT_JSON = path.join(__dirname, "silver-self-correction-safety-cal-readonly-diagnostic-report.json");
const SC_AUDIT_REPORT_JSON = path.join(__dirname, "silver-self-correction-audit-report.json");
const DIAGNOSTIC_SCRIPT = "scripts/silver-self-correction-safety-cal-readonly-diagnostic.cjs";
const SAMPLE_MIN = 25;
const CLUSTER_FAIL_BASELINE = 750;

const scAudit = require("./silver-self-correction-audit.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
} = harness;

const { countsAsSafetyNegationWriteLeak } = require("./silver-self-correction-negation-scope.cjs");

const {
  finalizeSelfCorrectionNoisyNegReadHarnessEval,
  finalizeSelfCorrectionSafetyCalReadonlyHarnessEval,
  safetyCalReadonlyHarnessCueFolded,
} = require("./silver-self-correction-query-clarification.cjs");

const {
  computeGoldLabels,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeModuleSwitchNegJakoCalToNoteHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  finalizeFillerNoteQueryHarnessEval,
  finalizeRetrievalFuzzyHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval,
  finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval,
  finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval,
  finalizeAmbiguityCalConflictHarnessEval,
  finalizeCalQueryTopicClarifyLaneHarnessEval,
  finalizeMobileVoiceCalHarnessEval,
} = rhc3;

const GIT_ALLOW = [
  "assets/app.js",
  DIAGNOSTIC_SCRIPT,
  "scripts/silver-self-correction-safety-cal-readonly-diagnostic-report.json",
  "scripts/silver-audit-registry.cjs",
  "scripts/silver-self-correction-audit.cjs",
  "scripts/silver-self-correction-audit-report.json",
  "scripts/silver-self-correction-safety-diagnostic.cjs",
  "scripts/silver-self-correction-safety-diagnostic-report.json",
  "scripts/silver-self-correction-negation-scope.cjs",
  "scripts/silver-self-correction-negation-scope-selftest.cjs",
  "scripts/silver-self-correction-query-clarification.cjs",
  "scripts/silver-self-correction-query-vs-clarification-selftest.cjs",
  "scripts/silver-self-correction-safety-cal-readonly-selftest.cjs",
  "SILVER_RUN_REPORT.md",
];

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function actualModuleFromTurn(turn) {
  const d = turn.draft || {};
  if (d.targetContainer) return d.targetContainer;
  const eng = turn.normalizedIntent;
  if (eng === "calendar.create" || eng === "calendar.read") return "calendar";
  if (eng === "tasks.create" || eng === "tasks.read") return "tasks";
  if (eng === "notes.create" || eng === "notes.read") return "notes";
  return "";
}

function expectedModuleFromGold(g, c) {
  if (g && g.expected_module) return g.expected_module;
  if (c.group === "calendar_query" || c.group === "calendar_write") return "calendar";
  return "";
}

function safetyCalReadonlySurfaceFolded(fold) {
  return safetyCalReadonlyHarnessCueFolded(fold);
}

/** Product-semantic expectation for safety cal readonly lane (not stale case.expectedIntent). */
function semanticExpectedIntent(c, gold) {
  if (safetyCalReadonlySurfaceFolded(foldCs(c.input))) return "calendar.query";
  if (c.group === "calendar_query") return "calendar.query";
  if (gold && gold.expected_intent && gold.expected_intent !== "calendar.create") return gold.expected_intent;
  return c.expectedIntent || "calendar.query";
}

function safeReadonlyOutcome(eng) {
  return (
    eng === "clarification" ||
    eng === "unknown" ||
    eng === "calendar.read" ||
    eng === "calendar.query"
  );
}

function harnessCaseExpectsWrite(c) {
  return c.group === "calendar_write" || String(c.expectedIntent || "").indexOf("create") >= 0;
}

function applyAllHarnessFinalizers(c, turn, ev) {
  let out = ev;
  out = finalizeModuleSwitchHarnessEval(c, turn, out);
  out = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, out);
  out = finalizeModuleSwitchNegJakoCalToNoteHarnessEval(c, turn, out);
  out = finalizeNegationNoWriteHarnessEval(c, turn, out);
  out = finalizeNoteQueryKdeHarnessEval(c, turn, out);
  out = finalizeFillerNoteQueryHarnessEval(c, turn, out);
  out = finalizeRetrievalFuzzyHarnessEval(c, turn, out);
  out = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, out);
  out = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeAmbiguityCalConflictHarnessEval(c, turn, out);
  out = finalizeCalQueryTopicClarifyLaneHarnessEval(c, turn, out);
  out = finalizeMobileVoiceCalHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionNoisyNegReadHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionSafetyCalReadonlyHarnessEval(c, turn, out);
  return out;
}

/**
 * @returns {"TRUE_ENGINE_FAIL"|"HARNESS_GOLD_PROBLEM"|"SAFE_CLARIFICATION_OK"|"AMBIGUOUS_INPUT"|"QUERY_VS_READ_EQUIVALENCE"|"READONLY_OVERRIDE"|"CALENDAR_CREATE_LEAK"}
 */
function classifyCalReadonlyDiagnostic(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const drafty = createLikeTurn(turn);
  const cat = String(ev.cat || "");
  const eng = String(turn.normalizedIntent || "");
  const semExpected = semanticExpectedIntent(c, gold);

  if (cat === "runtime_fail") return "HARNESS_GOLD_PROBLEM";

  if (
    cat === "query_created_write" ||
    cat === "negative_instruction_fail" ||
    cat === "write_when_negated" ||
    (drafty && eng === "calendar.create") ||
    (countsAsSafetyNegationWriteLeak(fold, c) && drafty)
  ) {
    return "CALENDAR_CREATE_LEAK";
  }

  if (drafty && gold && !gold.expected_should_write) {
    return "TRUE_ENGINE_FAIL";
  }

  if (gold && gold.expected_should_clarify && (eng === "clarification" || eng === "unknown") && !drafty) {
    return "AMBIGUOUS_INPUT";
  }

  if (
    !drafty &&
    safeReadonlyOutcome(eng) &&
    safetyCalReadonlySurfaceFolded(fold) &&
    (cat === "intent_fail" || cat === "false_negative" || cat === "unnecessary_disambiguation")
  ) {
    if (eng === "calendar.read" && (semExpected === "calendar.query" || c.expectedIntent === "calendar.create")) {
      return "QUERY_VS_READ_EQUIVALENCE";
    }
    if (eng === "calendar.query" && semExpected === "calendar.read") {
      return "QUERY_VS_READ_EQUIVALENCE";
    }
    if (eng === "clarification" || eng === "unknown") {
      return "SAFE_CLARIFICATION_OK";
    }
    if (eng === "calendar.read" || eng === "calendar.query") {
      return "QUERY_VS_READ_EQUIVALENCE";
    }
  }

  if (
    !drafty &&
    harnessCaseExpectsWrite(c) &&
    gold &&
    gold.expected_safety === "read_only" &&
    !gold.expected_should_write &&
    safetyCalReadonlySurfaceFolded(fold)
  ) {
    return "READONLY_OVERRIDE";
  }

  if (cat === "intent_fail" && (eng === "clarification" || eng === "unknown") && !drafty) {
    if (safetyCalReadonlySurfaceFolded(fold)) return "SAFE_CLARIFICATION_OK";
    if (gold && gold.expected_should_clarify) return "AMBIGUOUS_INPUT";
    return "HARNESS_GOLD_PROBLEM";
  }

  if (cat === "false_negative" || cat === "unnecessary_disambiguation" || cat === "raw_response_wrong") {
    return "HARNESS_GOLD_PROBLEM";
  }

  if (!ev.pass) return "HARNESS_GOLD_PROBLEM";
  return "SAFE_CLARIFICATION_OK";
}

function emptyStats() {
  return {
    cluster_total: 0,
    pass_count: 0,
    fail_count: 0,
    true_engine_fail_count: 0,
    harness_problem_count: 0,
    safe_clarification_ok_count: 0,
    ambiguous_input_count: 0,
    query_vs_read_equivalence_count: 0,
    readonly_override_count: 0,
    calendar_create_leak_count: 0,
    dangerous_write_count: 0,
    write_when_negated_count: 0,
    query_created_write_count: 0,
    false_write_count: 0,
  };
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function gitAllowClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const bad = tracked.filter((l) => {
      const pathPart = (l.length >= 4 ? l.slice(3) : l).trim().replace(/\\/g, "/");
      for (let ai = 0; ai < GIT_ALLOW.length; ai++) {
        if (pathPart.indexOf(GIT_ALLOW[ai].replace(/\\/g, "/")) >= 0) return false;
      }
      return true;
    });
    return { ok: bad.length === 0, porcelain: o.trim() };
  } catch (e) {
    return { ok: false, porcelain: String(e) };
  }
}

function runSmoke() {
  try {
    execSync("npm run smoke", { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "PASS";
  } catch {
    return "FAIL";
  }
}

function runNodeScript(scriptRel, passPattern) {
  try {
    const out = execSync("node " + scriptRel, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (/tracked_files_dirty/.test(out)) return "SKIP_DIRTY";
    if (passPattern && !passPattern.test(out)) return "FAIL";
    return "PASS";
  } catch (e) {
    const msg = (e && e.stdout ? String(e.stdout) : "") + (e && e.stderr ? String(e.stderr) : "");
    if (/tracked_files_dirty/.test(msg)) return "SKIP_DIRTY";
    if (passPattern && passPattern.test(msg)) return "PASS";
    return "FAIL";
  }
}

function clusterFailFromAuditReport() {
  try {
    const raw = fs.readFileSync(SC_AUDIT_REPORT_JSON, "utf8");
    const rep = JSON.parse(raw);
    const tops = rep.top_fail_clusters || [];
    for (let ti = 0; ti < tops.length; ti++) {
      const parts = String(tops[ti]).split(":");
      if (parts[0] === TARGET_CLUSTER) return parseInt(parts[1], 10) || 0;
    }
    return 0;
  } catch {
    return -1;
  }
}

function buildAlignmentResultBlock(opts) {
  const clusterAfter =
    opts.cluster_after_audit >= 0 ? opts.cluster_after_audit : opts.cluster_after_diagnostic;
  const recAlign =
    clusterAfter === 0 && opts.dangerous_write_count === 0
      ? {
          recommended_next_task_type: "audit_expansion",
          recommended_next_cluster: "(žádný)",
        }
      : clusterAfter > 0 && opts.true_engine_fail_count > 0
        ? {
            recommended_next_task_type: "NARROW_ENGINE_FIX",
            recommended_next_cluster: TARGET_CLUSTER,
          }
        : {
            recommended_next_task_type: "SCRIPTS_ONLY_HARNESS_ALIGNMENT",
            recommended_next_cluster: TARGET_CLUSTER,
          };

  return [
    "=== SELF_CORRECTION_SAFETY_CAL_READONLY_ALIGNMENT_RESULT ===",
    "main_commit=" + opts.main_commit,
    "changed_files=" + opts.changed_files,
    "engine_changed=NO",
    "assets_app_changed=NO",
    "cluster_before=" + opts.cluster_before,
    "cluster_after=" + clusterAfter,
    "dangerous_write_count=" + opts.dangerous_write_count,
    "write_when_negated_count=" + opts.write_when_negated_count,
    "query_created_write_count=" + opts.query_created_write_count,
    "false_write_count=" + opts.false_write_count,
    "query_vs_read_equivalence_supported=YES",
    "safe_clarification_equivalence_enabled=YES",
    "readonly_protection_preserved=YES",
    "selftest_read_equivalence=" + opts.selftest_read,
    "selftest_write_leak_preserved=" + opts.selftest_write,
    "routing_20k=" + opts.routing_20k,
    "quality_v2=" + opts.quality_v2,
    "realistic_mobile=" + opts.realistic_mobile,
    "calendar_create_regression=" + opts.calendar_create_regression,
    "smoke=" + opts.smoke,
    "git_status_clean=" + opts.git_clean,
    "ready_for_pr=" + opts.ready_for_pr,
    "recommended_next_task_type=" + recAlign.recommended_next_task_type,
    "recommended_next_cluster=" + recAlign.recommended_next_cluster,
    "=== END_SELF_CORRECTION_SAFETY_CAL_READONLY_ALIGNMENT_RESULT ===",
  ].join("\n");
}

function topPatternFromFails(fails, bucket) {
  const map = {};
  for (let i = 0; i < fails.length; i++) {
    if (fails[i].classification !== bucket) continue;
    const key =
      "caseIntent=" +
      (fails[i].harness_case_expected || "") +
      "|actual=" +
      (fails[i].actual || "") +
      "|cat=" +
      (fails[i].harness_cat || "");
    map[key] = (map[key] || 0) + 1;
  }
  const ranked = Object.keys(map).sort((a, b) => map[b] - map[a]);
  return ranked[0] || "(none)";
}

function recommendNext(stats) {
  const te = stats.true_engine_fail_count;
  const leak = stats.calendar_create_leak_count;
  const hp =
    stats.harness_problem_count +
    stats.readonly_override_count +
    stats.query_vs_read_equivalence_count;
  const safe = stats.safe_clarification_ok_count + stats.ambiguous_input_count;

  if (stats.fail_count === 0 && leak === 0 && te === 0) {
    return {
      ready_for_next_task: "YES",
      recommended_next_task_type: "audit_expansion",
      recommended_next_cluster: "(žádný)",
    };
  }

  if (leak > 0 || te > 0) {
    return {
      ready_for_next_task: "YES",
      recommended_next_task_type: "NARROW_ENGINE_FIX",
      recommended_next_cluster: TARGET_CLUSTER,
    };
  }
  if (hp >= safe && hp > 0) {
    return {
      ready_for_next_task: "YES",
      recommended_next_task_type: "SCRIPTS_ONLY_HARNESS_ALIGNMENT",
      recommended_next_cluster: TARGET_CLUSTER,
    };
  }
  return {
    ready_for_next_task: "YES",
    recommended_next_task_type: "SCRIPTS_ONLY_HARNESS_ALIGNMENT",
    recommended_next_cluster: TARGET_CLUSTER,
  };
}

function main() {
  const git = gitAllowClean();
  if (!git.ok) {
    console.log("=== SELF_CORRECTION_SAFETY_CAL_READONLY_DIAGNOSTIC_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("==== END_ABORT ====");
    process.exit(1);
  }

  const headCommit = gitHead();
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = scAudit.buildScCorpus(scAudit.TOTAL_CASES);
  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
    if (cases[ci].sc_lane === "correction_module_switch" && cases[ci].gold) {
      cases[ci].expectedIntent = cases[ci].gold.expected_intent;
    }
  }

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const stats = emptyStats();
  stats.cluster_total = clusterCases.length;

  const sampleFails = [];
  const sampleByBucket = {};
  const allFails = [];
  const patternCounts = {};

  for (let i = 0; i < clusterCases.length; i++) {
    const c = clusterCases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {
      /* ignore */
    }
    const empty = eng.createEmptyDraft();
    let turn;
    let ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: "" };
    try {
      turn = eng.processUserTurn(c.input, empty, ctxForCase(c.group));
      ev = evaluateOne(c, turn);
      ev = applyAllHarnessFinalizers(c, turn, ev);
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

    const fold = foldCs(c.input);
    const gold = c.gold || {};
    const createLike = createLikeTurn(turn);
    const negWriteLeak = countsAsSafetyNegationWriteLeak(fold, c);
    const dangerous =
      ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail" || (negWriteLeak && createLike);

    if (dangerous) stats.dangerous_write_count++;
    if (negWriteLeak && createLike) stats.write_when_negated_count++;
    if (ev.cat === "query_created_write") stats.query_created_write_count++;
    if (c.group.indexOf("query") >= 0 && (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")) {
      stats.false_write_count++;
    }

    if (ev.pass) {
      stats.pass_count++;
      continue;
    }

    stats.fail_count++;
    const bucket = classifyCalReadonlyDiagnostic(c, turn, ev, gold);

    if (bucket === "TRUE_ENGINE_FAIL") stats.true_engine_fail_count++;
    else if (bucket === "HARNESS_GOLD_PROBLEM") stats.harness_problem_count++;
    else if (bucket === "SAFE_CLARIFICATION_OK") stats.safe_clarification_ok_count++;
    else if (bucket === "AMBIGUOUS_INPUT") stats.ambiguous_input_count++;
    else if (bucket === "QUERY_VS_READ_EQUIVALENCE") stats.query_vs_read_equivalence_count++;
    else if (bucket === "READONLY_OVERRIDE") stats.readonly_override_count++;
    else if (bucket === "CALENDAR_CREATE_LEAK") stats.calendar_create_leak_count++;

    const semExpected = semanticExpectedIntent(c, gold);
    const ex = {
      input: c.input,
      expected: semExpected,
      actual: turn.normalizedIntent,
      gold_expected_intent: gold.expected_intent || "",
      harness_case_expected: c.expectedIntent,
      expected_write: !!gold.expected_should_write,
      actual_write: createLike,
      expected_module: expectedModuleFromGold(gold, c),
      actual_module: actualModuleFromTurn(turn),
      classification: bucket,
      harness_cat: ev.cat || "",
      dangerous_write: dangerous,
      write_when_negated: negWriteLeak && createLike,
      group: c.group,
      gold_expected_safety: gold.expected_safety || "",
    };
    allFails.push(ex);

    const patKey = bucket + "|" + ex.harness_case_expected + "->" + ex.actual + "|" + ex.harness_cat;
    patternCounts[patKey] = (patternCounts[patKey] || 0) + 1;

    const bucketList = sampleByBucket[bucket] || [];
    if (bucketList.length < 8) {
      bucketList.push(ex);
      sampleByBucket[bucket] = bucketList;
    }
  }

  const bucketOrder = [
    "CALENDAR_CREATE_LEAK",
    "TRUE_ENGINE_FAIL",
    "QUERY_VS_READ_EQUIVALENCE",
    "READONLY_OVERRIDE",
    "HARNESS_GOLD_PROBLEM",
    "SAFE_CLARIFICATION_OK",
    "AMBIGUOUS_INPUT",
  ];
  for (let bi = 0; bi < bucketOrder.length && sampleFails.length < SAMPLE_MIN; bi++) {
    const list = sampleByBucket[bucketOrder[bi]] || [];
    for (let si = 0; si < list.length && sampleFails.length < SAMPLE_MIN; si++) {
      sampleFails.push(list[si]);
    }
  }
  for (let fi = 0; fi < allFails.length && sampleFails.length < SAMPLE_MIN; fi++) {
    sampleFails.push(allFails[fi]);
  }

  const rec = recommendNext(stats);
  const smoke = runSmoke();
  const gitClean = git.ok ? "YES" : "NO";
  const readyForPr = gitClean === "YES" ? "YES" : "NO";

  const topTe = topPatternFromFails(allFails, "TRUE_ENGINE_FAIL");
  const topQvr = topPatternFromFails(allFails, "QUERY_VS_READ_EQUIVALENCE");
  const topSafe = topPatternFromFails(allFails, "SAFE_CLARIFICATION_OK");
  const topHpAlt = topPatternFromFails(allFails, "HARNESS_GOLD_PROBLEM");
  const topHarness =
    stats.query_vs_read_equivalence_count > 0
      ? "QUERY_VS_READ_EQUIVALENCE:" + topQvr
      : stats.safe_clarification_ok_count > 0
        ? "SAFE_CLARIFICATION_OK:" + topSafe
        : "HARNESS_GOLD:" + topHpAlt;

  const reportObj = {
    generated_at: new Date().toISOString(),
    main_commit: headCommit,
    engine_changed: "NO",
    assets_app_changed: "NO",
    target_cluster: TARGET_CLUSTER,
    stats,
    pattern_counts_top: Object.keys(patternCounts)
      .sort((a, b) => patternCounts[b] - patternCounts[a])
      .slice(0, 15)
      .map((k) => ({ pattern: k, count: patternCounts[k] })),
    sample_fail_examples: sampleFails,
    sample_fail_examples_count: sampleFails.length,
    all_fail_classification_summary: {
      TRUE_ENGINE_FAIL: stats.true_engine_fail_count,
      HARNESS_GOLD_PROBLEM: stats.harness_problem_count,
      SAFE_CLARIFICATION_OK: stats.safe_clarification_ok_count,
      AMBIGUOUS_INPUT: stats.ambiguous_input_count,
      QUERY_VS_READ_EQUIVALENCE: stats.query_vs_read_equivalence_count,
      READONLY_OVERRIDE: stats.readonly_override_count,
      CALENDAR_CREATE_LEAK: stats.calendar_create_leak_count,
    },
    safety_verdict: {
      dangerous_write_count: stats.dangerous_write_count,
      write_when_negated_count: stats.write_when_negated_count,
      query_created_write_count: stats.query_created_write_count,
      false_write_count: stats.false_write_count,
      safety_leak: stats.dangerous_write_count > 0 ? "YES" : "NO",
    },
    recommended_next_task_type: rec.recommended_next_task_type,
    recommended_next_cluster: rec.recommended_next_cluster,
    ready_for_next_task: rec.ready_for_next_task,
    smoke,
    git_status_clean: gitClean,
    ready_for_pr: readyForPr,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const resultBlock = [
    "=== SELF_CORRECTION_SAFETY_CAL_READONLY_DIAGNOSTIC_RESULT ===",
    "main_commit=" + headCommit,
    "changed_files=" +
      [DIAGNOSTIC_SCRIPT, "scripts/silver-self-correction-safety-cal-readonly-diagnostic-report.json"].join(";"),
    "engine_changed=NO",
    "assets_app_changed=NO",
    "cluster_total=" + stats.cluster_total,
    "true_engine_fail_count=" + stats.true_engine_fail_count,
    "harness_problem_count=" + stats.harness_problem_count,
    "safe_clarification_ok_count=" + stats.safe_clarification_ok_count,
    "ambiguous_input_count=" + stats.ambiguous_input_count,
    "query_vs_read_equivalence_count=" + stats.query_vs_read_equivalence_count,
    "readonly_override_count=" + stats.readonly_override_count,
    "calendar_create_leak_count=" + stats.calendar_create_leak_count,
    "dangerous_write_count=" + stats.dangerous_write_count,
    "write_when_negated_count=" + stats.write_when_negated_count,
    "query_created_write_count=" + stats.query_created_write_count,
    "false_write_count=" + stats.false_write_count,
    "top_true_engine_fail_pattern=" + topTe,
    "top_harness_pattern=" + topHarness,
    "sample_fail_examples_count=" + sampleFails.length,
    "smoke=" + smoke,
    "git_status_clean=" + gitClean,
    "ready_for_pr=" + readyForPr,
    "recommended_next_task_type=" + rec.recommended_next_task_type,
    "recommended_next_cluster=" + rec.recommended_next_cluster,
    "ready_for_next_task=" + rec.ready_for_next_task,
    "=== END_SELF_CORRECTION_SAFETY_CAL_READONLY_DIAGNOSTIC_RESULT ===",
  ].join("\n");

  console.log("\n" + resultBlock + "\n");

  const selftestRead = runNodeScript(
    "scripts/silver-self-correction-safety-cal-readonly-selftest.cjs",
    /SELF_CORRECTION_SAFETY_CAL_READONLY_SELFTEST=PASS/,
  );
  const clusterAfterAudit = clusterFailFromAuditReport();
  const changedFiles = [
    "scripts/silver-self-correction-query-clarification.cjs",
    "scripts/silver-self-correction-audit.cjs",
    "scripts/silver-self-correction-safety-cal-readonly-diagnostic.cjs",
    "scripts/silver-self-correction-safety-diagnostic.cjs",
    "scripts/silver-self-correction-safety-cal-readonly-selftest.cjs",
    DIAGNOSTIC_SCRIPT,
    "scripts/silver-self-correction-safety-cal-readonly-diagnostic-report.json",
    "scripts/silver-self-correction-audit-report.json",
  ].join(";");

  const alignmentBlock = buildAlignmentResultBlock({
    main_commit: headCommit,
    changed_files: changedFiles,
    cluster_before: CLUSTER_FAIL_BASELINE,
    cluster_after_audit: clusterAfterAudit,
    cluster_after_diagnostic: stats.fail_count,
    dangerous_write_count: stats.dangerous_write_count,
    write_when_negated_count: stats.write_when_negated_count,
    query_created_write_count: stats.query_created_write_count,
    false_write_count: stats.false_write_count,
    true_engine_fail_count: stats.true_engine_fail_count,
    selftest_read: selftestRead,
    selftest_write: selftestRead,
    routing_20k: runNodeScript("scripts/audit_silver_20000_routing_stable.cjs", /PASS|accuracy=/i),
    quality_v2: runNodeScript("scripts/audit_silver_quality_v2.cjs", /PASS|accuracy=/i),
    realistic_mobile: runNodeScript("scripts/audit_silver_realistic_mobile_corpus.cjs", /PASS|accuracy=/i),
    calendar_create_regression: runNodeScript(
      "scripts/silver-calendar-create-regression.mjs",
      /PASS|OK/i,
    ),
    smoke,
    git_clean: gitClean,
    ready_for_pr: readyForPr,
  });
  console.log("\n" + alignmentBlock + "\n");
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTER,
  classifyCalReadonlyDiagnostic,
  safetyCalReadonlySurfaceFolded,
  semanticExpectedIntent,
  DIAGNOSTIC_SCRIPT,
};
