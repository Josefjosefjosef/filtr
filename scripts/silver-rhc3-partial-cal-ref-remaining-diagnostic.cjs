/**
 * Scripts-only diagnostic: all failures in cluster rhc3_partial_cal_ref (partial_references / Silver RHC3).
 * Reads scripts/silver-real-human-chaos-v3-report.json for safety snapshot + optional main_commit.
 * Replays corpus + engine (no assets/app.js / engine source edits in this task).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER = "rhc3_partial_cal_ref";
const REPORT_JSON_PATH = path.join(__dirname, "silver-real-human-chaos-v3-report.json");
const OPTIONAL_WRITE_JSON = path.join(__dirname, "silver-rhc3-partial-cal-ref-remaining-diagnostic-report.json");

const PINNED_MAIN_COMMIT =
  process.env.RHC3_MAIN_COMMIT || "f0f8fc845428bc9c734c8a4042cddf0e24547abc";

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
  finalizeNoteQueryKdeHarnessEval
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  rawUserMessage,
  engineToAuditIntent,
  hasNegWrite
} = harness;
const { classifyPartialCalRef } = require("./silver-rhc3-partial-cal-ref-diagnostic.cjs");

const BUCKET_KEYS = [
  "harness_should_accept_calendar_read",
  "gold_too_strict_partial_reference",
  "template_dna_partial_reference_noise",
  "response_contract_read_ok_but_fail",
  "valid_partial_reference_ambiguous",
  "true_engine_bug_calendar_read",
  "true_engine_bug_calendar_create_false_positive",
  "missing_temporal_or_entity_anchor",
  "retrieval_expected_but_not_seeded",
  "safety_no_write_ok",
  "other"
];

function popcountMask(mask, onlyBits) {
  let x = (mask >>> 0) & (onlyBits >>> 0);
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}

function partialRefNoisePopcount(mask) {
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.MOBILE_PREFIX |
    core.M.SPOKEN_COMPRESS |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.STRIP_DIACRITICS;
  return popcountMask(mask >>> 0, noiseMask >>> 0);
}

function partialRefTemplateHealthy(fold) {
  const f = String(fold || "");
  return /\bv\s+kalend/i.test(f) && /\bkolem\b/i.test(f) && /\bco\s+(jsem|mas|mame)\b/i.test(f);
}

function partialRefTemplateRelaxed(fold) {
  const f = String(fold || "");
  return (
    /\bv\s+kalend/i.test(f) &&
    /\bkolem\b/i.test(f) &&
    /\bco\b/i.test(f) &&
    /\b(jsem|mas|mame)\b/i.test(f)
  );
}

function hasVagueTemporalFold(fold) {
  const f = String(fold || "");
  return /\b(tenkrat|nekdy\s+ten\s+den|tamto|kdysi|v\s+tom\s+tydnu)\b/i.test(f);
}

function hasVagueTemporalRaw(input) {
  const s = String(input || "").toLowerCase();
  return (
    /\btenkrát\b/.test(s) ||
    /\bněkdy\s+ten\s+den\b/.test(s) ||
    /\btamto\b/.test(s) ||
    /\bkdysi\b/.test(s) ||
    /\bv\s+tom\s+týdnu\b/.test(s)
  );
}

function hadTemporalAnchor(fold, input) {
  return hasVagueTemporalFold(fold) || hasVagueTemporalRaw(input);
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function foldWriteLike(fold) {
  const f = String(fold || "");
  return /\b(uloz|ulož|pridej|přidej|vytvor|vytvoř|zapis|zapiš)\b/i.test(f);
}

function hasCalendarSignalFold(fold) {
  return /\bkalend|udalost|schuzk|schůzk/i.test(String(fold || ""));
}

function hasReadQueryCueFold(fold) {
  const f = String(fold || "");
  return /\bco\s+(jsem|mas|mame)\b/i.test(f) || /\bohledne\b/i.test(f) || /\bohledně\b/i.test(f);
}

function hasEntityAnchorFold(fold) {
  return /\bkolem\s+\S+/i.test(String(fold || ""));
}

function hasTemporalAnchorWide(fold, input) {
  if (hadTemporalAnchor(fold, input)) return true;
  const f = String(fold || "").toLowerCase();
  return /\b(dnes|zitra|zítra|pozitri|pozítří|tyden|týden|pristi|příští|víkend|vikend)\b/i.test(f);
}

function payloadEntityQuality(turn) {
  const d = turn.draft || {};
  const t = String(d.title || "").trim();
  if (!t) return "missing";
  if (t.length < 2) return "weak";
  if (t.length > 90) return "weak";
  return "clear";
}

function wrongDatasetCat(cat) {
  return (
    cat === "query_wrong_dataset" ||
    cat === "calendar_vs_task_confusion" ||
    cat === "wrong_collection" ||
    cat === "note_vs_task_confusion"
  );
}

/**
 * @returns {{ bucket: string, root_class: string, why_fail: string }}
 */
