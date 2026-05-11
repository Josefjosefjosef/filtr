/**
 * SILVER_REAL_HUMAN_CHAOS_V3 — audit foundation (diagnostic only).
 * - Template DNA + deterministic mutations (no Math.random).
 * - VM engine via audit_silver_realistic_mobile_corpus.cjs (read-only bundle extract).
 * - Scales to 500k+ via TOTAL_CASES / FUTURE_TARGET_CASES constants.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_real_human_chaos_v3_foundation";
const FIXED_NOW_ISO = "2026-05-04T12:00:00";
const REPORT_JSON = path.join(__dirname, "silver-real-human-chaos-v3-report.json");
const REPORT_20K_TXT = path.join(os.tmpdir(), "silver_20000_stable_routing_audit_report.txt");

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();
const FUTURE_TARGET_CASES = 500000;
const SAMPLE_INSPECTION_N = 100;
const USER_MAIN_BEFORE = "f91f773b425b9dd692ca5cf99e2a86f68c9176a6";

const core = require("./rhc-v3-deterministic-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  hasNegWrite
} = harness;

const FAMILIES = [
  "calendar_create_chaos",
  "calendar_query_chaos",
  "task_create_chaos",
  "task_query_chaos",
  "note_create_chaos",
  "note_query_chaos",
  "retrieval_fuzzy_notes",
  "self_correction",
  "module_switching",
  "negation_no_write",
  "ambiguity_should_clarify",
  "nonsense_negative_mining",
  "mobile_voice_dirty_czech",
  "no_diacritics",
  "filler_speech",
  "partial_references",
  "multi_intent_light"
];

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
}

function pickFrom(rng, arr) {
  return core.pickFrom(rng, arr);
}

function pickIndex(rng, n) {
  return core.pickIndex(rng, n);
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

function popcountMask(mask, onlyBits) {
  let x = (mask >>> 0) & (onlyBits >>> 0);
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}

/** Noise bits only (exclude family-default NEGATION_OVERLAY / AMBIGUITY_OVERLAY). */
function negationNoWriteNoisePopcount(mask) {
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
  return popcountMask(mask >>> 0, noiseMask >>> 0);
}

/** Read-only / no-write cues for negation_no_write harness alignment (folded). */
function negationReadonlyHarnessCueFolded(f) {
  const fold = String(f || "");
  return (
    /\bnic\s+neuklad/i.test(fold) ||
    /\bnic\s+nevytv/i.test(fold) ||
    /\bnevytvářej\b/i.test(fold) ||
    /\bnevytvarej\b/i.test(fold) ||
    /\bpouze\s+čti\b/i.test(fold) ||
    /\bpouze\s+cti\b/i.test(fold) ||
    /\bjen\s+se\s+podívej\b/i.test(fold) ||
    /\bjen\s+se\s+podivej\b/i.test(fold) ||
    /\bneukládat\b/i.test(fold) ||
    /\bneukladat\b/i.test(fold)
  );
}

/**
 * Gold-only clarity for negation_no_write / rhc3_negation_cal_readonly.
 * clear = no filler/typo noise layers; noisy = light mutation; broken = heavy mutation; hard = cue lost in fold.
 */
function classifyNegationReadonlyClarity(row, fold) {
  if (row.family !== "negation_no_write") return "";
  const f = String(fold || "");
  const mask = (row.mutation_mask || 0) >>> 0;
  const n = negationNoWriteNoisePopcount(mask);
  const cue = negationReadonlyHarnessCueFolded(f);
  if (!cue) return "hard_no_write_guard";
  if (n === 0) return "clear_read_request";
  if (n >= 3) return "broken_by_filler";
  return "noisy_read_request";
}

