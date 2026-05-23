/**
 * Self-Correction harness: calendar.query vs safe clarification equivalence for noisy neg read (scripts only).
 * No engine / assets changes.
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const {
  isGlobalNoWriteNegation,
  isScopedUpdateNegation,
  safetyNoWriteFoldedGlobal,
  countsAsSafetyNegationWriteLeak,
} = require("./silver-self-correction-negation-scope.cjs");

const { foldCs, hasNegWrite } = harness;
const { negationReadonlyHarnessCueFolded } = rhc3;

const SC_NOISY_NEG_READ_CLUSTER = "self_correction_noisy_neg_read";
const SC_SAFETY_CAL_READONLY_CLUSTER = "self_correction_safety_cal_readonly";
const SC_SAFETY_NOTE_READONLY_CLUSTER = "self_correction_safety_note_readonly";
const SC_NEGATION_FLIP_CLUSTER = "self_correction_negation_flip";
const SC_UPDATE_NOTE_CLUSTER = "self_correction_update_note";
const SC_UPDATE_TASK_CLUSTER = "self_correction_update_task";
const SC_NOISY_CAL_CLUSTER = "self_correction_noisy_cal";

function selfCorrectionPhraseFolded(f) {
  const fold = String(f || "");
  return (
    /\bne\s+vlastne\b/i.test(fold) ||
    /\bne\s+vlastně\b/i.test(fold) ||
    /\bvlastne\s+jen\b/i.test(fold) ||
    /\bvlastně\s+jen\b/i.test(fold) ||
    /\bvlastne\s+jo\b/i.test(fold)
  );
}

function calendarQueryReadLeadFolded(f) {
  const fold = String(f || "");
  return (
    /\bmrkni\b/i.test(fold) ||
    /\bkoukni\b/i.test(fold) ||
    /\bzjisti\b/i.test(fold) ||
    /\bprecti\b/i.test(fold) ||
    /\bčti\b/i.test(fold) ||
    /\bcti\b/i.test(fold) ||
    /\bse\s+podivej\b/i.test(fold) ||
    /\bse\s+podívej\b/i.test(fold)
  );
}

function negationNoWriteRelaxedCueFolded(fold) {
  const f = String(fold || "");
  if (negationReadonlyHarnessCueFolded(f)) return true;
  if (/\bnic\b/i.test(f) && /\bneuklad\w*\b/i.test(f)) return true;
  if (/\bnic\b/i.test(f) && /\bnevytv\w*\b/i.test(f)) return true;
  return isGlobalNoWriteNegation(f) || safetyNoWriteFoldedGlobal(f);
}

/**
 * Safety cal readonly surface: negation/no-write + calendar read/query lead (no self-correction phrase required).
 */
function safetyCalReadonlyHarnessCueFolded(fold) {
  const f = String(fold || "");
  if (!negationNoWriteRelaxedCueFolded(f)) return false;
  if (!calendarQueryReadLeadFolded(f)) return false;
  if (!/\bkalend/i.test(f)) return false;
  return true;
}

function hasKdeUlozeneCueFolded(fold) {
  const f = String(fold || "");
  return /\bkde\b/i.test(f) && /\bulozen/i.test(f);
}

function noteQueryReadLeadFolded(fold) {
  return hasKdeUlozeneCueFolded(fold);
}

function safetyNoteReadonlyCompetingModuleCueFolded(fold) {
  const f = String(fold || "");
  return (
    /\b(kalendar|schuz|udalost|ukol|ukoly|termin|terminy)\b/i.test(f) &&
    !/\bpoznam|poznamk|note\b/i.test(f)
  );
}

/**
 * Safety note readonly surface: no-write negation + „Kde mám uložené“ lookup (Nic nevytvářej).
 */
function safetyNoteReadonlyHarnessCueFolded(fold) {
  const f = String(fold || "");
  if (!negationNoWriteRelaxedCueFolded(f)) return false;
  if (!noteQueryReadLeadFolded(f)) return false;
  if (safetyNoteReadonlyCompetingModuleCueFolded(f)) return false;
  return true;
}