function assignDiagBucket(c, turn, ev, gold, parentLegacy) {
  const fold = foldCs(c.input);
  const cat = String(ev.cat || "");
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const raw = rawUserMessage(turn);
  const auditIntent = engineToAuditIntent(eng, c.group);
  const expIntent = String((gold && gold.expected_intent) || c.expectedIntent || "");
  const drafty = createLikeTurn(turn);
  const noise = partialRefNoisePopcount(c.mutation_mask || 0);
  const vagueTime = hadTemporalAnchor(fold, c.input);
  const strictOk = partialRefTemplateHealthy(fold);
  const relaxedOk = partialRefTemplateRelaxed(fold);
  const lenOk = String(c.input || "").length >= 14;

  if (cat === "runtime_fail") {
    return {
      bucket: "other",
      root_class: "HARNESS_BUG",
      why_fail: "runtime_fail during harness replay: " + String(raw || "").slice(0, 160)
    };
  }

  if (
    cat === "query_created_write" ||
    ((ps === "READY_TO_SAVE" || eng === "calendar.create") && expIntent === "calendar.query")
  ) {
    return {
      bucket: "true_engine_bug_calendar_create_false_positive",
      root_class: "ENGINE_BUG",
      why_fail: "Query-shaped partial_ref surface but calendar.create / READY_TO_SAVE latch (cat=" + cat + ")."
    };
  }

  if (cat === "write_when_negated" || (cat === "negative_instruction_fail" && hasNegWrite(fold))) {
    return {
      bucket: "true_engine_bug_calendar_create_false_positive",
      root_class: "ENGINE_BUG",
      why_fail: "Negated read surface still produced write-like latch (cat=" + cat + ")."
    };
  }

  if (c.family === "partial_references" && lenOk && !hadTemporalAnchor(fold, c.input)) {
    return {
      bucket: "missing_temporal_or_entity_anchor",
      root_class: "TEMPLATE_DNA_PROBLEM",
      why_fail: "partial_references row lost vague Czech temporal anchor after mutations (tenkrát/tamto/…)."
    };
  }

  if (gold && gold.contains_retrieval && cat === "false_negative" && /nic\s+jsem\s+k\s+tomu\s+nenasel/i.test(foldCs(raw))) {
    return {
      bucket: "retrieval_expected_but_not_seeded",
      root_class: "RETRIEVAL_PROBLEM",
      why_fail: "Gold marks retrieval lane; harness saw empty-hit read card (false_negative) on entity-bearing fold."
    };
  }

  if (!strictOk && relaxedOk && noise >= 1 && hadTemporalAnchor(fold, c.input)) {
    return {
      bucket: "template_dna_partial_reference_noise",
      root_class: "TEMPLATE_DNA_PROBLEM",
      why_fail: "Filler/mutation bits broke strict co+jsem DNA while relaxed anchors + temporal still present (noise=" + noise + ")."
    };
  }

  if (!relaxedOk && lenOk) {
    if (noise >= 1) {
      return {
        bucket: "template_dna_partial_reference_noise",
        root_class: "TEMPLATE_DNA_PROBLEM",
        why_fail: "Mutations scrambled v kalendáři / kolem / co+jsem anchors beyond relaxed recovery."
      };
    }
    return {
      bucket: "template_dna_partial_reference_noise",
      root_class: "TEMPLATE_DNA_PROBLEM",
      why_fail: "Relaxed partial-ref template unhealthy with low noise (unexpected DNA drift)."
    };
  }

  if (wrongDatasetCat(cat)) {
    return {
      bucket: "true_engine_bug_calendar_read",
      root_class: "ENGINE_BUG",
      why_fail: "Collection/dataset routing confusion on calendar_query lane (cat=" + cat + ")."
    };
  }

  if (
    cat === "unnecessary_disambiguation" &&
    (eng === "calendar.read" || ps === "READ_OK" || ps === "STORAGE_DISAMBIGUATION")
  ) {
    return {
      bucket: "harness_should_accept_calendar_read",
      root_class: "HARNESS_BUG",
      why_fail: "Read-shaped engine path but calendar_query semantic flagged unnecessary_disambiguation."
    };
  }

  if (cat === "unnecessary_disambiguation") {
    return {
      bucket: "gold_too_strict_partial_reference",
      root_class: "GOLD_PROBLEM",
      why_fail: "Disambiguation/storage prompt treated as fail vs calendar.query PASS contract."
    };
  }

  if (vagueTime && (eng === "clarification" || eng === "unknown") && cat === "intent_fail") {
    return {
      bucket: "valid_partial_reference_ambiguous",
      root_class: "AMBIGUOUS_OK",
      why_fail: "Open-ended vague temporal window + clarify/unknown vs strict calendar.query expectation."
    };
  }

  if (parentLegacy === "SAFE_CLARIFICATION_OK") {
    return {
      bucket: "safety_no_write_ok",
      root_class: "SAFETY_OK",
      why_fail: "Noisy partial_ref surface: safe clarification behavior; legacy bucket marked calendar-reference fail."
    };
  }

  if (
    (cat === "raw_response_empty" || cat === "raw_response_wrong" || cat === "false_negative") &&
    auditIntent === "calendar.query" &&
    expIntent === "calendar.query"
  ) {
    return {
      bucket: "response_contract_read_ok_but_fail",
      root_class: "RESPONSE_CONTRACT_PROBLEM",
      why_fail: "Intent routing matched calendar.query but response/semantic contract gate failed (cat=" + cat + ")."
    };
  }

  if (cat === "intent_fail" && auditIntent !== expIntent && expIntent === "calendar.query") {
    return {
      bucket: "true_engine_bug_calendar_read",
      root_class: "ENGINE_BUG",
      why_fail: "Expected calendar.query audit lane but engine/clarify path diverged (audit=" + auditIntent + ")."
    };
  }

  if (parentLegacy === "GOLD_LABEL_TOO_STRICT") {
    return {
      bucket: "gold_too_strict_partial_reference",
      root_class: "GOLD_PROBLEM",
      why_fail: "Legacy GOLD_LABEL_TOO_STRICT / intent_fail on clarify vs strict PASS gold."
    };
  }

  if (parentLegacy === "AMBIGUOUS_PARTIAL_REFERENCE") {
    return {
      bucket: "valid_partial_reference_ambiguous",
      root_class: "AMBIGUOUS_OK",
      why_fail: "Legacy ambiguous partial temporal vs calendar.query strictness."
    };
  }

  if (parentLegacy === "TRUE_CALENDAR_REFERENCE_FAIL") {
    if (drafty) {
      return {
        bucket: "true_engine_bug_calendar_create_false_positive",
        root_class: "ENGINE_BUG",
        why_fail: "TRUE_CALENDAR_REFERENCE_FAIL with create-like turn on read family."
      };
    }
    return {
      bucket: "true_engine_bug_calendar_read",
      root_class: "ENGINE_BUG",
      why_fail: "Residual TRUE_CALENDAR_REFERENCE_FAIL (intent/response) on partial_ref read probe."
    };
  }

  if (parentLegacy === "WRONG_MODULE") {
    return {
      bucket: "true_engine_bug_calendar_read",
      root_class: "ENGINE_BUG",
      why_fail: "Legacy WRONG_MODULE on calendar_query partial_ref row."
    };
  }

  return {
    bucket: "other",
    root_class: "HARNESS_BUG",
    why_fail: "Residual: parentLegacy=" + parentLegacy + " cat=" + cat + " eng=" + eng + " ps=" + ps + "."
  };
}

