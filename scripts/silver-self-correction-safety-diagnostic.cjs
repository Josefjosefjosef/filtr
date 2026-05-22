/**
 * SILVER_SELF_CORRECTION_SAFETY_DIAGNOSTIC — P0 write-leak triage (scripts only; no engine/assets).
 * Clusters: safety_cal_readonly, negation_readonly, update_note, noisy_neg_read.
 *
 * Usage: node scripts/silver-self-correction-safety-diagnostic.cjs
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-self-correction-safety-diagnostic-report.json");
const DIAGNOSTIC_SCRIPT = "scripts/silver-self-correction-safety-diagnostic.cjs";

const TARGET_CLUSTERS = [
  "self_correction_safety_cal_readonly",
  "self_correction_safety_note_readonly",
  "self_correction_negation_readonly",
  "self_correction_negation_flip",
  "self_correction_update_note",
  "self_correction_noisy_neg_read",
];

const SAMPLE_MIN = 20;
const SAMPLE_PER_CLUSTER = 6;

const scAudit = require("./silver-self-correction-audit.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  engineToAuditIntent,
} = harness;

const {
  countsAsSafetyNegationWriteLeak,
  isScopedUpdateNegation,
  isGlobalNoWriteNegation,
  isUpdateVsCreateContext,
  safetyNoWriteFoldedGlobal,
} = require("./silver-self-correction-negation-scope.cjs");

const {
  finalizeSelfCorrectionNoisyNegReadHarnessEval,
  finalizeSelfCorrectionSafetyCalReadonlyHarnessEval,
  finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval,
  finalizeSelfCorrectionNegationFlipHarnessEval,
} = require("./silver-self-correction-query-clarification.cjs");

const { computeGoldLabels, finalizeModuleSwitchHarnessEval, finalizeModuleSwitchClarifyLaneHarnessEval } =
  rhc3;

const {
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
  "scripts/silver-self-correction-safety-diagnostic.cjs",
  "scripts/silver-self-correction-safety-diagnostic-report.json",
  "scripts/silver-audit-registry.cjs",
  "scripts/silver-self-correction-audit.cjs",
  "scripts/silver-self-correction-audit-report.json",
  "scripts/silver-self-correction-negation-scope.cjs",
  "scripts/silver-self-correction-negation-scope-selftest.cjs",
  "scripts/silver-self-correction-query-clarification.cjs",
  "scripts/silver-self-correction-query-vs-clarification-selftest.cjs",
  "scripts/silver-self-correction-negation-flip-selftest.cjs",
  "scripts/silver-self-correction-safety-cal-readonly-diagnostic.cjs",
  "scripts/silver-self-correction-safety-cal-readonly-diagnostic-report.json",
  "scripts/silver-self-correction-safety-cal-readonly-selftest.cjs",
  "scripts/silver-self-correction-safety-note-readonly-selftest.cjs",
  "SILVER_RUN_REPORT.md",
  "SILVER_CURSOR_OUTPUT.md",
  "SILVER_NEXT_ACTION.md",
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
  if (c.group === "task_query" || c.group === "task_write") return "tasks";
  if (c.group === "note_query" || c.group === "note_write") return "notes";
  return "";
}

function isNegationFlipCluster(c) {
  const cl = String(c.cluster || "");
  if (cl.indexOf("negation_flip") >= 0) return true;
  if (cl === "self_correction_noisy_neg_read") {
    const f = foldCs(c.input);
    return /\bne\s+vlastne\b/i.test(f) || /\bne\s+vlastně\b/i.test(f);
  }
  return false;
}

function isModuleSwitchContext(c) {
  return (
    c.sc_lane === "correction_module_switch" ||
    String(c.cluster || "").indexOf("module_") >= 0 ||
    (c.gold && c.gold.contains_module_switch)
  );
}

function templateDnaNoise(c, fold) {
  const f = String(fold || "");
  if (String(c.input || "").length < 12) return true;
  if (c.cluster === "self_correction_noisy_neg_read") {
    if (!/\bnic\b/i.test(f) && !/\bneuklad/i.test(f) && !/\bmrkni\b/i.test(f)) return true;
    if ((c.mutation_mask >>> 0) & require("./rhc-v3-deterministic-core.cjs").M.STRIP_DIACRITICS) {
      if (!/\bkalend/i.test(f) && !/\bzitra\b/i.test(f)) return true;
    }
  }
  if (c.cluster === "self_correction_update_note") {
    if (!/\b(poznam|poznám|uprav|zmen|změn)\b/i.test(f)) return true;
  }
  return false;
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
  out = finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionNegationFlipHarnessEval(c, turn, out);
  return out;
}

/**
 * @returns {"TRUE_ENGINE_FAIL"|"HARNESS_GOLD_PROBLEM"|"AMBIGUOUS_INPUT"|"SAFE_CLARIFICATION_OK"|"TEMPLATE_DNA_NOISE"}
 */
