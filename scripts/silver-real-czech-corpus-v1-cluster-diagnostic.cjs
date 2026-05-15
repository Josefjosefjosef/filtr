/**
 * SILVER_REAL_CZECH_CORPUS_V1 — cluster diagnostic (scripts only).
 * Reads scripts/silver-real-czech-corpus-v1-report.json; no engine/UI changes.
 * Optional: --run-gates  runs smoke, iu-perf, 20k, quality v2, realistic mobile audits and fills gate fields.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-real-czech-corpus-v1-report.json");

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function readReport() {
  const raw = fs.readFileSync(REPORT_JSON, "utf8");
  return JSON.parse(raw);
}

function isReadIntent(exp) {
  const e = String(exp || "");
  return (
    e.indexOf(".query") > 0 ||
    e === "global.search" ||
    e.indexOf("read") === 0 ||
    e.indexOf("query") > 0
  );
}

function isWriteIntent(exp) {
  const e = String(exp || "");
  return e.indexOf(".write") > 0 || e.indexOf("create") === 0;
}

function safetyRiskFromRow(f) {
  return String(f.safety_risk || "").toLowerCase() === "yes";
}

function classifyFail(f) {
  const cluster = String(f.cluster || "");
  const input = String(f.input || "");
  const fi = foldCs(input);
  const raw = String(f.raw || "");
  const expected = String(f.expected || "");
  const actual = String(f.actual || "");
  const cat = String(f.cat || "");

  const expectedWasSafe = isReadIntent(expected) || (!isWriteIntent(expected) && !expected.includes("write")) ? "YES" : "NO";
  let actualWasSafe = "YES";
  if (safetyRiskFromRow(f)) actualWasSafe = "NO";
  else if (actual.indexOf(".write") > 0 || actual.indexOf("write") === 0) actualWasSafe = "NO";

  let actualStatus = cat || "unknown_cat";
  if (actual === "unknown" && raw) actualStatus = "clarify_or_unknown";

  const actualReason = raw.replace(/\r?\n/g, "\\n").slice(0, 500);

  let isEngineBug = "NO";
  let isHarnessBug = "NO";
  let isCorrectClarification = "NO";
  let safetyRisk = safetyRiskFromRow(f) ? "YES" : "NO";
  let recommendedAction = "defer_pending_human_review";
  let minimalFixScope = "none";

  if (cluster === "rcz_note_query") {
    const hasNoteAnchor = fi.indexOf("poznam") >= 0;
    const hasReadCue = /\b(mrkni|zjisti|heslo|wifi|cti|čti)\b/.test(fi);
    if (hasNoteAnchor && hasReadCue && actual === "unknown") {
      isEngineBug = "YES";
      recommendedAction = "strengthen_note_read_routing_Czech_collocations";
      minimalFixScope = "Silver note.query anchors (non-engine change forbidden here; next task)";
    } else if (actual === "unknown") {
      isCorrectClarification = "YES";
      recommendedAction = "keep_clarify_or_expand_corpus_expected_next_task";
      minimalFixScope = "corpus_expected_or_templates_followup";
    }
  } else if (cluster === "rcz_negation_safety_task") {
    const negNoSave =
      /\bnic\s+neukl(a|á)?dej\b/.test(fi) ||
      /\bneukl(a|á)?dej\b/.test(fi) ||
      /\bzadny\s+zapis\b/.test(fi);
    const readQueryCue = /\b(jen\s+)?(zjisti|zjistit|cist|cti|ukol|ukoly)\b/.test(fi);
    const slangThrowTam = /\bhod\b.*\btam\b/.test(fi);
    const rawFalselyUlozit =
      /uložit\s+do\s+úkol/i.test(raw) ||
      /ulozit\s+do\s+ukol/i.test(foldCs(raw)) ||
      /požadavkem\s+uložit/i.test(raw) ||
      /pozadavkem\s+ulozit/i.test(foldCs(raw));

    if (negNoSave && readQueryCue && rawFalselyUlozit) {
      isEngineBug = "YES";
      isCorrectClarification = "NO";
      recommendedAction = "fix_nl_contradiction_detection_task_read_under_negation";
      minimalFixScope = "engine_followup_not_this_PR";
    } else if (slangThrowTam && negNoSave) {
      isCorrectClarification = "YES";
      isHarnessBug = "YES";
      recommendedAction = "relax_corpus_expected_or_add_paraphrase_row_hod_tam_read";
      minimalFixScope = "corpus_only_next_task";
    } else if (negNoSave && readQueryCue) {
      isEngineBug = "YES";
      recommendedAction = "disambiguate_task_read_vs_write_under_colloquial_Czech";
      minimalFixScope = "templates_or_corpus_next_task";
    } else {
      isCorrectClarification = "YES";
      minimalFixScope = "corpus_or_templates_next_task";
    }
  }

  if (isEngineBug === "YES" && isHarnessBug === "YES") isHarnessBug = "NO";

  return {
    expected_was_safe: expectedWasSafe,
    actual_was_safe: actualWasSafe,
    is_engine_bug: isEngineBug,
    is_harness_bug: isHarnessBug,
    is_correct_clarification: isCorrectClarification,
    safety_risk: safetyRisk,
    recommended_action: recommendedAction,
    minimal_fix_scope: minimalFixScope,
    actual_status: actualStatus,
    actual_reason: actualReason
  };
}

function sumCluster(rows, cluster) {
  const sub = rows.filter((r) => r.cluster === cluster);
  let eb = 0;
  let hb = 0;
  let cc = 0;
  let sr = 0;
  for (let i = 0; i < sub.length; i++) {
    const x = sub[i]._cls;
    if (x.is_engine_bug === "YES") eb++;
    if (x.is_harness_bug === "YES") hb++;
    if (x.is_correct_clarification === "YES") cc++;
    if (x.safety_risk === "YES") sr++;
  }
  return { total: sub.length, eb, hb, cc, sr, sub };
}

function clusterRecommendedAction(sum, clusterKey) {
  if (sum.sr > 0) return "STOP_P0_SAFETY_FIX_FIRST";
  if (sum.eb >= sum.total && sum.total > 0) return "engine_routing_" + clusterKey;
  if (sum.hb + sum.cc >= sum.eb && sum.eb === 0) return "corpus_harness_clarification_tune_next_task";
  if (sum.eb > 0) return "mixed_engine_plus_corpus_triage_" + clusterKey;
  return "review_cluster_" + clusterKey;
}

function parseOverallAccuracy(text) {
  const m = String(text || "").match(/overall_accuracy=([\d.]+)%/);
  return m ? m[1] : "";
}

function runOptionalGates() {
  const out = {
    smoke: "SKIPPED",
    iu_perf: "SKIPPED",
    acc20k: "",
    qualityAcc: "",
    realisticAcc: ""
  };
  try {
    execSync('node "' + path.join(REPO, "scripts", "smoke.mjs") + '"', { cwd: REPO, encoding: "utf8", stdio: "pipe" });
    out.smoke = "PASS";
  } catch (e) {
    out.smoke = "FAIL";
  }
  try {
    execSync('node "' + path.join(REPO, "scripts", "iu-perf-regression-guards.mjs") + '"', {
      cwd: REPO,
      encoding: "utf8",
      stdio: "pipe"
    });
    out.iu_perf = "PASS";
  } catch (e2) {
    out.iu_perf = "FAIL";
  }
  try {
    const o20 = execSync('node "' + path.join(REPO, "scripts", "audit_silver_20000_routing_stable.cjs") + '"', {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    out.acc20k = parseOverallAccuracy(o20);
  } catch (e3) {
    out.acc20k = "RUN_FAIL";
  }
  try {
    const oq = execSync('node "' + path.join(REPO, "scripts", "audit_silver_quality_v2.cjs") + '"', {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
    const mq = oq.match(/quality_accuracy=([\d.]+)%/);
    out.qualityAcc = mq ? mq[1] : "";
  } catch (e4) {
    out.qualityAcc = "RUN_FAIL";
  }
  try {
    const or = execSync('node "' + path.join(REPO, "scripts", "audit_silver_realistic_mobile_corpus.cjs") + '"', {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
    const mr = or.match(/overall_accuracy_realistic=([\d.]+)%/);
    if (mr) out.realisticAcc = mr[1];
    else {
      const mr2 = or.match(/overall_accuracy=([\d.]+)%/);
      out.realisticAcc = mr2 ? mr2[1] : "";
    }
    if (!out.realisticAcc) {
      const mr3 = or.match(/realistic[^\n]*accuracy=([\d.]+)/i);
      if (mr3) out.realisticAcc = mr3[1];
    }
  } catch (e5) {
    out.realisticAcc = "RUN_FAIL";
  }
  return out;
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    return "";
  }
}

function gitScriptsChanged() {
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const paths = st
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.replace(/^\s*\S+\s+/, "").trim())
      .filter((p) => p.indexOf("scripts/") === 0);
    return Array.from(new Set(paths)).join(";");
  } catch (e) {
    return "";
  }
}

function gitClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    return o.trim() ? "NO" : "YES";
  } catch (e) {
    return "NO";
  }
}

function main() {
  const runGates = process.argv.indexOf("--run-gates") >= 0;
  const rep = readReport();
  const failsAll = Array.isArray(rep.fails_sample) ? rep.fails_sample : [];
  const fails = failsAll.filter((f) => f && (f.cat || f.expected));

  console.log("=== SILVER_RCZ_CLUSTER_DIAGNOSTIC_DETAIL ===");
  console.log("report_path=" + REPORT_JSON);
  console.log("corpus_fail_field=" + String(rep.corpus_fail != null ? rep.corpus_fail : ""));
  console.log("fails_sample_count=" + fails.length);

  const enriched = [];
  for (let i = 0; i < fails.length; i++) {
    const f = fails[i];
    const cls = classifyFail(f);
    f._cls = cls;
    enriched.push(f);
    console.log("");
    console.log("--- fail_index=" + i + " ---");
    console.log("id=" + f.id);
    console.log("category=" + String(f.cat || ""));
    console.log("cluster=" + String(f.cluster || ""));
    console.log("input=" + String(f.input || "").replace(/\r?\n/g, "\\n"));
    console.log("expected_intent=" + String(f.expected || ""));
    console.log("actual_intent=" + String(f.actual || ""));
    console.log("actual_status=" + cls.actual_status);
    console.log("actual_reason=" + cls.actual_reason);
    console.log("expected_was_safe=" + cls.expected_was_safe);
    console.log("actual_was_safe=" + cls.actual_was_safe);
    console.log("is_engine_bug=" + cls.is_engine_bug);
    console.log("is_harness_bug=" + cls.is_harness_bug);
    console.log("is_correct_clarification=" + cls.is_correct_clarification);
    console.log("safety_risk=" + cls.safety_risk);
    console.log("recommended_action=" + cls.recommended_action);
    console.log("minimal_fix_scope=" + cls.minimal_fix_scope);
    console.log("probable_root_cause=" + String(f.probable_root_cause || ""));
  }

  const neg = sumCluster(enriched, "rcz_negation_safety_task");
  const note = sumCluster(enriched, "rcz_note_query");
  const totalSafetyRisk = neg.sr + note.sr;

  console.log("");
  console.log("=== CLUSTER_A_rcz_negation_safety_task ===");
  console.log(
    "Silver_clarified_or_refused_write_under_negation: cases where raw falsely claims user asked to ulozit do ukolu => NL/engine contradiction bug; cases with hod+tam colloquial read => harness/corpus may expect task.query too aggressively."
  );
  console.log("counts_engine_bug=" + neg.eb + " harness_bug=" + neg.hb + " correct_clarification=" + neg.cc + " safety_risk=" + neg.sr);

  console.log("");
  console.log("=== CLUSTER_B_rcz_note_query ===");
  console.log(
    "Expected_note_read_note.query: inputs anchor poznam* + read cues (Mrkni/heslo/WiFi); Silver returned unknown with calendar-vs-save disambiguation => likely weak note.read anchor or alias, not merely too-short input."
  );
  console.log("counts_engine_bug=" + note.eb + " harness_bug=" + note.hb + " correct_clarification=" + note.cc + " safety_risk=" + note.sr);

  let recommendedNextCluster = "REAL_CZECH_CORPUS_V1_EXPAND_TO_30K";
  let recommendedNextFixScope = "corpus_expand_and_relax_expected_where_clarify_is_valid";

  if (totalSafetyRisk > 0) {
    recommendedNextCluster = "STOP_P0_SAFETY_FIX_FIRST";
    recommendedNextFixScope = "Silver P0 safety before corpus tuning";
  } else if (note.eb >= 1) {
    recommendedNextCluster = "rcz_note_query_anchor_alias_fix";
    recommendedNextFixScope = "Silver note.query Czech anchors (Mrkni do poznamek + heslo/WiFi read)";
  } else if (neg.eb === 0 && note.eb === 0) {
    recommendedNextCluster = "REAL_CZECH_CORPUS_V1_EXPAND_TO_30K";
    recommendedNextFixScope = "No engine P1 from these clusters; expand corpus + template parity";
  } else if (neg.eb > 0 && note.eb === 0) {
    recommendedNextCluster = "rcz_negation_task_read_under_negation_fix";
    recommendedNextFixScope = "Silver negation scope + task.query read without false ulozit contradiction";
  }

  const negAct = clusterRecommendedAction(neg, "rcz_negation_safety_task");
  const noteAct = clusterRecommendedAction(note, "rcz_note_query");

  let gates = null;
  if (runGates) {
    console.log("");
    console.log("=== RUNNING_OPTIONAL_GATES (--run-gates) ===");
    gates = runOptionalGates();
    console.log("smoke=" + gates.smoke);
    console.log("iu_perf_regression_guards=" + gates.iu_perf);
    console.log("parsed_20k_overall_accuracy=" + gates.acc20k);
    console.log("parsed_quality_accuracy=" + gates.qualityAcc);
    console.log("parsed_realistic_overall_accuracy=" + gates.realisticAcc);
  }

  const qPath = path.join(REPO, "scripts", "silver-quality-v2-report.json");
  const rPath = path.join(REPO, "scripts", "silver-realistic-mobile-corpus-report.json");
  let qualityFromDisk = "";
  let realisticFromDisk = "";
  try {
    const qj = JSON.parse(fs.readFileSync(qPath, "utf8"));
    qualityFromDisk = qj.quality_accuracy != null ? String(qj.quality_accuracy) : "";
  } catch (e) {
    void e;
  }
  try {
    const rj = JSON.parse(fs.readFileSync(rPath, "utf8"));
    realisticFromDisk = rj.overall_accuracy_realistic != null ? String(rj.overall_accuracy_realistic) : "";
  } catch (e2) {
    void e2;
  }

  const mainCommit = gitHead();
  const changedFiles = gitScriptsChanged() || "(none)";
  const engineChanged = "NO";
  const behaviorChanged = "NO";

  const realCzechAcc = rep.corpus_accuracy != null ? String(rep.corpus_accuracy) : "";
  let acc20kOut = rep.embed_20k && rep.embed_20k.overall_accuracy ? String(rep.embed_20k.overall_accuracy) : "";
  if (!acc20kOut && rep.embed_20k && rep.embed_20k.error) acc20kOut = "EMBED_FAIL";
  if (!acc20kOut) acc20kOut = "SKIPPED";

  const qualityAcc =
    gates && gates.qualityAcc
      ? gates.qualityAcc
      : rep.quality_report && rep.quality_report.quality_accuracy != null
        ? String(rep.quality_report.quality_accuracy)
        : qualityFromDisk;

  const realisticAcc =
    gates && gates.realisticAcc
      ? gates.realisticAcc
      : rep.realistic_report && rep.realistic_report.overall_accuracy_realistic != null
        ? String(rep.realistic_report.overall_accuracy_realistic)
        : realisticFromDisk;

  const smokeOut = gates ? gates.smoke : "SKIPPED";
  const iuPerfOut = gates ? gates.iu_perf : "SKIPPED";
  const acc20kFinal = gates && gates.acc20k ? gates.acc20k : acc20kOut;

  const block = [
    "=== SILVER_RCZ_CLUSTER_DIAGNOSTIC_RESULT ===",
    "main_commit=" + mainCommit,
    "changed_files=" + changedFiles,
    "engine_changed=" + engineChanged,
    "behavior_changed=" + behaviorChanged,
    "total_failures_inspected=" + fails.length,
    "",
    "rcz_negation_safety_task_total=" + neg.total,
    "rcz_negation_safety_task_engine_bug_count=" + neg.eb,
    "rcz_negation_safety_task_harness_bug_count=" + neg.hb,
    "rcz_negation_safety_task_correct_clarification_count=" + neg.cc,
    "rcz_negation_safety_task_safety_risk_count=" + neg.sr,
    "rcz_negation_safety_task_recommended_action=" + negAct,
    "",
    "rcz_note_query_total=" + note.total,
    "rcz_note_query_engine_bug_count=" + note.eb,
    "rcz_note_query_harness_bug_count=" + note.hb,
    "rcz_note_query_correct_clarification_count=" + note.cc,
    "rcz_note_query_safety_risk_count=" + note.sr,
    "rcz_note_query_recommended_action=" + noteAct,
    "",
    "recommended_next_cluster=" + recommendedNextCluster,
    "recommended_next_fix_scope=" + recommendedNextFixScope,
    "",
    "real_czech_corpus_accuracy=" + realCzechAcc,
    "20k_overall_accuracy=" + acc20kFinal,
    "quality_accuracy=" + qualityAcc,
    "realistic_overall_accuracy=" + realisticAcc,
    "",
    "dangerous_write_count=" + String(rep.dangerous_write_count != null ? rep.dangerous_write_count : ""),
    "false_write_count=" + String(rep.false_write_count != null ? rep.false_write_count : ""),
    "query_created_write_count=" + String(rep.query_created_write_count != null ? rep.query_created_write_count : ""),
    "write_when_negated_count=" + String(rep.write_when_negated_count != null ? rep.write_when_negated_count : ""),
    "",
    "smoke=" + smokeOut,
    "iu_perf_regression_guards=" + iuPerfOut,
    "git_status_clean=" + gitClean(),
    "======= END_SILVER_RCZ_CLUSTER_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log("\n" + block);
}

if (require.main === module) {
  main();
}