function readReportSafety() {
  let safety = {
    dangerous_write_count: "",
    false_write_count: "",
    query_created_write_count: "",
    write_when_negated_count: ""
  };
  let mainFromReport = "";
  let partialRefFailFromReport = 0;
  try {
    const txt = fs.readFileSync(REPORT_JSON_PATH, "utf8");
    const j = JSON.parse(txt);
    mainFromReport = String(j.main_commit || j.user_main_before || "");
    if (j.safety) {
      safety = Object.assign(safety, j.safety);
    }
    const fr = j.family_breakdown && j.family_breakdown.partial_references;
    if (fr && fr.fail !== undefined) partialRefFailFromReport = parseInt(String(fr.fail), 10) || 0;
  } catch {
    /* optional */
  }
  return { safety, mainFromReport, partialRefFailFromReport };
}

function gitAllowListClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const allow = [
      "scripts/silver-rhc3-partial-cal-ref-remaining-diagnostic.cjs",
      "scripts/silver-rhc3-partial-cal-ref-remaining-diagnostic-report.json"
    ];
    const bad = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const pathPart = line.startsWith("??")
        ? line.slice(2).trim().replace(/\\/g, "/")
        : line.length >= 4
          ? line.slice(3).trim().replace(/\\/g, "/")
          : line.trim().replace(/\\/g, "/");
      let okLine = false;
      for (let ai = 0; ai < allow.length; ai++) {
        if (pathPart.indexOf(allow[ai]) >= 0) {
          okLine = true;
          break;
        }
      }
      if (!okLine) bad.push(line);
    }
    return { ok: bad.length === 0, porcelain: o.trim(), bad };
  } catch (e) {
    return { ok: false, porcelain: String(e && e.message), bad: ["error"] };
  }
}

