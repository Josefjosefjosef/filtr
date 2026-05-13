/**
 * RHC3 cluster triage (diagnostic only): rhc3_module_switch_cal_to_note
 * - No engine edits; no assets/app.js changes.
 * - Single-pass Silver scan: safety counters (full corpus) + cluster breakdown.
 * - Optional --proof: smoke, calendar regressions, 20k routing, quality v2, realistic mobile (requires clean git).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-module-switch-triage-report.json");
const FOUNDATION_REPORT = path.join(__dirname, "silver-rhc-v3-foundation-pilot-report.json");

const TARGET_CLUSTER = "rhc3_module_switch_cal_to_note";

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "6800", 10);
  return Number.isFinite(n) && n > 0 ? n : 6800;
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
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval
} = rhc3;
const { classifyFailure } = require("./silver-rhc3-top-cluster-diagnostic.cjs");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  hasNegWrite,
  rawUserMessage
} = harness;

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

function safetyNoWriteFolded(fold) {
  return (
    /\bnic\s+neuklad\w*\b/i.test(fold) ||
    /\bnevytvarej\b/i.test(fold) ||
    /\bnevytvářej\b/i.test(fold) ||
    /\bpouze\s+cti\b/i.test(fold) ||
    /\bpouze\s+čti\b/i.test(fold) ||
    /\bjen\s+se\s+podivej\b/i.test(fold) ||
    /\bjen\s+se\s+podívej\b/i.test(fold) ||
    /\bneukladat\b/i.test(fold) ||
    /\bneukládat\b/i.test(fold)
  );
}

function countKey(map, k) {
  map[k] = (map[k] || 0) + 1;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function runNode(rel) {
  const script = path.join(REPO, rel);
  const r = spawnSync(process.execPath, [script], { cwd: REPO, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function runNpmBackedScript(rel) {
  const script = path.join(REPO, rel);
  const r = spawnSync(process.execPath, [script], { cwd: REPO, encoding: "utf8", stdio: "pipe", maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0;
}

function subclusterLabel(c, turn, ev, internalBucket) {
  const g = c.gold || {};
  const cl = String(g.module_switch_clarity || "n/a");
  const cat = String(ev.cat || "n/a");
  const eng = String(turn.normalizedIntent || "n/a");
  const ps = String(turn.processingState || "n/a");
  const fold = foldCs(c.input);
  const hasCal = /\bkalend/i.test(fold);
  const hasNote = /\bpoznam|do\s+poznam/i.test(fold);
  const hasUloz = /\buloz/i.test(fold);
  const fillerBetween = /\bne\s+\S+\s+do\s+kalend/i.test(fold);
  const neDoCal =
    /\bne\s+do\s+kalend/i.test(fold) ||
    /\bne\s+v\s+kalend/i.test(fold) ||
    /\bne\b\s+\S{1,20}\s+do\s+kalend/i.test(fold) ||
    /\bne\s+do\s+\S{1,16}\s+kalend/i.test(fold);
  let surface = "surface_plain";
  if (fillerBetween) surface = "chaos_filler_between_ne_and_cal";
  else if (/\bne\s+jako\s+do\s+kalend/i.test(fold)) surface = "correction_ne_jako_do_cal";
  else if (g.contains_typo) surface = "typo_lane";
  else if (g.contains_no_diacritics) surface = "ascii_lane";
  else if (g.contains_filler) surface = "voice_filler_lane";
  if (c.mutation_mask) {
    const m = c.mutation_mask >>> 0;
    if ((m & core.M.MOBILE_PREFIX) !== 0) surface += "+mobile_prefix";
    if ((m & core.M.SPOKEN_COMPRESS) !== 0) surface += "+spoken_compress";
  }
  return [
    "clarity=" + cl,
    "harness_cat=" + cat,
    "eng=" + eng,
    "ps=" + ps,
    "bucket=" + internalBucket,
    "cue uloz=" +
      (hasUloz ? "1" : "0") +
      " note=" +
      (hasNote ? "1" : "0") +
      " neg_cal_surface=" +
      (neDoCal ? "1" : "0") +
      " cal_word=" +
      (hasCal ? "1" : "0"),
    surface
  ].join(" | ");
}

function gitStatusShort() {
  try {
    return execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "ERR";
  }
}

function gitCleanForTriage() {
  const gs = gitStatusShort();
  if (!gs) return { ok: true, lines: [] };
  const lines = gs.split(/\r?\n/).filter(Boolean);
  const allow = ["scripts/silver-rhc3-module-switch-triage.cjs", "scripts/silver-rhc3-module-switch-triage-report.json"];
  const bad = lines.filter((l) => {
    const pathPart = (l.length >= 4 ? l.slice(3) : l).trim().replace(/\\/g, "/");
    for (let ai = 0; ai < allow.length; ai++) {
      if (pathPart.indexOf(allow[ai]) >= 0) return false;
    }
    return true;
  });
  return { ok: bad.length === 0, lines };
}

function runProofBundle() {
  const out = {
    smoke: "FAIL",
    calendar_regression: "FAIL",
    routing_20k: "FAIL",
    quality: "FAIL",
    realistic_mobile: "FAIL"
  };
  const s1 = runNpmBackedScript("scripts/smoke.mjs");
  out.smoke = s1 ? "PASS" : "FAIL";
  const s2 = runNpmBackedScript("scripts/silver-calendar-create-regression.mjs");
  const s3 = runNpmBackedScript("scripts/silver-calendar-read-regression.mjs");
  out.calendar_regression = s2 && s3 ? "PASS" : "FAIL";
  const s4 = runNode("scripts/audit_silver_20000_routing_stable.cjs");
  out.routing_20k = s4.ok ? "PASS" : "FAIL";
  const s5 = runNode("scripts/audit_silver_quality_v2.cjs");
  let qAcc = "";
  if (s5.ok) {
    const mq = s5.out.match(/quality_accuracy=([\d.]+)%/);
    qAcc = mq ? mq[1] : "";
  }
  out.quality = s5.ok ? "PASS" : "FAIL";
  out._quality_accuracy = qAcc;
  const s6 = runNode("scripts/audit_silver_realistic_mobile_corpus.cjs");
  out.realistic_mobile = s6.ok ? "PASS" : "FAIL";
  return out;
}

function main() {
  const wantProof = process.argv.includes("--proof");
  const hashBefore = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";

  const gitPre = gitCleanForTriage();
  if (wantProof && !gitPre.ok) {
    console.log("=== RHC3_MODULE_SWITCH_TRIAGE_ABORT ===");
    console.log("reason=git_dirty_before_proof");
    console.log(gitPre.lines.join("\n"));
    process.exit(1);
  }

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    mainCommit = "UNKNOWN";
  }

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
  let p0SafetyExpectedNoWriteButDraft = 0;

  const internalCounts = {
    TRUE_ENGINE_FAIL_MODULE_SWITCH: 0,
    GOLD_LABEL_TOO_AGGRESSIVE: 0,
    TEMPLATE_DNA_BAD_INPUT: 0,
    SAFETY_NEGATION_CONFLICT: 0,
    AMBIGUITY_SHOULD_CLARIFY: 0,
    ENGINE_SAFE_CLARIFICATION_OK: 0,
    WRONG_MODULE_REAL_BUG: 0,
    OTHER: 0
  };

  const subclusterCounts = {};
  const patternNotes = {
    uloz_do_poznamky: 0,
    zapis_do_kalendare_proxy: 0,
    embedded_switch_phrase: 0,
    correction_phrase: 0,
    chaos_filler: 0,
    voice_wording_mobile: 0,
    partial_or_surface_clarify: 0,
    cross_module_task_or_cal: 0
  };

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const total_cluster_cases = clusterCases.length;

  let clusterPass = 0;
  let clusterFail = 0;
  let safetyRiskCluster = 0;

  let true_engine_fail_count = 0;
  let harness_problem_count = 0;
  let ambiguous_input_count = 0;
  let safe_clarification_ok_count = 0;
  let real_world_acceptable_count = 0;
  let must_fix_engine_count = 0;
  let should_fix_harness_count = 0;
  let overlap_ambiguous_gold_and_must_fix = 0;

  const examplesBySub = {};

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
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

    const createLike = createLikeTurn(turn);
    if (safetyNoWriteFolded(foldedIn) && createLike) {
      p0SafetyExpectedNoWriteButDraft++;
    }
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
      continue;
    }
    clusterFail++;
    const g = c.gold || {};
    const internal = classifyFailure(c, turn, ev, g);
    countKey(internalCounts, internal);

    const expInt = String(g.expected_intent || "");
    if (expInt === "unknown") ambiguous_input_count++;
    if (internal === "TRUE_ENGINE_FAIL_MODULE_SWITCH") true_engine_fail_count++;
    if (internal === "GOLD_LABEL_TOO_AGGRESSIVE" || internal === "SAFETY_NEGATION_CONFLICT") {
      harness_problem_count++;
      should_fix_harness_count++;
    }
    if (internal === "ENGINE_SAFE_CLARIFICATION_OK") {
      safe_clarification_ok_count++;
      should_fix_harness_count++;
    }
    if (internal === "WRONG_MODULE_REAL_BUG" || internal === "TRUE_ENGINE_FAIL_MODULE_SWITCH") {
      must_fix_engine_count++;
    }
    if (expInt === "unknown" && (internal === "TRUE_ENGINE_FAIL_MODULE_SWITCH" || internal === "WRONG_MODULE_REAL_BUG")) {
      overlap_ambiguous_gold_and_must_fix++;
    }

    const noisyRealWorld =
      !!g.contains_filler ||
      !!g.contains_typo ||
      !!g.contains_no_diacritics ||
      String(g.module_switch_clarity || "") === "broken_by_filler" ||
      /\b(hele|ee|prostě|tyjo|no jo)\b/i.test(foldedIn);
    if (noisyRealWorld) real_world_acceptable_count++;

    if (caseDangerous) safetyRiskCluster++;

    const lab = subclusterLabel(c, turn, ev, internal);
    countKey(subclusterCounts, lab);
    if (!examplesBySub[lab]) examplesBySub[lab] = [];
    if (examplesBySub[lab].length < 4) {
      examplesBySub[lab].push({
        id: c.id,
        input: c.input.slice(0, 200),
        raw: String(rawUserMessage(turn) || "").slice(0, 160)
      });
    }

    const fold = foldedIn;
    if (/\buloz.*poznam|do\s+poznam/i.test(fold)) patternNotes.uloz_do_poznamky++;
    if (/\bzapis.*kalend|do\s+kalend/i.test(fold) && /\bne\s+do\s+kalend/i.test(fold)) patternNotes.zapis_do_kalendare_proxy++;
    if (/\bale\s+ne\s+do\s+kalend/i.test(fold) || (/\bne\s+do\s+kalend/i.test(fold) && /\bdo\s+poznam/i.test(fold)))
      patternNotes.embedded_switch_phrase++;
    if (/\bne\s+vlastne|\bne\s+vlastně/i.test(fold)) patternNotes.correction_phrase++;
    if (/\b(hele|ee|prostě|tyjo|no jo)\b/i.test(fold)) patternNotes.chaos_filler++;
    if ((c.mutation_mask & core.M.MOBILE_PREFIX) !== 0 || (c.mutation_mask & core.M.SPOKEN_COMPRESS) !== 0)
      patternNotes.voice_wording_mobile++;
    if (g.module_switch_clarity === "surface_clarify_lane" || g.module_switch_clarity === "ambiguous")
      patternNotes.partial_or_surface_clarify++;
    if (turn.normalizedIntent === "calendar.create" || turn.normalizedIntent === "tasks.create")
      patternNotes.cross_module_task_or_cal++;
  }

  const hashAfter = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";
  const assets_app_changed = hashBefore && hashAfter && hashBefore !== hashAfter ? "YES" : "NO";
  if (hashBefore && hashAfter && hashBefore !== hashAfter) {
    console.log("=== RHC3_MODULE_SWITCH_TRIAGE_ABORT ===");
    console.log("reason=assets_app_js_hash_changed");
    process.exit(1);
  }

  let smoke = "SKIPPED";
  let calendar_regression = "SKIPPED";
  let routing_20k = "SKIPPED";
  let quality = "SKIPPED";
  let realistic_mobile = "SKIPPED";

  if (wantProof) {
    const pb = runProofBundle();
    smoke = pb.smoke;
    calendar_regression = pb.calendar_regression;
    routing_20k = pb.routing_20k;
    quality = pb.quality;
    realistic_mobile = pb.realistic_mobile;
    if (pb._quality_accuracy) {
      /* keep for json */
    }
    try {
      execSync("git checkout -- scripts/silver-quality-v2-report.json scripts/silver-realistic-mobile-corpus-report.json", {
        cwd: REPO,
        encoding: "utf8",
        stdio: "pipe"
      });
    } catch {
      /* non-fatal */
    }
  } else {
    const fr = readJsonSafe(FOUNDATION_REPORT);
    const bundle = fr && fr.proof_bundle;
    if (bundle && bundle.gates_pass === "YES" && String(fr.main_commit || "") === mainCommit) {
      smoke = bundle.smoke || smoke;
      const cr =
        bundle.silver_calendar_create_regression === "PASS" && bundle.silver_calendar_read_regression === "PASS"
          ? "PASS"
          : "SKIPPED";
      calendar_regression = cr;
      routing_20k = bundle.audit_silver_20000_routing_stable || "SKIPPED";
      quality = bundle.audit_silver_quality_v2 || "SKIPPED";
      realistic_mobile = bundle.audit_silver_realistic_mobile_corpus || "SKIPPED";
    }
  }

  const safetyAllZero =
    dangerousWriteCount === 0 &&
    falseWriteCount === 0 &&
    queryCreatedWriteCount === 0 &&
    writeWhenNegatedCount === 0 &&
    p0SafetyExpectedNoWriteButDraft === 0;

  if (!safetyAllZero) {
    console.log("=== RHC3_MODULE_SWITCH_TRIAGE_ABORT ===");
    console.log("reason=safety_counters_non_zero");
    console.log(
      "dangerous_write_count=" +
        dangerousWriteCount +
        " false_write_count=" +
        falseWriteCount +
        " query_created_write_count=" +
        queryCreatedWriteCount +
        " write_when_negated_count=" +
        writeWhenNegatedCount +
        " p0_safety_expected_no_write_but_draft=" +
        p0SafetyExpectedNoWriteButDraft
    );
    process.exit(1);
  }

  const rankedSub = Object.entries(subclusterCounts).sort((a, b) => b[1] - a[1]);
  const top1 = rankedSub[0] || ["(none)", 0];
  const top2 = rankedSub[1] || ["(none)", 0];

  const failPct = total_cluster_cases ? ((100 * clusterFail) / total_cluster_cases).toFixed(2) : "0.00";

  let recommended_next_task =
    "Sign off harness labels for module_switch_clarify_lane + storage_disambiguation; then narrow engine PR for TRUE_ENGINE_FAIL_MODULE_SWITCH dominant slice.";
  if (must_fix_engine_count > 0 && ambiguous_input_count > 0 && overlap_ambiguous_gold_and_must_fix >= must_fix_engine_count * 0.6) {
    recommended_next_task =
      "Majority of fails sit on ambiguous gold lane but still route to calendar.create: tighten engine routing for neg_cal + note cues even under Template DNA noise; parallel harness review for clarify vs write expectations.";
  } else if (must_fix_engine_count >= harness_problem_count + ambiguous_input_count && must_fix_engine_count > 0) {
    recommended_next_task =
      "Engine PR: route cal-to-note switch (explicit calendar negation + note target) after harness freeze; keep diagnostics on ambiguous lane separate.";
  } else if (should_fix_harness_count > must_fix_engine_count) {
    recommended_next_task =
      "Harness/gold PR first: relax unnecessary_disambiguation where storage probe is human-safe; re-run this triage before engine edits.";
  }

  const gitLines = gitStatusShort();
  const git_status_clean = gitLines === "" ? "YES" : "NO";

  const rankedInternal = Object.entries(internalCounts).sort((a, b) => b[1] - a[1]);

  const reportObj = {
    generated_at: new Date().toISOString(),
    main_commit: mainCommit,
    total_cases_scanned: TOTAL_CASES,
    target_cluster: TARGET_CLUSTER,
    total_cluster_cases,
    cluster_pass: clusterPass,
    cluster_fail: clusterFail,
    cluster_fail_pct: failPct,
    internal_bucket_counts: internalCounts,
    internal_bucket_ranked: rankedInternal,
    user_partition: {
      true_engine_fail_count,
      harness_problem_count,
      ambiguous_input_count,
      safe_clarification_ok_count,
      real_world_acceptable_count,
      must_fix_engine_count,
      should_fix_harness_count,
      overlap_ambiguous_gold_and_must_fix,
      harness_only_fail_count:
        (internalCounts.GOLD_LABEL_TOO_AGGRESSIVE || 0) +
        (internalCounts.ENGINE_SAFE_CLARIFICATION_OK || 0) +
        (internalCounts.SAFETY_NEGATION_CONFLICT || 0),
      interpretation: {
        ambiguous_input_count: "Fails where gold.expected_intent is unknown (ambiguous / clarify lane).",
        must_fix_engine_count: "Fails classified TRUE_ENGINE_FAIL_MODULE_SWITCH or WRONG_MODULE_REAL_BUG.",
        true_engine_fail_count: "Subset: TRUE_ENGINE_FAIL_MODULE_SWITCH only (calendar.create despite cal-negation + note cues).",
        harness_problem_count: "GOLD_LABEL_TOO_AGGRESSIVE + SAFETY_NEGATION_CONFLICT.",
        should_fix_harness_count: "harness_problem + ENGINE_SAFE_CLARIFICATION_OK."
      }
    },
    pattern_rollups: patternNotes,
    top_subclusters: rankedSub.slice(0, 12).map((x) => ({ label: x[0], count: x[1], pct_of_cluster_fail: clusterFail ? ((100 * x[1]) / clusterFail).toFixed(2) : "0.00" })),
    safety: {
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount,
      p0_safety_expected_no_write_but_draft: p0SafetyExpectedNoWriteButDraft,
      safety_all_zero: safetyAllZero,
      safety_risk_count_cluster_fails: safetyRiskCluster
    },
    proof: {
      requested: wantProof ? "YES" : "NO",
      smoke,
      calendar_regression,
      routing_20k,
      quality,
      realistic_mobile
    },
    examples_top_subclusters: {
      top1: examplesBySub[top1[0]] || [],
      top2: examplesBySub[top2[0]] || []
    },
    engine_changed: "NO",
    assets_app_changed: assets_app_changed
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const textBlock = [
    "=== RHC3_MODULE_SWITCH_TRIAGE_RESULT ===",
    "main_commit=" + mainCommit,
    "engine_changed=NO",
    "assets_app_changed=" + assets_app_changed,
    "total_cluster_cases=" + total_cluster_cases,
    "true_engine_fail_count=" + true_engine_fail_count,
    "harness_problem_count=" + harness_problem_count,
    "ambiguous_input_count=" + ambiguous_input_count,
    "safe_clarification_ok_count=" + safe_clarification_ok_count,
    "real_world_acceptable_count=" + real_world_acceptable_count,
    "must_fix_engine_count=" + must_fix_engine_count,
    "should_fix_harness_count=" + should_fix_harness_count,
    "top_subcluster_1=" + top1[0],
    "top_subcluster_1_count=" + top1[1],
    "top_subcluster_2=" + top2[0],
    "top_subcluster_2_count=" + top2[1],
    "safety_risk_count=" + safetyRiskCluster,
    "smoke=" + smoke,
    "calendar_regression=" + calendar_regression,
    "routing_20k=" + routing_20k,
    "quality=" + quality,
    "realistic_mobile=" + realistic_mobile,
    "git_status_clean=" + git_status_clean,
    "recommended_next_task=" + recommended_next_task,
    "=== END_RHC3_MODULE_SWITCH_TRIAGE_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const gatesOk =
    smoke === "PASS" &&
    calendar_regression === "PASS" &&
    routing_20k === "PASS" &&
    quality === "PASS" &&
    realistic_mobile === "PASS";
  if (wantProof && !gatesOk) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { TARGET_CLUSTER, subclusterLabel };