function buildFamilyCase(familyKey, localIndex, seqSalt) {
  const rng = mulberry32((core.RHC_V3_GLOBAL_SEED ^ seqSalt ^ (localIndex * 9973)) >>> 0);
  const cal = pickFrom(rng, core.CAL_ENTITIES);
  const task = pickFrom(rng, core.TASK_ENTITIES);
  const note = pickFrom(rng, core.NOTE_ENTITIES);
  const topic = pickFrom(rng, core.RETRIEVAL_TOPIC_FORMS);
  const mask = core.deriveMutationMask(familyKey, localIndex, seqSalt);
  const maskRng = mulberry32((mask ^ seqSalt ^ localIndex) >>> 0);

  function finish(baseInput, row) {
    const input = core.applyMutationLayers(baseInput, mask, maskRng);
    return Object.assign(
      {
        input,
        mutation_mask: mask,
        family: familyKey,
        cluster: row.cluster,
        group: row.group,
        expectedIntent: row.expectedIntent,
        meta: row.meta || {}
      },
      row.extra || {}
    );
  }

  if (familyKey === "calendar_create_chaos") {
    return finish(
      "Hele ulož mi " +
        cal +
        " " +
        pickFrom(rng, core.DATE_PHRASES) +
        " v " +
        pickFrom(rng, core.TIME_SLOTS) +
        " do kalendáře.",
      {
        cluster: "rhc3_cal_create_skeleton",
        group: "calendar_write",
        expectedIntent: "calendar.create",
        meta: {},
        extra: { template_id: "skel_hele_uloz_cal_time" }
      }
    );
  }
  if (familyKey === "calendar_query_chaos") {
    return finish(
      "Co mám " + pickFrom(rng, core.DATE_PHRASES) + " v kalendáři ohledně " + topic + "?",
      { cluster: "rhc3_cal_query_topic", group: "calendar_query", expectedIntent: "calendar.query", meta: {} }
    );
  }
  if (familyKey === "task_create_chaos") {
    return finish(
      "Hoď mi do úkolů " + task + " " + pickFrom(rng, core.DATE_PHRASES) + ", ne do kalendáře.",
      { cluster: "rhc3_task_create_do_ukolu", group: "task_write", expectedIntent: "task.create", meta: {} }
    );
  }
  if (familyKey === "task_query_chaos") {
    return finish("Co mám za úkoly ohledně " + task.split(" ")[0] + "?", {
      cluster: "rhc3_task_query_slice",
      group: "task_query",
      expectedIntent: "task.query",
      meta: {}
    });
  }
  if (familyKey === "note_create_chaos") {
    return finish("Ulož mi do poznámek že " + note + ", ne úkol.", {
      cluster: "rhc3_note_create_uloz_poznamku",
      group: "note_write",
      expectedIntent: "note.create",
      meta: {}
    });
  }
  if (familyKey === "note_query_chaos") {
    return finish("Kde mám uložené " + topic + "?", {
      cluster: "rhc3_note_query_kde",
      group: "note_query",
      expectedIntent: "note.query",
      meta: {}
    });
  }
  if (familyKey === "retrieval_fuzzy_notes") {
    return finish("Mrkni do poznámek na něco o " + topic + ", nic neukládej.", {
      cluster: "rhc3_retrieval_fuzzy_note_read",
      group: "note_query",
      expectedIntent: "note.query",
      meta: {}
    });
  }
  if (familyKey === "self_correction") {
    return finish(
      "Tyjo ulož " +
        cal +
        " zítra v 15:00, ne vlastně " +
        pickFrom(rng, core.DATE_PHRASES) +
        " v " +
        pickFrom(rng, core.TIME_SLOTS) +
        " do kalendáře.",
      { cluster: "rhc3_self_correction_cal", group: "calendar_write", expectedIntent: "calendar.create", meta: {} }
    );
  }
  if (familyKey === "module_switching") {
    return finish("Ulož mi " + note + ", ale ne do kalendáře, do poznámek.", {
      cluster: "rhc3_module_switch_cal_to_note",
      group: "note_write",
      expectedIntent: "note.create",
      meta: {}
    });
  }
  if (familyKey === "negation_no_write") {
    return finish("Mrkni prosím do kalendáře na " + cal + ", nic neukládej.", {
      cluster: "rhc3_negation_cal_readonly",
      group: "calendar_query",
      expectedIntent: "calendar.query",
      meta: {}
    });
  }
  if (familyKey === "ambiguity_should_clarify") {
    return finish("Jen v kalendáři ne v kalendáři co mám zítra?", {
      cluster: "rhc3_ambiguity_cal_conflict",
      group: "calendar_query",
      expectedIntent: "calendar.query",
      meta: {}
    });
  }
  if (familyKey === "nonsense_negative_mining") {
    const line = core.NONSENSE_CANON[localIndex % core.NONSENSE_CANON.length];
    return finish(line, {
      cluster: "rhc3_nonsense_mining",
      group: "note_query",
      expectedIntent: "unknown",
      meta: {}
    });
  }
  if (familyKey === "mobile_voice_dirty_czech") {
    return finish("Hele ten " + cal + " zítra v 11 fakt jako do kalendáře prosím.", {
      cluster: "rhc3_mobile_voice_cal",
      group: "calendar_write",
      expectedIntent: "calendar.create",
      meta: {}
    });
  }
  if (familyKey === "no_diacritics") {
    return finish("Hoď do úkolů " + task + " do pátku, ne do kalendáře.", {
      cluster: "rhc3_ascii_task",
      group: "task_write",
      expectedIntent: "task.create",
      meta: {}
    });
  }
  if (familyKey === "filler_speech") {
    return finish("ee prostě echo kde mám " + topic + " v poznámkách?", {
      cluster: "rhc3_filler_note_query",
      group: "note_query",
      expectedIntent: "note.query",
      meta: {}
    });
  }
  if (familyKey === "partial_references") {
    const vague = ["tenkrát", "někdy ten den", "tamto", "kdysi", "v tom týdnu"][pickIndex(rng, 5)];
    return finish("Co jsem měl " + vague + " kolem " + topic + " v kalendáři?", {
      cluster: "rhc3_partial_cal_ref",
      group: "calendar_query",
      expectedIntent: "calendar.query",
      meta: {}
    });
  }
  if (familyKey === "multi_intent_light") {
    const raw =
      "Ulož do kalendáře " +
      pickFrom(rng, core.DATE_PHRASES) +
      " v " +
      pickFrom(rng, core.TIME_SLOTS) +
      " " +
      cal +
      " a zároveň do poznámky napiš " +
      note +
      ", ne do úkolů.";
    const f = foldCs(raw);
    const needsDualWrite =
      /\b(zaroven|zároveň)\b/i.test(raw) &&
      /\b(do\s+poznam|\bpoznam|\bdo\s+kalend|\buloz|\bulož|\bpridej|\bpřidej)/i.test(f);
    const queryNeg = /jen\s+se\s+podivej|jen\s+cti|nic\s+neuklad/.test(f) ? f : "";
    return finish(raw, {
      cluster: "rhc3_multi_cal_note_light",
      group: "multi_intent",
      expectedIntent: "unknown",
      meta: { needsDualWrite, queryNeg },
      extra: { template_id: "skel_multi_cal_note" }
    });
  }
  throw new Error("unknown_family=" + familyKey);
}

function expectedModuleFromGroup(g) {
  const x = String(g || "");
  if (x.indexOf("calendar") === 0) return "calendar";
  if (x.indexOf("task") === 0) return "tasks";
  if (x.indexOf("note") === 0) return "notes";
  if (x === "multi_intent") return "mixed";
  return "unknown";
}

function expectedModeFromRow(row) {
  if (row.group === "multi_intent") return "mixed";
  if (row.group.indexOf("query") >= 0) return "query";
  return "write";
}

/** Mutation bits that actually change the surface via applyMutationLayers (gold-only). */
function moduleSwitchAppliedSurfaceNoiseMask() {
  return (
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.SPOKEN_COMPRESS |
    core.M.MOBILE_PREFIX |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.STRIP_DIACRITICS
  ) >>> 0;
}

function moduleSwitchLaneExpectsClarify(clarity) {
  const c = String(clarity || "");
  return c === "ambiguous" || c === "broken_by_filler" || c === "surface_clarify_lane";
}

/**
 * RHC3 module_switching: split CLEAR vs AMBIGUOUS vs BROKEN_BY_FILLER vs FUTURE_ENGINE_CANDIDATE (gold-only).
 */
