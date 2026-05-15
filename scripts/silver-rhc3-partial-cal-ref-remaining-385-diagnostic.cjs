/**
 * Diagnostic-only: rhc3_partial_cal_ref failures EXCLUDING TRUE_CALENDAR_REFERENCE_FAIL
 * (no engine / assets/app.js changes). Buckets remaining ~385 harness/template/gold surfaces.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER = "rhc3_partial_cal_ref";
const TEMP_REPORT_JSON = path.join(
  os.tmpdir(),
  "silver-rhc3-partial-cal-ref-remaining-385-diagnostic-report.json"
);

const PINNED_MAIN_COMMIT =
  process.env.RHC3_MAIN_COMMIT || "03bfa37fe41241c5bc08d4e11481b2900230ac43";

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
  rawUserMessage
} = harness;
const { classifyPartialCalRef } = require("./silver-rhc3-partial-cal-ref-diagnostic.cjs");

const BUCKET_KEYS = [
  "template_dna_bad_input",
  "base_string_mutation_mismatch",
  "gold_label_problem",
  "invalid_or_unrealistic_prompt",
  "ambiguous_prompt_should_clarify",
  "calendar_scope_missing_after_mutation",
  "temporal_anchor_destroyed_by_mutation",
  "expected_read_but_input_is_write_like",
  "response_contract_problem",
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

/** Mutations often insert fillers between „co“ and „jsem“; strict DNA rejects those rows. */
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

/**
 * @returns {{ bucket: string, why: string, root: string }}
 */