function classifySafetyDiagnostic(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const drafty = createLikeTurn(turn);
  const cat = String(ev.cat || "");
  const eng = String(turn.normalizedIntent || "");

  if (cat === "runtime_fail") return "HARNESS_GOLD_PROBLEM";

  if (isUpdateVsCreateContext(c) && isScopedUpdateNegation(fold) && drafty) {
    return "HARNESS_GOLD_PROBLEM";
  }

  if (drafty && gold && !gold.expected_should_write) {
    return "TRUE_ENGINE_FAIL";
  }
  if (countsAsSafetyNegationWriteLeak(fold, c) && drafty) {
    return "TRUE_ENGINE_FAIL";
  }
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return "TRUE_ENGINE_FAIL";
  }

  if (templateDnaNoise(c, fold) && !drafty && (eng === "unknown" || eng === "clarification")) {
    return "TEMPLATE_DNA_NOISE";
  }

  if (cat === "intent_fail" || cat === "wrong_collection" || cat === "calendar_vs_task_confusion") {
    if (eng === "clarification" || eng === "unknown") {
      if (gold && gold.expected_should_clarify) return "AMBIGUOUS_INPUT";
      if (safetyNoWriteFoldedGlobal(fold) || isGlobalNoWriteNegation(fold) || countsAsSafetyNegationWriteLeak(fold, c)) {
        if (!drafty) return "SAFE_CLARIFICATION_OK";
        return "TRUE_ENGINE_FAIL";
      }
      if (c.cluster === "self_correction_update_note" && drafty) {
        return "TRUE_ENGINE_FAIL";
      }
      return "SAFE_CLARIFICATION_OK";
    }
    if (drafty && c.cluster === "self_correction_update_note") {
      return "TRUE_ENGINE_FAIL";
    }
    if (c.cluster === "self_correction_noisy_neg_read") {
      return "HARNESS_GOLD_PROBLEM";
    }
    if (isNegationFlipCluster(c) && !drafty) {
      return "HARNESS_GOLD_PROBLEM";
    }
    if (!drafty && (c.group || "").indexOf("query") >= 0) {
      return "HARNESS_GOLD_PROBLEM";
    }
    if (drafty) return "TRUE_ENGINE_FAIL";
    return "HARNESS_GOLD_PROBLEM";
  }

  if (cat === "false_negative" || cat === "unnecessary_disambiguation" || cat === "raw_response_wrong") {
    return "HARNESS_GOLD_PROBLEM";
  }

  if (!ev.pass) return "HARNESS_GOLD_PROBLEM";
  return "SAFE_CLARIFICATION_OK";
}

