/**
 * RHC3 read-only diagnostic: `ambiguous_should_clarify` sub-breakdown within
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
  "silver-rhc3-note-create-ambiguous-clarify-diagnostic-report.json"
);

const EXPECTED_MAIN_COMMIT = "a3948f3bb55e12f57500c43a3cad5c854e8a0732";
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
  finalizeNoteQueryKdeHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const parentDiag = require("./silver-rhc3-note-create-uloz-poznamku-diagnostic.cjs");

const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, rawUserMessage, hasNegWrite } =
  harness;

const SUB_BUCKETS = [
  "valid_ambiguity_should_clarify",
  "gold_too_strict_should_allow_clarify",
  "template_dna_ambiguous_noise",
  "engine_should_create_despite_clarify",
  "safety_negation_or_no_write_ok",
  "conflicting_module_target_task_calendar",
  "missing_note_content_or_empty_payload",
  "response_contract_clarify_ok",
  "harness_finalize_should_pass_clarify",
  "other"
];

function popcount(mask, onlyBits) {
  let x = (mask >>> 0) & (onlyBits >>> 0);
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}

function isChaoticMutationSurface(c) {
  const mask = (c.mutation_mask || 0) >>> 0;
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.MOBILE_PREFIX |
    core.M.SPOKEN_COMPRESS |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.STRIP_DIACRITICS |
    core.M.PARTIAL_REF;
  if (popcount(mask, noiseMask) >= 3) return true;
  if ((mask & core.M.NEGATION_OVERLAY) !== 0) return true;
  if ((mask & core.M.AMBIGUITY_OVERLAY) !== 0) return true;
  return false;
}

function noiseOnlyPopcount(mask) {
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.MOBILE_PREFIX |
    core.M.SPOKEN_COMPRESS |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.STRIP_DIACRITICS |
    core.M.PARTIAL_REF;
  return popcount((mask || 0) >>> 0, noiseMask >>> 0);
}

function safetyNoWriteFolded(fold) {
  const f = String(fold || "");
  return (
    /\bnic\s+neuklad\w*\b/i.test(f) ||
    /\bnevytvarej\b/i.test(f) ||
    /\bnevytvĂˇĹ™ej\b/i.test(f) ||
    /\bpouze\s+cti\b/i.test(f) ||
    /\bpouze\s+ÄŤti\b/i.test(f) ||
    /\bjen\s+se\s+podivej\b/i.test(f) ||
    /\bjen\s+se\s+podĂ­vej\b/i.test(f) ||
    /\bneukladat\b/i.test(f) ||
    /\bneuklĂˇdat\b/i.test(f)
  );
}

function noteCreateBenignNeUkolDisambigTailFolded(fold) {
  const f = String(fold || "");
  return /,?\s*ne\s+úkol\.?\s*$/i.test(f) || /,?\s*ne\s+ukol\.?\s*$/i.test(f);
}

function noteCreateStripBenignNeUkolPhraseFolded(fold) {
  return String(fold || "")
    .replace(/,?\s*ne\s+úkol\.?/gi, " ")
    .replace(/,?\s*ne\s+ukol\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function noteCreateCrossModuleCalendarTaskNoiseFolded(fold) {
  const f = String(fold || "");
  const stripped = f.replace(/,?\s*ne\s+úkol\.?\s*$/i, " ").replace(/,?\s*ne\s+ukol\.?\s*$/i, " ");
  if (/\bkalend|\budalost|\bschuzk/i.test(stripped)) return true;
  if (
    (/\búkol\b|\bukol\b/i.test(stripped) || /\bdo\s+úkol|\bdo\s+ukol/i.test(stripped)) &&
    !noteCreateBenignNeUkolDisambigTailFolded(f)
  ) {
    return true;
  }
  return false;
}

function noteCreateDoPoznamkStorageHarnessBlockedFolded(fold) {
  const f = String(fold || "");
  if (/\bne\s+do\s+poznam/i.test(f)) return true;
  if (/\bdo\s+poznam\w*\s+to\s+neuklad/i.test(f)) return true;
  if (/\bneuklad\w*\s+do\s+poznam/i.test(f)) return true;
  if (/\bnic\s+neuklad\w*\s+do\s+poznam/i.test(f)) return true;
  if (/\bco\s+mam\s+v\s+poznam/i.test(f)) return true;
  if (/\bco\s+je\s+v\s+poznam/i.test(f)) return true;
  if (/\bjen\s+cti\b/i.test(f) && /\bpoznam/i.test(f)) return true;
  if (/\bkoukni\s+do\s+poznam/i.test(f) && !/\buloz/i.test(f)) return true;
  const crossProbe = noteCreateStripBenignNeUkolPhraseFolded(f);
  if (noteCreateCrossModuleCalendarTaskNoiseFolded(crossProbe)) return true;
  return false;
}

function noteCreateDoPoznamkZeChainFolded(fold) {
  return /\bdo\s+(?:\S+\s+){0,8}poznam\w*\s+ze\b/i.test(String(fold || ""));
}

function strictPrimaryUlozMiDoPoznam(fold) {
  return /\buloz\w*\s+mi\s+do\s+poznam/i.test(String(fold || ""));
}

function extractPayloadAfterZe(input) {
  const s = String(input || "");
  const m = s.match(/do\s+pozn[aĂˇ]mk[aĂˇ]ch\s+(?:ze|Ĺľe)\s+(.+?)(?:,\s*ne\s+Ăşkol|,?\s*ne\s+ukol|$)/i);
  if (m) return m[1].trim().slice(0, 200);
  return "";
}

/** Diagnostic-only: matches spoken `do … poznámek/poznamek … že` (strict harness extract is narrower). */
function extractPayloadAfterZeRelaxed(input) {
  const a = extractPayloadAfterZe(input);
  if (a) return a;
  const s = String(input || "");
  const m2 = s.match(/\bdo\s+(?:\S+\s+){0,8}poznam\w*\s+(?:ze|že|Ĺľe)\s+(.+?)(?:,\s*ne\s+úkol|,?\s*ne\s+ukol|$)/i);
  if (m2) return m2[1].trim().slice(0, 200);
  return "";
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function noteHarnessTokensOkFolded(raw) {
  const rf = foldCs(String(raw || ""));
  return /poznam|uloz|zapamat|informac/i.test(rf);
}

function hasNoteCreateTemplateSignal(fold) {
  const f = String(fold || "");
  return (
    /\buloz\w*\s+mi\s+do\s+poznam/i.test(f) ||
    /\buloz\w*\s+do\s+poznam/i.test(f) ||
    /\bdo\s+(?:\S+\s+){0,8}poznam\w*\s+ze\b/i.test(f)
  );
}

function detectNoteTarget(fold) {
  return /\bdo\s+pozn\w*\b/i.test(String(fold || "")) || /\bdo\s+(?:\S+\s+){0,8}poznam\w*\b/i.test(String(fold || ""))
    ? "ano"
    : "ne";
}

function detectWriteCue(fold) {
  return /\buloz\w*\b|\bdo\s+poznam|\bpoznamk/i.test(String(fold || "")) ? "ano" : "ne";
}

function detectConflictingTarget(fold) {
  return noteCreateCrossModuleCalendarTaskNoiseFolded(noteCreateStripBenignNeUkolPhraseFolded(fold)) ? "ano" : "ne";
}

function detectNegationNoWrite(fold) {
  return safetyNoWriteFolded(fold) || hasNegWrite(fold) ? "ano" : "ne";
}

function serializeDraft(turn) {
  const d = turn.draft || {};
  const parts = [];
  if (d.title) parts.push("title:" + String(d.title).slice(0, 120));
  if (d.note) parts.push("note:" + String(d.note).slice(0, 120));
  if (d.silverNoteText) parts.push("nText:" + String(d.silverNoteText).slice(0, 120));
  if (d.targetContainer) parts.push("target:" + d.targetContainer);
  return parts.join(";") || "(none)";
}

/**
 * Priority-ordered sub-bucket for rows already in parent `ambiguous_should_clarify`.
 * @returns {{ sub: string, why_fail: string, classification: string }}
 */
function subBucketAmbiguousClarify(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const g = gold || {};
  const mask = (c.mutation_mask || 0) >>> 0;
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const raw = rawUserMessage(turn);
  const payloadStrict = extractPayloadAfterZe(c.input);
  const payloadRelaxed = extractPayloadAfterZeRelaxed(c.input);
  const payload = payloadRelaxed || payloadStrict;
  const chaotic = isChaoticMutationSurface(c);
  const drafty = createLikeTurn(turn);
  const noiseN = noiseOnlyPopcount(mask);
  const onlyAmbiguityOverlay = (mask & core.M.AMBIGUITY_OVERLAY) !== 0 && noiseN < 3;
  const onlyNegOverlay = (mask & core.M.NEGATION_OVERLAY) !== 0 && noiseN < 3;
  const singleOverlayChaos = chaotic && (onlyAmbiguityOverlay || onlyNegOverlay) && noiseN < 2;

  if ((safetyNoWriteFolded(fold) || hasNegWrite(fold)) && !drafty) {
    return {
      sub: "safety_negation_or_no_write_ok",
      why_fail: "negation_or_no_write_cue_in_fold+engine_non_create_like_turn",
      classification: "SAFETY_OK"
    };
  }

  if (noteCreateCrossModuleCalendarTaskNoiseFolded(noteCreateStripBenignNeUkolPhraseFolded(fold))) {
    return {
      sub: "conflicting_module_target_task_calendar",
      why_fail: "calendar_or_task_target_noise_after_ne_ukol_strip",
      classification: "AMBIGUOUS_OK"
    };
  }

  if (!payloadRelaxed || foldCs(payloadRelaxed).replace(/\s+/g, "").length < 4) {
    return {
      sub: "missing_note_content_or_empty_payload",
      why_fail:
        "ze_clause_payload_missing_or_too_short_after_relaxed_extract(strict_empty=" +
        (!payloadStrict ? "yes" : "no") +
        ")",
      classification: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (!payloadStrict && payloadRelaxed && foldCs(payloadRelaxed).replace(/\s+/g, "").length >= 4) {
    return {
      sub: "gold_too_strict_should_allow_clarify",
      why_fail:
        "relaxed_payload_present_but_harness_strict_extract_empty+gold_expected_create (align extract or gold clarify flag)",
      classification: "GOLD_PROBLEM"
    };
  }

  if (
    ev.cat === "intent_fail" &&
    (eng === "clarification" || eng === "unknown") &&
    noteCreateDoPoznamkZeChainFolded(fold) &&
    !noteCreateDoPoznamkStorageHarnessBlockedFolded(fold) &&
    !safetyNoWriteFolded(fold) &&
    !hasNegWrite(fold) &&
    hasNoteCreateTemplateSignal(fold)
  ) {
    return {
      sub: "harness_finalize_should_pass_clarify",
      why_fail:
        "intent_fail+clarify_lane_candidate: do_poznam_ze_chain_ok+not_blocked+safety_clean (mirror note_query_kde finalize pattern)",
      classification: "HARNESS_BUG"
    };
  }

  if (!noteCreateDoPoznamkZeChainFolded(fold) && hasNoteCreateTemplateSignal(fold)) {
    return {
      sub: "template_dna_ambiguous_noise",
      why_fail: "partial_uloz_do_poznam_markers_but_do_poznam_ze_chain_not_matched",
      classification: "TEMPLATE_DNA_PROBLEM"
    };
  }

  if (noteHarnessTokensOkFolded(raw) && (eng === "clarification" || eng === "unknown")) {
    return {
      sub: "response_contract_clarify_ok",
      why_fail: "assistant_raw_contains_note_harness_tokens_under_intent_fail",
      classification: "HARNESS_BUG"
    };
  }

  if (singleOverlayChaos && strictPrimaryUlozMiDoPoznam(fold) && noteCreateDoPoznamkZeChainFolded(fold)) {
    return {
      sub: "engine_should_create_despite_clarify",
      why_fail: "light_overlay_only+strict_uloz_mi_do_poznam+ze_chain_engine_still_unknown_or_clarify",
      classification: "ENGINE_BUG"
    };
  }

  if (noiseN >= 3 || ((mask & core.M.AMBIGUITY_OVERLAY) !== 0 && noiseN >= 2)) {
    return {
      sub: "valid_ambiguity_should_clarify",
      why_fail: "heavy_noise_or_ambiguity_overlay+safe_clarify_vs_note.create",
      classification: "AMBIGUOUS_OK"
    };
  }

  return {
    sub: "other",
    why_fail: "ambiguous_parent_bucket_residual:mask=" + mask + ";noiseN=" + noiseN + ";cat=" + String(ev.cat || ""),
    classification: "HARNESS_BUG"
  };
}

function gitAllowListClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/silver-rhc3-note-create-ambiguous-clarify-diagnostic.cjs",
      "scripts/silver-rhc3-note-create-uloz-poznamku-diagnostic.cjs",
      "scripts/silver-rhc3-note-create-response-contract-remaining-diagnostic.cjs",
      "scripts/silver-real-human-chaos-v3.cjs",
      "scripts/silver-real-human-chaos-v3-report.json"
    ];
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

function buildDetailRecord(c, turn, ev, gold, parentCls, sub) {
  const g = gold || {};
  const fold = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const actualClarify =
    eng === "clarification" || eng === "unknown" || String(turn.processingState || "") === "CLARIFICATION";
  const payloadStrict = extractPayloadAfterZe(c.input);
  const payloadRelaxed = extractPayloadAfterZeRelaxed(c.input);
  return {
    id: c.id,
    sub_bucket: sub.sub,
    classification: sub.classification,
    parent_bucket: parentCls.bucket,
    parent_classification: parentCls.root,
    why_fail: sub.why_fail,
    parent_why: parentCls.why,
    input: c.input,
    expected_intent: g.expected_intent || "",
    actual_intent: eng,
    actual_state: String(turn.processingState || ""),
    expected_should_clarify: !!g.expected_should_clarify,
    actual_should_clarify_or_probe: actualClarify,
    harness_cat: ev.cat || "",
    audit_intent: ev.auditIntent || "",
    note_target_detected: detectNoteTarget(fold),
    write_cue_detected: detectWriteCue(fold),
    conflicting_target_detected: detectConflictingTarget(fold),
    negation_no_write_detected: detectNegationNoWrite(fold),
    extracted_payload_after_ze: (payloadRelaxed || payloadStrict || "").slice(0, 200),
    extracted_payload_strict_empty: !payloadStrict,
    extracted_title: String((turn.draft && turn.draft.title) || ""),
    extracted_note: String((turn.draft && (turn.draft.note || turn.draft.silverNoteText)) || ""),
    draft_summary: serializeDraft(turn),
    response_excerpt: String(rawUserMessage(turn) || "").slice(0, 320),
    mutation_mask: (c.mutation_mask || 0) >>> 0
  };
}

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== RHC3_NOTE_CREATE_AMBIGUOUS_CLARIFY_DIAGNOSTIC_ABORT ===");
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

  let ambiguous_should_clarify_total = 0;

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
      ev = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, ev);
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

    if (ev.pass) continue;

    const parentCls = parentDiag.classifyNoteCreateUloz(c, turn, ev, c.gold);
    if (parentCls.bucket !== "ambiguous_should_clarify") continue;

    ambiguous_should_clarify_total++;
    const sub = subBucketAmbiguousClarify(c, turn, ev, c.gold);
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
  if (ambiguous_should_clarify_total === 0) {
    dominant_root_cause = "(none)";
  } else {
    for (let bi = 0; bi < SUB_BUCKETS.length; bi++) {
      const k = SUB_BUCKETS[bi];
      const v = subCounts[k] || 0;
      if (v > best) {
        best = v;
        dominant_root_cause = k;
      }
    }
  }

  const engine_bug_count = classTotals.ENGINE_BUG;
  const harness_bug_count = classTotals.HARNESS_BUG;
  const gold_problem_count = classTotals.GOLD_PROBLEM;
  const template_dna_problem_count = classTotals.TEMPLATE_DNA_PROBLEM;
  const safety_ok_count = classTotals.SAFETY_OK;
  const ambiguous_ok_count = classTotals.AMBIGUOUS_OK;

  const scriptStopShipDominant =
    ambiguous_should_clarify_total > 0 &&
    (dominant_root_cause === "valid_ambiguity_should_clarify" ||
      dominant_root_cause === "gold_too_strict_should_allow_clarify" ||
      dominant_root_cause === "harness_finalize_should_pass_clarify" ||
      dominant_root_cause === "template_dna_ambiguous_noise" ||
      dominant_root_cause === "response_contract_clarify_ok" ||
      dominant_root_cause === "conflicting_module_target_task_calendar" ||
      dominant_root_cause === "safety_negation_or_no_write_ok" ||
      dominant_root_cause === "missing_note_content_or_empty_payload");

  let engine_fix_recommended = "NO";
  if (!scriptStopShipDominant && ambiguous_should_clarify_total > 0 && engine_bug_count > 0) {
    if (dominant_root_cause === "engine_should_create_despite_clarify") {
      engine_fix_recommended = "YES";
    }
  }

  let scripts_alignment_recommended = "NO";
  if (
    scriptStopShipDominant ||
    harness_bug_count + gold_problem_count + template_dna_problem_count + ambiguous_ok_count + safety_ok_count >
      engine_bug_count
  ) {
    scripts_alignment_recommended = "YES";
  }
  if (engine_bug_count > 0 && dominant_root_cause === "engine_should_create_despite_clarify") {
    engine_fix_recommended = "YES";
    scripts_alignment_recommended = "NO";
  }

  if (
    dominant_root_cause === "valid_ambiguity_should_clarify" ||
    dominant_root_cause === "gold_too_strict_should_allow_clarify" ||
    dominant_root_cause === "harness_finalize_should_pass_clarify" ||
    dominant_root_cause === "template_dna_ambiguous_noise" ||
    dominant_root_cause === "response_contract_clarify_ok" ||
    dominant_root_cause === "missing_note_content_or_empty_payload"
  ) {
    engine_fix_recommended = "NO";
  }

  let recommended_next_scope = "";
  if (dominant_root_cause === "(none)") {
    recommended_next_scope = "no ambiguous_should_clarify residual in cluster " + TARGET_CLUSTER;
  } else if (dominant_root_cause === "harness_finalize_should_pass_clarify") {
    recommended_next_scope =
      "scripts+harness: add note_create clarify-lane finalize (intent_fail+do_poznam_ze+not_blocked) mirroring finalizeNoteQueryKdeHarnessEval";
  } else if (dominant_root_cause === "gold_too_strict_should_allow_clarify") {
    recommended_next_scope =
      "scripts-only: widen strict do+poznamkach+ze extract vs spoken do+filler+poznamek+ze; align expected_should_clarify or clarify-lane PASS";
  } else if (dominant_root_cause === "template_dna_ambiguous_noise") {
    recommended_next_scope = "scripts-only: template/mutation DNA so do_poznam_ze chain survives overlays";
  } else if (dominant_root_cause === "valid_ambiguity_should_clarify") {
    recommended_next_scope = "scripts-only: accept PASS for intentional clarify on heavy noise (harness align)";
  } else if (dominant_root_cause === "engine_should_create_despite_clarify") {
    recommended_next_scope =
      "narrow engine fix: unknown/clarify on light-overlay uloz+mi+do+poznam+ze locked surfaces";
  } else if (dominant_root_cause === "conflicting_module_target_task_calendar") {
    recommended_next_scope = "scripts+harness: clarify PASS when cross-module noise present (already ambiguous_ok)";
  } else if (dominant_root_cause === "safety_negation_or_no_write_ok") {
    recommended_next_scope = "scripts+harness: optional PASS bucket for negation surface without draft";
  } else if (dominant_root_cause === "missing_note_content_or_empty_payload") {
    recommended_next_scope =
      "scripts-only: template DNA / folding so ze-payload survives; check genitive/locative poznamek vs extract regex";
  } else if (dominant_root_cause === "response_contract_clarify_ok") {
    recommended_next_scope = "scripts+harness: intent_fail vs raw token presence mismatch in evaluator";
  } else {
    recommended_next_scope = "inspect other JSON samples in tmp report; refine heuristics";
  }

  const gitCleanAll = (() => {
    try {
      return execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim() === "" ? "YES" : "NO";
    } catch {
      return "NO";
    }
  })();

  const lines = [
    "=== RHC3_NOTE_CREATE_AMBIGUOUS_CLARIFY_DIAGNOSTIC ===",
    "",
    "main_commit=" + EXPECTED_MAIN_COMMIT,
    "",
    "cluster_total=" + cluster_total,
    "ambiguous_should_clarify_total=" + ambiguous_should_clarify_total,
    "",
    "valid_ambiguity_should_clarify=" + (subCounts.valid_ambiguity_should_clarify || 0),
    "gold_too_strict_should_allow_clarify=" + (subCounts.gold_too_strict_should_allow_clarify || 0),
    "template_dna_ambiguous_noise=" + (subCounts.template_dna_ambiguous_noise || 0),
    "engine_should_create_despite_clarify=" + (subCounts.engine_should_create_despite_clarify || 0),
    "safety_negation_or_no_write_ok=" + (subCounts.safety_negation_or_no_write_ok || 0),
    "conflicting_module_target_task_calendar=" + (subCounts.conflicting_module_target_task_calendar || 0),
    "missing_note_content_or_empty_payload=" + (subCounts.missing_note_content_or_empty_payload || 0),
    "response_contract_clarify_ok=" + (subCounts.response_contract_clarify_ok || 0),
    "harness_finalize_should_pass_clarify=" + (subCounts.harness_finalize_should_pass_clarify || 0),
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

  console.log("=== END_RHC3_NOTE_CREATE_AMBIGUOUS_CLARIFY_DIAGNOSTIC ===\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    diag_runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    cluster_total,
    ambiguous_should_clarify_total,
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
  subBucketAmbiguousClarify,
  EXPECTED_MAIN_COMMIT
};
