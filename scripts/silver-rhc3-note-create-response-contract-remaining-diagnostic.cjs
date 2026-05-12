/**
 * RHC3 read-only diagnostic: remaining `note_create_response_contract_fail` within
 * cluster rhc3_note_create_uloz_poznamku only (no engine/assets changes).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(
  os.tmpdir(),
  "silver-rhc3-note-create-response-contract-remaining-diagnostic-report.json"
);

const EXPECTED_MAIN_COMMIT = "babca799aef2c79f050362a980da5f44318c4bdd";
const TARGET_CLUSTER = "rhc3_note_create_uloz_poznamku";

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
const parentDiag = require("./silver-rhc3-note-create-uloz-poznamku-diagnostic.cjs");

const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, rawUserMessage, hasNegWrite } =
  harness;

const SUB_BUCKETS = [
  "missing_write_cue_token",
  "long_prefix_before_write_cue",
  "write_cue_order_or_distance_problem",
  "explicit_note_target_after_noise_not_seen",
  "do_poznamek_variant_not_seen",
  "parser_requires_start_anchor",
  "module_switch_negative_task_calendar_noise",
  "safe_negation_or_no_write_should_block",
  "harness_gold_problem",
  "template_dna_problem",
  "engine_recovery_candidate",
  "other"
];

function hasNoteCreateTemplateSignal(fold) {
  const f = String(fold || "");
  return /\buloz\w*\s+mi\s+do\s+poznam|\buloz\w*\s+do\s+poznam|do\s+poznam\w*\s+(ze|že)\b/i.test(f);
}

function safetyNoWriteFolded(fold) {
  const f = String(fold || "");
  return (
    /\bnic\s+neuklad\w*\b/i.test(f) ||
    /\bnevytvarej\b/i.test(f) ||
    /\bnevytvářej\b/i.test(f) ||
    /\bpouze\s+cti\b/i.test(f) ||
    /\bpouze\s+čti\b/i.test(f) ||
    /\bjen\s+se\s+podivej\b/i.test(f) ||
    /\bjen\s+se\s+podívej\b/i.test(f) ||
    /\bneukladat\b/i.test(f) ||
    /\bneukládat\b/i.test(f)
  );
}

function noteHarnessTokensOk(raw) {
  return /poznám|poznam|ulož|uloz|zapamat|informac/i.test(String(raw || ""));
}

function noteHarnessTokensOkFolded(raw) {
  const rf = foldCs(String(raw || ""));
  return /poznam|uloz|zapamat|informac/i.test(rf);
}

function firstWriteCueIndex(fold) {
  const f = String(fold || "");
  const re = /\buloz\w*\b|\bdo\s+poznam\w*|\bpoznamk\w*\b/i;
  const m = re.exec(f);
  return m ? m.index : 99999;
}

function benignNeUkolDisambigTail(fold) {
  return /,?\s*ne\s+úkol\.?\s*$/i.test(fold) || /,?\s*ne\s+ukol\.?\s*$/i.test(fold);
}

function crossModuleCalendarTaskNoise(fold) {
  const f = String(fold || "");
  const stripped = f.replace(/,?\s*ne\s+úkol\.?\s*$/i, " ").replace(/,?\s*ne\s+ukol\.?\s*$/i, " ");
  if (/\bkalend|\budalost|\bschuzk/i.test(stripped)) return true;
  if ((/\búkol\b|\bukol\b/i.test(stripped) || /\bdo\s+úkol|\bdo\s+ukol/i.test(stripped)) && !benignNeUkolDisambigTail(f))
    return true;
  return false;
}

function hasExplicitDoPoznamk(fold) {
  return /\bdo\s+pozn\w*\b/i.test(String(fold || ""));
}

function zeDoPoznamOrderWeird(fold) {
  const f = String(fold || "");
  const iZe = f.search(/\b(ze|že)\b/i);
  const iDo = f.search(/\bdo\s+pozn/i);
  const iUloz = f.search(/\buloz/i);
  if (iZe >= 0 && iDo >= 0 && iZe < iDo) return true;
  if (iUloz >= 0 && iDo >= 0 && Math.abs(iUloz - iDo) > 120) return true;
  return false;
}

function hasRelaxedDoPoznamkChain(fold) {
  return /\bdo\s+(?:\S+\s+){0,8}pozn\w*\b/i.test(String(fold || ""));
}

/** Canonical RHC3 note-create template anchor: ulož + mi + do + poznám… (no filler between mi and do). */
function strictPrimaryUlozMiDoPoznam(fold) {
  return /\buloz\w*\s+mi\s+do\s+poznam/i.test(String(fold || ""));
}