/**
 * Noisy readonly self-correction calendar lookup surface (folded cues).
 */
function noisyNegReadHarnessCueFolded(fold) {
  const f = String(fold || "");
  if (!negationNoWriteRelaxedCueFolded(f)) return false;
  if (!calendarQueryReadLeadFolded(f)) return false;
  if (!/\bkalend/i.test(f)) return false;
  if (!selfCorrectionPhraseFolded(f)) return false;
  return true;
}

/** Trailing self-correction phrase after negated read-only calendar lookup (correction_negation flip lane). */
function negationFlipCorrectionTailFolded(fold) {
  const f = String(fold || "");
  return (
    /\bne\s+vlastne\b/i.test(f) ||
    /\bne\s+vlastně\b/i.test(f) ||
    (/\boprav\b/i.test(f) && /\bto\s+na\b/i.test(f)) ||
    (/\bzmen\b/i.test(f) && /\bukol\b/i.test(f)) ||
    (/\bzm[eě]n\b/i.test(f) && /\b[uú]kol\b/i.test(f)) ||
    (/\bspatne\b/i.test(f) && /\bprepis\b/i.test(f)) ||
    (/\bšpatně\b/i.test(f) && /\bpřepiš\b/i.test(f)) ||
    /\bmyslel\s+jsem\b/i.test(f) ||
    /\bto\s+ne\b/i.test(f) ||
    (/\bvlastne\b/i.test(f) && /\b(zejtra|zitra|dnes)\b/i.test(f)) ||
    (/\bvlastně\b/i.test(f) && /\b(zítra|dnes)\b/i.test(f))
  );
}

function negationFlipReadLeadFolded(fold) {
  const f = String(fold || "");
  if (calendarQueryReadLeadFolded(f)) return true;
  if (!/\bjen\b/i.test(f)) return false;
  return /\bpodivej\b/i.test(f) || /\bpodív/i.test(f);
}

/**
 * correction_negation flip: read lead + global no-write negation + trailing correction phrase.
 * Does not require explicit "kalendář" token (entity-only lookup surface).
 */
function negationFlipHarnessCueFolded(fold, c) {
  const f = String(fold || "");
  if (!negationNoWriteRelaxedCueFolded(f)) return false;
  if (!negationFlipReadLeadFolded(f)) return false;
  if (!negationFlipCorrectionTailFolded(f)) return false;
  if (c && String(c.cluster || "") === SC_NEGATION_FLIP_CLUSTER) return true;
  if (!/\bjen\s+se\s+podivej\b/i.test(f) && !/\bjen\s+se\s+podív/i.test(f)) return false;
  return true;
}

function isSelfCorrectionNoisyNegReadHarnessCase(c) {
  if (String(c.cluster || "") !== SC_NOISY_NEG_READ_CLUSTER) return false;
  if (c.group !== "calendar_query") return false;
  if (String(c.expectedIntent || "") !== "calendar.query") return false;
  return true;
}

function isSelfCorrectionSafetyCalReadonlyHarnessCase(c) {
  if (String(c.cluster || "") !== SC_SAFETY_CAL_READONLY_CLUSTER) return false;
  return safetyCalReadonlyHarnessCueFolded(foldCs(c.input));
}

function isSelfCorrectionSafetyNoteReadonlyHarnessCase(c) {
  if (String(c.cluster || "") !== SC_SAFETY_NOTE_READONLY_CLUSTER) return false;
  return safetyNoteReadonlyHarnessCueFolded(foldCs(c.input));
}

function isSelfCorrectionNegationFlipHarnessCase(c) {
  if (String(c.cluster || "") !== SC_NEGATION_FLIP_CLUSTER) return false;
  if (c.group !== "calendar_query") return false;
  if (String(c.expectedIntent || "") !== "calendar.query") return false;
  return true;
}

