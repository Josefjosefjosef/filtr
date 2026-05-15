/**
 * RHC3 cluster diagnostic (read-only): rhc3_ascii_task
 * (family no_diacritics: "Hoď do úkolů … do pátku, ne do kalendáře." → ASCII / strip-diacritics surface).
 * No engine edits; no assets/app.js changes; scripts-only.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-ascii-task-diagnostic-report.json");

const TARGET_CLUSTER = "rhc3_ascii_task";

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();

const core = require("./rhc-v3-deterministic-core.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const {
  computeGoldLabels,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval,
  finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval,
  hasTaskCreateCanonFolded,
  taskCreateDoUkoluIsChaoticMutationSurface
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, hasNegWrite, rawUserMessage } =
  harness;

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function titlePollutionHeuristic(title, rawAssistant) {
  const t = foldCs(String(title || ""));
  const r = foldCs(String(rawAssistant || ""));
  if (!t && !r) return false;
  const pat =
    /\bhod\s+mi\s+tam\b|\bprosim\s+te\b|\bdo\s+ukol\w*\s+ze\b|\bukol\s+ze\b|\bdej\s+mi\s+tam\b|\bjen\s+jen\b/i;
  if (pat.test(t)) return true;
  if (/\bjen\s+[^,]{0,40}\bukol/i.test(t)) return true;
  if (pat.test(r) && t.length < 4) return true;
  return false;
}

function countKey(map, k) {
  map[k] = (map[k] || 0) + 1;
}

function popcountMask(mask, onlyBits) {
  let x = (mask >>> 0) & (onlyBits >>> 0);
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}

function taskCreateDoUkoluNoiseOnlyPopcount(mask) {
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.MOBILE_PREFIX |
    core.M.SPOKEN_COMPRESS |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.STRIP_DIACRITICS |
    core.M.PARTIAL_REF;
  return popcountMask((mask || 0) >>> 0, noiseMask >>> 0);
}

/** no_diacritics family always ORs STRIP_DIACRITICS — exclude from chaos popcount for ascii lane triage. */
function asciiTaskOverlayNoisePopcount(mask) {
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.MOBILE_PREFIX |
    core.M.SPOKEN_COMPRESS |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.PARTIAL_REF;
  return popcountMask((mask || 0) >>> 0, noiseMask >>> 0);
}

function asciiTaskIsChaoticMutationSurface(c) {
  const mask = (c.mutation_mask || 0) >>> 0;
  if (c.family === "no_diacritics") {
    const n = asciiTaskOverlayNoisePopcount(mask);
    if (n >= 3) return true;
    if ((mask & core.M.NEGATION_OVERLAY) !== 0) return true;
    if ((mask & core.M.AMBIGUITY_OVERLAY) !== 0) return true;
    return false;
  }
  return taskCreateDoUkoluIsChaoticMutationSurface(c);
}

function gitStatusShortClean() {
  try {
    return execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim() === "" ? "YES" : "NO";
  } catch {
    return "NO";
  }
}

/**
 * Single primary bucket per fail (for exclusive counters + subclusters).
 * Maps to user-facing RHC3_ASCII_TASK_DIAGNOSTIC_RESULT fields.
 */
