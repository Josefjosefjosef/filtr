/**
 * SILVER_RCZ2_MOBILE_VOICE_INTENT_FAIL_DIAGNOSTIC — scripts-only P1 diagnostic.
 * Re-evaluates Real Czech Public UX Corpus V2; slices cluster rcz2_mobile_voice||intent_fail only.
 * Does not modify assets/app.js or engine bundle.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-rcz2-mobile-voice-intent-fail-diagnostic-report.json");
const TARGET_CLUSTER_KEY = "rcz2_mobile_voice||intent_fail";
const MOBILE_FIRST_GID = 12000 + 7000 + 4500 + 4500 + 1;

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;
const { buildPublicUxCorpusV2 } = require("./silver-real-czech-public-ux-corpus-v2.cjs");

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function readJsonReport(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

function parse20kStdout(out) {
  const r = {};
  const mAcc = out.match(/overall_accuracy=([\d.]+)%/);
  r.overall_accuracy = mAcc ? mAcc[1] : "";
  const grab = (label) => {
    const x = out.match(new RegExp(label + "=([0-9]+)/([0-9]+)"));
    return x ? x[1] + "/" + x[2] : "";
  };
  r.calendar_write = grab("calendar_write");
  return r;
}

function groupToKind(g) {
  if (g === "calendar_write") return 0;
  if (g === "task_write") return 1;
  if (g === "note_write") return 2;
  if (g === "calendar_query") return 3;
  if (g === "task_query") return 4;
  return -1;
}

function gidFromCaseId(id) {
  const m = /^rcz2_(\d+)$/.exec(String(id || ""));
  return m ? parseInt(m[1], 10) : -1;
}

function mobileSeedMismatch(c) {
  const gid = gidFromCaseId(c.id);
  if (gid < MOBILE_FIRST_GID || gid > MOBILE_FIRST_GID + 22000 - 1) return false;
  const idx = gid - MOBILE_FIRST_GID;
  const kind = idx % 5;
  return groupToKind(c.group) !== kind;
}

function hasNegationOrCorrectionPhrase(fi) {
  return (
    /\b(vlastne|spis|oprav|presun|zrus|zru[sš]|nedavej|neukladej|pockej|ne\s+pockej)\b/.test(fi) ||
    /\bne\s+do\s+(kalend|ukol)\b/.test(fi) ||
    /\bne\s+kalend\b/.test(fi) ||
    /\bne\s+ukol\b/.test(fi) ||
    /\bne\s+plet\b/.test(fi) ||
    /\bnevim\s+presne\b/.test(fi)
  );
}

function hasStorageRoutingCue(fi) {
  return (
    /\b(do\s+kalend|do\s+ukol|do\s+poznam|kalendari|ukolu|poznamk)\b/.test(fi) &&
    (/\bne\s+do\b/.test(fi) || /\bale\s+do\b/.test(fi) || /\bnedavej\b/.test(fi) || /\bvlastne\b/.test(fi))
  );
}

function isCalendarFamily(intent) {
  const s = String(intent || "");
  return s.indexOf("calendar") === 0;
}

function isTaskFamily(intent) {
  const s = String(intent || "");
  return s.indexOf("task") === 0;
}

function calendarVsTaskAmbiguity(expected, actual) {
  const e = String(expected || "");
  const a = String(actual || "");
  return (isCalendarFamily(e) && isTaskFamily(a)) || (isTaskFamily(e) && isCalendarFamily(a));
}

function inferProbableRootCause(c, ev) {
  const cat = String(ev.cat || "");
  const g = String(c.group || "");
  const fi = foldCs(c.input || "");
  if (cat === "intent_fail") {
    if (g === "task_write" && !/\b(do ukol|do úkol|ukol|úkol|nezapom|přidej|pridej|hoď|hod)\b/.test(fi)) {
      return "missing_task_activity_verb";
    }
    if (g === "note_write" && !/\bpoznam|zapamat|napis\s+si\b/.test(fi)) return "weak_note_only_anchor";
    if (g.indexOf("calendar") === 0 && /\b(rano|ráno|vecer|večer|po obede|po obědě|v tejdnu|zejtra)\b/.test(fi)) {
      return "calendar_bias_from_time_phrase";
    }
    return "ambiguous_should_clarify";
  }
  return "other";
}

function inferFixScopeFromCause(cause) {
  if (cause === "missing_task_activity_verb") return "Silver task write verb detection (Czech colloquial)";
  if (cause === "weak_note_only_anchor") return "Silver note intent anchors";
  if (cause === "calendar_bias_from_time_phrase") return "Silver calendar time-phrase bias guard";
  return "Silver routing thresholds + Czech paraphrase templates (mobile_voice_chaos)";
}

function assertAssetsAppClean(stage) {
  let diff = "";
  try {
    diff = execSync("git diff --name-only -- assets/app.js", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    console.log("git_diff_fail=" + String(e && e.message));
    process.exit(1);
  }
  if (diff.length) {
    console.log("=== STOP assets/app.js has diff at " + stage + " ===");
    console.log(diff);
    process.exit(1);
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
    return [];
  }
}

function stratifiedExamples(rows, minN) {
  const byG = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const g = r.group || "unknown";
    if (!byG[g]) byG[g] = [];
    byG[g].push(r);
  }
  const groups = Object.keys(byG).sort();
  const out = [];
  let round = 0;
  while (out.length < minN && out.length < rows.length) {
    let added = false;
    for (let gi = 0; gi < groups.length; gi++) {
      const arr = byG[groups[gi]];
      if (arr && arr[round]) {
        out.push(arr[round]);
        added = true;
        if (out.length >= minN) break;
      }
    }
    if (!added) break;
    round++;
  }
  if (out.length < minN) {
    for (let i = 0; i < rows.length && out.length < minN; i++) {
      if (out.indexOf(rows[i]) < 0) out.push(rows[i]);
    }
  }
  return out;
}

function subclusterKey(row) {
  return (
    String(row.group || "") +
    "|exp=" +
    String(row.expected || "") +
    "|act=" +
    String(row.actual || "") +
    "|ps=" +
    String(row.processingState || "") +
    "|eng=" +
    String(row.normalizedIntent || "")
  );
}

function main() {
  assertAssetsAppClean("start");

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = buildPublicUxCorpusV2();
  const targetFails = [];

  let calendarWriteIntentFailCount = 0;
  let taskWriteIntentFailCount = 0;
  let noteWriteIntentFailCount = 0;
  let calendarQueryIntentFailCount = 0;
  let taskQueryIntentFailCount = 0;
  let noteQueryIntentFailCount = 0;

  let negationOrCorrectionPhraseCount = 0;
  let storageDisambiguationCount = 0;
  let calendarVsTaskAmbiguityCount = 0;
  let wrongExpectedIntentOrHarnessProblemCount = 0;
  let seedMismatchCount = 0;
  let trueProductFailCount = 0;
  let safetyRiskCount = 0;

  const subHist = {};

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateOne(c, turn);
    const foldedIn = foldCs(c.input);
    const engN = turn.normalizedIntent;
    const psN = turn.processingState;
    const createLike =
      psN === "READY_TO_SAVE" || engN === "calendar.create" || engN === "tasks.create" || engN === "notes.create";

    if (c.cluster === "rcz2_mobile_voice" && ev.cat === "intent_fail") {
      const row = {
        id: c.id,
        cluster: c.cluster,
        group: c.group,
        module: c.group,
        input: c.input,
        expected: c.expectedIntent,
        actual: ev.auditIntent,
        cat: ev.cat,
        raw: ev.raw,
        processingState: psN,
        normalizedIntent: engN,
        ux_category: c.ux_category || ""
      };
      targetFails.push(row);

      if (c.group === "calendar_write") calendarWriteIntentFailCount++;
      else if (c.group === "task_write") taskWriteIntentFailCount++;
      else if (c.group === "note_write") noteWriteIntentFailCount++;
      else if (c.group === "calendar_query") calendarQueryIntentFailCount++;
      else if (c.group === "task_query") taskQueryIntentFailCount++;
      else if (c.group === "note_query") noteQueryIntentFailCount++;

      const fi = foldedIn;
      if (hasNegationOrCorrectionPhrase(fi) || hasNegWrite(fi)) negationOrCorrectionPhraseCount++;
      if (hasStorageRoutingCue(fi) || String(psN || "") === "CLARIFICATION" || engN === "clarification") {
        storageDisambiguationCount++;
      }
      if (calendarVsTaskAmbiguity(c.expectedIntent, ev.auditIntent)) calendarVsTaskAmbiguityCount++;

      const seedBad = mobileSeedMismatch(c);
      if (seedBad) seedMismatchCount++;

      const harnessUnknown =
        (String(ev.auditIntent || "") === "unknown" || engN === "clarification") &&
        String(c.expectedIntent || "") !== "unknown";

      if (harnessUnknown && !seedBad) wrongExpectedIntentOrHarnessProblemCount++;

      if (!seedBad && !harnessUnknown && String(ev.auditIntent || "") !== String(c.expectedIntent || "")) {
        trueProductFailCount++;
      }

      if (hasNegWrite(fi) && createLike && (c.group || "").indexOf("_write") > 0) {
        safetyRiskCount++;
      }

      const sk = subclusterKey(row);
      subHist[sk] = (subHist[sk] || 0) + 1;
    }
  }

  const targetClusterTotal = targetFails.length;
  const pickN = targetClusterTotal >= 100 ? Math.min(120, targetClusterTotal) : targetClusterTotal;
  const sampleGoal = targetClusterTotal >= 100 ? Math.max(100, pickN) : pickN;
  const representative = stratifiedExamples(targetFails, sampleGoal);
  const inspectedCount = representative.length;

  const subPairs = Object.keys(subHist)
    .map((k) => ({ k: k, n: subHist[k] }))
    .sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k)));
  const top5 = subPairs.slice(0, 5);

  function examplesForKey(key, limit) {
    const xs = targetFails.filter((r) => subclusterKey(r) === key).slice(0, limit);
    return xs.map((r) => r.input.slice(0, 120));
  }

  const rootCauseHist = {};
  for (let i = 0; i < targetFails.length; i++) {
    const r = targetFails[i];
    const pr = inferProbableRootCause(
      { group: r.group, input: r.input, cluster: r.cluster },
      { cat: r.cat }
    );
    rootCauseHist[pr] = (rootCauseHist[pr] || 0) + 1;
  }
  const topCause = Object.keys(rootCauseHist).sort((a, b) => rootCauseHist[b] - rootCauseHist[a])[0] || "ambiguous_should_clarify";

  const recommendedNextFixCluster = top5[0] ? top5[0].k.split("|")[0] || "rcz2_mobile_voice" : "rcz2_mobile_voice";
  const recommendedNextFixScope = inferFixScopeFromCause(topCause);
  const recommendedReason =
    "Dominant harness root-cause signal «" +
    topCause +
    "» across " +
    targetClusterTotal +
    " intent_fail rows in mobile_voice_chaos; narrow Silver change in that module first.";
  const riskLevel = safetyRiskCount > 0 ? "P0" : targetClusterTotal > 4000 ? "P1" : "P2";
  const readyForFixTask = safetyRiskCount > 0 ? "NO" : "YES";

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e1) {
    void e1;
  }
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e2) {
    void e2;
  }

  const auditScripts = [
    "audit_silver_20000_routing_stable.cjs",
    "audit_silver_quality_v2.cjs",
    "audit_silver_realistic_mobile_corpus.cjs",
    "silver-real-czech-corpus-v1.cjs",
    "silver-deep-product-real-ux-v2.cjs"
  ];
  let out20k = "";
  for (let ai = 0; ai < auditScripts.length; ai++) {
    try {
      const out = execSync('node "' + path.join(REPO, "scripts", auditScripts[ai]) + '"', {
        cwd: REPO,
        encoding: "utf8",
        stdio: "pipe",
        maxBuffer: 64 * 1024 * 1024
      });
      if (auditScripts[ai] === "audit_silver_20000_routing_stable.cjs") out20k = out;
    } catch (e3) {
      void e3;
    }
  }

  let calendarWrite20k = "SKIPPED";
  let overall20kAcc = "SKIPPED";
  const p20 = parse20kStdout(out20k);
  if (p20.calendar_write) calendarWrite20k = p20.calendar_write;
  if (p20.overall_accuracy) overall20kAcc = p20.overall_accuracy + "%";

  const qj = readJsonReport(path.join(REPO, "scripts", "silver-quality-v2-report.json"));
  const rj = readJsonReport(path.join(REPO, "scripts", "silver-realistic-mobile-corpus-report.json"));
  const rcj = readJsonReport(path.join(REPO, "scripts", "silver-real-czech-corpus-v1-report.json"));
  const dpj = readJsonReport(path.join(REPO, "scripts", "silver-deep-product-real-ux-v2-report.json"));

  const qualityAccRaw = qj && qj.quality_accuracy ? String(qj.quality_accuracy) : "SKIPPED";
  const qualityAcc = qualityAccRaw !== "SKIPPED" && qualityAccRaw.indexOf("%") < 0 ? qualityAccRaw + "%" : qualityAccRaw;
  const realisticAccRaw = rj && rj.overall_accuracy_realistic ? String(rj.overall_accuracy_realistic) : "SKIPPED";
  const realisticAcc =
    realisticAccRaw !== "SKIPPED" && realisticAccRaw.indexOf("%") < 0 ? realisticAccRaw + "%" : realisticAccRaw;
  const realCzechAccRaw = rcj && rcj.corpus_accuracy ? String(rcj.corpus_accuracy) : "SKIPPED";
  const realCzechAcc =
    realCzechAccRaw !== "SKIPPED" && realCzechAccRaw.indexOf("%") < 0 ? realCzechAccRaw + "%" : realCzechAccRaw;
  let deepUxAcc = "SKIPPED";
  if (dpj && dpj.deep_product_accuracy != null) deepUxAcc = String(dpj.deep_product_accuracy) + "%";

  const dangerousWriteCount = rj && rj.dangerous_write_count != null ? String(rj.dangerous_write_count) : "NA";
  const falseWriteCount = rj && rj.false_write_count != null ? String(rj.false_write_count) : "NA";
  const queryCreatedWriteCount =
    rj && rj.query_created_write_count_realistic != null ? String(rj.query_created_write_count_realistic) : "NA";
  const writeWhenNegatedCount =
    rj && rj.write_when_negated_count != null ? String(rj.write_when_negated_count) : "NA";

  assertAssetsAppClean("end");

  const changedPaths = gitChangedFiles();
  const changedFiles = changedPaths.length ? changedPaths.join(";") : "";

  const reportObj = {
    harness_id: "silver_rcz2_mobile_voice_intent_fail_diagnostic",
    main_commit: mainCommit,
    branch,
    engine_changed: "NO",
    assets_app_changed: "NO",
    target_cluster: TARGET_CLUSTER_KEY,
    target_cluster_total: targetClusterTotal,
    inspected_count: inspectedCount,
    counts: {
      calendar_write_intent_fail: calendarWriteIntentFailCount,
      task_write_intent_fail: taskWriteIntentFailCount,
      note_write_intent_fail: noteWriteIntentFailCount,
      calendar_query_intent_fail: calendarQueryIntentFailCount,
      task_query_intent_fail: taskQueryIntentFailCount,
      note_query_intent_fail: noteQueryIntentFailCount,
      negation_or_correction_phrase: negationOrCorrectionPhraseCount,
      storage_disambiguation: storageDisambiguationCount,
      calendar_vs_task_ambiguity: calendarVsTaskAmbiguityCount,
      wrong_expected_intent_or_harness_problem: wrongExpectedIntentOrHarnessProblemCount,
      seed_mismatch: seedMismatchCount,
      true_product_fail: trueProductFailCount,
      safety_risk: safetyRiskCount
    },
    subclusters_top5: top5.map((p) => ({ key: p.k, count: p.n, examples: examplesForKey(p.k, 3) })),
    representative_examples: representative.map((r) => ({
      id: r.id,
      group: r.group,
      expected: r.expected,
      actual: r.actual,
      ps: r.processingState,
      eng: r.normalizedIntent,
      input: r.input.slice(0, 220)
    })),
    recommendation: {
      recommended_next_fix_cluster: recommendedNextFixCluster,
      recommended_next_fix_scope: recommendedNextFixScope,
      recommended_reason: recommendedReason,
      risk_level: riskLevel,
      ready_for_fix_task: readyForFixTask
    },
    audit_snapshot: {
      calendar_write_20k: calendarWrite20k,
      overall_20k_accuracy: overall20kAcc,
      quality_accuracy: qualityAcc,
      realistic_overall_accuracy: realisticAcc,
      real_czech_corpus_accuracy: realCzechAcc,
      deep_product_real_ux_v2_accuracy: deepUxAcc,
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount
    },
    changed_files: changedFiles,
    git_status_clean: changedPaths.length === 0 ? "YES" : "NO"
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  function escapeKeyLine(s) {
    return String(s || "").replace(/\r?\n/g, "\\n");
  }

  function exLine(idx, field) {
    const t = top5[idx - 1];
    if (!t) return "";
    if (field === "name") return escapeKeyLine(t.k);
    if (field === "count") return String(t.n);
    if (field === "examples") return escapeField(examplesForKey(t.k, 3).join(" | "));
    return "";
  }

  const block = [
    "=== SILVER_RCZ2_MOBILE_VOICE_INTENT_FAIL_DIAGNOSTIC_RESULT ===",
    "main_commit=" + escapeField(mainCommit),
    "branch=" + escapeField(branch),
    "engine_changed=NO",
    "assets_app_changed=NO",
    "changed_files=" + escapeField(changedFiles),
    "",
    "target_cluster=" + escapeField(TARGET_CLUSTER_KEY),
    "target_cluster_total=" + targetClusterTotal,
    "inspected_count=" + inspectedCount,
    "",
    "calendar_write_intent_fail_count=" + calendarWriteIntentFailCount,
    "task_write_intent_fail_count=" + taskWriteIntentFailCount,
    "note_write_intent_fail_count=" + noteWriteIntentFailCount,
    "calendar_query_intent_fail_count=" + calendarQueryIntentFailCount,
    "task_query_intent_fail_count=" + taskQueryIntentFailCount,
    "note_query_intent_fail_count=" + noteQueryIntentFailCount,
    "",
    "negation_or_correction_phrase_count=" + negationOrCorrectionPhraseCount,
    "storage_disambiguation_count=" + storageDisambiguationCount,
    "calendar_vs_task_ambiguity_count=" + calendarVsTaskAmbiguityCount,
    "wrong_expected_intent_or_harness_problem_count=" + wrongExpectedIntentOrHarnessProblemCount,
    "seed_mismatch_count=" + seedMismatchCount,
    "true_product_fail_count=" + trueProductFailCount,
    "safety_risk_count=" + safetyRiskCount,
    "",
    "subcluster_1=" + exLine(1, "name"),
    "subcluster_1_count=" + exLine(1, "count"),
    "subcluster_1_examples=" + exLine(1, "examples"),
    "subcluster_2=" + exLine(2, "name"),
    "subcluster_2_count=" + exLine(2, "count"),
    "subcluster_2_examples=" + exLine(2, "examples"),
    "subcluster_3=" + exLine(3, "name"),
    "subcluster_3_count=" + exLine(3, "count"),
    "subcluster_3_examples=" + exLine(3, "examples"),
    "subcluster_4=" + exLine(4, "name"),
    "subcluster_4_count=" + exLine(4, "count"),
    "subcluster_4_examples=" + exLine(4, "examples"),
    "subcluster_5=" + exLine(5, "name"),
    "subcluster_5_count=" + exLine(5, "count"),
    "subcluster_5_examples=" + exLine(5, "examples"),
    "",
    "recommended_next_fix_cluster=" + escapeField(recommendedNextFixCluster),
    "recommended_next_fix_scope=" + escapeField(recommendedNextFixScope),
    "recommended_reason=" + escapeField(recommendedReason),
    "risk_level=" + riskLevel,
    "ready_for_fix_task=" + readyForFixTask,
    "",
    "calendar_write_20k=" + escapeField(calendarWrite20k),
    "20k_overall_accuracy=" + escapeField(overall20kAcc),
    "quality_accuracy=" + escapeField(qualityAcc),
    "realistic_overall_accuracy=" + escapeField(realisticAcc),
    "real_czech_corpus_accuracy=" + escapeField(realCzechAcc),
    "deep_product_real_ux_v2_accuracy=" + escapeField(deepUxAcc),
    "",
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "",
    "git_status_clean=" + reportObj.git_status_clean,
    "======= END_SILVER_RCZ2_MOBILE_VOICE_INTENT_FAIL_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log("\n" + block);

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
}

if (require.main === module) {
  main();
}