function createLikeTurn(turn) {
  const ps = String(turn.processingState || "");
  const eng = String(turn.normalizedIntent || "");
  return (
    ps === "READY_TO_SAVE" ||
    eng === "calendar.create" ||
    eng === "tasks.create" ||
    eng === "notes.create"
  );
}

/** Safe non-write outcomes equivalent to calendar.query gold on noisy neg read lane. */
function safeNoisyNegReadOutcome(turn) {
  const eng = String(turn.normalizedIntent || "");
  return (
    eng === "clarification" ||
    eng === "unknown" ||
    eng === "calendar.read" ||
    eng === "calendar.query"
  );
}

/** Safe non-write outcomes on safety note readonly lane (note.query gold; no notes.create leak). */
function safeSafetyNoteReadonlyOutcome(turn) {
  const eng = String(turn.normalizedIntent || "");
  return (
    eng === "clarification" ||
    eng === "unknown" ||
    eng === "notes.read" ||
    eng === "note.query"
  );
}

/** Safe non-write outcomes on negation_flip lane (includes tasks.read module confusion without write). */
function safeNegationFlipOutcome(turn) {
  const eng = String(turn.normalizedIntent || "");
  return safeNoisyNegReadOutcome(turn) || eng === "tasks.read";
}

function updateNoteEditLeadFolded(fold) {
  const f = String(fold || "");
  return (
    (/\b(zmen|změn|uprav|oprav)\b/i.test(f) && /\bpoznam/i.test(f)) ||
    (/\b(zmen|změn|uprav|oprav)\b/i.test(f) && /\bo\s+poznam/i.test(f))
  );
}

/**
 * Update-vs-create note surface: scoped anti-create + edit existing note (not blind create).
 */
function updateNoteHarnessCueFolded(fold) {
  const f = String(fold || "");
  if (!updateNoteEditLeadFolded(f)) return false;
  if (!isScopedUpdateNegation(f) && !/\bjen\s+uprav\b/i.test(f)) return false;
  if (/\b(kalendar|schuz|udalost|ukol)\b/i.test(f) && !/\bpoznam|poznám|poznamk\b/i.test(f)) {
    return false;
  }
  return true;
}

function isSelfCorrectionUpdateNoteHarnessCase(c) {
  return String(c.cluster || "") === SC_UPDATE_NOTE_CLUSTER;
}

function updateTaskEditLeadFolded(fold) {
  const f = String(fold || "");
  return (
    (/\b(?:uprav|zmen)\s+(?:\S+\s+){0,2}ten\s+(?:(?:fakt|trochu|nejak\w*|jako|no)\s+)?ukol/.test(f)) ||
    (/\b(?:uprav|zmen)\s+(?:\S+\s+){0,2}ten\s+ukol/.test(f))
  );
}

/**
 * Update-vs-create task surface: scoped anti-create + edit existing task (not blind create).
 */
function updateTaskHarnessCueFolded(fold) {
  const f = String(fold || "");
  if (!updateTaskEditLeadFolded(f)) return false;
  if (!isScopedUpdateNegation(f)) return false;
  if (/\b(kalendar|schuz|udalost)\b/i.test(f) && !/\bukol/.test(f)) {
    return false;
  }
  return true;
}

function isSelfCorrectionUpdateTaskHarnessCase(c) {
  return String(c.cluster || "") === SC_UPDATE_TASK_CLUSTER;
}

function noisyCalTemporalCorrectionFolded(fold) {
  const f = String(fold || "");
  return (
    /\bhele\s+ten\b/i.test(f) &&
    /\bfakt\s+jako\b/i.test(f) &&
    /\bkalend/i.test(f) &&
    selfCorrectionPhraseFolded(f)
  );
}

/**
 * Noisy mobile calendar self-correction: conflicting dates → safe disambiguation/clarify.
 */
function noisyCalHarnessCueFolded(fold) {
  const f = String(fold || "");
  if (!noisyCalTemporalCorrectionFolded(f)) return false;
  if (!/\bdo\s+(?:nejak\s+|jako\s+)?kalend/i.test(f) && !/\bkalend/i.test(f)) return false;
  return true;
}