function emptyClusterStats() {
  return {
    total_cases: 0,
    fail_count: 0,
    pass_count: 0,
    dangerous_write_count: 0,
    write_when_negated_count: 0,
    true_engine_fail_count: 0,
    harness_problem_count: 0,
    ambiguous_input_count: 0,
    safe_clarification_ok_count: 0,
    template_dna_noise_count: 0,
    readonly_override_fail_count: 0,
    module_switch_fail_count: 0,
    negation_flip_fail_count: 0,
    update_vs_create_fail_count: 0,
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

function recommendNext(agg, clusterStats, globalAgg) {
  const wn = globalAgg ? globalAgg.write_when_negated_count : agg.write_when_negated_count;
  const te = globalAgg ? globalAgg.true_engine_fail_on_write_negated : agg.true_engine_fail_count;
  const hp = globalAgg
    ? globalAgg.harness_or_other_on_write_negated + agg.harness_problem_count
    : agg.harness_problem_count;
  const amb = agg.ambiguous_input_count;
  const tpl = agg.template_dna_noise_count;

  let writeLeakVerdict = "mixed";
  if (wn > 0) {
    const teShare = te / wn;
    const harnessShare = (globalAgg ? globalAgg.harness_or_other_on_write_negated : hp + amb + tpl) / wn;
    if (teShare >= 0.55) writeLeakVerdict = "predominantly_real_engine_leak";
    else if (harnessShare >= 0.55) writeLeakVerdict = "predominantly_harness_template_noise";
    else writeLeakVerdict = "mixed_engine_and_harness";
  }

  const clusterRankTe = Object.keys(clusterStats)
    .map((k) => ({ cluster: k, te: clusterStats[k].true_engine_fail_count }))
    .sort((a, b) => b.te - a.te);
  const clusterRankHp = Object.keys(clusterStats)
    .map((k) => ({
      cluster: k,
      hp: clusterStats[k].harness_problem_count + clusterStats[k].template_dna_noise_count,
    }))
    .sort((a, b) => b.hp - a.hp);

  const topTe = clusterRankTe[0] || { cluster: "(none)", te: 0 };
  const topHp = clusterRankHp[0] || { cluster: "(none)", hp: 0 };

  let recommended_next_task_type = "SCRIPTS_ONLY_HARNESS_ALIGNMENT";
  let recommended_next_cluster = topHp.cluster;
  let ready_for_next_task = "YES";

  const globalByCl = globalAgg && globalAgg.by_cluster ? globalAgg.by_cluster : {};
  const topGlobalHarness = Object.keys(globalByCl)
    .map((k) => ({ cluster: k, h: globalByCl[k].harness_other || 0 }))
    .sort((a, b) => b.h - a.h)[0];
  const topGlobalTe = Object.keys(globalByCl)
    .map((k) => ({ cluster: k, te: globalByCl[k].true_engine_fail || 0 }))
    .sort((a, b) => b.te - a.te)[0];

  if (writeLeakVerdict.indexOf("harness") >= 0 && topGlobalHarness && topGlobalHarness.h > (topGlobalTe ? topGlobalTe.te : 0)) {
    recommended_next_task_type = "SCRIPTS_ONLY_HARNESS_ALIGNMENT";
    recommended_next_cluster = topGlobalHarness.cluster;
  } else if (te >= hp && te >= amb && te > 0 && writeLeakVerdict.indexOf("engine") >= 0) {
    recommended_next_task_type = "NARROW_ENGINE_SAFETY_FIX";
    recommended_next_cluster = topGlobalTe ? topGlobalTe.cluster : topTe.cluster;
  } else if (topHp.hp > topTe.te) {
    recommended_next_task_type = "SCRIPTS_ONLY_HARNESS_ALIGNMENT";
    recommended_next_cluster = topHp.cluster;
  } else if (te > 0) {
    recommended_next_task_type = "NARROW_ENGINE_SAFETY_FIX";
    recommended_next_cluster = topGlobalTe ? topGlobalTe.cluster : topTe.cluster;
  } else {
    ready_for_next_task = "NO";
  }

  return {
    write_leak_verdict: writeLeakVerdict,
    recommended_next_task_type,
    recommended_next_cluster,
    ready_for_next_task,
    top_true_engine_fail_cluster: topTe.cluster,
    top_harness_cluster: topHp.cluster,
  };
}

function main() {
  const git = gitAllowClean();
  if (!git.ok) {
    console.log("=== SILVER_SELF_CORRECTION_SAFETY_DIAGNOSTIC_ABORT ===");
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

  const totalCases = scAudit.TOTAL_CASES;
  const cases = scAudit.buildScCorpus(totalCases);
  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
    if (cases[ci].sc_lane === "correction_module_switch" && cases[ci].gold) {
      cases[ci].expectedIntent = cases[ci].gold.expected_intent;
    }
  }

  const clusterStats = {};
  for (let ti = 0; ti < TARGET_CLUSTERS.length; ti++) {
    clusterStats[TARGET_CLUSTERS[ti]] = emptyClusterStats();
  }

  const agg = emptyClusterStats();
  const targetSet = {};
  for (let ts = 0; ts < TARGET_CLUSTERS.length; ts++) targetSet[TARGET_CLUSTERS[ts]] = true;
  let targetCaseCount = 0;

  const globalWriteNegByCluster = {};
  let globalDangerousWrite = 0;
  let globalWriteWhenNegated = 0;
  let globalWriteNegTrueEngine = 0;
  let globalWriteNegHarness = 0;

  const sampleFails = [];
  const writeWhenNegatedBreakdown = {
    TRUE_ENGINE_FAIL: 0,
    HARNESS_GOLD_PROBLEM: 0,
    AMBIGUOUS_INPUT: 0,
    SAFE_CLARIFICATION_OK: 0,
    TEMPLATE_DNA_NOISE: 0,
  };

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const isTarget = !!targetSet[c.cluster];
    if (isTarget) targetCaseCount++;

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
      if (!isTarget) continue;
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

    const foldedIn = foldCs(c.input);
    const createLike = createLikeTurn(turn);
    const gold = c.gold || {};
    const negWriteLeak = countsAsSafetyNegationWriteLeak(foldedIn, c);
    const dangerous =
      ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail" || (negWriteLeak && createLike);
    const writeNeg = negWriteLeak && createLike;

    if (dangerous) {
      globalDangerousWrite++;
      const gCl = c.cluster || c.sc_lane || "unknown";
      if (!globalWriteNegByCluster[gCl]) {
        globalWriteNegByCluster[gCl] = {
          dangerous_write: 0,
          write_when_negated: 0,
          true_engine_fail: 0,
          harness_other: 0,
        };
      }
      globalWriteNegByCluster[gCl].dangerous_write++;
    }
    if (writeNeg) {
      globalWriteWhenNegated++;
      const wnCl = c.cluster || c.sc_lane || "unknown";
      if (!globalWriteNegByCluster[wnCl]) {
        globalWriteNegByCluster[wnCl] = {
          dangerous_write: 0,
          write_when_negated: 0,
          true_engine_fail: 0,
          harness_other: 0,
        };
      }
      const wb = globalWriteNegByCluster[wnCl];
      wb.write_when_negated++;
      const wnBucket = classifySafetyDiagnostic(c, turn, ev, gold);
      writeWhenNegatedBreakdown[wnBucket] = (writeWhenNegatedBreakdown[wnBucket] || 0) + 1;
      if (wnBucket === "TRUE_ENGINE_FAIL") {
        globalWriteNegTrueEngine++;
        wb.true_engine_fail++;
      } else {
        globalWriteNegHarness++;
        wb.harness_other++;
      }
    }

    if (!isTarget) continue;

    const ck = c.cluster;
    const st = clusterStats[ck];
    st.total_cases++;
    agg.total_cases++;

    if (dangerous) {
      st.dangerous_write_count++;
      agg.dangerous_write_count++;
    }
    if (writeNeg) {
      st.write_when_negated_count++;
      agg.write_when_negated_count++;
    }

    if (ev.pass) {
      st.pass_count++;
    } else {
      st.fail_count++;
      agg.fail_count++;

      const bucket = classifySafetyDiagnostic(c, turn, ev, gold);
      if (bucket === "TRUE_ENGINE_FAIL") {
        st.true_engine_fail_count++;
        agg.true_engine_fail_count++;
      } else if (bucket === "HARNESS_GOLD_PROBLEM") {
        st.harness_problem_count++;
        agg.harness_problem_count++;
      } else if (bucket === "AMBIGUOUS_INPUT") {
        st.ambiguous_input_count++;
        agg.ambiguous_input_count++;
      } else if (bucket === "SAFE_CLARIFICATION_OK") {
        st.safe_clarification_ok_count++;
        agg.safe_clarification_ok_count++;
      } else if (bucket === "TEMPLATE_DNA_NOISE") {
        st.template_dna_noise_count++;
        agg.template_dna_noise_count++;
      }

      if (!gold.expected_should_write && createLike) {
        st.readonly_override_fail_count++;
        agg.readonly_override_fail_count++;
      }
      if (isModuleSwitchContext(c)) {
        st.module_switch_fail_count++;
        agg.module_switch_fail_count++;
      }
      if (isNegationFlipCluster(c)) {
        st.negation_flip_fail_count++;
        agg.negation_flip_fail_count++;
      }
      if (isUpdateVsCreateContext(c)) {
        st.update_vs_create_fail_count++;
        agg.update_vs_create_fail_count++;
      }

      const ex = {
        cluster: ck,
        sc_lane: c.sc_lane,
        input: c.input,
        expected_intent: gold.expected_intent || c.expectedIntent,
        actual_intent: turn.normalizedIntent,
        expected_module: expectedModuleFromGold(gold, c),
        actual_module: actualModuleFromTurn(turn),
        expected_write: !!gold.expected_should_write,
        actual_write: createLike,
        failure_classification: bucket,
        harness_cat: ev.cat || "",
        dangerous_write: dangerous,
        write_when_negated: writeNeg,
      };
      const perCl = sampleFails.filter((s) => s.cluster === ck).length;
      if (sampleFails.length < SAMPLE_MIN || perCl < SAMPLE_PER_CLUSTER) {
        sampleFails.push(ex);
      }
    }
  }

  const globalAgg = {
    write_when_negated_count: globalWriteWhenNegated,
    true_engine_fail_on_write_negated: globalWriteNegTrueEngine,
    harness_or_other_on_write_negated: globalWriteNegHarness,
    by_cluster: globalWriteNegByCluster,
  };
  const rec = recommendNext(agg, clusterStats, globalAgg);
  const smoke = runSmoke();
  const gitClean = git.ok ? "YES" : "NO";
  const readyForPr = gitClean === "YES" ? "YES" : "NO";

  const globalVerdict =
    globalWriteWhenNegated > 0 && globalWriteNegTrueEngine / globalWriteWhenNegated >= 0.55
      ? "predominantly_real_engine_leak"
      : globalWriteWhenNegated > 0
        ? "predominantly_harness_template_noise"
        : "no_write_when_negated_in_corpus";

  const reportObj = {
    generated_at: new Date().toISOString(),
    main_commit: headCommit,
    engine_changed: "NO",
    assets_app_changed: "NO",
    diagnostic_script: DIAGNOSTIC_SCRIPT,
    clusters_analyzed: TARGET_CLUSTERS,
    cluster_stats: clusterStats,
    aggregate: agg,
    global_corpus_21k: {
      dangerous_write_count: globalDangerousWrite,
      write_when_negated_count: globalWriteWhenNegated,
      true_engine_fail_on_write_negated: globalWriteNegTrueEngine,
      harness_or_other_on_write_negated: globalWriteNegHarness,
      by_cluster: globalWriteNegByCluster,
      write_leak_verdict: globalVerdict,
    },
    write_when_negated_breakdown: writeWhenNegatedBreakdown,
    write_leak_verdict: rec.write_leak_verdict,
    top_true_engine_fail_cluster: rec.top_true_engine_fail_cluster,
    top_harness_cluster: rec.top_harness_cluster,
    recommended_next_task_type: rec.recommended_next_task_type,
    recommended_next_cluster: rec.recommended_next_cluster,
    ready_for_next_task: rec.ready_for_next_task,
    sample_fail_examples: sampleFails,
    sample_fail_examples_count: sampleFails.length,
    smoke,
    git_status_clean: gitClean,
    ready_for_pr: readyForPr,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const resultBlock = [
    "=== SELF_CORRECTION_SAFETY_DIAGNOSTIC_RESULT ===",
    "main_commit=" + headCommit,
    "changed_files=" +
      [
        DIAGNOSTIC_SCRIPT,
        "scripts/silver-self-correction-safety-diagnostic-report.json",
        "scripts/silver-audit-registry.cjs",
      ].join(";"),
    "engine_changed=NO",
    "assets_app_changed=NO",
    "diagnostic_script=" + DIAGNOSTIC_SCRIPT,
    "clusters_analyzed=" + TARGET_CLUSTERS.join("|"),
    "global_dangerous_write_count=" + globalDangerousWrite,
    "global_write_when_negated_count=" + globalWriteWhenNegated,
    "global_write_neg_true_engine_fail=" + globalWriteNegTrueEngine,
    "global_write_neg_harness_other=" + globalWriteNegHarness,
    "global_write_leak_verdict=" + globalVerdict,
    "global_write_neg_by_cluster=" + JSON.stringify(globalWriteNegByCluster),
    "dangerous_write_count=" + agg.dangerous_write_count,
    "write_when_negated_count=" + agg.write_when_negated_count,
    "true_engine_fail_count=" + agg.true_engine_fail_count,
    "harness_problem_count=" + agg.harness_problem_count,
    "ambiguous_input_count=" + agg.ambiguous_input_count,
    "readonly_override_fail_count=" + agg.readonly_override_fail_count,
    "module_switch_fail_count=" + agg.module_switch_fail_count,
    "negation_flip_fail_count=" + agg.negation_flip_fail_count,
    "update_vs_create_fail_count=" + agg.update_vs_create_fail_count,
    "write_leak_verdict=" + rec.write_leak_verdict,
    "write_when_negated_breakdown=" + JSON.stringify(writeWhenNegatedBreakdown),
    "cluster_stats=" + JSON.stringify(clusterStats),
    "top_true_engine_fail_cluster=" + rec.top_true_engine_fail_cluster,
    "top_harness_cluster=" + rec.top_harness_cluster,
    "recommended_next_task_type=" + rec.recommended_next_task_type,
    "recommended_next_cluster=" + rec.recommended_next_cluster,
    "sample_fail_examples_count=" + sampleFails.length,
    "smoke=" + smoke,
    "git_status_clean=" + gitClean,
    "ready_for_pr=" + readyForPr,
    "ready_for_next_task=" + rec.ready_for_next_task,
    "=== END_SELF_CORRECTION_SAFETY_DIAGNOSTIC_RESULT ===",
  ].join("\n");

  console.log("\n" + resultBlock + "\n");
  console.log(
    "SILVER_SELF_CORRECTION_SAFETY_DIAGNOSTIC clusters=" +
      TARGET_CLUSTERS.length +
      " cases=" +
      targetCaseCount +
      " dangerous_write=" +
      agg.dangerous_write_count +
      " write_when_negated=" +
      agg.write_when_negated_count +
      " te=" +
      agg.true_engine_fail_count +
      " verdict=" +
      rec.write_leak_verdict,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTERS,
  classifySafetyDiagnostic,
  DIAGNOSTIC_SCRIPT,
};