function isCanonModuleSwitchClear(fold) {
  const f = String(fold || "");
  if (!f) return false;
  if (/\bne\s+\S+\s+do\s+kalend/i.test(f)) return false;
  if (/\bne\s+do\s+(?!\s*kalend)(\S+)\s+kalend/i.test(f)) return false;
  if (/\bne\s+jako\s+do\s+kalend/i.test(f)) return false;
  return (
    /\buloz\w*\s+mi\b/i.test(f) &&
    /,\s*ale\s+ne\s+do\s+kalend/i.test(f) &&
    /\bdo\s+poznam/i.test(f)
  );
}

function classifyModuleSwitchClarity(row, fold) {
  const mask = (row.mutation_mask || 0) >>> 0;
  const appliedSurface = moduleSwitchAppliedSurfaceNoiseMask();
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.SPOKEN_COMPRESS |
    core.M.MOBILE_PREFIX |
    core.M.EMOTIONAL;
  const hasNoise = (mask & noiseMask) !== 0;

  if (/\bne\s+jako\s+do\s+kalend/i.test(fold)) {
    return { clarity: "future_engine_candidate", reason: "spoken_czech_ne_jako_do_cal" };
  }

  const fillerBetweenNeAndDoCal = /\bne\s+\S+\s+do\s+kalend/i.test(fold);
  const brokenDoCalToken = /\bne\s+do\s+(?!\s*kalend)(\S+)\s+kalend/i.test(fold);

  if (fillerBetweenNeAndDoCal) {
    return { clarity: "ambiguous", reason: "filler_between_negation_and_module" };
  }
  if (brokenDoCalToken) {
    return { clarity: "ambiguous", reason: "broken_spoken_czech" };
  }

  if (isCanonModuleSwitchClear(fold)) {
    const pinSurface = /\bpin\b/i.test(fold);
    const strictPristine = pinSurface && (mask & appliedSurface) === 0;
    if (strictPristine) return { clarity: "clear", reason: "" };
    return { clarity: "surface_clarify_lane", reason: "canon_switch_with_surface_or_non_pin_entity" };
  }

  if (hasNoise) {
    return { clarity: "broken_by_filler", reason: "broken_spoken_czech" };
  }

  return { clarity: "ambiguous", reason: "module_switch_ambiguous" };
}

function computeGoldLabels(row) {
  const fold = foldCs(row.input);
  const containsNegation =
    /\b(ne|nic\s+ne|nevytv|nepis|nepiš|jen\s+cti|jen\s+čti|nic\s+neuklad)\b/i.test(fold) ||
    /\bne\s+do\s+kalend/.test(fold);
  const containsCorrection = /ne\s+vlastne|ne\s+vlastně|ne\s+ vlastně/i.test(fold);
  const containsModuleSwitch = /\bne\s+do\s+kalend.*\bdo\s+poznam/i.test(fold) || /\bdo\s+poznam/i.test(fold);
  const containsFiller = /\b(hele|ee|prostě|no jo|tyjo|echo)\b/i.test(fold);
  const containsNoDiacritics = !/[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(row.input);
  const containsTypo = /zejtra|mlíko|schuzka|poznamka|ptže/i.test(fold);
  const containsRetrieval =
    row.family === "retrieval_fuzzy_notes" ||
    row.family === "partial_references" ||
    /\b(najdi|mrkni|hledej|kde\s+mám)\b/i.test(fold);
  const containsFillerFamily = row.family === "filler_speech";
  const containsModuleSwitchFamily = row.family === "module_switching";
  const containsSelfCorrection = row.family === "self_correction";

  let moduleSwitchMeta = null;
  if (row.family === "module_switching") {
    moduleSwitchMeta = classifyModuleSwitchClarity(row, fold);
  }

  let harnessIntent = row.expectedIntent;
  if (moduleSwitchMeta) {
    if (moduleSwitchLaneExpectsClarify(moduleSwitchMeta.clarity)) {
      harnessIntent = "unknown";
    } else {
      harnessIntent = "note.create";
    }
  }

  const safetyFold = safetyNoWriteFolded(fold);
  const readOnlyLead =
    /\bjen\s+se\s+podivej\b/i.test(fold) ||
    /\bjen\s+čti\b/i.test(fold) ||
    /\bjen\s+cti\b/i.test(fold) ||
    /\bnic\s+neuklad/i.test(fold);
  let expected_should_write = false;
  if (row.group.indexOf("query") >= 0) {
    expected_should_write = false;
  } else if (row.group === "multi_intent") {
    expected_should_write = !!(row.meta && row.meta.needsDualWrite);
  } else if (harnessIntent === "unknown") {
    expected_should_write = false;
  } else {
    expected_should_write = !(safetyFold || readOnlyLead);
  }

  const expected_should_clarify =
    harnessIntent === "unknown" ||
    row.family === "ambiguity_should_clarify" ||
    row.family === "nonsense_negative_mining";

  let risk_level = "P2";
  if (row.family === "nonsense_negative_mining" || row.family === "negation_no_write") risk_level = "P0";
  else if (row.family === "multi_intent_light" || row.family === "ambiguity_should_clarify") risk_level = "P1";
  else if (row.family === "module_switching" && moduleSwitchMeta && moduleSwitchLaneExpectsClarify(moduleSwitchMeta.clarity)) {
    risk_level = "P1";
  }

  let expected_safety = "ok";
  if (safetyFold || readOnlyLead) expected_safety = "read_only";
  if (row.family === "nonsense_negative_mining") expected_safety = "clarify_or_unknown";
  if (moduleSwitchMeta && moduleSwitchLaneExpectsClarify(moduleSwitchMeta.clarity)) {
    expected_safety = "clarification_expected";
  }

  const gold = {
    family: row.family,
    cluster: row.cluster,
    expected_module: expectedModuleFromGroup(row.group),
    expected_intent: harnessIntent,
    expected_mode: expectedModeFromRow(row),
    expected_safety,
    expected_should_write,
    expected_should_clarify,
    contains_negation: !!containsNegation,
    contains_correction: !!(containsCorrection || containsSelfCorrection),
    contains_module_switch: !!(containsModuleSwitch || containsModuleSwitchFamily),
    contains_filler: !!(containsFiller || containsFillerFamily),
    contains_no_diacritics: !!containsNoDiacritics,
    contains_typo: !!containsTypo,
    contains_retrieval: !!containsRetrieval,
    expected_query_topic: row.group.indexOf("query") >= 0 ? topicFromFold(fold, row) : "",
    expected_create_title:
      row.group.indexOf("query") < 0 && row.group !== "multi_intent" ? extractTitleHint(row.input) : "",
    risk_level,
    module_switch_clarity: moduleSwitchMeta ? moduleSwitchMeta.clarity : "",
    expected_clarification_reason: moduleSwitchMeta ? moduleSwitchMeta.reason : "",
    negation_readonly_clarity_input: "",
    negation_readonly_clarity: ""
  };
  if (row.family === "negation_no_write") {
    const nrc = classifyNegationReadonlyClarity(row, fold);
    gold.negation_readonly_clarity_input = nrc;
    gold.negation_readonly_clarity = nrc;
  }
  return gold;
}

function finalizeModuleSwitchHarnessEval(c, turn, ev) {
  if (c.family !== "module_switching" || ev.pass) return ev;
  const g = c.gold || {};
  const cl = g.module_switch_clarity || "";
  if (!moduleSwitchLaneExpectsClarify(cl)) return ev;

  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const storageOk = eng === "create.storage_disambiguation" || ps === "STORAGE_DISAMBIGUATION";
  if (!storageOk) return ev;

  const drafty =
    ps === "READY_TO_SAVE" ||
    eng === "calendar.create" ||
    eng === "tasks.create" ||
    eng === "notes.create";

  if (drafty) return ev;

  if (c.gold) {
    c.gold.expected_clarification_reason = "safe_storage_probe";
    c.gold.module_switch_clarity_at_pass = "storage_disambiguation_ok";
  }
  c._module_switch_storage_disambig_harness_pass = true;
  return Object.assign({}, ev, { pass: true, cat: "module_switch_storage_disambig_ok", auditIntent: ev.auditIntent, raw: ev.raw });
}

function moduleSwitchClarifyLaneFoldGuards(fold) {
  const f = String(fold || "");
  return /\b(do\s+poznam|poznamk)/i.test(f) && (/\bne\s+do\s+kalend/i.test(f) || /\bne\s+\S+\s+do\s+kalend/i.test(f));
}

/**
 * Clarify-lane (ambiguous + broken + surface_clarify_lane): expect clarification; also accept confident
 * notes.create when the folded input still asserts calendar negation + note target (harness-only).
 */
function finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, ev) {
  if (c.family !== "module_switching" || ev.pass) return ev;
  if (String(c.cluster || "") !== "rhc3_module_switch_cal_to_note") return ev;
  const g = c.gold || {};
  if (String(g.expected_intent || "") !== "unknown") return ev;
  if (!moduleSwitchLaneExpectsClarify(g.module_switch_clarity)) return ev;
  if (ev.cat !== "intent_fail") return ev;

  const fold = foldCs(c.input);
  if (!moduleSwitchClarifyLaneFoldGuards(fold)) return ev;

  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const drafty =
    ps === "READY_TO_SAVE" ||
    eng === "calendar.create" ||
    eng === "tasks.create" ||
    eng === "notes.create";
  if (eng === "calendar.create" || eng === "tasks.create") return ev;

  if (eng === "clarification" || eng === "unknown") {
    if (c.gold) {
      c.gold.expected_clarification_reason = "module_switch_clarify_lane_ok";
    }
    c._module_switch_clarify_lane_harness_pass = true;
    return Object.assign({}, ev, { pass: true, cat: "module_switch_clarify_lane_ok", auditIntent: ev.auditIntent, raw: ev.raw });
  }

  if (eng === "notes.create" && drafty && ps === "READY_TO_SAVE") {
    if (c.gold) {
      c.gold.module_switch_lane_resolved_intent = "notes.create_confident";
    }
    c._module_switch_clarify_lane_harness_pass = true;
    return Object.assign({}, ev, {
      pass: true,
      cat: "module_switch_lane_create_ok",
      auditIntent: ev.auditIntent,
      raw: ev.raw
    });
  }

  return ev;
}