function classifyRemainingPartialCalRefFail(c, turn, ev, gold) {
  const parent = classifyPartialCalRef(c, turn, ev, gold);
  if (parent === "TRUE_CALENDAR_REFERENCE_FAIL") {
    return { bucket: "__EXCLUDED_TRUE__", why: "", root: "" };
  }

  const fold = foldCs(c.input);
  const cat = String(ev.cat || "");
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const noise = partialRefNoisePopcount(c.mutation_mask || 0);
  const strictHealthy = partialRefTemplateHealthy(fold);
  const relaxedHealthy = partialRefTemplateRelaxed(fold);
  const lenOk = String(c.input || "").length >= 14;
  const expIntent = String((gold && gold.expected_intent) || c.expectedIntent || "");
  const expClar = !!(gold && gold.expected_should_clarify);

  if (c.family === "partial_references" && lenOk && !hadTemporalAnchor(fold, c.input)) {
    return {
      bucket: "temporal_anchor_destroyed_by_mutation",
      why:
        "Canonical partial_references line must retain vague Czech temporal (tenkrát/…/v tom týdnu); final input lost that anchor after mutations.",
      root: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (!strictHealthy || !lenOk) {
    if (!lenOk) {
      return {
        bucket: "template_dna_bad_input",
        why: "Final input shorter than partial-ref template minimum; not a stable read probe.",
        root: "TEMPLATE_DNA_PROBLEM"
      };
    }
    if (!relaxedHealthy) {
      if (noise >= 1) {
        return {
          bucket: "base_string_mutation_mismatch",
          why:
            "Mutations removed or scrambled calendar anchor tokens (v kalendáři / kolem / co … jsem) beyond relaxed recovery.",
          root: "TEMPLATE_DNA_PROBLEM"
        };
      }
      return {
        bucket: "template_dna_bad_input",
        why: "Folded input fails even relaxed partial-ref anchors with zero surface-noise bits.",
        root: "TEMPLATE_DNA_PROBLEM"
      };
    }
    if (
      expIntent === "calendar.query" &&
      (eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create") &&
      cat === "intent_fail"
    ) {
      return {
        bucket: "expected_read_but_input_is_write_like",
        why:
          "Strict harness DNA flag TEMPLATE_DNA_BAD_INPUT, but relaxed fold still looks like calendar.query; engine returned create-family on read-shaped surface.",
        root: "ENGINE_BUG"
      };
    }
    if (noise >= 1) {
      return {
        bucket: "base_string_mutation_mismatch",
        why:
          "Filler/mutation tokens broke contiguous co+jsem harness fingerprint while relaxed anchors (kolem + kalendář + co…jsem) remain.",
        root: "TEMPLATE_DNA_PROBLEM"
      };
    }
    return {
      bucket: "template_dna_bad_input",
      why: "Strict DNA unhealthy with relaxed anchors intact and zero noise bits (unexpected).",
      root: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (parent === "WRONG_MODULE") {
    return {
      bucket: "calendar_scope_missing_after_mutation",
      why: "Harness category " + cat + " (collection/dataset routing drift vs calendar_query lane).",
      root: "HARNESS_BUG"
    };
  }

  if (parent === "GOLD_LABEL_TOO_STRICT") {
    return {
      bucket: "gold_label_problem",
      why: "Harness marked unnecessary_disambiguation or strict PASS vs clarification/read lane (" + cat + ").",
      root: "GOLD_PROBLEM"
    };
  }

  if (parent === "AMBIGUOUS_PARTIAL_REFERENCE" || parent === "SAFE_CLARIFICATION_OK") {
    return {
      bucket: "ambiguous_prompt_should_clarify",
      why:
        "Open-ended Czech temporal / noise surface: gold expected_should_clarify=" +
        expClar +
        " conflicts with strict calendar.query PASS contract.",
      root: "AMBIGUOUS_OK"
    };
  }

  if (!lenOk || (fold.length < 8 && String(c.input || "").trim().length < 8)) {
    return {
      bucket: "invalid_or_unrealistic_prompt",
      why: "Degenerate or near-empty prompt after fold (invalid probe).",
      root: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (
    expIntent === "calendar.query" &&
    (eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create") &&
    !createLikeTurn(turn) &&
    cat === "intent_fail"
  ) {
    return {
      bucket: "expected_read_but_input_is_write_like",
      why: "Gold expects calendar.query but engine intent is create-family without READY_TO_SAVE draft latch.",
      root: "ENGINE_BUG"
    };
  }

  if (
    expIntent === "calendar.query" &&
    foldWriteLike(fold) &&
    (eng === "calendar.create" || eng === "tasks.create") &&
    cat === "intent_fail"
  ) {
    return {
      bucket: "expected_read_but_input_is_write_like",
      why: "Fold still contains write-like lemmas while gold expects read; engine chose create path.",
      root: "ENGINE_BUG"
    };
  }

  if (
    cat === "raw_response_empty" ||
    cat === "raw_response_wrong" ||
    cat === "false_negative" ||
    cat === "unnecessary_disambiguation"
  ) {
    return {
      bucket: "response_contract_problem",
      why: "Response or semantic contract gate failed (cat=" + cat + ") outside TRUE_CALENDAR_REFERENCE_FAIL split.",
      root: cat === "unnecessary_disambiguation" ? "HARNESS_BUG" : "ENGINE_BUG"
    };
  }

  if (parent === "OTHER" && cat === "runtime_fail") {
    return {
      bucket: "other",
      why: "Runtime exception during processUserTurn/evaluateOne: " + String(ev.raw || "").slice(0, 120),
      root: "HARNESS_BUG"
    };
  }

  return {
    bucket: "other",
    why: "Residual non-TRUE fail: parent=" + parent + " cat=" + cat + " eng=" + eng + " ps=" + ps + ".",
    root: "HARNESS_BUG"
  };
}

function gitAllowListClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = ["scripts/silver-rhc3-partial-cal-ref-remaining-385-diagnostic.cjs"];
    const bad = tracked.filter((l) => {
      const pathPart = (l.length >= 4 ? l.slice(3) : l).trim().replace(/\\/g, "/");
      for (let ai = 0; ai < allow.length; ai++) {
        if (pathPart.indexOf(allow[ai].replace(/\\/g, "/")) >= 0) return false;
      }
      return true;
    });
    const untracked = lines.filter((l) => l.startsWith("??"));
    const badUt = untracked.filter((l) => {
      const pathPart = (l.length >= 3 ? l.slice(2) : l).trim().replace(/\\/g, "/");
      for (let ai = 0; ai < allow.length; ai++) {
        if (pathPart.indexOf(allow[ai].replace(/\\/g, "/")) >= 0) return false;
      }
      return true;
    });
    return { ok: bad.length === 0 && badUt.length === 0, porcelain: o.trim() };
  } catch (e) {
    return { ok: false, porcelain: String(e && e.message) };
  }
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function pushExample(map, bucket, rec, maxN) {
  const arr = map[bucket];
  if (arr.length >= maxN) return;
  arr.push(rec);
}

function recommendedNextScope(dominant, parentTemplateCount, remainingTotal) {
  const d = String(dominant || "");
  const allFromStrictTemplate =
    remainingTotal > 0 && parentTemplateCount === remainingTotal && parentTemplateCount > 0;
  if (d === "expected_read_but_input_is_write_like" && allFromStrictTemplate) {
    return (
      "dual_track: (A) scripts alignment — relax partialRefTemplateHealthy (co+jsem contiguous) in " +
      "silver-rhc3-partial-cal-ref-diagnostic.cjs / keep gold calendar.query; " +
      "(B) narrow engine diagnostic — calendar.create + NEEDS_CLARIFICATION on relaxed read-shaped " +
      "partial_references vs calendar.query (no broad RHC rewrite)."
    );
  }
  if (d === "template_dna_bad_input" || d === "base_string_mutation_mismatch" || d === "temporal_anchor_destroyed_by_mutation") {
    return "scripts-only: rhc3 partial_references base string + deriveMutationMask/applyMutationLayers preserve vague temporal + v kalendáři + kolem DNA.";
  }
  if (d === "gold_label_problem" || d === "ambiguous_prompt_should_clarify") {
    return "scripts-only: gold expected_should_clarify vs calendar_query PASS strictness (harness alignment, not engine).";
  }
  if (d === "calendar_scope_missing_after_mutation") {
    return "scripts-only: query_wrong_dataset / collection cats on calendar_query noisy partial-ref (harness routing gates).";
  }
  if (d === "expected_read_but_input_is_write_like" || d === "response_contract_problem") {
    return "narrow engine diagnostic on intent vs response contract for the listed sub-cats (no broad family rewrite).";
  }
  if (d === "invalid_or_unrealistic_prompt") {
    return "scripts-only: filter degenerate rows from partial_references allocation.";
  }
  return "review dominant bucket examples in TEMP JSON; decide scripts vs narrow engine follow-up.";
}

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== RHC3_PARTIAL_CAL_REF_REMAINING_385_DIAGNOSTIC_ABORT ===");
    console.log("reason=git_not_clean_allowlist");
    console.log(git.porcelain);
    console.log("=== END_ABORT ===");
    process.exit(1);
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

  let true_calendar_reference_fail_count = 0;
  let remaining_fail_total = 0;

  const counts = {};
  for (let bi = 0; bi < BUCKET_KEYS.length; bi++) counts[BUCKET_KEYS[bi]] = 0;

  const examples = {};
  for (let bj = 0; bj < BUCKET_KEYS.length; bj++) examples[BUCKET_KEYS[bj]] = [];

  let engine_bug_count = 0;
  let harness_bug_count = 0;
  let gold_problem_count = 0;
  let template_dna_problem_count = 0;
  let ambiguous_ok_count = 0;
  let parent_template_dna_bad_input_count = 0;

  for (let fi = 0; fi < clusterCases.length; fi++) {
    const c = clusterCases[fi];
    const hit = byId.get(c.id);
    if (!hit || hit.ev.pass) continue;
    const parent = classifyPartialCalRef(c, hit.turn, hit.ev, c.gold);
    if (parent === "TRUE_CALENDAR_REFERENCE_FAIL") {
      true_calendar_reference_fail_count++;
      continue;
    }
    remaining_fail_total++;
    if (parent === "TEMPLATE_DNA_BAD_INPUT") parent_template_dna_bad_input_count++;

    const sub = classifyRemainingPartialCalRefFail(c, hit.turn, hit.ev, c.gold);
    const bucket = sub.bucket;
    counts[bucket] = (counts[bucket] || 0) + 1;

    if (sub.root === "ENGINE_BUG") engine_bug_count++;
    else if (sub.root === "HARNESS_BUG") harness_bug_count++;
    else if (sub.root === "GOLD_PROBLEM") gold_problem_count++;
    else if (sub.root === "TEMPLATE_DNA_PROBLEM") template_dna_problem_count++;
    else if (sub.root === "AMBIGUOUS_OK") ambiguous_ok_count++;

    const g = c.gold || {};
    const raw = rawUserMessage(hit.turn);
    const expIntent = String(g.expected_intent || c.expectedIntent || "");
    const rec = {
      id: c.id,
      input: c.input,
      expected_intent: expIntent,
      actual_intent: String(hit.turn.normalizedIntent || ""),
      actual_state: String(hit.turn.processingState || ""),
      harness_cat: String(hit.ev.cat || ""),
      expected_should_clarify: !!g.expected_should_clarify,
      actual_processingState: String(hit.turn.processingState || ""),
      actual_should_clarify_processingState:
        String(hit.turn.normalizedIntent || "") +
        " | ps=" +
        String(hit.turn.processingState || "") +
        " | clarify-ish=" +
        (hit.turn.normalizedIntent === "clarification" || hit.turn.normalizedIntent === "unknown" ? "yes" : "no"),
      why_fail: sub.why,
      kind: sub.root,
      parent_partial_cal_classifier: parent,
      mutation_noise_popcount: partialRefNoisePopcount(c.mutation_mask || 0),
      raw_excerpt: String(raw || "").slice(0, 220)
    };
    pushExample(examples, bucket, rec, 10);
  }

  let dominant_root_cause = "none";
  let domCount = -1;
  for (let bk = 0; bk < BUCKET_KEYS.length; bk++) {
    const k = BUCKET_KEYS[bk];
    if (counts[k] > domCount) {
      domCount = counts[k];
      dominant_root_cause = k;
    }
  }

  const harnessTemplateDominant = new Set([
    "template_dna_bad_input",
    "base_string_mutation_mismatch",
    "gold_label_problem",
    "ambiguous_prompt_should_clarify",
    "invalid_or_unrealistic_prompt",
    "temporal_anchor_destroyed_by_mutation",
    "calendar_scope_missing_after_mutation"
  ]);

  let engine_fix_recommended = "NO";
  if (engine_bug_count > 0 && !harnessTemplateDominant.has(dominant_root_cause)) {
    engine_fix_recommended = "YES";
  }
  if (harnessTemplateDominant.has(dominant_root_cause)) {
    engine_fix_recommended = "NO";
  }

  let scripts_alignment_recommended = "NO";
  if (
    remaining_fail_total > 0 &&
    parent_template_dna_bad_input_count === remaining_fail_total &&
    engine_bug_count > 0
  ) {
    scripts_alignment_recommended = "YES";
  } else if (
    template_dna_problem_count + gold_problem_count + harness_bug_count + ambiguous_ok_count >=
    engine_bug_count
  ) {
    scripts_alignment_recommended = "YES";
  }
  if (harnessTemplateDominant.has(dominant_root_cause)) {
    scripts_alignment_recommended = "YES";
  }

  const git_status_clean = git.ok ? "YES" : "NO";
  const recommended_next_scope = recommendedNextScope(
    dominant_root_cause,
    parent_template_dna_bad_input_count,
    remaining_fail_total
  );

  const reportObj = {
    generated_at: new Date().toISOString(),
    main_commit: PINNED_MAIN_COMMIT,
    runner_head: mainCommit(),
    target_cluster: TARGET_CLUSTER,
    cluster_total,
    remaining_fail_total,
    true_calendar_reference_fail_count,
    counts,
    dominant_root_cause,
    engine_bug_count,
    harness_bug_count,
    gold_problem_count,
    template_dna_problem_count,
    ambiguous_ok_count,
    engine_fix_recommended,
    scripts_alignment_recommended,
    recommended_next_scope,
    examples,
    parent_template_dna_bad_input_count,
  };
  fs.writeFileSync(TEMP_REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const lines = [];
  lines.push("=== RHC3_PARTIAL_CAL_REF_REMAINING_385_DIAGNOSTIC ===");
  lines.push("main_commit=" + PINNED_MAIN_COMMIT);
  lines.push("cluster_total=" + cluster_total);
  lines.push("remaining_fail_total=" + remaining_fail_total);
  lines.push("true_calendar_reference_fail_count=" + true_calendar_reference_fail_count);
  lines.push("");
  for (let ki = 0; ki < BUCKET_KEYS.length; ki++) {
    const key = BUCKET_KEYS[ki];
    lines.push(key + "=" + counts[key]);
  }
  lines.push("");
  lines.push("engine_bug_count=" + engine_bug_count);
  lines.push("harness_bug_count=" + harness_bug_count);
  lines.push("gold_problem_count=" + gold_problem_count);
  lines.push("template_dna_problem_count=" + template_dna_problem_count);
  lines.push("ambiguous_ok_count=" + ambiguous_ok_count);
  lines.push("");
  lines.push("dominant_root_cause=" + dominant_root_cause);
  lines.push("");
  lines.push("engine_fix_recommended=" + engine_fix_recommended);
  lines.push("scripts_alignment_recommended=" + scripts_alignment_recommended);
  lines.push("");
  lines.push("recommended_next_scope=" + recommended_next_scope);
  lines.push("");
  lines.push("git_status_clean=" + git_status_clean);
  lines.push("=== END_RHC3_PARTIAL_CAL_REF_REMAINING_385_DIAGNOSTIC ===");

  console.log(lines.join("\n"));

  for (let ei = 0; ei < BUCKET_KEYS.length; ei++) {
    const bk = BUCKET_KEYS[ei];
    const n = counts[bk];
    const ex = examples[bk] || [];
    console.log("");
    console.log("--- bucket=" + bk + " count=" + n + " (showing " + ex.length + " examples) ---");
    for (let xi = 0; xi < ex.length; xi++) {
      const r = ex[xi];
      console.log("");
      console.log("example_index=" + (xi + 1));
      console.log("id=" + r.id);
      console.log("input=" + r.input);
      console.log("expected_intent=" + r.expected_intent);
      console.log("actual_intent=" + r.actual_intent);
      console.log("actual_state=" + r.actual_state);
      console.log("harness_cat=" + r.harness_cat);
      console.log("expected_should_clarify=" + r.expected_should_clarify);
      console.log("actual_should_clarify_processingState=" + r.actual_should_clarify_processingState);
      console.log("why_fail=" + r.why_fail);
      console.log("ENGINE_BUG|HARNESS_BUG|GOLD_PROBLEM|TEMPLATE_DNA_PROBLEM|AMBIGUOUS_OK=" + r.kind);
      console.log("parent_partial_cal_classifier=" + r.parent_partial_cal_classifier);
      console.log("mutation_noise_popcount=" + r.mutation_noise_popcount);
      console.log("raw_excerpt=" + r.raw_excerpt);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTER,
  classifyRemainingPartialCalRefFail,
  BUCKET_KEYS,
  PINNED_MAIN_COMMIT
};
