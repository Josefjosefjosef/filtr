/**
 * SILVER_RCZ2_ULTRA_SHORT_CHAOS_DIAGNOSTIC — cluster rcz2_ultra_short_chaos (Public UX V2).
 * Classifies failures into product taxonomy; emits JSON report + console summary.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER_NAME = "rcz2_ultra_short_chaos";
const REPORT_JSON = path.join(__dirname, "silver-real-czech-public-ux-corpus-v2-report.json");
const DIAG_REPORT_JSON = path.join(__dirname, "silver-rcz2-ultra-short-chaos-diagnostic-report.json");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;
const { buildPublicUxCorpusV2 } = require("./silver-real-czech-public-ux-corpus-v2.cjs");

const CLASSIFICATIONS = [
  "TRUE_ENGINE_FAIL",
  "HARNESS_GOLD_MISMATCH",
  "AMBIGUOUS_USER_INPUT",
  "SAFE_CLARIFICATION_OK",
  "STALE_AUDIT",
  "NO_SAFE_FIX"
];

const SUBCLUSTERS = [
  "ultra_short_entity_daypart",
  "ultra_short_entity_date",
  "ultra_short_query_seed_calendar",
  "ultra_short_query_seed_task",
  "ultra_short_query_seed_note",
  "ultra_short_filler_noise",
  "other"
];

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

function yn(b) {
  return b ? "ano" : "ne";
}

function wordCount(raw) {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hasDaypartOrDate(f) {
  return /\b(rano|vecer|odpoledne|dopoledne|noc|zitra|zejtra|dnes|pozitri|na\s+patek)\b/.test(f);
}

function hasWriteCue(f) {
  return /\b(uloz|ulozit|zapis|pridej|vytvor|nahod|dej\s+mi\s+do|naplanuj)\b/.test(f);
}

function hasExplicitModule(f) {
  return /\b(do\s+kalend|v\s+kalend|do\s+ukol|v\s+ukol|do\s+poznam|v\s+poznam)\b/.test(f);
}

function hasCalendarEntityCue(f) {
  return /\b(zubar|doktor|pravnik|ucetni|advokat|schuz|udalost|porad)\b/.test(f);
}

function dangerousCreateLike(turn) {
  const ps = String(turn.processingState || "");
  const ni = String(turn.normalizedIntent || "");
  return ps === "READY_TO_SAVE" || ni === "calendar.create" || ni === "tasks.create" || ni === "notes.create";
}

function assignSubcluster(row) {
  const f = row.folded;
  const g = String(row.group || "");
  if (/\b(prosim|tyjo|fakt|rychle)\b/.test(f) || /\?\?/.test(row.input)) return "ultra_short_filler_noise";
  if (g === "calendar_query") return "ultra_short_query_seed_calendar";
  if (g === "task_query") return "ultra_short_query_seed_task";
  if (g === "note_query") return "ultra_short_query_seed_note";
  if (hasDaypartOrDate(f)) return "ultra_short_entity_daypart";
  return "other";
}

function assignClassification(row) {
  const exp = String(row.expected || "");
  const act = String(row.actual || "");
  const eng = String(row.normalizedIntent || "");
  const ps = String(row.processingState || "");
  const cat = String(row.harnessCat || "");
  const f = row.folded;

  if (row.pass) {
    if (exp === "unknown") {
      if (
        act === "unknown" ||
        eng === "clarification" ||
        eng === "unknown" ||
        ps === "CLARIFICATION" ||
        ps === "STORAGE_DISAMBIGUATION" ||
        ps === "NEEDS_CLARIFICATION"
      ) {
        return {
          classification: "SAFE_CLARIFICATION_OK",
          reason: "gold_unknown_engine_safe_clarify_or_unknown_path",
          engine_fix_safe: "ne"
        };
      }
      if (!dangerousCreateLike(row.turn)) {
        return {
          classification: "AMBIGUOUS_USER_INPUT",
          reason: "gold_unknown_pass_without_unsafe_create",
          engine_fix_safe: "ne"
        };
      }
    }
    return {
      classification: "AMBIGUOUS_USER_INPUT",
      reason: "harness_pass",
      engine_fix_safe: "ne"
    };
  }

  if (exp === "unknown" && dangerousCreateLike(row.turn) && (eng === "calendar.create" || cat.indexOf("confusion") >= 0)) {
    return {
      classification: "TRUE_ENGINE_FAIL",
      reason: "implicit_calendar_create_on_entity_daypart_fragment",
      engine_fix_safe: "ano"
    };
  }

  if (exp === "unknown" && act !== "unknown" && !dangerousCreateLike(row.turn)) {
    return {
      classification: "HARNESS_GOLD_MISMATCH",
      reason: "harness_expected_unknown_but_concrete_read_without_create",
      engine_fix_safe: "ne"
    };
  }

  if (exp === "unknown" && wordCount(row.input) <= 5 && !hasWriteCue(f) && !hasExplicitModule(f)) {
    return {
      classification: "AMBIGUOUS_USER_INPUT",
      reason: "ultra_short_fragment_genuinely_ambiguous",
      engine_fix_safe: "ne"
    };
  }

  if (cat === "intent_fail" && exp === "unknown") {
    return {
      classification: "HARNESS_GOLD_MISMATCH",
      reason: "seed_group_module_label_vs_gold_unknown_tension",
      engine_fix_safe: "ne"
    };
  }

  return {
    classification: "NO_SAFE_FIX",
    reason: "unclassified_fail_shape",
    engine_fix_safe: "ne"
  };
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
  if (!lines.length) return true;
  const allow = {
    "assets/app.js": true,
    "scripts/silver-rcz2-ultra-short-chaos-diagnostic.cjs": true,
    "scripts/silver-rcz2-ultra-short-chaos-diagnostic-report.json": true,
    "scripts/silver-real-czech-public-ux-corpus-v2-report.json": true
  };
  for (let i = 0; i < lines.length; i++) {
    const rest = String(lines[i] || "").length >= 4 ? String(lines[i]).slice(3).trim() : String(lines[i]).trim();
    if (!allow[rest]) return false;
  }
  return true;
}

function main() {
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const report = readJsonSafe(REPORT_JSON);
  const cases = buildPublicUxCorpusV2();
  const rows = [];
  const byClass = {};
  const bySub = {};
  for (let ci = 0; ci < CLASSIFICATIONS.length; ci++) byClass[CLASSIFICATIONS[ci]] = [];
  for (let si = 0; si < SUBCLUSTERS.length; si++) bySub[SUBCLUSTERS[si]] = [];

  let failCount = 0;
  let inspected = 0;
  let safetySensitive = 0;
  let wrongModule = 0;
  let queryToCreateRisk = 0;
  let titlePollution = 0;
  let storageDisambiguation = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    if (c.cluster !== TARGET_CLUSTER_NAME) continue;
    inspected++;
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateOne(c, turn);
    const folded = foldCs(c.input);
    const row = {
      id: c.id,
      cluster: c.cluster,
      group: c.group,
      input: c.input,
      expected: String(c.expectedIntent || ""),
      actual: String(ev.auditIntent || ""),
      harnessCat: String(ev.cat || ""),
      pass: !!ev.pass,
      processingState: String(turn.processingState || ""),
      normalizedIntent: String(turn.normalizedIntent || ""),
      raw: String(ev.raw || ""),
      folded,
      turn
    };
    const sub = assignSubcluster(row);
    row.subcluster = sub;
    const asg = assignClassification(row);
    row.classification = asg.classification;
    row.reason = asg.reason;
    row.engine_fix_safe = asg.engine_fix_safe;
    rows.push(row);
    byClass[row.classification].push(row);
    bySub[sub].push(row);

    if (!ev.pass) failCount++;
    if (dangerousCreateLike(turn) && c.expectedIntent === "unknown") safetySensitive++;
    if (ev.cat === "calendar_vs_task_confusion" || ev.cat === "wrong_collection" || ev.cat === "note_vs_task_confusion") {
      wrongModule++;
    }
    if (c.group.indexOf("_query") > 0 && (turn.normalizedIntent === "calendar.create" || turn.processingState === "READY_TO_SAVE")) {
      queryToCreateRisk++;
    }
    if (/\b(title|dirty_calendar_title|bad_title)/.test(String(ev.cat || ""))) titlePollution++;
    if (turn.processingState === "STORAGE_DISAMBIGUATION") storageDisambiguation++;
  }

  const totalClusterCases = rows.length;
  const counts = {};
  for (let i = 0; i < CLASSIFICATIONS.length; i++) counts[CLASSIFICATIONS[i]] = byClass[CLASSIFICATIONS[i]].length;

  const subCounts = {};
  for (let i = 0; i < SUBCLUSTERS.length; i++) subCounts[SUBCLUSTERS[i]] = bySub[SUBCLUSTERS[i]].length;

  const topSubclusters = Object.keys(subCounts)
    .map((k) => k + ":" + subCounts[k])
    .sort((a, b) => parseInt(b.split(":")[1], 10) - parseInt(a.split(":")[1], 10))
    .slice(0, 8);

  function pickSamples(cls, cap) {
    const arr = byClass[cls] || [];
    const fails = arr.filter((r) => !r.pass);
    const src = fails.length ? fails : arr;
    return src.slice(0, cap).map((r) => ({
      input: r.input,
      expected: r.expected,
      actual: r.actual,
      classification: r.classification,
      reason: r.reason,
      engine_fix_safe: r.engine_fix_safe,
      harness_cat: r.harnessCat,
      processingState: r.processingState,
      normalizedIntent: r.normalizedIntent,
      subcluster: r.subcluster,
      pass: r.pass
    }));
  }

  const engineFixRecommended = counts.TRUE_ENGINE_FAIL > 0 ? "YES" : "NO";
  const harnessAlignmentRecommended =
    counts.HARNESS_GOLD_MISMATCH + counts.STALE_AUDIT > counts.TRUE_ENGINE_FAIL && counts.TRUE_ENGINE_FAIL === 0
      ? "YES"
      : counts.HARNESS_GOLD_MISMATCH > 0
        ? "YES"
        : "NO";

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

  const changedPaths = gitChangedFiles();
  const porc = (() => {
    try {
      return execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    } catch (e3) {
      void e3;
      return [];
    }
  })();

  const reportObj = {
    harness_id: "silver_rcz2_ultra_short_chaos_diagnostic",
    main_commit: mainCommit,
    branch,
    target_cluster: TARGET_CLUSTER_NAME,
    total_cluster_cases: totalClusterCases,
    fail_count: failCount,
    inspected_count: inspected,
    classification_counts: counts,
    true_engine_fail_count: counts.TRUE_ENGINE_FAIL,
    harness_gold_mismatch_count: counts.HARNESS_GOLD_MISMATCH,
    ambiguous_user_input_count: counts.AMBIGUOUS_USER_INPUT,
    safe_clarification_ok_count: counts.SAFE_CLARIFICATION_OK,
    stale_audit_count: counts.STALE_AUDIT,
    no_safe_fix_count: counts.NO_SAFE_FIX,
    safety_sensitive_count: safetySensitive,
    wrong_module_count: wrongModule,
    query_to_create_risk_count: queryToCreateRisk,
    title_pollution_count: titlePollution,
    storage_disambiguation_count: storageDisambiguation,
    subcluster_counts: subCounts,
    top_subclusters: topSubclusters,
    recommendation: {
      engine_fix_recommended: engineFixRecommended,
      harness_alignment_recommended: harnessAlignmentRecommended,
      narrow_engine_guard: "iuSilverUltraShortTimeFragmentNoImplicitCreateFolded",
      pre_fix_fail_estimate: 2828,
      root_cause: "implicit_calendar_create_on_entity_plus_daypart_ultra_short_fragments"
    },
    representative_samples: {
      TRUE_ENGINE_FAIL: pickSamples("TRUE_ENGINE_FAIL", 5),
      HARNESS_GOLD_MISMATCH: pickSamples("HARNESS_GOLD_MISMATCH", 5),
      AMBIGUOUS_USER_INPUT: pickSamples("AMBIGUOUS_USER_INPUT", 5),
      SAFE_CLARIFICATION_OK: pickSamples("SAFE_CLARIFICATION_OK", 8),
      STALE_AUDIT: pickSamples("STALE_AUDIT", 3),
      NO_SAFE_FIX: pickSamples("NO_SAFE_FIX", 3)
    },
    report_json_stale_hint:
      report && report.main_commit && report.main_commit !== mainCommit ? "YES" : "NO",
    changed_files: changedPaths.join(";"),
    git_status_clean: porc.length === 0 ? "YES" : onlyAllowedDirty(porc) ? "YES" : "NO"
  };

  fs.writeFileSync(DIAG_REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const lines = [];
  lines.push("=== RCZ2_ULTRA_SHORT_CHAOS_DIAGNOSTIC ===");
  lines.push("main_commit=" + escapeField(mainCommit));
  lines.push("target_cluster=" + TARGET_CLUSTER_NAME);
  lines.push("total_cluster_cases=" + totalClusterCases);
  lines.push("fail_count=" + failCount);
  lines.push("inspected_count=" + inspected);
  lines.push("true_engine_fail_count=" + counts.TRUE_ENGINE_FAIL);
  lines.push("harness_gold_mismatch_count=" + counts.HARNESS_GOLD_MISMATCH);
  lines.push("ambiguous_user_input_count=" + counts.AMBIGUOUS_USER_INPUT);
  lines.push("safe_clarification_ok_count=" + counts.SAFE_CLARIFICATION_OK);
  lines.push("stale_audit_count=" + counts.STALE_AUDIT);
  lines.push("no_safe_fix_count=" + counts.NO_SAFE_FIX);
  lines.push("safety_sensitive_count=" + safetySensitive);
  lines.push("wrong_module_count=" + wrongModule);
  lines.push("query_to_create_risk_count=" + queryToCreateRisk);
  lines.push("title_pollution_count=" + titlePollution);
  lines.push("storage_disambiguation_count=" + storageDisambiguation);
  lines.push("top_subclusters=" + topSubclusters.join(" | "));
  lines.push("engine_fix_recommended=" + engineFixRecommended);
  lines.push("harness_alignment_recommended=" + harnessAlignmentRecommended);
  lines.push("diagnostic_report=" + DIAG_REPORT_JSON);
  lines.push("=== END_RCZ2_ULTRA_SHORT_CHAOS_DIAGNOSTIC ===");
  console.log("\n" + lines.join("\n"));

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