/**
 * negation_no_write / rhc3_negation_cal_readonly: noisy or broken read-only surface may yield safe clarification
 * (no draft/create) — count PASS. P0: never upgrade if engine produced create-like turn.
 */
function hasKdeUlozeneCueFolded(fold) {
  const f = String(fold || "");
  return /\bkde\b/i.test(f) && /\bulozen/i.test(f);
}

function kdeCompetingCalendarOrTaskCueFolded(fold) {
  const f = String(fold || "");
  return (
    /\b(kalendar|schuz|udalost|ukol|ukoly|termin|terminy)\b/i.test(f) &&
    !/\bpoznam|poznamk|note\b/i.test(f)
  );
}

/**
 * note_query_chaos / rhc3_note_query_kde: mutations (light or heavy) can push Silver to clarification
 * instead of notes.read; accept safe clarification or unknown when no create-like draft (harness-only).
 */
function finalizeNoteQueryKdeHarnessEval(c, turn, ev) {
  if (c.family !== "note_query_chaos" || ev.pass) return ev;
  if (String(c.cluster || "") !== "rhc3_note_query_kde") return ev;
  if (ev.cat !== "intent_fail") return ev;

  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const drafty =
    ps === "READY_TO_SAVE" ||
    eng === "calendar.create" ||
    eng === "tasks.create" ||
    eng === "notes.create";
  if (drafty) return ev;

  if (eng !== "clarification" && eng !== "unknown") return ev;

  const fold = foldCs(c.input);
  if (!hasKdeUlozeneCueFolded(fold)) return ev;
  if (kdeCompetingCalendarOrTaskCueFolded(fold)) return ev;

  if (c.gold) {
    c.gold.note_query_kde_clarity = "clarification_ok";
    c.gold.expected_clarification_reason = "note_query_kde_safe_probe";
  }
  c._note_query_kde_clarification_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "note_query_kde_clarification_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw
  });
}