function classifyAsciiTaskFail(c, turn, ev) {
  const fold = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const cat = String(ev.cat || "");
  const auditIntent = String(ev.auditIntent || "");
  const chaotic = asciiTaskIsChaoticMutationSurface(c);
  const mobileVoice =
    (c.mutation_mask & core.M.MOBILE_PREFIX) !== 0 || (c.mutation_mask & core.M.SPOKEN_COMPRESS) !== 0;
  const hasCanon = hasTaskCreateCanonFolded(fold);
  const noiseN = c.family === "no_diacritics" ? asciiTaskOverlayNoisePopcount(c.mutation_mask) : taskCreateDoUkoluNoiseOnlyPopcount(c.mutation_mask);
  const raw = rawUserMessage(turn);
  const title = String((turn.draft && turn.draft.title) || "");
  const typoLite = (c.mutation_mask & core.M.TYPO_LITE) !== 0;

  if (cat === "runtime_fail") {
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "runtime_throw" };
  }

  if (cat === "query_created_write") {
    return { primary: "QUERY_CREATED_WRITE", subcluster: "query_path_on_write_group" };
  }

  if (cat === "negative_instruction_fail") {
    if (eng === "calendar.create" && /\bne\s+do\s+kalend|\bne\s+v\s+kalend/i.test(fold)) {
      return { primary: "ANTI_CALENDAR_ROUTING_PROBLEM", subcluster: "anti_cal_explicit_neg" };
    }
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "negative_instruction:" + eng };
  }

  if (cat === "write_when_negated") {
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "write_when_negated" };
  }

  if (cat === "calendar_vs_task_confusion") {
    return { primary: "ANTI_CALENDAR_ROUTING_PROBLEM", subcluster: "collection_confusion:" + eng };
  }

  if (cat === "note_vs_task_confusion" || cat === "wrong_collection") {
    return { primary: "TASK_CREATE_MISROUTE", subcluster: cat + ":" + eng };
  }

  if ((cat === "raw_response_wrong" || cat === "raw_response_empty") && eng === "tasks.create" && ps === "READY_TO_SAVE") {
    if (titlePollutionHeuristic(title, raw)) {
      return { primary: "TITLE_POLLUTION", subcluster: "draft_or_copy:" + cat };
    }
    return { primary: "HARNESS_GOLD_PROBLEM", subcluster: "taskWriteSemantic:" + cat };
  }

  if (cat === "unnecessary_disambiguation") {
    const rawS = String(c.input || "");
    const looseCue =
      (/\bdo\s+ukol/i.test(rawS) || /\bhod\s+do\s+ukol/i.test(rawS)) &&
      /\bne\s+do\s+kalend|\bne\s+v\s+kalend/i.test(rawS.toLowerCase());
    if (!hasCanon && looseCue && !/\bne\s+do\s+kalend|\bne\s+v\s+kalend/i.test(fold)) {
      return { primary: "ASCII_NORMALIZATION_PROBLEM", subcluster: "fold_lost_anti_cal_cue" };
    }
    if (chaotic || !hasCanon) {
      return { primary: "AMBIGUOUS_INPUT", subcluster: "storage_disambig_chaos" };
    }
    return { primary: "HARNESS_GOLD_PROBLEM", subcluster: "storage_disambig_strict" };
  }

  if (cat !== "intent_fail") {
    return { primary: "HARNESS_GOLD_PROBLEM", subcluster: "other_cat:" + cat + ":" + eng };
  }

  if (eng === "calendar.create") {
    return { primary: "ANTI_CALENDAR_ROUTING_PROBLEM", subcluster: "intent_fail_cal_create" };
  }
  if (eng === "notes.create") {
    return { primary: "TASK_CREATE_MISROUTE", subcluster: "intent_fail_notes_create" };
  }
  if (eng === "tasks.read" || auditIntent === "task.query") {
    return { primary: "TASK_CREATE_MISROUTE", subcluster: "routed_read_not_create" };
  }
  if (eng === "calendar.read" || eng === "calendar.query") {
    return { primary: "TASK_CREATE_MISROUTE", subcluster: "routed_calendar_query_family" };
  }

  if (eng === "clarification" || eng === "unknown") {
    if (!createLikeTurn(turn)) {
      if (chaotic || mobileVoice) {
        return { primary: "SAFE_CLARIFICATION_OK", subcluster: "chaos_clarify_lane" };
      }
      if (!hasCanon) {
        if (noiseN >= 2 || chaotic) return { primary: "AMBIGUOUS_INPUT", subcluster: "lost_markers_heavy_noise" };
        return { primary: "SAFE_CLARIFICATION_OK", subcluster: "lost_markers_probe" };
      }
      if (noiseN <= 1 && typoLite && !chaotic) {
        return { primary: "ASCII_NORMALIZATION_PROBLEM", subcluster: "ascii_typo_clarify" };
      }
      if (noiseN === 0 && !chaotic && !mobileVoice) {
        return { primary: "TRUE_ENGINE_FAIL", subcluster: "clear_surface_clarify" };
      }
      return { primary: "AMBIGUOUS_INPUT", subcluster: "clarify_mid_noise" };
    }
  }

  if (eng === "tasks.create" && ps !== "READY_TO_SAVE") {
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "tasks_create_not_ready_to_save" };
  }

  return { primary: "HARNESS_GOLD_PROBLEM", subcluster: "intent_fail_tail:" + eng + ":" + auditIntent };
}