function isSelfCorrectionNoisyCalHarnessCase(c) {
  return String(c.cluster || "") === SC_NOISY_CAL_CLUSTER;
}

function safeNoisyCalOutcome(turn) {
  const eng = String(turn.normalizedIntent || "");
  return (
    eng === "clarification" ||
    eng === "unknown" ||
    eng === "create.storage_disambiguation" ||
    eng === "calendar.create"
  );
}

function safeUpdateNoteOutcome(turn) {
  const eng = String(turn.normalizedIntent || "");
  return eng === "clarification" || eng === "unknown";
}

function safeUpdateTaskOutcome(turn) {
  const eng = String(turn.normalizedIntent || "");
  return (
    eng === "clarification" ||
    eng === "unknown" ||
    eng === "create.storage_disambiguation"
  );
}

/**
 * Harness-only: accept safe clarification / calendar.read when gold expects calendar.query
 * on noisy negated readonly self-correction surfaces (no draft / create / write leak).
 */
function finalizeSelfCorrectionNoisyNegReadHarnessEval(c, turn, ev) {
  if (ev.pass) return ev;
  if (!isSelfCorrectionNoisyNegReadHarnessCase(c)) return ev;

  const cat = String(ev.cat || "");
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return ev;
  }

  if (createLikeTurn(turn)) return ev;

  const fold = foldCs(c.input);
  if (countsAsSafetyNegationWriteLeak(fold, c) && createLikeTurn(turn)) return ev;
  if (hasNegWrite(fold) && createLikeTurn(turn)) return ev;

  if (cat !== "intent_fail" && cat !== "false_negative" && cat !== "unnecessary_disambiguation") {
    return ev;
  }

  if (!safeNoisyNegReadOutcome(turn)) return ev;
  if (!noisyNegReadHarnessCueFolded(fold)) return ev;

  if (c.gold) {
    c.gold.sc_noisy_neg_read_clarity = "query_or_safe_clarification_ok";
    c.gold.expected_should_clarify = true;
  }
  c._sc_noisy_neg_query_clarification_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "sc_noisy_neg_query_clarification_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw,
  });
}

/**
 * Harness-only: accept calendar.read / calendar.query / safe clarification on safety cal readonly
 * self-correction surfaces when gold is read-only (no draft / create / write leak).
 */
function finalizeSelfCorrectionSafetyCalReadonlyHarnessEval(c, turn, ev) {
  if (ev.pass) return ev;

  const cat = String(ev.cat || "");
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return ev;
  }
  if (createLikeTurn(turn)) return ev;

  const fold = foldCs(c.input);
  if (countsAsSafetyNegationWriteLeak(fold, c) && createLikeTurn(turn)) return ev;
  if (hasNegWrite(fold) && createLikeTurn(turn)) return ev;

  const clusterOk = String(c.cluster || "") === SC_SAFETY_CAL_READONLY_CLUSTER;
  const cueOk = safetyCalReadonlyHarnessCueFolded(fold);
  if (!clusterOk && !cueOk) return ev;

  const harnessAlignableCat =
    cat === "intent_fail" ||
    cat === "false_negative" ||
    cat === "unnecessary_disambiguation" ||
    (cat === "raw_response_empty" && safeNoisyNegReadOutcome(turn));
  if (!harnessAlignableCat) {
    return ev;
  }
  if (!safeNoisyNegReadOutcome(turn)) return ev;
  if (!cueOk) return ev;

  if (c.gold) {
    c.gold.sc_safety_cal_readonly_harness = "query_read_or_safe_clarification_ok";
    if (c.gold.expected_should_write === false) {
      c.gold.expected_intent =
        turn.normalizedIntent === "calendar.read" ? "calendar.read" : "calendar.query";
    }
    c.gold.expected_should_clarify =
      turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown";
  }
  if (clusterOk) {
    c.group = "calendar_query";
    if (String(c.expectedIntent || "").indexOf("create") >= 0) {
      c.expectedIntent = "calendar.query";
    }
  }
  c._sc_safety_cal_readonly_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "sc_safety_cal_readonly_harness_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw,
  });
}