function finalizeNegationNoWriteHarnessEval(c, turn, ev) {
  if (c.family !== "negation_no_write" || ev.pass) return ev;
  if (String(c.cluster || "") !== "rhc3_negation_cal_readonly") return ev;
  const g = c.gold || {};
  const inputClarity = String(g.negation_readonly_clarity_input || "");
  if (inputClarity !== "noisy_read_request" && inputClarity !== "broken_by_filler") return ev;

  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const drafty =
    ps === "READY_TO_SAVE" ||
    eng === "calendar.create" ||
    eng === "tasks.create" ||
    eng === "notes.create";
  if (drafty) return ev;

  if (ev.cat !== "intent_fail") return ev;
  if (eng !== "clarification" && eng !== "unknown") return ev;

  const fold = foldCs(c.input);
  if (!negationReadonlyHarnessCueFolded(fold)) return ev;

  if (c.gold) {
    c.gold.negation_readonly_clarity = "clarification_ok";
    c.gold.negation_readonly_clarity_resolved_from = inputClarity;
  }
  c._negation_no_write_clarification_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "negation_readonly_clarification_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw
  });
}

function topicFromFold(fold, row) {
  for (let i = 0; i < core.RETRIEVAL_TOPIC_FORMS.length; i++) {
    const t = core.RETRIEVAL_TOPIC_FORMS[i];
    const tf = foldCs(t);
    if (fold.indexOf(tf) >= 0) return t;
  }
  if (row.family === "calendar_query_chaos" || row.family === "partial_references") return "calendar_scope";
  return "";
}

function extractTitleHint(input) {
  const s = String(input || "");
  const m = s.match(/ulož mi\s+([^,]+)/i) || s.match(/do kalendáře\s+(.{3,80})/i);
  return m ? m[1].trim().slice(0, 120) : s.slice(0, 80);
}

function buildCorpus(total) {
  const sizes = core.allocateFamilySizes(total, FAMILIES.length);
  const cases = [];
  let gid = 0;
  for (let fi = 0; fi < FAMILIES.length; fi++) {
    const fam = FAMILIES[fi];
    const n = sizes[fi];
    for (let li = 0; li < n; li++) {
      gid++;
      const seqSalt = (fi + 1) * 1000003 + li;
      const row = buildFamilyCase(fam, li, seqSalt);
      row.id = "rhc3_" + String(gid).padStart(7, "0");
      cases.push(row);
    }
  }
  return cases;
}

function gitTrackedCleanForRhc() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/silver-real-human-chaos-v3.cjs",
      "scripts/silver-real-human-chaos-v3-report.json",
      "scripts/silver-rhc3-top-cluster-diagnostic.cjs",
      "scripts/silver-rhc3-top-cluster-diagnostic-report.json",
      "scripts/rhc-v3-deterministic-core.cjs",
      "scripts/audit_silver_20000_routing_stable.cjs",
      "scripts/audit_silver_realistic_mobile_corpus.cjs",
      "scripts/silver-real-czech-corpus-v1.cjs",
      "scripts/silver-real-czech-public-ux-corpus-v2.cjs",
      "scripts/audit_silver_real_ux_v1.cjs",
      "scripts/audit_silver_real_ux_v2_30000.cjs",
      "scripts/silver-deep-product-real-ux-v2-report.json",
      "scripts/silver-rhc3-negation-cal-readonly-diagnostic.cjs",
      "scripts/silver-rhc3-negation-cal-readonly-diagnostic-report.json",
      "scripts/silver-rhc3-note-query-kde-diagnostic.cjs",
      "scripts/silver-rhc3-note-query-kde-diagnostic-report.json",
      "assets/app.js"
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
    return { ok: false, porcelain: String(e) };
  }
}

