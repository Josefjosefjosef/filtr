/**
 * RHC3 cluster diagnostic: rhc3_mobile_voice_cal (read-only engine; scripts-only).
 * Family: mobile_voice_dirty_czech. No assets/app.js edits.
 *
 * Subcluster taxonomy (deterministic):
 *   true_engine_bug_calendar | true_engine_bug_task | true_engine_bug_note | true_engine_bug_routing
 *   harness_should_accept_safe_clarification | gold_too_strict | response_contract_storage_disambig
 *   template_dna_mobile_noise | speech_to_text_noise | conversational_czech_noise
 *   retrieval_query_relevance | negation_no_write_safety_ok | module_switching_conflict
 *   explicit_module_signal_missed | UNCLASSIFIED
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-mobile-voice-cluster-diagnostic-report.json");
const ALIGNMENT_REPORT_JSON = path.join(__dirname, "silver-rhc3-mobile-voice-harness-alignment-report.json");
const RHC3_REPORT_JSON = path.join(__dirname, "silver-real-human-chaos-v3-report.json");

const HARNESS_ALIGN_BASELINE = {
  cluster_fail_count: 125,
  safe_clarification_count: 125,
  true_engine_bug_count: 0
};

const EXPECTED_MAIN_COMMIT = "893763bd622e6c168dbec2342fc0d93432da7cdd";
const TARGET_CLUSTER = "rhc3_mobile_voice_cal";

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();

const SUBCLUSTERS = [
  "true_engine_bug_calendar",
  "true_engine_bug_task",
  "true_engine_bug_note",
  "true_engine_bug_routing",
  "harness_should_accept_safe_clarification",
  "gold_too_strict",
  "response_contract_storage_disambig",
  "template_dna_mobile_noise",
  "speech_to_text_noise",
  "conversational_czech_noise",
  "retrieval_query_relevance",
  "negation_no_write_safety_ok",
  "module_switching_conflict",
  "explicit_module_signal_missed",
  "UNCLASSIFIED"
];

const core = require("./rhc-v3-deterministic-core.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
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
  finalizeMobileVoiceCalHarnessEval
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, hasNegWrite } =
  harness;

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function countKey(map, k) {
  map[k] = (map[k] || 0) + 1;
}

function hasCalendarSignal(f) {
  return /\b(kalend|schuz|schůz|udalost|udál|zubar|zubař|dokt|rano|ráno|vecer|večer|zitra|zítra|pozitri|pozítří|program\s+na)\b/.test(f);
}

function hasTaskSignal(f) {
  return /\b(ukol|úkol|uloha|úloh|splnit|udel|udělat|koupit|do\s+ukol|v\s+ukol)\b/.test(f);
}

function hasNoteSignal(f) {
  return /\b(poznam|poznám|napis\s+si|zapamat|do\s+poznam|v\s+poznam)\b/.test(f);
}

function hasExplicitModuleSignal(f) {
  return /\b(do\s+kalend|v\s+kalend|do\s+ukol|v\s+ukol|do\s+poznam|v\s+poznam|jen\s+v\s+(kalend|ukol|poznam))\b/.test(f);
}

function explicitModuleKind(f) {
  if (/\b(do\s+kalend|v\s+kalend|jen\s+v\s+kalend)\b/.test(f)) return "calendar";
  if (/\b(do\s+ukol|v\s+ukol|jen\s+v\s+ukol)\b/.test(f)) return "task";
  if (/\b(do\s+poznam|v\s+poznam|jen\s+v\s+poznam)\b/.test(f)) return "note";
  return "";
}

function hasModuleSwitch(f) {
  return /\bne\s+do\s+(kalend|ukol|poznam)|\bne\s+v\s+(kalend|ukol|poznam)|\bale\s+do\s+(kalend|ukol|poznam)/.test(f);
}

function hasReadQueryCue(f) {
  return (
    /\b(kde|kdy|co\s+mam|mrkni|najdi|hled|podivej|podívej|koukni|ukaz\s+mi)\b/.test(f) || /\?/.test(f)
  );
}

function mobileFillerCount(f) {
  let n = 0;
  const fillers = [
    /\bhele\b/g,
    /\bbtw\b/g,
    /\btyjo\b/g,
    /\bfakt\b/g,
    /\bjako\b/g,
    /\bprosim\b/g,
    /\bdiky\b/g,
    /\bdíky\b/g,
    /\bvlastne\b/g,
    /\bpockej\b/g,
    /\bjojo\b/g,
    /\beee+\b/g,
    /\behm\b/g
  ];
  for (let i = 0; i < fillers.length; i++) {
    const m = f.match(fillers[i]);
    if (m) n += m.length;
  }
  return n;
}

function isMobileVoiceNoisy(f) {
  return mobileFillerCount(f) >= 2;
}

function isConversationalCzechNoise(c, f) {
  const mask = (c.mutation_mask || 0) >>> 0;
  const mobile = (mask & core.M.MOBILE_PREFIX) !== 0;
  const filler = (mask & core.M.FILLER_PREFIX) !== 0 || (mask & core.M.FILLER_SUFFIX) !== 0;
  return (mobile || filler) && isMobileVoiceNoisy(f) && !hasExplicitModuleSignal(f);
}

function templateDnaMismatch(g, f) {
  const grp = String(g || "");
  const cal = hasCalendarSignal(f);
  const task = hasTaskSignal(f);
  const note = hasNoteSignal(f);
  if (grp.indexOf("calendar") === 0 && !cal && (task || note)) return true;
  if (grp.indexOf("task") === 0 && !task && (cal || note)) return true;
  if (grp.indexOf("note") === 0 && !note && (cal || task)) return true;
  return false;
}

function explicitModuleMissed(g, exp, act, eng, ps, f) {
  const explicit = explicitModuleKind(f);
  if (!explicit) return "";
  const expCal = String(exp || "").indexOf("calendar") === 0;
  const expTask = String(exp || "").indexOf("task") === 0;
  const expNote = String(exp || "").indexOf("note") === 0;
  if (expCal && explicit === "calendar" && (act === "unknown" || act !== exp)) return "calendar";
  if (expTask && explicit === "task" && (act === "unknown" || act !== exp)) return "task";
  if (expNote && explicit === "note" && (act === "unknown" || act !== exp)) return "note";
  if (g === "calendar_write" && explicit === "calendar" && eng !== "calendar.create" && ps !== "READY_TO_SAVE") {
    return "calendar";
  }
  return "";
}

function classifyMobileVoiceFail(c, turn, ev) {
  const f = foldCs(c.input);
  const exp = String(c.expectedIntent || "");
  const act = String(ev.auditIntent || "");
  const expUn = exp === "unknown";
  const actUn = act === "unknown";
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const cat = String(ev.cat || "");
  const g = String(c.group || "");

  if (hasNegWrite(f) && !createLikeTurn(turn)) {
    return { subcluster: "negation_no_write_safety_ok", primary: "HARNESS_OR_GOLD" };
  }

  if (hasReadQueryCue(f) && g.indexOf("write") >= 0 && !createLikeTurn(turn)) {
    return { subcluster: "retrieval_query_relevance", primary: "RETRIEVAL" };
  }

  if (hasModuleSwitch(f) && (hasCalendarSignal(f) || hasTaskSignal(f) || hasNoteSignal(f))) {
    return { subcluster: "module_switching_conflict", primary: "HARNESS_OR_GOLD" };
  }

  if (templateDnaMismatch(g, f)) {
    return { subcluster: "template_dna_mobile_noise", primary: "HARNESS_OR_GOLD" };
  }

  const missed = explicitModuleMissed(g, exp, act, eng, ps, f);
  if (missed === "calendar") return { subcluster: "true_engine_bug_calendar", primary: "TRUE_ENGINE_BUG" };
  if (missed === "task") return { subcluster: "true_engine_bug_task", primary: "TRUE_ENGINE_BUG" };
  if (missed === "note") return { subcluster: "true_engine_bug_note", primary: "TRUE_ENGINE_BUG" };
  if (missed) return { subcluster: "explicit_module_signal_missed", primary: "TRUE_ENGINE_BUG" };

  if (
    !expUn &&
    actUn &&
    (ps === "STORAGE_DISAMBIGUATION" || eng === "create.storage_disambiguation")
  ) {
    return { subcluster: "response_contract_storage_disambig", primary: "HARNESS_OR_GOLD" };
  }

  if (!expUn && actUn && (eng === "clarification" || ps === "CLARIFICATION")) {
    return { subcluster: "harness_should_accept_safe_clarification", primary: "SAFE_CLARIFICATION" };
  }

  if (!expUn && actUn) {
    if (isMobileVoiceNoisy(f) && !hasCalendarSignal(f) && !hasTaskSignal(f) && !hasNoteSignal(f)) {
      return { subcluster: "speech_to_text_noise", primary: "AMBIGUITY" };
    }
    if (isConversationalCzechNoise(c, f)) {
      return { subcluster: "conversational_czech_noise", primary: "AMBIGUITY" };
    }
    return { subcluster: "gold_too_strict", primary: "HARNESS_OR_GOLD" };
  }

  if (!expUn && !actUn && exp !== act) {
    if (exp.indexOf("calendar") === 0) {
      return { subcluster: "true_engine_bug_calendar", primary: "TRUE_ENGINE_BUG" };
    }
    if (exp.indexOf("task") === 0) {
      return { subcluster: "true_engine_bug_task", primary: "TRUE_ENGINE_BUG" };
    }
    if (exp.indexOf("note") === 0) {
      return { subcluster: "true_engine_bug_note", primary: "TRUE_ENGINE_BUG" };
    }
    return { subcluster: "true_engine_bug_routing", primary: "TRUE_ENGINE_BUG" };
  }

  if (cat === "wrong_collection" || cat === "calendar_vs_task_confusion" || cat === "note_vs_task_confusion") {
    if (createLikeTurn(turn)) {
      return { subcluster: "true_engine_bug_routing", primary: "TRUE_ENGINE_BUG" };
    }
    return { subcluster: "retrieval_query_relevance", primary: "RETRIEVAL" };
  }

  if (createLikeTurn(turn) && expUn) {
    return { subcluster: "true_engine_bug_routing", primary: "TRUE_ENGINE_BUG" };
  }

  if (eng === "clarification" || eng === "unknown" || actUn) {
    if (isConversationalCzechNoise(c, f)) {
      return { subcluster: "conversational_czech_noise", primary: "AMBIGUITY" };
    }
    return { subcluster: "harness_should_accept_safe_clarification", primary: "SAFE_CLARIFICATION" };
  }

  if (isMobileVoiceNoisy(f)) {
    return { subcluster: "speech_to_text_noise", primary: "AMBIGUITY" };
  }

  return { subcluster: "UNCLASSIFIED", primary: "UNCLASSIFIED" };
}

function parseReportClusterFail(rhc3Report) {
  const top = (rhc3Report && rhc3Report.top_clusters) || [];
  for (let i = 0; i < top.length; i++) {
    const parsed = String(top[i] || "").match(/^rhc3_mobile_voice_cal:(\d+)\/(\d+)$/);
    if (parsed) return { fail: parseInt(parsed[1], 10), total: parseInt(parsed[2], 10) };
  }
  return { fail: null, total: null };
}

function gitStatusShortClean() {
  try {
    const o = execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
    return o ? "NO" : "YES";
  } catch {
    return "UNKNOWN";
  }
}

function main() {
  let runnerHead = "";
  try {
    runnerHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    runnerHead = "UNKNOWN";
  }

  const hashBefore = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = rhc3.buildCorpus(TOTAL_CASES);
  if (cases.length !== TOTAL_CASES) {
    console.log("seed_data_fail=expected_" + TOTAL_CASES + "_got_" + cases.length);
    process.exit(1);
  }

  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
  }

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const totalClusterCases = clusterCases.length;

  const subclusterCounts = {};
  for (let si = 0; si < SUBCLUSTERS.length; si++) subclusterCounts[SUBCLUSTERS[si]] = 0;

  let clusterPass = 0;
  let clusterFailCount = 0;
  let safeClarificationAcceptedCount = 0;
  let hardWriteFailCount = 0;
  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  const failRows = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c.cluster !== TARGET_CLUSTER) continue;

    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {}
    const empty = eng.createEmptyDraft();
    let turn;
    let ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: "" };
    try {
      turn = eng.processUserTurn(c.input, empty, ctxForCase(c.group));
      ev = evaluateOne(c, turn);
      ev = finalizeModuleSwitchHarnessEval(c, turn, ev);
      ev = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeModuleSwitchNegJakoCalToNoteHarnessEval(c, turn, ev);
      ev = finalizeNegationNoWriteHarnessEval(c, turn, ev);
      ev = finalizeNoteQueryKdeHarnessEval(c, turn, ev);
      ev = finalizeFillerNoteQueryHarnessEval(c, turn, ev);
      ev = finalizeRetrievalFuzzyHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeAmbiguityCalConflictHarnessEval(c, turn, ev);
      ev = finalizeCalQueryTopicClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeMobileVoiceCalHarnessEval(c, turn, ev);
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

    const createLike = createLikeTurn(turn);
    if (c._mobile_voice_cal_clarification_harness_pass) safeClarificationAcceptedCount++;
    if (
      !ev.pass &&
      c.group.indexOf("query") >= 0 &&
      (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")
    ) {
      falseWriteCount++;
    }
    if (ev.cat === "query_created_write") queryCreatedWriteCount++;
    if (hasNegWrite(foldCs(c.input)) && createLike) writeWhenNegatedCount++;
    const caseDangerous =
      ev.cat === "query_created_write" ||
      ev.cat === "negative_instruction_fail" ||
      (hasNegWrite(foldCs(c.input)) && createLike);
    if (caseDangerous) dangerousWriteCount++;
    if (createLike && !ev.pass) hardWriteFailCount++;

    if (ev.pass) {
      clusterPass++;
    } else {
      clusterFailCount++;
      const cls = classifyMobileVoiceFail(c, turn, ev);
      countKey(subclusterCounts, cls.subcluster);
      failRows.push({
        id: c.id,
        family: c.family,
        group: c.group,
        input: c.input.slice(0, 220),
        expected: c.expectedIntent,
        actual: ev.auditIntent,
        cat: ev.cat,
        eng: turn.normalizedIntent,
        ps: turn.processingState,
        subcluster: cls.subcluster,
        primary: cls.primary
      });
    }
  }

  const hashAfter = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";
  const assetsAppChanged = hashBefore && hashAfter && hashBefore !== hashAfter ? "YES" : "NO";
  if (assetsAppChanged === "YES") {
    console.log("=== SILVER_RHC3_MOBILE_VOICE_CLUSTER_DIAGNOSTIC_ABORT ===");
    console.log("reason=assets_app_js_hash_changed");
    process.exit(1);
  }

  const trueEngineBugCount =
    (subclusterCounts.true_engine_bug_calendar || 0) +
    (subclusterCounts.true_engine_bug_task || 0) +
    (subclusterCounts.true_engine_bug_note || 0) +
    (subclusterCounts.true_engine_bug_routing || 0) +
    (subclusterCounts.explicit_module_signal_missed || 0);

  const harnessOrGoldCount =
    (subclusterCounts.harness_should_accept_safe_clarification || 0) +
    (subclusterCounts.gold_too_strict || 0) +
    (subclusterCounts.response_contract_storage_disambig || 0) +
    (subclusterCounts.template_dna_mobile_noise || 0) +
    (subclusterCounts.module_switching_conflict || 0) +
    (subclusterCounts.negation_no_write_safety_ok || 0);

  const ambiguityCount =
    (subclusterCounts.speech_to_text_noise || 0) + (subclusterCounts.conversational_czech_noise || 0);

  const retrievalRelevanceCount = subclusterCounts.retrieval_query_relevance || 0;

  const safeClarificationCount = subclusterCounts.harness_should_accept_safe_clarification || 0;

  const unclassifiedCount = subclusterCounts.UNCLASSIFIED || 0;
  const classifiedCount = clusterFailCount - unclassifiedCount;
  const noRuleCount = 0;

  const rhc3Report = readJsonSafe(RHC3_REPORT_JSON);
  const reportHint = parseReportClusterFail(rhc3Report);

  let readyForEngineFix = "NO";
  if (clusterFailCount > 0 && trueEngineBugCount > harnessOrGoldCount + ambiguityCount) {
    readyForEngineFix = "YES";
  }

  let recommendedNextFixScope =
    "scripts-only: extend harness clarification acceptance + gold tolerance for mobile_voice_dirty_czech / rhc3_mobile_voice_cal; no engine change";
  if (readyForEngineFix === "YES") {
    recommendedNextFixScope =
      "narrow engine routing fix for explicit calendar.create mobile_voice surfaces after harness sign-off; scope from true_engine_bug_* subclusters only";
  } else if (harnessOrGoldCount >= trueEngineBugCount && harnessOrGoldCount > 0) {
    recommendedNextFixScope =
      "scripts-only CAP50 prep: align harness/gold/response-contract for rhc3_mobile_voice_cal before any engine PR";
  } else if (ambiguityCount >= trueEngineBugCount && ambiguityCount > 0) {
    recommendedNextFixScope =
      "scripts-only: treat mobile voice Czech noise as expected ambiguity; tune gold + safe_clarification lanes";
  }

  const reportMatch =
    reportHint.fail != null && reportHint.fail === clusterFailCount ? "YES" : "NO";
  const passFail =
    clusterFailCount === 0 && reportMatch === "YES"
      ? "PASS"
      : clusterFailCount > 0 && classifiedCount > 0 && unclassifiedCount < clusterFailCount && reportMatch === "YES"
        ? "PASS"
        : clusterFailCount > 0 && classifiedCount > 0
          ? "PASS_PARTIAL"
          : "FAIL";

  const textBlock = [
    "=== SILVER_RHC3_MOBILE_VOICE_CLUSTER_RESULT ===",
    "main_commit=" + runnerHead,
    "expected_main_commit=" + EXPECTED_MAIN_COMMIT,
    "target_cluster=" + TARGET_CLUSTER,
    "total_cluster_cases=" + totalClusterCases,
    "cluster_total=" + clusterFailCount,
    "cluster_pass=" + clusterPass,
    "report_json_fail_hint=" + String(reportHint.fail != null ? reportHint.fail : "n/a"),
    "report_match=" + reportMatch,
    "classified_count=" + classifiedCount,
    "unclassified_count=" + unclassifiedCount,
    "no_rule_count=" + noRuleCount,
    "true_engine_bug_count=" + trueEngineBugCount,
    "harness_or_gold_problem_count=" + harnessOrGoldCount,
    "ambiguity_count=" + ambiguityCount,
    "retrieval_relevance_count=" + retrievalRelevanceCount,
    "safe_clarification_count=" + safeClarificationCount,
    "ready_for_engine_fix=" + readyForEngineFix,
    "recommended_next_fix_scope=" + recommendedNextFixScope,
    "PASS_FAIL=" + passFail,
    "engine_changed=NO",
    "assets_app_changed=" + assetsAppChanged,
    "git_status_clean=" + gitStatusShortClean(),
    "subcluster_counts=" + JSON.stringify(subclusterCounts),
    "=== END_SILVER_RHC3_MOBILE_VOICE_CLUSTER_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    main_commit: runnerHead,
    target_cluster: TARGET_CLUSTER,
    total_cluster_cases: totalClusterCases,
    cluster_total: clusterFailCount,
    cluster_pass: clusterPass,
    report_json_fail_hint: reportHint.fail,
    report_match: reportMatch,
    classified_count: classifiedCount,
    unclassified_count: unclassifiedCount,
    no_rule_count: noRuleCount,
    true_engine_bug_count: trueEngineBugCount,
    harness_or_gold_problem_count: harnessOrGoldCount,
    ambiguity_count: ambiguityCount,
    retrieval_relevance_count: retrievalRelevanceCount,
    safe_clarification_count: safeClarificationCount,
    ready_for_engine_fix: readyForEngineFix,
    recommended_next_fix_scope: recommendedNextFixScope,
    PASS_FAIL: passFail,
    subcluster_counts: subclusterCounts,
    fail_samples: failRows.slice(0, 40),
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  console.log("report_json=" + REPORT_JSON);

  const trueEngineBugCountAfter =
    (subclusterCounts.true_engine_bug_calendar || 0) +
    (subclusterCounts.true_engine_bug_task || 0) +
    (subclusterCounts.true_engine_bug_note || 0) +
    (subclusterCounts.true_engine_bug_routing || 0) +
    (subclusterCounts.explicit_module_signal_missed || 0);

  let recommendedNextCluster = "none";
  const rhc3Top = (rhc3Report && rhc3Report.top_fail_clusters) || [];
  for (let ti = 0; ti < rhc3Top.length; ti++) {
    const line = String(rhc3Top[ti] || "");
    if (line.indexOf("rhc3_mobile_voice_cal:") === 0) continue;
    const m = line.match(/^([^:]+):(\d+)$/);
    if (m && parseInt(m[2], 10) > 0) {
      recommendedNextCluster = m[1];
      break;
    }
  }

  const readyForProductCap50 =
    clusterFailCount === 0 &&
    trueEngineBugCountAfter === 0 &&
    dangerousWriteCount === 0 &&
    falseWriteCount === 0 &&
    queryCreatedWriteCount === 0 &&
    writeWhenNegatedCount === 0 &&
    hardWriteFailCount === 0
      ? "YES"
      : "NO";

  const alignmentPassFail =
    clusterFailCount === 0 &&
    safeClarificationAcceptedCount >= HARNESS_ALIGN_BASELINE.safe_clarification_count &&
    trueEngineBugCountAfter === 0 &&
    dangerousWriteCount === 0
      ? "PASS"
      : clusterFailCount < HARNESS_ALIGN_BASELINE.cluster_fail_count
        ? "PASS_PARTIAL"
        : "FAIL";

  const alignBlock = [
    "=== SILVER_RHC3_MOBILE_VOICE_ALIGNMENT_RESULT ===",
    "main_commit=" + runnerHead,
    "expected_main_commit=" + EXPECTED_MAIN_COMMIT,
    "target_cluster=" + TARGET_CLUSTER,
    "previous_fail_count=" + HARNESS_ALIGN_BASELINE.cluster_fail_count,
    "fail_count_after=" + clusterFailCount,
    "safe_clarification_accepted_count=" + safeClarificationAcceptedCount,
    "true_engine_bug_count_after=" + trueEngineBugCountAfter,
    "hard_write_fail_count=" + hardWriteFailCount,
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "ready_for_product_cap50=" + readyForProductCap50,
    "recommended_next_cluster=" + recommendedNextCluster,
    "PASS_FAIL=" + alignmentPassFail,
    "engine_changed=NO",
    "assets_app_changed=" + assetsAppChanged,
    "git_status_clean=" + gitStatusShortClean(),
    "=== END_SILVER_RHC3_MOBILE_VOICE_ALIGNMENT_RESULT ==="
  ].join("\n");

  console.log("\n" + alignBlock + "\n");

  const alignObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    main_commit: runnerHead,
    target_cluster: TARGET_CLUSTER,
    baseline: HARNESS_ALIGN_BASELINE,
    previous_fail_count: HARNESS_ALIGN_BASELINE.cluster_fail_count,
    fail_count_after: clusterFailCount,
    safe_clarification_accepted_count: safeClarificationAcceptedCount,
    true_engine_bug_count_after: trueEngineBugCountAfter,
    hard_write_fail_count: hardWriteFailCount,
    dangerous_write_count: dangerousWriteCount,
    false_write_count: falseWriteCount,
    query_created_write_count: queryCreatedWriteCount,
    write_when_negated_count: writeWhenNegatedCount,
    ready_for_product_cap50: readyForProductCap50,
    recommended_next_cluster: recommendedNextCluster,
    PASS_FAIL: alignmentPassFail,
    text_block: alignBlock
  };
  fs.writeFileSync(ALIGNMENT_REPORT_JSON, JSON.stringify(alignObj, null, 2), "utf8");
  console.log("alignment_report_json=" + ALIGNMENT_REPORT_JSON);
}

main();