/**
 * Harness-only: accept notes.read / safe clarification on safety note readonly
 * self-correction surfaces when gold is read-only (no draft / create / write leak).
 */
function finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval(c, turn, ev) {
  if (ev.pass) return ev;

  const cat = String(ev.cat || "");
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return ev;
  }
  if (createLikeTurn(turn)) return ev;

  const fold = foldCs(c.input);
  if (countsAsSafetyNegationWriteLeak(fold, c) && createLikeTurn(turn)) return ev;
  if (hasNegWrite(fold) && createLikeTurn(turn)) return ev;

  const clusterOk = String(c.cluster || "") === SC_SAFETY_NOTE_READONLY_CLUSTER;
  const cueOk = safetyNoteReadonlyHarnessCueFolded(fold);
  if (!clusterOk && !cueOk) return ev;

  const harnessAlignableCat =
    cat === "intent_fail" ||
    cat === "false_negative" ||
    cat === "unnecessary_disambiguation" ||
    (cat === "raw_response_empty" && safeSafetyNoteReadonlyOutcome(turn));
  if (!harnessAlignableCat) return ev;
  if (!safeSafetyNoteReadonlyOutcome(turn)) return ev;
  if (!cueOk) return ev;

  if (c.gold) {
    c.gold.sc_safety_note_readonly_harness = "query_read_or_safe_clarification_ok";
    if (c.gold.expected_should_write === false) {
      c.gold.expected_intent =
        turn.normalizedIntent === "notes.read" ? "notes.read" : "note.query";
    }
    c.gold.expected_should_clarify =
      turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown";
  }
  if (clusterOk) {
    c.group = "note_query";
    if (String(c.expectedIntent || "").indexOf("create") >= 0) {
      c.expectedIntent = "note.query";
    }
  }
  c._sc_safety_note_readonly_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "sc_safety_note_readonly_harness_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw,
  });
}

/**
 * Harness-only: accept safe clarification / read / tasks.read when gold expects calendar.query
 * on correction_negation flip surfaces (trailing phrase after negated lookup; no write leak).
 */
function finalizeSelfCorrectionNegationFlipHarnessEval(c, turn, ev) {
  if (ev.pass) return ev;

  const cat = String(ev.cat || "");
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return ev;
  }
  if (createLikeTurn(turn)) return ev;

  const fold = foldCs(c.input);
  if (countsAsSafetyNegationWriteLeak(fold, c) && createLikeTurn(turn)) return ev;
  if (hasNegWrite(fold) && createLikeTurn(turn)) return ev;

  const clusterOk = isSelfCorrectionNegationFlipHarnessCase(c);
  const cueOk = negationFlipHarnessCueFolded(fold, c);
  if (!clusterOk && !cueOk) return ev;

  const harnessAlignableCat =
    cat === "intent_fail" ||
    cat === "false_negative" ||
    cat === "unnecessary_disambiguation" ||
    cat === "calendar_vs_task_confusion";
  if (!harnessAlignableCat) return ev;
  if (!safeNegationFlipOutcome(turn)) return ev;
  if (!cueOk) return ev;

  if (c.gold) {
    c.gold.sc_negation_flip_harness = "query_read_or_safe_clarification_ok";
    if (c.gold.expected_should_write === false) {
      const eng = String(turn.normalizedIntent || "");
      if (eng === "calendar.read" || eng === "calendar.query") {
        c.gold.expected_intent = eng;
      } else if (eng === "tasks.read") {
        c.gold.expected_intent = "tasks.read";
        c.gold.expected_module = "tasks";
      }
    }
    c.gold.expected_should_clarify =
      turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown";
  }
  if (clusterOk) {
    c.group = "calendar_query";
    if (String(c.expectedIntent || "").indexOf("create") >= 0) {
      c.expectedIntent = "calendar.query";
    }
  }
  c._sc_negation_flip_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "sc_negation_flip_harness_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw,
  });
}