/**
 * @returns {{ sub: string, why_fail: string, classification: string }}
 */
function subBucketResponseContractRemaining(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const raw = String(ev.raw || "");
  const cat = String(ev.cat || "");
  const g = gold || {};
  const mask = (c.mutation_mask || 0) >>> 0;
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");

  if (String(c.expectedIntent || "") !== String(g.expected_intent || "")) {
    return {
      sub: "harness_gold_problem",
      why_fail: "row.expectedIntent vs gold.expected_intent mismatch",
      classification: "HARNESS_BUG"
    };
  }

  if (!hasNoteCreateTemplateSignal(fold) && hasRelaxedDoPoznamkChain(fold)) {
    return {
      sub: "do_poznamek_variant_not_seen",
      why_fail: "filler_token_between_do_and_poznamk_breaks_strict_template_regex",
      classification: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (!hasNoteCreateTemplateSignal(fold)) {
    return {
      sub: "template_dna_problem",
      why_fail: "lost_note_create_template_markers_after_mutation",
      classification: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (cat === "unnecessary_disambiguation" && !strictPrimaryUlozMiDoPoznam(fold) && hasRelaxedDoPoznamkChain(fold)) {
    return {
      sub: "do_poznamek_variant_not_seen",
      why_fail: "do_poznam_ze_tail_ok_but_uloz_mi_do_poznam_broken_by_spoken_filler_token",
      classification: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (cat === "unnecessary_disambiguation") {
    return {
      sub: "safe_negation_or_no_write_should_block",
      why_fail: "STORAGE_DISAMBIGUATION_or_unnecessary_disambiguation_on_note_write_surface",
      classification: "AMBIGUOUS_OK"
    };
  }

  if (crossModuleCalendarTaskNoise(fold)) {
    return {
      sub: "module_switch_negative_task_calendar_noise",
      why_fail: "calendar_or_task_surface_tokens_beyond_benign_ne_ukol_tail",
      classification: "ENGINE_BUG"
    };
  }

  if ((mask & core.M.FILLER_PREFIX) !== 0 && firstWriteCueIndex(fold) > 10) {
    return {
      sub: "parser_requires_start_anchor",
      why_fail: "filler_prefix_bit_set_and_write_cue_not_near_start",
      classification: "ENGINE_BUG"
    };
  }

  const noiseSurface =
    (mask &
      (core.M.FILLER_PREFIX |
        core.M.FILLER_SUFFIX |
        core.M.HESITATION |
        core.M.MOBILE_PREFIX |
        core.M.SPOKEN_COMPRESS |
        core.M.EMOTIONAL)) !==
    0;
  if (noiseSurface && !hasExplicitDoPoznamk(fold) && !hasRelaxedDoPoznamkChain(fold)) {
    return {
      sub: "explicit_note_target_after_noise_not_seen",
      why_fail: "mutation_noise_surface_but_do_poznamk_clause_missing_or_broken",
      classification: "ENGINE_BUG"
    };
  }

  if (/\buloz|\bpoznam/i.test(fold) && !hasExplicitDoPoznamk(fold) && !hasRelaxedDoPoznamkChain(fold)) {
    return {
      sub: "do_poznamek_variant_not_seen",
      why_fail: "write_surface_present_but_missing_do_poznam_token_chain",
      classification: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (zeDoPoznamOrderWeird(fold)) {
    return {
      sub: "write_cue_order_or_distance_problem",
      why_fail: "ze_before_do_poznam_or_uloz_do_distance_excess",
      classification: "ENGINE_BUG"
    };
  }

  const idx = firstWriteCueIndex(fold);
  if (idx > 48) {
    return {
      sub: "long_prefix_before_write_cue",
      why_fail: "first_write_cue_index=" + idx,
      classification: "ENGINE_BUG"
    };
  }

  if (!noteHarnessTokensOk(raw) && noteHarnessTokensOkFolded(raw)) {
    return {
      sub: "engine_recovery_candidate",
      why_fail: "diacritics_or_fold_mismatch_raw_vs_foldCs_pass_probe",
      classification: "ENGINE_BUG"
    };
  }

  if (cat === "raw_response_wrong" && raw.length >= 6 && !noteHarnessTokensOk(raw) && ps !== "READY_TO_SAVE") {
    if (eng === "notes.create" && (ps === "DRAFTING" || ps === "NEEDS_CLARIFICATION")) {
      return {
        sub: "engine_recovery_candidate",
        why_fail: "notes.create_mid_pipeline_but_raw_missing_note_write_cues",
        classification: "ENGINE_BUG"
      };
    }
    return {
      sub: "missing_write_cue_token",
      why_fail: "noteWriteSemantic_failed_raw_missing_poznam_uloz_zapamat_informac",
      classification: "ENGINE_BUG"
    };
  }

  if (cat === "raw_response_empty" || !raw || raw.length < 5) {
    return {
      sub: "missing_write_cue_token",
      why_fail: "empty_or_short_assistant_raw_cat=" + cat,
      classification: "ENGINE_BUG"
    };
  }

  return {
    sub: "other",
    why_fail: "unclassified_response_contract_tail_cat=" + cat + ";eng=" + eng + ";ps=" + ps,
    classification: "HARNESS_BUG"
  };
}

function gitAllowListClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = ["scripts/silver-rhc3-note-create-response-contract-remaining-diagnostic.cjs"];
    const bad = tracked.filter((l) => {
      const pathPart = (l.length >= 4 ? l.slice(3) : l).trim().replace(/\\/g, "/");
      for (let ai = 0; ai < allow.length; ai++) {
        if (pathPart.indexOf(allow[ai].replace(/\\/g, "/")) >= 0) return false;
      }
      return true;
    });
    return { ok: bad.length === 0, porcelain: o.trim() };
  } catch (e) {
    return { ok: false, porcelain: String(e && e.message) };
  }
}

function detectNoteTarget(fold) {
  return hasExplicitDoPoznamk(fold) || hasRelaxedDoPoznamkChain(fold) ? "ano" : "ne";
}

function detectWriteCueInInput(fold) {
  return /\buloz\w*\b|\bdo\s+poznam|\bpoznamk/i.test(String(fold || "")) ? "ano" : "ne";
}

function detectNegationNoWrite(fold) {
  const f = String(fold || "");
  const neg = safetyNoWriteFolded(f) || hasNegWrite(f);
  return neg ? "ano" : "ne";
}

function buildDetailRecord(c, turn, ev, gold, parentCls, sub) {
  const g = gold || {};
  const raw = rawUserMessage(turn);
  const eng = String(turn.normalizedIntent || "");
  const fold = foldCs(c.input);
  const draft = turn.draft || {};
  const ps = String(turn.processingState || "");
  const clarifyOrUnknown =
    eng === "clarification" ||
    eng === "unknown" ||
    ps === "CLARIFICATION" ||
    ps === "NEEDS_CLARIFICATION";
  const actualClarify = {
    id: c.id,
    sub_bucket: sub.sub,
    classification: sub.classification,
    input: c.input,
    expected_intent: g.expected_intent || "",
    actual_intent: eng,
    actual_state: ps,
    expected_should_clarify: !!g.expected_should_clarify,
    actual_should_clarify_or_processing: clarifyOrUnknown ? "yes_clarify_or_unknown" : ps,
    detected_note_target: detectNoteTarget(fold),
    detected_write_cue_in_input: detectWriteCueInInput(fold),
    detected_negation_or_no_write: detectNegationNoWrite(fold),
    detected_write_cue_in_assistant_raw: noteHarnessTokensOk(raw) ? "ano" : "ne",
    strict_uloz_mi_do_poznam_anchor: strictPrimaryUlozMiDoPoznam(fold) ? "ano" : "ne",
    extracted_draft_title: String(draft.title || ""),
    extracted_draft_note: String(draft.note || draft.silverNoteText || ""),
    harness_cat: ev.cat || "",
    parent_classifier_why: parentCls.why,
    parent_classifier_root: parentCls.root,
    why_fail: sub.why_fail,
    response_excerpt: String(raw || "").slice(0, 320)
  };
  return actualClarify;
}

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== RHC3_NOTE_CREATE_RESPONSE_CONTRACT_REMAINING_DIAGNOSTIC_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("=== END_ABORT ===");
    process.exit(1);
  }

  let runnerHead = "";
  try {
    runnerHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    runnerHead = "UNKNOWN";
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

  const subCounts = {};
  for (let si = 0; si < SUB_BUCKETS.length; si++) subCounts[SUB_BUCKETS[si]] = 0;

  const classTotals = {
    ENGINE_BUG: 0,
    HARNESS_BUG: 0,
    GOLD_PROBLEM: 0,
    TEMPLATE_DNA_PROBLEM: 0,
    SAFETY_OK: 0,
    AMBIGUOUS_OK: 0
  };

  const examplesBySub = {};
  for (let ei = 0; ei < SUB_BUCKETS.length; ei++) examplesBySub[SUB_BUCKETS[ei]] = [];

  let remaining_response_contract_fail_total = 0;

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

    if (ev.pass) continue;

    const parentCls = parentDiag.classifyNoteCreateUloz(c, turn, ev, c.gold);
    if (parentCls.bucket !== "note_create_response_contract_fail") continue;

    remaining_response_contract_fail_total++;
    const sub = subBucketResponseContractRemaining(c, turn, ev, c.gold);
    subCounts[sub.sub] = (subCounts[sub.sub] || 0) + 1;
    const ck = sub.classification;
    if (classTotals[ck] != null) classTotals[ck]++;
    else classTotals.HARNESS_BUG++;

    const list = examplesBySub[sub.sub];
    if (list && list.length < 10) {
      list.push(buildDetailRecord(c, turn, ev, c.gold, parentCls, sub));
    }
  }

  let dominant_root_cause = SUB_BUCKETS[0];
  let best = -1;
  for (let bi = 0; bi < SUB_BUCKETS.length; bi++) {
    const k = SUB_BUCKETS[bi];
    const v = subCounts[k] || 0;
    if (v > best) {
      best = v;
      dominant_root_cause = k;
    }
  }

  const engine_bug_count = classTotals.ENGINE_BUG;
  const harness_bug_count = classTotals.HARNESS_BUG;
  const gold_problem_count = classTotals.GOLD_PROBLEM;
  const template_dna_problem_count = classTotals.TEMPLATE_DNA_PROBLEM;
  const safety_ok_count = classTotals.SAFETY_OK;
  const ambiguous_ok_count = classTotals.AMBIGUOUS_OK;

  const scriptDominant =
    dominant_root_cause === "harness_gold_problem" ||
    dominant_root_cause === "template_dna_problem" ||
    dominant_root_cause === "do_poznamek_variant_not_seen";

  let engine_fix_recommended = "NO";
  if (!scriptDominant && remaining_response_contract_fail_total > 0 && engine_bug_count > 0) {
    if (
      dominant_root_cause === "missing_write_cue_token" ||
      dominant_root_cause === "engine_recovery_candidate" ||
      dominant_root_cause === "long_prefix_before_write_cue" ||
      dominant_root_cause === "write_cue_order_or_distance_problem" ||
      dominant_root_cause === "explicit_note_target_after_noise_not_seen" ||
      dominant_root_cause === "parser_requires_start_anchor" ||
      dominant_root_cause === "module_switch_negative_task_calendar_noise"
    ) {
      engine_fix_recommended = "YES";
    }
  }

  let scripts_alignment_recommended = "NO";
  if (
    dominant_root_cause === "harness_gold_problem" ||
    dominant_root_cause === "template_dna_problem" ||
    dominant_root_cause === "do_poznamek_variant_not_seen" ||
    harness_bug_count > engine_bug_count ||
    template_dna_problem_count + gold_problem_count > engine_bug_count
  ) {
    scripts_alignment_recommended = "YES";
  }

  if (
    dominant_root_cause === "harness_gold_problem" ||
    dominant_root_cause === "template_dna_problem" ||
    dominant_root_cause === "do_poznamek_variant_not_seen"
  ) {
    engine_fix_recommended = "NO";
  }

  let recommended_next_scope = "";
  if (dominant_root_cause === "do_poznamek_variant_not_seen") {
    recommended_next_scope =
      "scripts+harness: widen gold/harness anchor beyond uloz_mi_do_poznam OR finalize STORAGE on do_poznam_ze+rhc3_note_create (no engine copy tokens needed for this slice)";
  } else if (dominant_root_cause === "safe_negation_or_no_write_should_block") {
    recommended_next_scope =
      "scripts+harness: STORAGE_DISAMBIGUATION + Kam uložit? on rhc3_note_create_uloz_poznamku — pass when folded input locks do→poznámek+že payload (narrow finalize like module_switch storage_ok)";
  } else if (dominant_root_cause === "harness_gold_problem") {
    recommended_next_scope =
      "scripts-only: align row.expectedIntent vs computeGoldLabels for note_create_chaos after harmonization";
  } else if (dominant_root_cause === "template_dna_problem") {
    recommended_next_scope =
      "scripts-only: template/mutation DNA so uloz+do+poznamkach+ze chain survives folding";
  } else if (dominant_root_cause === "missing_write_cue_token" || dominant_root_cause === "engine_recovery_candidate") {
    recommended_next_scope =
      "narrow engine/copy: assistant raw must include note-write cues (expand recovery tokens only if probe-safe)";
  } else if (dominant_root_cause === "long_prefix_before_write_cue") {
    recommended_next_scope = "narrow engine: long spoken prefix before uloz/do poznam imperative";
  } else if (dominant_root_cause === "write_cue_order_or_distance_problem") {
    recommended_next_scope = "narrow engine: token order / distance between uloz, do poznam, ze clause";
  } else if (dominant_root_cause === "explicit_note_target_after_noise_not_seen") {
    recommended_next_scope = "narrow engine: do poznamkach after filler/noise not anchored in parse";
  } else if (dominant_root_cause === "parser_requires_start_anchor") {
    recommended_next_scope = "narrow engine: filler-prefix mutations shift anchor away from uloz";
  } else if (dominant_root_cause === "module_switch_negative_task_calendar_noise") {
    recommended_next_scope = "narrow engine: calendar/task tokens colliding with note.create clause";
  } else {
    recommended_next_scope = "inspect other samples in tmp JSON report; pick first high-frequency harness_cat";
  }

  const gitCleanAll = (() => {
    try {
      return execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim() === "" ? "YES" : "NO";
    } catch {
      return "NO";
    }
  })();

  const lines = [
    "=== RHC3_NOTE_CREATE_RESPONSE_CONTRACT_REMAINING_DIAGNOSTIC ===",
    "",
    "main_commit=" + EXPECTED_MAIN_COMMIT,
    "",
    "cluster_total=" + cluster_total,
    "remaining_response_contract_fail_total=" + remaining_response_contract_fail_total,
    "",
    "missing_write_cue_token=" + (subCounts.missing_write_cue_token || 0),
    "long_prefix_before_write_cue=" + (subCounts.long_prefix_before_write_cue || 0),
    "write_cue_order_or_distance_problem=" + (subCounts.write_cue_order_or_distance_problem || 0),
    "explicit_note_target_after_noise_not_seen=" + (subCounts.explicit_note_target_after_noise_not_seen || 0),
    "do_poznamek_variant_not_seen=" + (subCounts.do_poznamek_variant_not_seen || 0),
    "parser_requires_start_anchor=" + (subCounts.parser_requires_start_anchor || 0),
    "module_switch_negative_task_calendar_noise=" + (subCounts.module_switch_negative_task_calendar_noise || 0),
    "safe_negation_or_no_write_should_block=" + (subCounts.safe_negation_or_no_write_should_block || 0),
    "harness_gold_problem=" + (subCounts.harness_gold_problem || 0),
    "template_dna_problem=" + (subCounts.template_dna_problem || 0),
    "engine_recovery_candidate=" + (subCounts.engine_recovery_candidate || 0),
    "other=" + (subCounts.other || 0),
    "",
    "engine_bug_count=" + engine_bug_count,
    "harness_bug_count=" + harness_bug_count,
    "gold_problem_count=" + gold_problem_count,
    "template_dna_problem_count=" + template_dna_problem_count,
    "safety_ok_count=" + safety_ok_count,
    "ambiguous_ok_count=" + ambiguous_ok_count,
    "",
    "dominant_root_cause=" + dominant_root_cause,
    "",
    "engine_fix_recommended=" + engine_fix_recommended,
    "scripts_alignment_recommended=" + scripts_alignment_recommended,
    "",
    "recommended_next_scope=" + recommended_next_scope,
    "",
    "git_status_clean=" + gitCleanAll,
    "",
    "=== DETAIL_BY_SUB_BUCKET (max 10 examples each, JSON lines) ==="
  ];

  const textBlock = lines.join("\n");
  console.log("\n" + textBlock + "\n");

  for (let bi = 0; bi < SUB_BUCKETS.length; bi++) {
    const bk = SUB_BUCKETS[bi];
    const ex = examplesBySub[bk] || [];
    console.log("--- sub_bucket=" + bk + " count=" + (subCounts[bk] || 0) + " ---");
    for (let xi = 0; xi < ex.length; xi++) {
      console.log(JSON.stringify(ex[xi]));
    }
    console.log("");
  }

  console.log("=== END_RHC3_NOTE_CREATE_RESPONSE_CONTRACT_REMAINING_DIAGNOSTIC ===\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    diag_runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    cluster_total,
    remaining_response_contract_fail_total,
    sub_bucket_counts: subCounts,
    classification_totals: classTotals,
    dominant_root_cause,
    engine_fix_recommended,
    scripts_alignment_recommended,
    recommended_next_scope,
    examples_by_sub_bucket: examplesBySub,
    text_block_header: lines.join("\n")
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTER,
  subBucketResponseContractRemaining,
  EXPECTED_MAIN_COMMIT
};