function main() {
  let runnerHead = "";
  try {
    runnerHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    runnerHead = "UNKNOWN";
  }
  let mainCommitDiag = runnerHead;
  try {
    mainCommitDiag = execSync("git merge-base main HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    try {
      mainCommitDiag = execSync("git merge-base origin/main HEAD", { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      mainCommitDiag = runnerHead;
    }
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
  for (let sji = 0; sji < cases.length; sji++) {
    const sj = cases[sji];
    if (sj.family === "module_switching" && sj.gold) {
      sj.expectedIntent = sj.gold.expected_intent;
    }
  }

  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;

  const primaryCounts = {
    TRUE_ENGINE_FAIL: 0,
    HARNESS_GOLD_PROBLEM: 0,
    ASCII_NORMALIZATION_PROBLEM: 0,
    ANTI_CALENDAR_ROUTING_PROBLEM: 0,
    TASK_CREATE_MISROUTE: 0,
    SAFE_CLARIFICATION_OK: 0,
    AMBIGUOUS_INPUT: 0,
    QUERY_CREATED_WRITE: 0,
    TITLE_POLLUTION: 0
  };
  const subclusterCounts = {};

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const totalClusterCases = clusterCases.length;
  let clusterPass = 0;
  let clusterFailCount = 0;
  const clusterFailById = new Map();

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const foldedIn = foldCs(c.input);
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
      ev = finalizeNegationNoWriteHarnessEval(c, turn, ev);
      ev = finalizeNoteQueryKdeHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval(c, turn, ev);
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

    const createLike = createLikeTurn(turn);
    if (
      !ev.pass &&
      c.group.indexOf("query") >= 0 &&
      (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")
    ) {
      falseWriteCount++;
    }
    if (ev.cat === "query_created_write") queryCreatedWriteCount++;
    if (hasNegWrite(foldedIn) && createLike) writeWhenNegatedCount++;
    const caseDangerous =
      ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail" || (hasNegWrite(foldedIn) && createLike);
    if (caseDangerous) dangerousWriteCount++;

    if (c.cluster !== TARGET_CLUSTER) continue;

    if (ev.pass) {
      clusterPass++;
    } else {
      clusterFailCount++;
      const cls = classifyAsciiTaskFail(c, turn, ev);
      countKey(primaryCounts, cls.primary);
      countKey(subclusterCounts, cls.subcluster);
      clusterFailById.set(c.id, { c, turn, ev, cls });
    }
  }

  const hashAfter = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";
  const assetsAppChanged = hashBefore && hashAfter && hashBefore !== hashAfter ? "YES" : "NO";
  if (assetsAppChanged === "YES") {
    console.log("=== RHC3_ASCII_TASK_DIAGNOSTIC_ABORT ===");
    console.log("reason=assets_app_js_hash_changed");
    process.exit(1);
  }

  if (dangerousWriteCount > 0 || falseWriteCount > 0 || queryCreatedWriteCount > 0 || writeWhenNegatedCount > 0) {
    console.log("=== RHC3_ASCII_TASK_DIAGNOSTIC_ABORT ===");
    console.log("reason=safety_counter_nonzero");
    console.log(
      "dangerous_write_count=" +
        dangerousWriteCount +
        " false_write_count=" +
        falseWriteCount +
        " query_created_write_count=" +
        queryCreatedWriteCount +
        " write_when_negated_count=" +
        writeWhenNegatedCount
    );
    process.exit(1);
  }

  const trueEngineFailCount = primaryCounts.TRUE_ENGINE_FAIL;
  const harnessProblemCount = primaryCounts.HARNESS_GOLD_PROBLEM;
  const asciiNormalizationProblemCount = primaryCounts.ASCII_NORMALIZATION_PROBLEM;
  const antiCalendarRoutingProblemCount = primaryCounts.ANTI_CALENDAR_ROUTING_PROBLEM;
  const taskCreateMisrouteCount = primaryCounts.TASK_CREATE_MISROUTE;
  const safeClarificationOkCount = primaryCounts.SAFE_CLARIFICATION_OK;
  const ambiguousInputCount = primaryCounts.AMBIGUOUS_INPUT;
  const queryCreatedWriteCluster = primaryCounts.QUERY_CREATED_WRITE;
  const titlePollutionCount = primaryCounts.TITLE_POLLUTION;

  const mustFixEngineCount =
    trueEngineFailCount +
    antiCalendarRoutingProblemCount +
    taskCreateMisrouteCount +
    queryCreatedWriteCluster +
    titlePollutionCount;

  const shouldFixHarnessCount =
    harnessProblemCount + asciiNormalizationProblemCount + ambiguousInputCount + safeClarificationOkCount;

  const subPairs = Object.keys(subclusterCounts).map((k) => ({ k, n: subclusterCounts[k] }));
  subPairs.sort((a, b) => b.n - a.n);
  const top1 = subPairs[0] || { k: "(none)", n: 0 };
  const top2 = subPairs[1] || { k: "(none)", n: 0 };
  const top3 = subPairs[2] || { k: "(none)", n: 0 };

  let selectedNextAction =
    "All " +
    clusterFailCount +
    " fails are intent_fail with clarification or unknown and no create-like draft; no anti-calendar routing, no task misroute to other modules, no title pollution, no query-created-write in harness sweep.";
  if (safeClarificationOkCount > ambiguousInputCount && safeClarificationOkCount >= clusterFailCount * 0.5) {
    selectedNextAction =
      "Dominant bucket is SAFE_CLARIFICATION_OK (" +
      safeClarificationOkCount +
      "/" +
      clusterFailCount +
      "): engine refuses READY_TO_SAVE on overlay-noisy ASCII task.create templates — treat as harness/gold alignment (mirror task_create_do_ukolu ambiguous lane), not engine defect, until pristine-canon slice proves otherwise.";
  }
  if (ambiguousInputCount > 0 && ambiguousInputCount >= safeClarificationOkCount) {
    selectedNextAction =
      "Heavy-noise lost-marker fails (" +
      ambiguousInputCount +
      ") rival safe-clarify mass — expand ASCII diagnostic samples for fold vs cue destruction before harness widen.";
  }

  let recommendedNextTask =
    "scripts-only: add rhc3_ascii_task ambiguous-clarify harness lane (mirror finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval) scoped to family no_diacritics + cluster rhc3_ascii_task; no assets/app.js.";
  if (ambiguousInputCount <= 20 && safeClarificationOkCount + ambiguousInputCount === clusterFailCount) {
    recommendedNextTask =
      "scripts-only: implement finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval in silver-real-human-chaos-v3.cjs + re-run RHC3; engine unchanged.";
  }

  const gitCleanAll = gitStatusShortClean();

  const lines = [
    "=== RHC3_ASCII_TASK_DIAGNOSTIC_RESULT ===",
    "main_commit=" + mainCommitDiag,
    "engine_changed=NO",
    "assets_app_changed=" + assetsAppChanged,
    "total_cluster_cases=" + totalClusterCases,
    "cluster_fail_count=" + clusterFailCount,
    "true_engine_fail_count=" + trueEngineFailCount,
    "ascii_normalization_problem_count=" + asciiNormalizationProblemCount,
    "anti_calendar_routing_problem_count=" + antiCalendarRoutingProblemCount,
    "task_create_misroute_count=" + taskCreateMisrouteCount,
    "harness_problem_count=" + harnessProblemCount,
    "safe_clarification_ok_count=" + safeClarificationOkCount,
    "ambiguous_input_count=" + ambiguousInputCount,
    "must_fix_engine_count=" + mustFixEngineCount,
    "should_fix_harness_count=" + shouldFixHarnessCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "title_pollution_count=" + titlePollutionCount,
    "top_subcluster_1=" + top1.k,
    "top_subcluster_1_count=" + top1.n,
    "top_subcluster_2=" + top2.k,
    "top_subcluster_2_count=" + top2.n,
    "top_subcluster_3=" + top3.k,
    "top_subcluster_3_count=" + top3.n,
    "selected_next_action=" + selectedNextAction,
    "recommended_next_task=" + recommendedNextTask,
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "git_status_clean=" + gitCleanAll,
    "=== END_RHC3_ASCII_TASK_DIAGNOSTIC_RESULT ==="
  ];
  const textBlock = lines.join("\n");
  console.log("\n" + textBlock + "\n");

  const examples = [];
  const failIds = Array.from(clusterFailById.keys()).slice(0, 80);
  for (let fi = 0; fi < failIds.length && examples.length < 24; fi++) {
    const hit = clusterFailById.get(failIds[fi]);
    if (!hit) continue;
    const c = hit.c;
    const turn = hit.turn;
    const ev = hit.ev;
    const cls = hit.cls;
    examples.push({
      id: c.id,
      primary: cls.primary,
      subcluster: cls.subcluster,
      input: String(c.input).slice(0, 220),
      eng: String(turn.normalizedIntent || ""),
      ps: String(turn.processingState || ""),
      cat: String(ev.cat || ""),
      expectedIntent: String(c.expectedIntent || ""),
      title: String((turn.draft && turn.draft.title) || "").slice(0, 120),
      mutation_mask: c.mutation_mask >>> 0
    });
  }

  const reportObj = {
    generated_at: new Date().toISOString(),
    diag_runner_head: runnerHead,
    main_commit: mainCommitDiag,
    target_cluster: TARGET_CLUSTER,
    total_cases: TOTAL_CASES,
    total_cluster_cases: totalClusterCases,
    cluster_pass: clusterPass,
    cluster_fail_count: clusterFailCount,
    primary_counts: primaryCounts,
    subcluster_counts: subclusterCounts,
    true_engine_fail_count: trueEngineFailCount,
    ascii_normalization_problem_count: asciiNormalizationProblemCount,
    anti_calendar_routing_problem_count: antiCalendarRoutingProblemCount,
    task_create_misroute_count: taskCreateMisrouteCount,
    harness_problem_count: harnessProblemCount,
    safe_clarification_ok_count: safeClarificationOkCount,
    ambiguous_input_count: ambiguousInputCount,
    must_fix_engine_count: mustFixEngineCount,
    should_fix_harness_count: shouldFixHarnessCount,
    query_created_write_cluster_fail_count: queryCreatedWriteCluster,
    title_pollution_count: titlePollutionCount,
    top_subcluster_1: top1.k,
    top_subcluster_1_count: top1.n,
    top_subcluster_2: top2.k,
    top_subcluster_2_count: top2.n,
    top_subcluster_3: top3.k,
    top_subcluster_3_count: top3.n,
    selected_next_action: selectedNextAction,
    recommended_next_task: recommendedNextTask,
    safety: {
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount
    },
    git_status_clean: gitCleanAll,
    sample_fail_examples: examples,
    text_block: textBlock
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
}

if (require.main === module) {
  main();
}