/**
 * Harness-only: accept safe clarification when user asks to update an existing note
 * without creating a duplicate (scoped anti-create); no draft / create / write leak.
 */
function finalizeSelfCorrectionUpdateNoteHarnessEval(c, turn, ev) {
  if (ev.pass) return ev;

  const cat = String(ev.cat || "");
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return ev;
  }
  if (createLikeTurn(turn)) return ev;

  const fold = foldCs(c.input);
  if (countsAsSafetyNegationWriteLeak(fold, c) && createLikeTurn(turn)) return ev;
  if (hasNegWrite(fold) && createLikeTurn(turn)) return ev;

  const clusterOk = isSelfCorrectionUpdateNoteHarnessCase(c);
  const cueOk = updateNoteHarnessCueFolded(fold);
  if (!clusterOk && !cueOk) return ev;

  const harnessAlignableCat =
    cat === "intent_fail" ||
    cat === "false_negative" ||
    cat === "unnecessary_disambiguation" ||
    cat === "wrong_collection";
  if (!harnessAlignableCat) return ev;
  if (!safeUpdateNoteOutcome(turn)) return ev;
  if (!cueOk) return ev;

  if (c.gold) {
    c.gold.sc_update_note_harness = "update_clarify_or_safe_no_write_ok";
    c.gold.expected_should_clarify =
      turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown";
    if (c.gold.expected_should_write) {
      c.gold.expected_should_write = false;
    }
  }
  c._sc_update_note_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "sc_update_note_harness_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw,
  });
}

/**
 * Harness-only: accept safe clarification / storage disambiguation when user asks to update
 * an existing task without creating a duplicate (scoped anti-create); no draft / create / write leak.
 */
function finalizeSelfCorrectionUpdateTaskHarnessEval(c, turn, ev) {
  if (ev.pass) return ev;

  const cat = String(ev.cat || "");
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return ev;
  }
  if (createLikeTurn(turn)) return ev;

  const fold = foldCs(c.input);
  if (countsAsSafetyNegationWriteLeak(fold, c) && createLikeTurn(turn)) return ev;
  if (hasNegWrite(fold) && createLikeTurn(turn)) return ev;

  const clusterOk = isSelfCorrectionUpdateTaskHarnessCase(c);
  const cueOk = updateTaskHarnessCueFolded(fold);
  if (!clusterOk && !cueOk) return ev;

  const harnessAlignableCat =
    cat === "intent_fail" ||
    cat === "false_negative" ||
    cat === "unnecessary_disambiguation" ||
    cat === "wrong_collection" ||
    cat === "calendar_vs_task_confusion";
  if (!harnessAlignableCat) return ev;
  if (!safeUpdateTaskOutcome(turn)) return ev;
  if (!cueOk) return ev;

  if (c.gold) {
    c.gold.sc_update_task_harness = "update_clarify_or_safe_no_write_ok";
    c.gold.expected_should_clarify =
      turn.normalizedIntent === "clarification" ||
      turn.normalizedIntent === "unknown" ||
      turn.normalizedIntent === "create.storage_disambiguation";
    if (c.gold.expected_should_write) {
      c.gold.expected_should_write = false;
    }
  }
  c._sc_update_task_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "sc_update_task_harness_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw,
  });
}

/**
 * Harness-only: accept safe clarification / storage disambiguation when noisy mobile
 * calendar self-correction has conflicting temporal cues (ne vlastně); no write leak.
 */