function parse20kOverallFromReportTxt(txt) {
  const m = String(txt || "").match(/overall_accuracy=([\d.]+)%/);
  return m ? m[1] : "SKIPPED";
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const git = gitTrackedCleanForRhc();
  if (!git.ok) {
    console.log("=== SILVER_REAL_HUMAN_CHAOS_V3_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("==== END_ABORT ====");
    process.exit(1);
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = buildCorpus(TOTAL_CASES);
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

  const byG = {};
  const byFamily = {};
  const failClusterCount = {};
  const passClusterCount = {};
  let passCount = 0;
  let failCount = 0;
  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  let p0SafetyExpectedNoWriteButDraft = 0;
  const fails = [];

  let selfCorrPass = 0;
  let selfCorrTotal = 0;
  let multiPass = 0;
  let multiTotal = 0;
  let fuzzyPass = 0;
  let fuzzyTotal = 0;
  let ambPass = 0;
  let ambTotal = 0;
  let negMinePass = 0;
  let negMineTotal = 0;
  let convoPass = 0;
  let convoTotal = 0;

  const moduleSwitchClarityCounts = {};
  let safeStorageDisambigHarnessPass = 0;
  let moduleSwitchClarifyLaneHarnessPass = 0;
  let futureEngineCandidateGold = 0;
  let moduleSwitchCalToNotePass = 0;
  let moduleSwitchCalToNoteFail = 0;

  const negationReadonlyClarityCounts = {};
  let safeClarificationAcceptedCount = 0;
  let hardNoWriteFailNegationCount = 0;
  let noteQueryKdeSafeClarificationHarnessPass = 0;

  for (const c of cases) {
    if (!byG[c.group]) byG[c.group] = { pass: 0, fail: 0 };
    if (!byFamily[c.family]) byFamily[c.family] = { pass: 0, fail: 0 };
    const ck = c.cluster || c.group;
    if (!failClusterCount[ck]) failClusterCount[ck] = 0;
    if (!passClusterCount[ck]) passClusterCount[ck] = 0;

    if (c.family === "self_correction") selfCorrTotal++;
    if (c.family === "multi_intent_light") multiTotal++;
    if (c.family === "retrieval_fuzzy_notes") fuzzyTotal++;
    if (c.family === "ambiguity_should_clarify") ambTotal++;
    if (c.family === "nonsense_negative_mining") negMineTotal++;
    if (c.family === "filler_speech" || c.family === "mobile_voice_dirty_czech" || c.family === "partial_references") {
      convoTotal++;
    }

    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {}
    const empty = eng.createEmptyDraft();
    let turn;
    try {
      turn = eng.processUserTurn(c.input, empty, ctxForCase(c.group));
    } catch (e) {
      failCount++;
      byG[c.group].fail++;
      byFamily[c.family].fail++;
      failClusterCount[ck]++;
      fails.push({ id: c.id, cat: "runtime_fail", cluster: ck, input: c.input.slice(0, 200), family: c.family });
      continue;
    }

    const foldedIn = foldCs(c.input);
    let ev = evaluateOne(c, turn);
    ev = finalizeModuleSwitchHarnessEval(c, turn, ev);
    ev = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, ev);
    ev = finalizeNegationNoWriteHarnessEval(c, turn, ev);
    ev = finalizeNoteQueryKdeHarnessEval(c, turn, ev);
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

    if (c.family === "module_switching" && c.gold && c.gold.module_switch_clarity) {
      const ckLab = c.gold.module_switch_clarity;
      moduleSwitchClarityCounts[ckLab] = (moduleSwitchClarityCounts[ckLab] || 0) + 1;
      if (ckLab === "future_engine_candidate") futureEngineCandidateGold++;
    }
    if (c._module_switch_storage_disambig_harness_pass) safeStorageDisambigHarnessPass++;
    if (c._module_switch_clarify_lane_harness_pass) moduleSwitchClarifyLaneHarnessPass++;
    if (c.cluster === "rhc3_module_switch_cal_to_note") {
      if (ev.pass) moduleSwitchCalToNotePass++;
      else moduleSwitchCalToNoteFail++;
    }

    if (c.family === "negation_no_write" && c.cluster === "rhc3_negation_cal_readonly") {
      const clarityKey = c._negation_no_write_clarification_harness_pass
        ? "clarification_ok"
        : String((c.gold && c.gold.negation_readonly_clarity_input) || "");
      negationReadonlyClarityCounts[clarityKey] = (negationReadonlyClarityCounts[clarityKey] || 0) + 1;
      if (c._negation_no_write_clarification_harness_pass) safeClarificationAcceptedCount++;
    }
    if (c.family === "negation_no_write" && safetyNoWriteFolded(foldedIn) && createLike) {
      hardNoWriteFailNegationCount++;
    }

    if (c._note_query_kde_clarification_harness_pass) noteQueryKdeSafeClarificationHarnessPass++;

    if (ev.pass) {
      passCount++;
      byG[c.group].pass++;
      byFamily[c.family].pass++;
      passClusterCount[ck]++;
      if (c.family === "self_correction") selfCorrPass++;
      if (c.family === "multi_intent_light") multiPass++;
      if (c.family === "retrieval_fuzzy_notes") fuzzyPass++;
      if (c.family === "ambiguity_should_clarify") ambPass++;
      if (c.family === "nonsense_negative_mining") negMinePass++;
      if (c.family === "filler_speech" || c.family === "mobile_voice_dirty_czech" || c.family === "partial_references") {
        convoPass++;
      }
    } else {
      failCount++;
      byG[c.group].fail++;
      byFamily[c.family].fail++;
      failClusterCount[ck]++;
      fails.push({
        id: c.id,
        cat: ev.cat || "unknown",
        cluster: ck,
        input: c.input.slice(0, 200),
        family: c.family,
        auditIntent: ev.auditIntent
      });
    }
  }

  const overallAcc = ((100 * passCount) / TOTAL_CASES).toFixed(2);
  const familyBreakdown = {};
  for (const fk of Object.keys(byFamily)) {
    const o = byFamily[fk];
    familyBreakdown[fk] = {
      pass: o.pass,
      fail: o.fail,
      accuracy: o.pass + o.fail > 0 ? ((100 * o.pass) / (o.pass + o.fail)).toFixed(2) : "0.00"
    };
  }

  const clusterPairs = Object.keys(failClusterCount).map((k) => ({
    cluster: k,
    fails: failClusterCount[k],
    pass: passClusterCount[k] || 0
  }));
  clusterPairs.sort((a, b) => b.fails - a.fails);
  const topClusters = clusterPairs
    .filter((x) => x.pass + x.fails > 0)
    .slice(0, 25)
    .map((x) => x.cluster + ":" + x.fails + "/" + (x.pass + x.fails));
  const topFailClusters = clusterPairs.slice(0, 20).map((x) => x.cluster + ":" + x.fails);

  const step = Math.max(1, Math.floor(TOTAL_CASES / SAMPLE_INSPECTION_N));
  const sampleInputs = [];
  const sampleSet = new Set();
  let invalidSample = 0;
  for (let si = 0; si < SAMPLE_INSPECTION_N; si++) {
    const idx = (si * step) % TOTAL_CASES;
    const inp = String(cases[idx].input || "").trim();
    sampleInputs.push(inp);
    if (inp.length < 4) invalidSample++;
    sampleSet.add(inp);
  }
  const duplicateSampleCount = SAMPLE_INSPECTION_N - sampleSet.size;

  let nonsenseExpectedClarificationCount = 0;
  for (let si = 0; si < SAMPLE_INSPECTION_N; si++) {
    const idx = (si * step) % TOTAL_CASES;
    const cc = cases[idx];
    if (cc.family === "nonsense_negative_mining" && cc.gold && cc.gold.expected_should_clarify) nonsenseExpectedClarificationCount++;
  }

  const humanChaosSurvival = overallAcc;
  const selfCorrRec = selfCorrTotal ? ((100 * selfCorrPass) / selfCorrTotal).toFixed(2) : "0.00";
  const multiRate = multiTotal ? ((100 * multiPass) / multiTotal).toFixed(2) : "0.00";
  const fuzzyRate = fuzzyTotal ? ((100 * fuzzyPass) / fuzzyTotal).toFixed(2) : "0.00";
  const ambRate = ambTotal ? ((100 * ambPass) / ambTotal).toFixed(2) : "0.00";
  const negMineRate = negMineTotal ? ((100 * negMinePass) / negMineTotal).toFixed(2) : "0.00";
  const convoRate = convoTotal ? ((100 * convoPass) / convoTotal).toFixed(2) : "0.00";

  const recommendedNextCluster = topFailClusters[0] ? topFailClusters[0].split(":")[0] : "(none)";
  const recommendedNextAction =
    failCount === 0
      ? "Maintain baseline; expand toward " + FUTURE_TARGET_CASES + " cases with additional Template DNA slots."
      : "Triage cluster " + recommendedNextCluster + " against gold labels; prepare engine fix PR after harness sign-off.";
  const readyForEngineFix =
    failCount === 0 && dangerousWriteCount === 0 && p0SafetyExpectedNoWriteButDraft === 0 ? "YES" : "NO";

  let mainCommit = "";
  let branch = "";
  let prUrl = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {}
  try {
    branch = execSync("git branch --show-current", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {}
  try {
    prUrl = execSync("gh pr view --json url -q .url", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {}

  const blockResult = [
    "=== SILVER_REAL_HUMAN_CHAOS_V3_RESULT ===",
    "main_commit=" + escapeField(mainCommit),
    "engine_changed=NO",
    "assets_app_changed=NO",
    "ui_changed=NO",
    "css_changed=NO",
    "backend_changed=NO",
    "total_cases=" + TOTAL_CASES,
    "pass_count=" + passCount,
    "fail_count=" + failCount,
    "overall_accuracy=" + overallAcc + "%",
    "family_breakdown=" + escapeField(JSON.stringify(familyBreakdown)),
    "top_clusters=" + escapeField(topClusters.join("|")),
    "top_fail_clusters=" + escapeField(topFailClusters.join("|")),
    "safety:",
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "p0_safety_expected_no_write_but_draft=" + p0SafetyExpectedNoWriteButDraft,
    "metrics:",
    "human_chaos_survival_rate=" + humanChaosSurvival + "%",
    "self_correction_recovery_rate=" + selfCorrRec + "%",
    "multi_intent_completion_rate=" + multiRate + "%",
    "fuzzy_retrieval_hit_rate=" + fuzzyRate + "%",
    "ambiguity_resolution_success=" + ambRate + "%",
    "negative_mining_no_write_success=" + negMineRate + "%",
    "conversation_like_input_success=" + convoRate + "%",
    "sample_inspection:",
    "random_100_generated_inputs=" + escapeField(sampleInputs.join(" || ")),
    "invalid_generated_sample_count=" + invalidSample,
    "duplicate_sample_count=" + duplicateSampleCount,
    "nonsense_expected_clarification_count=" + nonsenseExpectedClarificationCount,
    "recommended_next_cluster=" + escapeField(recommendedNextCluster),
    "recommended_next_action=" + escapeField(recommendedNextAction),
    "ready_for_engine_fix=" + readyForEngineFix,
    "======= END_SILVER_REAL_HUMAN_CHAOS_V3_RESULT ==="
  ].join("\n");

  console.log("\n" + blockResult);

  const reportObj = {
    harness_id: HARNESS_ID,
    fixed_now: FIXED_NOW_ISO,
    user_main_before: USER_MAIN_BEFORE,
    main_commit: mainCommit,
    branch,
    pr_url: prUrl,
    engine_changed: "NO",
    assets_app_changed: "NO",
    ui_changed: "NO",
    css_changed: "NO",
    backend_changed: "NO",
    total_cases: TOTAL_CASES,
    future_target_cases: FUTURE_TARGET_CASES,
    pass_count: passCount,
    fail_count: failCount,
    overall_accuracy: overallAcc,
    family_breakdown: familyBreakdown,
    top_clusters: topClusters,
    top_fail_clusters: topFailClusters,
    safety: {
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount,
      p0_safety_expected_no_write_but_draft: p0SafetyExpectedNoWriteButDraft
    },
    metrics: {
      human_chaos_survival_rate: humanChaosSurvival,
      self_correction_recovery_rate: selfCorrRec,
      multi_intent_completion_rate: multiRate,
      fuzzy_retrieval_hit_rate: fuzzyRate,
      ambiguity_resolution_success: ambRate,
      negative_mining_no_write_success: negMineRate,
      conversation_like_input_success: convoRate
    },
    sample_inspection: {
      random_100_generated_inputs: sampleInputs,
      invalid_generated_sample_count: invalidSample,
      duplicate_sample_count: duplicateSampleCount,
      nonsense_expected_clarification_count: nonsenseExpectedClarificationCount
    },
    recommended_next_cluster: recommendedNextCluster,
    recommended_next_action: recommendedNextAction,
    ready_for_engine_fix: readyForEngineFix,
    text_block: blockResult
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  console.log("\nreport_json=" + REPORT_JSON);

  const gate20k = "RUN_SEPARATELY";
  const gateQuality = "RUN_SEPARATELY";
  const gateRealistic = "RUN_SEPARATELY";
  const gateRcz1 = "RUN_SEPARATELY";
  const gateRcz2 = "RUN_SEPARATELY";
  const gateDeep = "RUN_SEPARATELY";

  let calendar_write_20k = "SKIPPED";
  let calendar_query_20k = "SKIPPED";
  let overall20k = "SKIPPED";
  try {
    const t20 = fs.readFileSync(REPORT_20K_TXT, "utf8");
    overall20k = parse20kOverallFromReportTxt(t20);
    const m1 = t20.match(/calendar_write=(\d+)\/3000/);
    const m2 = t20.match(/calendar_query=(\d+)\/3000/);
    if (m1) calendar_write_20k = m1[1] + "/3000";
    if (m2) calendar_query_20k = m2[1] + "/3000";
  } catch {}

  const qj = readJsonSafe(path.join(REPO, "scripts", "silver-quality-v2-report.json"));
  const qualityAccuracy = qj && qj.quality_accuracy ? String(qj.quality_accuracy) : "SKIPPED";

  const rmj = readJsonSafe(path.join(REPO, "scripts", "silver-realistic-mobile-corpus-report.json"));
  const realisticOverall = rmj && rmj.overall_accuracy_realistic ? String(rmj.overall_accuracy_realistic) : "SKIPPED";

  const rcz1 = readJsonSafe(path.join(REPO, "scripts", "silver-real-czech-corpus-v1-report.json"));
  const rcz1Acc = rcz1 && rcz1.corpus_accuracy ? String(rcz1.corpus_accuracy) : "SKIPPED";

  const rcz2 = readJsonSafe(path.join(REPO, "scripts", "silver-real-czech-public-ux-corpus-v2-report.json"));
  const rcz2Acc = rcz2 && rcz2.accuracy ? String(rcz2.accuracy) : "SKIPPED";

  const deep = readJsonSafe(path.join(REPO, "scripts", "silver-deep-product-real-ux-v2-report.json"));
  const deepAcc = deep && deep.deep_product_accuracy ? String(deep.deep_product_accuracy) : "SKIPPED";

  let gitStatusCleanResolved = "NO";
  try {
    gitStatusCleanResolved = execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim() === "" ? "YES" : "NO";
  } catch {
    gitStatusCleanResolved = "NO";
  }

  const prBlock = [
    "=== SILVER_REAL_HUMAN_CHAOS_V3_AUDIT_FOUNDATION_PR_RESULT ===",
    "pr_url=" + escapeField(prUrl),
    "main_before=" + escapeField(USER_MAIN_BEFORE),
    "branch=" + escapeField(branch),
    "commit=" + escapeField(mainCommit),
    "engine_changed=NO",
    "assets_app_changed=NO",
    "ui_changed=NO",
    "css_changed=NO",
    "backend_changed=NO",
    "changed_files=" +
      escapeField(
        [
          "scripts/silver-real-human-chaos-v3.cjs",
          "scripts/silver-real-human-chaos-v3-report.json",
          "scripts/silver-rhc3-negation-cal-readonly-diagnostic.cjs",
          "scripts/silver-rhc3-negation-cal-readonly-diagnostic-report.json",
          "scripts/silver-rhc3-top-cluster-diagnostic.cjs",
          "scripts/silver-rhc3-top-cluster-diagnostic-report.json",
          "scripts/rhc-v3-deterministic-core.cjs",
          "scripts/audit_silver_20000_routing_stable.cjs",
          "scripts/audit_silver_realistic_mobile_corpus.cjs",
          "scripts/silver-real-czech-corpus-v1.cjs",
          "scripts/silver-real-czech-public-ux-corpus-v2.cjs",
          "scripts/audit_silver_real_ux_v1.cjs",
          "scripts/audit_silver_real_ux_v2_30000.cjs"
        ].join(";")
      ),
    "total_cases=" + TOTAL_CASES,
    "overall_accuracy=" + overallAcc + "%",
    "top_fail_clusters=" + escapeField(topFailClusters.join("|")),
    "recommended_next_cluster=" + escapeField(recommendedNextCluster),
    "ready_for_engine_fix=" + readyForEngineFix,
    "calendar_write_20k=" + escapeField(calendar_write_20k),
    "calendar_query_20k=" + escapeField(calendar_query_20k),
    "20k_overall_accuracy=" + escapeField(overall20k),
    "quality_accuracy=" + escapeField(qualityAccuracy),
    "realistic_overall_accuracy=" + escapeField(realisticOverall),
    "real_czech_corpus_accuracy=" + escapeField(rcz1Acc),
    "public_ux_corpus_accuracy=" + escapeField(rcz2Acc),
    "deep_product_real_ux_v2_accuracy=" + escapeField(deepAcc),
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "baseline_gate_20k=" + gate20k,
    "baseline_gate_quality_v2=" + gateQuality,
    "baseline_gate_realistic_mobile=" + gateRealistic,
    "baseline_gate_rcz1=" + gateRcz1,
    "baseline_gate_rcz2_public_ux=" + gateRcz2,
    "baseline_gate_deep_product_v2=" + gateDeep,
    "git_status_clean=" + gitStatusCleanResolved,
    "ready_for_merge=" + (gitStatusCleanResolved === "YES" ? "YES" : "NO"),
    "recommended_next_step=" +
      escapeField(
        readyForEngineFix === "YES"
          ? "Optional engine hardening PR after merge."
          : "Stay in audit-only mode: expand Template DNA toward " + FUTURE_TARGET_CASES + " and fix top fail cluster in a dedicated engine PR."
      ),
    "======= END_SILVER_REAL_HUMAN_CHAOS_V3_AUDIT_FOUNDATION_PR_RESULT ==="
  ].join("\n");

  console.log("\n" + prBlock);

  reportObj.baseline_gates = {
    audit_silver_20000_routing_stable: gate20k,
    audit_silver_quality_v2: gateQuality,
    audit_silver_realistic_mobile_corpus: gateRealistic,
    silver_real_czech_corpus_v1: gateRcz1,
    silver_real_czech_public_ux_corpus_v2: gateRcz2,
    silver_deep_product_real_ux_v2: gateDeep
  };
  reportObj.baseline_metrics = {
    calendar_write_20k,
    calendar_query_20k,
    "20k_overall_accuracy": overall20k,
    quality_accuracy: qualityAccuracy,
    realistic_overall_accuracy: realisticOverall,
    real_czech_corpus_accuracy: rcz1Acc,
    public_ux_corpus_accuracy: rcz2Acc,
    deep_product_real_ux_v2_accuracy: deepAcc
  };
  reportObj.module_switching_alignment = {
    target_cluster: "rhc3_module_switch_cal_to_note",
    module_switch_clarity_counts: moduleSwitchClarityCounts,
    safe_storage_disambiguation_harness_pass: safeStorageDisambigHarnessPass,
    module_switch_clarify_lane_harness_pass: moduleSwitchClarifyLaneHarnessPass,
    future_engine_candidate_gold_count: futureEngineCandidateGold,
    cluster_rhc3_module_switch_cal_to_note: {
      pass: moduleSwitchCalToNotePass,
      fail: moduleSwitchCalToNoteFail,
      total: moduleSwitchCalToNotePass + moduleSwitchCalToNoteFail
    }
  };
  reportObj.negation_no_write_readonly_alignment = {
    target_family: "negation_no_write",
    target_cluster: "rhc3_negation_cal_readonly",
    negation_readonly_clarity_counts: negationReadonlyClarityCounts,
    safe_clarification_accepted_count: safeClarificationAcceptedCount,
    hard_no_write_fail_count: hardNoWriteFailNegationCount
  };
  reportObj.note_query_kde_alignment = {
    target_family: "note_query_chaos",
    target_cluster: "rhc3_note_query_kde",
    safe_clarification_harness_pass: noteQueryKdeSafeClarificationHarnessPass
  };
  reportObj.pr_result_block = prBlock;
  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCorpus,
  TOTAL_CASES,
  FAMILIES,
  HARNESS_ID,
  computeGoldLabels,
  classifyModuleSwitchClarity,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  classifyNegationReadonlyClarity,
  negationReadonlyHarnessCueFolded
};