function gitChangedFiles() {
  try {
    return execSync("git diff --name-only", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function rootClassToAggKey(rootClass) {
  const m = {
    ENGINE_BUG: "engine_bug_count",
    GOLD_PROBLEM: "gold_problem_count",
    HARNESS_BUG: "harness_bug_count",
    TEMPLATE_DNA_PROBLEM: "template_dna_problem_count",
    RESPONSE_CONTRACT_PROBLEM: "response_contract_problem_count",
    SAFETY_OK: "safety_ok_count",
    AMBIGUOUS_OK: "ambiguous_ok_count",
    RETRIEVAL_PROBLEM: "retrieval_problem_count"
  };
  return m[rootClass] || "harness_bug_count";
}

function dominantBucketFromCounts(counts) {
  let best = "other";
  let bestN = -1;
  for (let bi = 0; bi < BUCKET_KEYS.length; bi++) {
    const k = BUCKET_KEYS[bi];
    const n = counts[k] || 0;
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return bestN <= 0 ? "NONE" : best;
}

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== RHC3_PARTIAL_CAL_REF_REMAINING_DIAGNOSTIC_ABORT ===");
    console.log("reason=git_not_clean_allowlist");
    console.log(git.porcelain);
    console.log("=== END_ABORT ===");
    process.exit(1);
  }

  const reportSnap = readReportSafety();
  const reportPartialRefFail = reportSnap.partialRefFailFromReport || 0;

  const mainCommitOut =
    process.env.RHC3_MAIN_COMMIT || PINNED_MAIN_COMMIT || reportSnap.mainFromReport;

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

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const cluster_total = clusterCases.length;

  const byId = new Map();
  for (let i = 0; i < clusterCases.length; i++) {
    const c = clusterCases[i];
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
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }
    byId.set(c.id, { c, turn, ev });
  }

  const counts = {};
  for (let bi = 0; bi < BUCKET_KEYS.length; bi++) counts[BUCKET_KEYS[bi]] = 0;

  const examples = {};
  for (let bj = 0; bj < BUCKET_KEYS.length; bj++) examples[BUCKET_KEYS[bj]] = [];

  const agg = {
    engine_bug_count: 0,
    gold_problem_count: 0,
    harness_bug_count: 0,
    template_dna_problem_count: 0,
    response_contract_problem_count: 0,
    safety_ok_count: 0,
    ambiguous_ok_count: 0,
    retrieval_problem_count: 0
  };

  let cluster_fail = 0;
  let false_create_count = 0;
  let query_created_write_count = 0;
  let write_when_negated_count = 0;

  for (let fi = 0; fi < clusterCases.length; fi++) {
    const c = clusterCases[fi];
    const hit = byId.get(c.id);
    if (!hit) continue;
    const turn = hit.turn;
    const ev = hit.ev;
    const g = c.gold;
    if (ev.pass) continue;
    cluster_fail++;

    const cat = String(ev.cat || "");
    const eng = String(turn.normalizedIntent || "");
    const ps = String(turn.processingState || "");
    const expIntent = String((g && g.expected_intent) || c.expectedIntent || "");
    if (cat === "query_created_write") query_created_write_count++;
    if (cat === "write_when_negated") write_when_negated_count++;
    const falseCreateRow =
      cat === "query_created_write" ||
      (expIntent === "calendar.query" && eng === "calendar.create" && ps === "READY_TO_SAVE");
    if (falseCreateRow) false_create_count++;

    const parentLegacy = classifyPartialCalRef(c, turn, ev, g);
    const diag = assignDiagBucket(c, turn, ev, g, parentLegacy);
    counts[diag.bucket]++;

    const fold = foldCs(c.input);
    const raw = rawUserMessage(turn);
    const auditIntent = engineToAuditIntent(eng, c.group);
    const ex = {
      id: c.id,
      input: c.input,
      expected_module: g.expected_module,
      expected_intent: g.expected_intent,
      actual_intent: eng,
      audit_intent: auditIntent,
      processingState: ps,
      response_text: raw ? raw.slice(0, 320) : "",
      harness_cat: cat,
      has_calendar_signal: hasCalendarSignalFold(fold) ? "ano" : "ne",
      has_read_query_cue: hasReadQueryCueFold(fold) ? "ano" : "ne",
      has_write_cue: foldWriteLike(fold) ? "ano" : "ne",
      has_temporal_anchor: hasTemporalAnchorWide(fold, c.input) ? "ano" : "ne",
      has_entity_anchor: hasEntityAnchorFold(fold) ? "ano" : "ne",
      has_negation_no_write: hasNegWrite(fold) ? "ano" : "ne",
      false_create: falseCreateRow ? "ano" : "ne",
      query_created_write: cat === "query_created_write" ? "ano" : "ne",
      payload_entity_quality: payloadEntityQuality(turn),
      why_fail: diag.why_fail,
      legacy_parent: parentLegacy,
      classification: diag.root_class,
      diagnostic_bucket: diag.bucket
    };

    const arr = examples[diag.bucket];
    if (arr.length < 10) arr.push(ex);

    const aggKey = rootClassToAggKey(diag.root_class);
    if (agg[aggKey] !== undefined) agg[aggKey]++;
  }

  const dominant = dominantBucketFromCounts(counts);
  const scriptsHeavy =
    (counts.harness_should_accept_calendar_read || 0) +
    (counts.gold_too_strict_partial_reference || 0) +
    (counts.template_dna_partial_reference_noise || 0) +
    (counts.valid_partial_reference_ambiguous || 0) +
    (counts.response_contract_read_ok_but_fail || 0) +
    (counts.safety_no_write_ok || 0);
  const engineHeavy =
    (counts.true_engine_bug_calendar_read || 0) + (counts.true_engine_bug_calendar_create_false_positive || 0);

  const engine_fix_recommended = engineHeavy > scriptsHeavy && engineHeavy > 0 ? "YES" : "NO";
  const scripts_alignment_recommended = scriptsHeavy >= engineHeavy && cluster_fail > 0 ? "YES" : "NO";
  const template_alignment_recommended =
    (counts.template_dna_partial_reference_noise || 0) + (counts.missing_temporal_or_entity_anchor || 0) >
    cluster_fail * 0.25
      ? "YES"
      : "NO";
  const gold_alignment_recommended = (counts.gold_too_strict_partial_reference || 0) > cluster_fail * 0.15 ? "YES" : "NO";
  const retrieval_stress_recommended = "NO";

  const massive_corpus_should_wait =
    cluster_fail > 400 || reportPartialRefFail > 400 ? "YES" : "NO";
  const massive_corpus_wait_reason =
    massive_corpus_should_wait === "YES"
      ? cluster_fail > 400
        ? "replay_cluster_fail_gt_400"
        : "report_json_partial_references_fail_gt_400 (replay may be clean on newer main_commit)"
      : "cluster_fail_and_report_partial_ref_fail_below_threshold";

  const retrieval_stress_should_start_after_this_cluster =
    massive_corpus_should_wait === "NO" && cluster_fail === 0 && reportPartialRefFail === 0 ? "YES" : "NO";
  const chaos_dna_should_start = "NO";

  let recommended_next_scope = "scripts-only: align gold/harness/template/response contract for rhc3_partial_cal_ref dominant bucket=" + dominant;
  if (cluster_fail === 0 && reportPartialRefFail > 0) {
    recommended_next_scope =
      "refresh scripts/silver-real-human-chaos-v3-report.json from a full RHC3 run at this main_commit (replay shows 0 cluster_fail; report still lists partial_references fail=" +
      reportPartialRefFail +
      ") or diff replay at the report's main_commit for historical bucket counts.";
  }
  if (engine_fix_recommended === "YES") {
    recommended_next_scope =
      "narrow engine fix PR scoped to true_engine_bug_calendar_read / false_positive subpatterns after harness sign-off.";
  }
  if (query_created_write_count > 0 || write_when_negated_count > 0) {
    recommended_next_scope = "P0 safety: investigate query_created_write / write_when_negated in partial_ref replay before scaling.";
  }

  const gitFinal = gitAllowListClean();
  const git_status_clean = gitFinal.ok ? "YES" : "NO";
  const changed_files = gitChangedFiles();
  const ready_for_pr = gitFinal.ok ? "YES" : "NO";

  console.log("=== RHC3_PARTIAL_CAL_REF_REMAINING_DIAGNOSTIC ===");
  console.log("main_commit=" + mainCommitOut);
  console.log("target_cluster=" + TARGET_CLUSTER);
  console.log("cluster_total=" + cluster_total);
  console.log("cluster_fail=" + cluster_fail);
  console.log("harness_should_accept_calendar_read=" + (counts.harness_should_accept_calendar_read || 0));
  console.log("gold_too_strict_partial_reference=" + (counts.gold_too_strict_partial_reference || 0));
  console.log("template_dna_partial_reference_noise=" + (counts.template_dna_partial_reference_noise || 0));
  console.log("response_contract_read_ok_but_fail=" + (counts.response_contract_read_ok_but_fail || 0));
  console.log("valid_partial_reference_ambiguous=" + (counts.valid_partial_reference_ambiguous || 0));
  console.log("true_engine_bug_calendar_read=" + (counts.true_engine_bug_calendar_read || 0));
  console.log("true_engine_bug_calendar_create_false_positive=" + (counts.true_engine_bug_calendar_create_false_positive || 0));
  console.log("missing_temporal_or_entity_anchor=" + (counts.missing_temporal_or_entity_anchor || 0));
  console.log("retrieval_expected_but_not_seeded=" + (counts.retrieval_expected_but_not_seeded || 0));
  console.log("safety_no_write_ok=" + (counts.safety_no_write_ok || 0));
  console.log("other=" + (counts.other || 0));
  console.log("");
  console.log("engine_bug_count=" + agg.engine_bug_count);
  console.log("gold_problem_count=" + agg.gold_problem_count);
  console.log("harness_bug_count=" + agg.harness_bug_count);
  console.log("template_dna_problem_count=" + agg.template_dna_problem_count);
  console.log("response_contract_problem_count=" + agg.response_contract_problem_count);
  console.log("safety_ok_count=" + agg.safety_ok_count);
  console.log("ambiguous_ok_count=" + agg.ambiguous_ok_count);
  console.log("retrieval_problem_count=" + agg.retrieval_problem_count);
  console.log("");
  console.log("false_create_count=" + false_create_count);
  console.log("query_created_write_count=" + query_created_write_count);
  console.log("write_when_negated_count=" + write_when_negated_count);
  console.log("");
  console.log("dominant_root_cause=" + dominant);
  console.log("");
  console.log("engine_fix_recommended=" + engine_fix_recommended);
  console.log("scripts_alignment_recommended=" + scripts_alignment_recommended);
  console.log("template_alignment_recommended=" + template_alignment_recommended);
  console.log("gold_alignment_recommended=" + gold_alignment_recommended);
  console.log("retrieval_stress_recommended=" + retrieval_stress_recommended);
  console.log("");
  console.log("recommended_next_scope=" + recommended_next_scope);
  console.log("");
  console.log("massive_corpus_should_wait=" + massive_corpus_should_wait);
  console.log("massive_corpus_wait_reason=" + massive_corpus_wait_reason);
  console.log("");
  console.log("retrieval_stress_should_start_after_this_cluster=" + retrieval_stress_should_start_after_this_cluster);
  console.log("chaos_dna_should_start=" + chaos_dna_should_start);
  console.log("");
  console.log("report_json_safety_snapshot=" + JSON.stringify(reportSnap.safety));
  console.log("changed_files=" + (changed_files || "(none)"));
  console.log("git_status_clean=" + git_status_clean);
  console.log("ready_for_pr=" + ready_for_pr);
  console.log("=== END_RHC3_PARTIAL_CAL_REF_REMAINING_DIAGNOSTIC ===");

  console.log("");
  console.log("=== RHC3_PARTIAL_CAL_REF_DIAG_SUPPLEMENT ===");
  console.log(
    "report_json_partial_references_fail=" +
      reportPartialRefFail +
      " (scripts/silver-real-human-chaos-v3-report.json family_breakdown.partial_references.fail)"
  );
  console.log("replay_vs_report_mismatch=" + (reportPartialRefFail > 0 && cluster_fail === 0 ? "YES" : "NO"));
  console.log("=== END_SUPPLEMENT ===");
  console.log("=== BUCKET_EXAMPLES_MAX10 ===");
  for (let ei = 0; ei < BUCKET_KEYS.length; ei++) {
    const bk = BUCKET_KEYS[ei];
    const n = counts[bk] || 0;
    const exs = examples[bk] || [];
    console.log("");
    console.log("--- bucket=" + bk + " count=" + n + " ---");
    for (let xi = 0; xi < exs.length; xi++) {
      console.log(JSON.stringify(exs[xi]));
    }
  }
  console.log("=== END_BUCKET_EXAMPLES ===");

  if (process.env.SILVER_RHC3_PARTIAL_CAL_REF_DIAG_WRITE_JSON === "1") {
    const reportObj = {
      generated_at: new Date().toISOString(),
      main_commit: mainCommitOut,
      target_cluster: TARGET_CLUSTER,
      cluster_total,
      cluster_fail,
      bucket_counts: counts,
      classification_agg: agg,
      false_create_count,
      query_created_write_count,
      write_when_negated_count,
      dominant_root_cause: dominant,
      recommendations: {
        engine_fix_recommended,
        scripts_alignment_recommended,
        template_alignment_recommended,
        gold_alignment_recommended,
        retrieval_stress_recommended,
        recommended_next_scope,
        massive_corpus_should_wait,
        massive_corpus_wait_reason,
        retrieval_stress_should_start_after_this_cluster,
        chaos_dna_should_start
      },
      examples_max10: examples,
      report_json_safety_snapshot: reportSnap.safety
    };
    fs.writeFileSync(OPTIONAL_WRITE_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  }
}

if (require.main === module) {
  main();
}

module.exports = { TARGET_CLUSTER, assignDiagBucket };