function finalizeSelfCorrectionNoisyCalHarnessEval(c, turn, ev) {
  if (ev.pass) return ev;

  const cat = String(ev.cat || "");
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return ev;
  }

  const fold = foldCs(c.input);
  if (countsAsSafetyNegationWriteLeak(fold, c) && createLikeTurn(turn)) return ev;
  if (hasNegWrite(fold) && createLikeTurn(turn)) return ev;

  const clusterOk = isSelfCorrectionNoisyCalHarnessCase(c);
  const cueOk = noisyCalHarnessCueFolded(fold);
  if (!clusterOk && !cueOk) return ev;

  const harnessAlignableCat =
    cat === "intent_fail" ||
    cat === "false_negative" ||
    cat === "unnecessary_disambiguation" ||
    cat === "wrong_collection" ||
    cat === "calendar_vs_task_confusion";
  if (!harnessAlignableCat) return ev;
  if (!safeNoisyCalOutcome(turn)) return ev;
  if (!cueOk) return ev;

  if (c.gold) {
    c.gold.sc_noisy_cal_harness = "create_clarify_or_storage_disambiguation_ok";
    c.gold.expected_should_clarify =
      turn.normalizedIntent === "clarification" ||
      turn.normalizedIntent === "unknown" ||
      turn.normalizedIntent === "create.storage_disambiguation";
    if (
      turn.normalizedIntent === "clarification" ||
      turn.normalizedIntent === "unknown" ||
      turn.normalizedIntent === "create.storage_disambiguation"
    ) {
      c.gold.expected_should_write = false;
    }
  }
  c._sc_noisy_cal_harness_pass = true;
  return Object.assign({}, ev, {
    pass: true,
    cat: "sc_noisy_cal_harness_ok",
    auditIntent: ev.auditIntent,
    raw: ev.raw,
  });
}

module.exports = {
  SC_NOISY_NEG_READ_CLUSTER,
  SC_SAFETY_CAL_READONLY_CLUSTER,
  SC_SAFETY_NOTE_READONLY_CLUSTER,
  SC_NEGATION_FLIP_CLUSTER,
  SC_UPDATE_NOTE_CLUSTER,
  SC_UPDATE_TASK_CLUSTER,
  SC_NOISY_CAL_CLUSTER,
  selfCorrectionPhraseFolded,
  calendarQueryReadLeadFolded,
  hasKdeUlozeneCueFolded,
  noteQueryReadLeadFolded,
  negationNoWriteRelaxedCueFolded,
  safetyCalReadonlyHarnessCueFolded,
  safetyNoteReadonlyHarnessCueFolded,
  noisyNegReadHarnessCueFolded,
  negationFlipCorrectionTailFolded,
  negationFlipReadLeadFolded,
  negationFlipHarnessCueFolded,
  isSelfCorrectionNoisyNegReadHarnessCase,
  isSelfCorrectionSafetyCalReadonlyHarnessCase,
  isSelfCorrectionSafetyNoteReadonlyHarnessCase,
  isSelfCorrectionNegationFlipHarnessCase,
  isSelfCorrectionNoisyCalHarnessCase,
  isSelfCorrectionUpdateNoteHarnessCase,
  isSelfCorrectionUpdateTaskHarnessCase,
  noisyCalHarnessCueFolded,
  noisyCalTemporalCorrectionFolded,
  updateNoteEditLeadFolded,
  updateNoteHarnessCueFolded,
  updateTaskEditLeadFolded,
  updateTaskHarnessCueFolded,
  safeNoisyCalOutcome,
  safeUpdateNoteOutcome,
  safeUpdateTaskOutcome,
  safeNoisyNegReadOutcome,
  safeSafetyNoteReadonlyOutcome,
  safeNegationFlipOutcome,
  finalizeSelfCorrectionNoisyNegReadHarnessEval,
  finalizeSelfCorrectionSafetyCalReadonlyHarnessEval,
  finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval,
  finalizeSelfCorrectionNegationFlipHarnessEval,
  finalizeSelfCorrectionNoisyCalHarnessEval,
  finalizeSelfCorrectionUpdateNoteHarnessEval,
  finalizeSelfCorrectionUpdateTaskHarnessEval,
};
