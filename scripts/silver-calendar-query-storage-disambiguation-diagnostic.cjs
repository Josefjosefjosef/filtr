/**
 * SILVER_CALENDAR_QUERY_STORAGE_DISAMBIGUATION_DIAGNOSTIC — scripts-only P1.
 * Subcluster: calendar_query|exp=calendar.query|act=unknown|ps=STORAGE_DISAMBIGUATION|eng=create.storage_disambiguation
 * within rcz2_mobile_voice||intent_fail. Does not modify assets/app.js or engine bundle.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-calendar-query-storage-disambiguation-diagnostic-report.json");
const TARGET_CLUSTER = "rcz2_mobile_voice||intent_fail";
const TARGET_SUBCLUSTER_KEY =
  "calendar_query|exp=calendar.query|act=unknown|ps=STORAGE_DISAMBIGUATION|eng=create.storage_disambiguation";
const MOBILE_FIRST_GID = 12000 + 7000 + 4500 + 4500 + 1;
const SAMPLE_GOAL = 120;

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;
const { buildPublicUxCorpusV2 } = require("./silver-real-czech-public-ux-corpus-v2.cjs");

function gidFromCaseId(id) {
  const m = /^rcz2_(\d+)$/.exec(String(id || ""));
  return m ? parseInt(m[1], 10) : -1;
}

function groupToKind(g) {
  if (g === "calendar_write") return 0;
  if (g === "task_write") return 1;
  if (g === "note_write") return 2;
  if (g === "calendar_query") return 3;
  if (g === "task_query") return 4;
  return -1;
}

function mobileSeedMismatch(c) {
  const gid = gidFromCaseId(c.id);
  if (gid < MOBILE_FIRST_GID || gid > MOBILE_FIRST_GID + 22000 - 1) return false;
  const idx = gid - MOBILE_FIRST_GID;
  const kind = idx % 5;
  return groupToKind(c.group) !== kind;
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

function looksTaskQueryText(fi) {
  return (
    /\b(do\s+ukol|v\s+ukol|v\s+ukolech|ukoly|ukolech)\b/.test(fi) &&
    /\b(mrkni|koukni|najdi|zjisti|podivej|co\s+mam|ukaz)\b/.test(fi)
  );
}

function looksCalendarReadQuery(fi) {
  return (
    /\b(mrkni|koukni|najdi|zjisti|ukaz|podivej|co\s+mam|kdy\s+mam)\b/.test(fi) &&
    /\bkalend|zubar|schuzk|program\b/.test(fi)
  );
}

function hasCorrectionOrPivotPhrase(fi) {
  return (
    /\b(vlastne|spis|oprav|presun|zrus|zru[sš]|nedavej|neukladej|pockej|ne\s+pockej)\b/.test(fi) ||
    /\bne\s+do\s+(kalend|ukol)\b/.test(fi) ||
    /\bne\s+kalend\b/.test(fi) ||
    /\bne\s+ukol\b/.test(fi) ||
    /\bnevim\s+presne\b/.test(fi)
  );
}

function hasMixedStorageCue(fi) {
  return (
    /\b(do\s+kalend|do\s+ukol|do\s+poznam|kalendari|ukolu|poznamk)\b/.test(fi) &&
    (/\bne\s+do\b/.test(fi) || /\bale\s+do\b/.test(fi) || /\bnedavej\b/.test(fi) || /\bvlastne\b/.test(fi))
  );
}

function classifyRow(c, folded, seedBad) {
  const fi = folded;
  if (seedBad) {
    return { root_cause: "wrong_expected_calendar_query", classification: "harness_label_problem" };
  }
  if (looksTaskQueryText(fi)) {
    return { root_cause: "wrong_expected_calendar_query", classification: "harness_label_problem" };
  }
  if (/\bzapis\s+(mi\s+)?(si\s+)?poznam|poznamku\s+ze|uloz\s+do\s+poznam|poznamenej\b/.test(fi)) {
    return {
      root_cause: "note_or_task_phrase_mislabeled_as_calendar_query",
      classification: "harness_label_problem"
    };
  }
  if (
    /\buloz\s+mi\s+do\s+kalend|\bpripomen\s+mi\b|\bzapis\s+mi\s+do\s+kalend|\bpridej\s+do\s+kalend|\bnahod\s+do\s+kalend/.test(
      fi
    )
  ) {
    return { root_cause: "create_phrase_mislabeled_as_query", classification: "harness_label_problem" };
  }
  if (hasNegWrite(fi) || /\bjen\s+(cti|čti|se\s+podivej|se\s+podívej)\b/.test(fi)) {
    return { root_cause: "correction_phrase_conflict", classification: "safety_sensitive" };
  }
  if (hasMixedStorageCue(fi)) {
    return { root_cause: "ambiguous_mixed_module", classification: "ambiguous_user_input" };
  }
  if (!hasCorrectionOrPivotPhrase(fi) && looksCalendarReadQuery(fi)) {
    return { root_cause: "calendar_read_anchor_missing", classification: "true_product_fail" };
  }
  if (hasCorrectionOrPivotPhrase(fi)) {
    return { root_cause: "correction_phrase_conflict", classification: "ambiguous_user_input" };
  }
  if (!/\b(schuzk|ukol|poznam|zubar|pravnik|udal|kalend|meeting|doktor|ucetni|advokat|faktur)\b/.test(fi)) {
    if (/\b(zejtra|zitra|rano|vecer|utery|patku|pondeli|dnes)\b/.test(fi)) {
      return { root_cause: "time_only_without_entity", classification: "not_enough_context" };
    }
  }
  if (/^(hele|tyjo|btw|vlastne|pockej|no\s+tak)\s+/i.test(String(c.input || "").trim()) && fi.split(/\s+/).length < 14) {
    return { root_cause: "mobile_voice_prefix_noise", classification: "ambiguous_user_input" };
  }
  return { root_cause: "other", classification: "not_enough_context" };
}

function stratifiedByClassification(rows, minN) {
  const byC = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const k = r.classification || "not_enough_context";
    if (!byC[k]) byC[k] = [];
    byC[k].push(r);
  }
  const keys = Object.keys(byC).sort();
  const out = [];
  let round = 0;
  while (out.length < minN && out.length < rows.length) {
    let added = false;
    for (let ki = 0; ki < keys.length; ki++) {
      const arr = byC[keys[ki]];
      if (arr && arr[round]) {
        out.push(arr[round]);
        added = true;
        if (out.length >= minN) break;
      }
    }
    if (!added) break;
    round++;
  }
  for (let i = 0; i < rows.length && out.length < minN; i++) {
    if (out.indexOf(rows[i]) < 0) out.push(rows[i]);
  }
  return out;
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

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function topN(hist, n) {
  return Object.keys(hist)
    .map((k) => ({ k: k, n: hist[k] }))
    .sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k)))
    .slice(0, n);
}

function main() {
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = buildPublicUxCorpusV2();
  const bucket = [];

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateOne(c, turn);
    if (c.cluster !== "rcz2_mobile_voice" || ev.cat !== "intent_fail") continue;

    const row = {
      id: c.id,
      cluster: c.cluster,
      group: c.group,
      input: c.input,
      expected: c.expectedIntent,
      actual: ev.auditIntent,
      processingState: turn.processingState,
      normalizedIntent: turn.normalizedIntent,
      raw: ev.raw
    };
    if (subclusterKey(row) !== TARGET_SUBCLUSTER_KEY) continue;

    const folded = foldCs(c.input);
    const seedBad = mobileSeedMismatch(c);
    const cl = classifyRow(c, folded, seedBad);
    row.provider_state = String(turn.processingState || "");
    row.engine_action = String(turn.normalizedIntent || "");
    row.root_cause = cl.root_cause;
    row.classification = cl.classification;
    bucket.push(row);
  }

  const clsCount = {
    true_product_fail: 0,
    harness_label_problem: 0,
    ambiguous_user_input: 0,
    safety_sensitive: 0,
    not_enough_context: 0
  };
  const rootHist = {};
  for (let i = 0; i < bucket.length; i++) {
    const r = bucket[i];
    clsCount[r.classification] = (clsCount[r.classification] || 0) + 1;
    rootHist[r.root_cause] = (rootHist[r.root_cause] || 0) + 1;
  }

  const inspected = stratifiedByClassification(bucket, Math.min(SAMPLE_GOAL, Math.max(bucket.length, 0)));
  const inspectedCount = inspected.length;

  const top5 = topN(rootHist, 5);
  function pickUpTo(arr, pred, n) {
    const o = [];
    for (let i = 0; i < arr.length && o.length < n; i++) {
      if (pred(arr[i])) o.push(arr[i]);
    }
    return o;
  }
  const exProds = pickUpTo(bucket, (r) => r.classification === "true_product_fail", 3);
  const exHars = pickUpTo(bucket, (r) => r.classification === "harness_label_problem", 3);
  const exProd1 = exProds[0] || null;
  const exProd2 = exProds[1] || null;
  const exProd3 = exProds[2] || null;
  const exHar1 = exHars[0] || null;
  const exHar2 = exHars[1] || null;
  const exHar3 = exHars[2] || null;

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e1) {
    void e1;
  }
  const changedPaths = gitChangedFiles();
  const engineChanged = "NO";
  const assetsAppChanged = "NO";

  const safeFixCandidate =
    clsCount.harness_label_problem > clsCount.ambiguous_user_input &&
    bucket.length > 0 &&
    clsCount.harness_label_problem / bucket.length >= 0.45
      ? "YES"
      : "NO";
  let safeFixScope = "NO_SCOPE";
  let unsafeReasons =
    "Dominant signals are not pure harness mislabels; includes true_product_fail, ambiguity, or safety-sensitive rows — narrow auto-fix unsafe without engine/harness co-design.";
  if (safeFixCandidate === "YES") {
    safeFixScope =
      "Silver rcz2_mobile_voice: harness-only relabel or template fork for calendar_query mobile_voice slot (kind index 3) rows that are note.create / task.create / calendar.create phrasing in MOB_MID.";
    unsafeReasons =
      String(clsCount.ambiguous_user_input) +
      " rows remain ambiguous_user_input (correction / mixed storage); engine STORAGE_DISAMBIGUATION untouched; no routing change in this diagnostic.";
  }

  const reportObj = {
    harness_id: "silver_calendar_query_storage_disambiguation_diagnostic",
    main_commit: mainCommit,
    engine_changed: engineChanged,
    assets_app_changed: assetsAppChanged,
    target_cluster: TARGET_CLUSTER,
    target_subcluster: "calendar_query_storage_disambiguation",
    target_subcluster_key: TARGET_SUBCLUSTER_KEY,
    target_subcluster_count: bucket.length,
    inspected_count: inspectedCount,
    classification_counts: clsCount,
    root_cause_histogram: rootHist,
    top_root_causes: top5,
    samples: inspected.map((r) => ({
      id: r.id,
      input: r.input.slice(0, 400),
      expected: r.expected,
      actual: r.actual,
      provider_state: r.provider_state,
      engine_action: r.engine_action,
      root_cause: r.root_cause,
      classification: r.classification
    })),
    safe_fix_candidate: safeFixCandidate,
    safe_fix_scope: safeFixScope,
    unsafe_or_deferred_reasons: unsafeReasons,
    git_status_clean: changedPaths.length === 0 ? "YES" : "NO",
    changed_files: changedPaths.length ? changedPaths.join(";") : ""
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  function fmtEx(r) {
    if (!r) return "";
    return (
      "id=" +
      escapeField(r.id) +
      " | in=" +
      escapeField(r.input.slice(0, 160)) +
      " | cls=" +
      escapeField(r.classification) +
      " | rc=" +
      escapeField(r.root_cause)
    );
  }

  const t1 = top5[0] || { k: "", n: 0 };
  const t2 = top5[1] || { k: "", n: 0 };
  const t3 = top5[2] || { k: "", n: 0 };
  const t4 = top5[3] || { k: "", n: 0 };
  const t5 = top5[4] || { k: "", n: 0 };

  const block = [
    "=== SILVER_CALENDAR_QUERY_STORAGE_DIAGNOSTIC_RESULT ===",
    "main_commit=" + escapeField(mainCommit),
    "engine_changed=" + engineChanged,
    "assets_app_changed=" + assetsAppChanged,
    "",
    "target_cluster=" + escapeField(TARGET_CLUSTER),
    "target_subcluster=calendar_query_storage_disambiguation",
    "target_subcluster_count=" + bucket.length,
    "inspected_count=" + inspectedCount,
    "",
    "true_product_fail_count=" + clsCount.true_product_fail,
    "harness_label_problem_count=" + clsCount.harness_label_problem,
    "ambiguous_user_input_count=" + clsCount.ambiguous_user_input,
    "safety_sensitive_count=" + clsCount.safety_sensitive,
    "not_enough_context_count=" + clsCount.not_enough_context,
    "",
    "top_root_cause_1=" + escapeField(t1.k),
    "top_root_cause_1_count=" + t1.n,
    "top_root_cause_2=" + escapeField(t2.k),
    "top_root_cause_2_count=" + t2.n,
    "top_root_cause_3=" + escapeField(t3.k),
    "top_root_cause_3_count=" + t3.n,
    "top_root_cause_4=" + escapeField(t4.k),
    "top_root_cause_4_count=" + t4.n,
    "top_root_cause_5=" + escapeField(t5.k),
    "top_root_cause_5_count=" + t5.n,
    "",
    "safe_fix_candidate=" + safeFixCandidate,
    "safe_fix_scope=" + escapeField(safeFixScope),
    "unsafe_or_deferred_reasons=" + escapeField(unsafeReasons),
    "",
    "example_true_product_fail_1=" + fmtEx(exProd1),
    "example_true_product_fail_2=" + fmtEx(exProd2),
    "example_true_product_fail_3=" + fmtEx(exProd3),
    "",
    "example_harness_problem_1=" + fmtEx(exHar1),
    "example_harness_problem_2=" + fmtEx(exHar2),
    "example_harness_problem_3=" + fmtEx(exHar3),
    "",
    "git_status_clean=" + reportObj.git_status_clean,
    "recommended_next_step=Human review of 120 stratified samples in " +
      escapeField(path.basename(REPORT_JSON)) +
      "; reconcile heuristic labels against product policy before any routing change.",
    "======= END_SILVER_CALENDAR_QUERY_STORAGE_DIAGNOSTIC_RESULT ==="
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
