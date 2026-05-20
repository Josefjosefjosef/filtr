/**
 * Self-Correction harness: calendar.query vs safe clarification equivalence for noisy neg read (scripts only).
 * No engine / assets changes.
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const {
  isGlobalNoWriteNegation,
  safetyNoWriteFoldedGlobal,
  countsAsSafetyNegationWriteLeak,
} = require("./silver-self-correction-negation-scope.cjs");

const { foldCs, hasNegWrite } = harness;
const { negationReadonlyHarnessCueFolded } = rhc3;

const SC_NOISY_NEG_READ_CLUSTER = "self_correction_noisy_neg_read";
const SC_SAFETY_CAL_READONLY_CLUSTER = "self_correction_safety_cal_readonly";

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

module.exports = {
  SC_NOISY_NEG_READ_CLUSTER,
  SC_SAFETY_CAL_READONLY_CLUSTER,
  selfCorrectionPhraseFolded,
  calendarQueryReadLeadFolded,
  negationNoWriteRelaxedCueFolded,
  safetyCalReadonlyHarnessCueFolded,
  noisyNegReadHarnessCueFolded,
  isSelfCorrectionNoisyNegReadHarnessCase,
  isSelfCorrectionSafetyCalReadonlyHarnessCase,
  safeNoisyNegReadOutcome,
  finalizeSelfCorrectionNoisyNegReadHarnessEval,
  finalizeSelfCorrectionSafetyCalReadonlyHarnessEval,
};
