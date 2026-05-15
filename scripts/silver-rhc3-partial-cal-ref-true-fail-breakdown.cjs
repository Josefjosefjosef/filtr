/**
 * Diagnostic-only: sub-bucket breakdown for rhc3_partial_cal_ref cases classified as
 * TRUE_CALENDAR_REFERENCE_FAIL (no engine / app.js / harness edits).
 * Full detail JSON → os.tmpdir() (keeps git clean). Stdout: summary banner only.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER = "rhc3_partial_cal_ref";
const TEMP_REPORT_JSON = path.join(os.tmpdir(), "silver-rhc3-partial-cal-ref-true-fail-breakdown-report.json");
/** Printed as main_commit (task baseline); override with RHC3_MAIN_COMMIT. */
const PINNED_MAIN_COMMIT =
  process.env.RHC3_MAIN_COMMIT || "21ad670806e50fad7c096e2ec528144421de5729";

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
const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, engineToAuditIntent, rawUserMessage } = harness;
const { classifyPartialCalRef } = require("./silver-rhc3-partial-cal-ref-diagnostic.cjs");

const BUCKETS = [
  "partial_temporal_reference",
  "missing_calendar_anchor",
  "entity_anchor_failure",
  "fuzzy_title_lookup_failure",
  "read_vs_unknown",
  "query_contract_failure",
  "response_text_mismatch",
  "harness_gold_problem",
  "ambiguous_but_expected_read",
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

/** Tenkrát / kdysi / tamto / „někdy ten den“ — širší než baseline „v tom týdnu“. */
function hasNarrowVagueTemporal(fold, input) {
  const f = String(fold || "");
  if (/\b(tenkrat|nekdy\s+ten\s+den|tamto|kdysi)\b/i.test(f)) return true;
  const s = String(input || "").toLowerCase();
  return (
    /\btenkrát\b/.test(s) ||
    /\bněkdy\s+ten\s+den\b/.test(s) ||
    /\btamto\b/.test(s) ||
    /\bkdysi\b/.test(s)
  );
}

function isClarifyLeadRaw(raw) {
  const r = String(raw || "");
  return /potrebuji\s+upresnit|potřebuji\s+upřesnit|upresnit\s+detaily|upřesnit\s+detaily/i.test(r);
}

function hasCalendarSurfaceCue(fold) {
  const f = String(fold || "");
  return /\bkalend/.test(f) || /\bv\s+kalend/i.test(f);
}

function isQueryContractFailCat(cat) {
  return (
    cat === "query_created_write" ||
    cat === "negative_instruction_fail" ||
    cat === "write_when_negated" ||
    cat === "wrong_person_match" ||
    cat === "query_wrong_dataset" ||
    cat === "calendar_vs_task_confusion" ||
    cat === "wrong_collection" ||
    cat === "note_vs_task_confusion"
  );
}

/**
 * @returns {{ bucket: string, why: string }}
 */
function subClassifyTrueCalendarReferenceFail(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const cat = String(ev.cat || "");
  const eng = String(turn.normalizedIntent || "");
  const raw = String(ev.raw || "");
  const noise = partialRefNoisePopcount(c.mutation_mask || 0);
  const vague = hasVagueTemporalFold(fold) || hasVagueTemporalRaw(c.input);
  const narrowVague = hasNarrowVagueTemporal(fold, c.input);
  const auditIntent = engineToAuditIntent(eng, c.group);
  const expIntent = String((gold && gold.expected_intent) || c.expectedIntent || "");
  const ps = String(turn.processingState || "");
  const shouldClar = !!(gold && gold.expected_should_clarify);

  if (!hasCalendarSurfaceCue(fold)) {
    return {
      bucket: "missing_calendar_anchor",
      why: "Folded input lacks stable calendar-surface cue (kalendář/kalendari); partial-ref template anchor missing."
    };
  }

  if (isQueryContractFailCat(cat)) {
    return {
      bucket: "query_contract_failure",
      why: "Harness category " + cat + " (write/negation/person/collection contract vs calendar_query read lane)."
    };
  }

  if (cat === "intent_fail" && (eng === "unknown" || eng === "clarification")) {
    return {
      bucket: "read_vs_unknown",
      why: "Expected " + expIntent + " but engine returned " + eng + " (auditIntent=" + auditIntent + ")."
    };
  }

  if (cat === "raw_response_empty") {
    return {
      bucket: "response_text_mismatch",
      why: "Assistant/user-facing message empty or below calendar_query length gate before semantic checks."
    };
  }

  if (cat === "false_negative") {
    if (vague && eng === "calendar.read") {
      return {
        bucket: "ambiguous_but_expected_read",
        why: "Vague temporal anchor + calendar.read path, but harness treated calendarQuerySemantic empty-hit as FAIL (strict vs open window)."
      };
    }
    if (/\bkolem\b/.test(fold)) {
      return {
        bucket: "fuzzy_title_lookup_failure",
        why: "false_negative on kolem-fragment lookup: response implied no row vs seeded calendar corpus for this query shape."
      };
    }
    return {
      bucket: "entity_anchor_failure",
      why: "false_negative without kolem token: entity/topic anchor likely not resolved to a seeded event/note line."
    };
  }

  if (cat === "intent_fail" && (eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create")) {
    if (narrowVague) {
      return {
        bucket: "partial_temporal_reference",
        why: "Narrow vague Czech temporal (tenkrát/kdysi/tamto/…) steered to " + eng + " instead of calendar.query."
      };
    }
    if (!shouldClar && (ps === "NEEDS_CLARIFICATION" || ps === "CLARIFICATION") && isClarifyLeadRaw(raw)) {
      return {
        bucket: "ambiguous_but_expected_read",
        why: "Gold disallows clarify (expected_should_clarify=false) but engine emitted NEEDS_CLARIFICATION-style lead on a read-shaped query."
      };
    }
    if (noise >= 5) {
      return {
        bucket: "harness_gold_problem",
        why: "Heavy mutation noise (" + noise + " bits) while harness still demands calendar.query PASS without clarification lane."
      };
    }
    if (ps === "READY_TO_SAVE" || ps === "DRAFTING") {
      return {
        bucket: "query_contract_failure",
        why: "Draft/write processingState (" + ps + ") with " + eng + " vs gold calendar.query read contract."
      };
    }
    if (/\bkolem\b/.test(fold) && isClarifyLeadRaw(raw)) {
      return {
        bucket: "fuzzy_title_lookup_failure",
        why: "Kolem-fragment query misclassified as create/clarify path (retrieval anchor vs draft heuristic collision)."
      };
    }
    if (vague && /\bkolem\b/.test(fold)) {
      return {
        bucket: "partial_temporal_reference",
        why: "Baseline week-window (v tom týdnu / … týdnu) + kolem anchor still routed to " + eng + " instead of calendar.query."
      };
    }
    if (vague) {
      return {
        bucket: "partial_temporal_reference",
        why: "Partial temporal surface (incl. v tom týdnu) misrouted to " + eng + " vs calendar.query."
      };
    }
  }

  if (cat === "intent_fail") {
    return {
      bucket: "other",
      why: "intent_fail: eng=" + eng + " auditIntent=" + auditIntent + " expected=" + expIntent + " cat=" + cat + " ps=" + ps + "."
    };
  }

  return {
    bucket: "other",
    why: "Residual true_calendar_reference_fail: cat=" + cat + " eng=" + eng + " auditIntent=" + auditIntent + "."
  };
}

function pushExample(map, bucket, rec, maxN) {
  const arr = map[bucket];
  if (arr.length >= maxN) return;
  arr.push(rec);
}

function gitPorcelainClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    return String(o || "").trim().length === 0;
  } catch {
    return false;
  }
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function main() {
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
  for (let bi = 0; bi < BUCKETS.length; bi++) counts[BUCKETS[bi]] = 0;

  const examples = {};
  for (let bj = 0; bj < BUCKETS.length; bj++) examples[BUCKETS[bj]] = [];

  const trueFails = [];

  for (let fi = 0; fi < clusterCases.length; fi++) {
    const c = clusterCases[fi];
    const hit = byId.get(c.id);
    if (!hit || hit.ev.pass) continue;
    const parent = classifyPartialCalRef(c, hit.turn, hit.ev, c.gold);
    if (parent !== "TRUE_CALENDAR_REFERENCE_FAIL") continue;
    const sub = subClassifyTrueCalendarReferenceFail(c, hit.turn, hit.ev, c.gold);
    counts[sub.bucket] = (counts[sub.bucket] || 0) + 1;
    const expIntent = String((c.gold && c.gold.expected_intent) || c.expectedIntent || "");
    const raw = rawUserMessage(hit.turn);
    const rec = {
      id: c.id,
      input: c.input,
      expected: {
        expected_intent: expIntent,
        expected_module: String((c.gold && c.gold.expected_module) || ""),
        expected_should_clarify: !!(c.gold && c.gold.expected_should_clarify),
        expected_should_write: !!(c.gold && c.gold.expected_should_write)
      },
      actual: {
        normalizedIntent: String(hit.turn.normalizedIntent || ""),
        processingState: String(hit.turn.processingState || ""),
        harness_cat: String(hit.ev.cat || ""),
        auditIntent: engineToAuditIntent(hit.turn.normalizedIntent, c.group),
        raw_excerpt: String(raw || "").slice(0, 220)
      },
      why: sub.why
    };
    trueFails.push({ bucket: sub.bucket, rec });
    pushExample(examples, sub.bucket, rec, 10);
  }

  const true_fail_total = trueFails.length;
  let dominant = "none";
  let domCount = -1;
  for (let bk = 0; bk < BUCKETS.length; bk++) {
    const k = BUCKETS[bk];
    if (counts[k] > domCount) {
      domCount = counts[k];
      dominant = k;
    }
  }

  /** Diagnostic-only gate: do not infer merge-ready engine work from this script alone. */
  const engine_fix_recommended = "NO";

  let recommended_next_scope =
    "Keep diagnostic focus: sample dominant bucket " +
    dominant +
    " before any engine/harness PR (per cluster contract).";
  if (dominant === "partial_temporal_reference") {
    recommended_next_scope =
      "Scope: calendar.query vs calendar.create on partial week + kolem temporal anchors; parallel track: gold clarify=false vs NEEDS_CLARIFICATION (ambiguous_but_expected_read=" +
      counts.ambiguous_but_expected_read +
      ").";
  } else if (dominant === "fuzzy_title_lookup_failure" || dominant === "entity_anchor_failure") {
    recommended_next_scope =
      "Scope: retrieval / title anchor alignment for kolem-fragment and entity probes vs seeded rows (verify harness seed before engine).";
  } else if (dominant === "read_vs_unknown") {
    recommended_next_scope =
      "Scope: clarification/unknown exits on calendar_query noisy partial-ref inputs.";
  } else if (dominant === "harness_gold_problem" || dominant === "ambiguous_but_expected_read") {
    recommended_next_scope =
      "Scope: gold vs clarification lane and false_negative rules on open-ended temporal windows.";
  } else if (dominant === "query_contract_failure") {
    recommended_next_scope =
      "Scope: query contract cats (negation / write / person / collection) on calendar_query surface.";
  } else if (dominant === "response_text_mismatch") {
    recommended_next_scope =
      "Scope: empty or too-short assistant payloads on calendar.read/query path.";
  }

  const runnerHead = mainCommit();
  const gitClean = gitPorcelainClean() ? "YES" : "NO";

  const reportObj = {
    generated_at: new Date().toISOString(),
    main_commit: PINNED_MAIN_COMMIT,
    runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    filter: "classified=true_calendar_reference_fail (parent TRUE_CALENDAR_REFERENCE_FAIL)",
    cluster_total,
    true_fail_total,
    counts,
    dominant_root_cause: dominant,
    engine_fix_recommended,
    recommended_next_scope,
    examples,
    true_fail_ids_sample: trueFails.slice(0, 30).map((x) => x.rec.id)
  };

  fs.writeFileSync(TEMP_REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const lines = [
    "=== RHC3_PARTIAL_CAL_REF_TRUE_FAIL_BREAKDOWN ===",
    "main_commit=" + PINNED_MAIN_COMMIT,
    "cluster_total=" + cluster_total,
    "true_fail_total=" + true_fail_total,
    "partial_temporal_reference=" + counts.partial_temporal_reference,
    "missing_calendar_anchor=" + counts.missing_calendar_anchor,
    "entity_anchor_failure=" + counts.entity_anchor_failure,
    "fuzzy_title_lookup_failure=" + counts.fuzzy_title_lookup_failure,
    "read_vs_unknown=" + counts.read_vs_unknown,
    "query_contract_failure=" + counts.query_contract_failure,
    "response_text_mismatch=" + counts.response_text_mismatch,
    "harness_gold_problem=" + counts.harness_gold_problem,
    "ambiguous_but_expected_read=" + counts.ambiguous_but_expected_read,
    "other=" + counts.other,
    "dominant_root_cause=" + dominant,
    "engine_fix_recommended=" + engine_fix_recommended,
    "recommended_next_scope=" + recommended_next_scope,
    "git_status_clean=" + gitClean,
    "=== END_RHC3_PARTIAL_CAL_REF_TRUE_FAIL_BREAKDOWN ==="
  ];
  console.log(lines.join("\n"));
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTER,
  subClassifyTrueCalendarReferenceFail,
  BUCKETS
};
