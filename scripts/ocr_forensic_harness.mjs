#!/usr/bin/env node
/**
 * OCR forensic proof harness — Phase 7.3M.
 * Fixture validity gate, contradiction guard, deterministic truth table, verdict assembler.
 * Single source of truth so invalid fixture or contradictory verdict never produce false RCA.
 */

export const ALLOWED_VERDICT_CLASSES = Object.freeze([
  "INVALID_TEST_FIXTURE",
  "INVALID_FORENSIC_VERDICT",
  "REAL_PROD_PIPELINE_FAILURE",
  "SUCCESS_VALID_CORPUS",
  "COMBINED_EXACT",
]);

export const PIPELINE_STEPS = Object.freeze([
  "CREATE_WORKER",
  "LOAD_LANGUAGE",
  "INITIALIZE",
  "RECOGNIZE",
  "PARSE",
  "UI_RENDER",
]);

const MIN_FIXTURE_BYTES = 500;
const MIN_DIMENSION = 2;

/**
 * Fixture validity gate. If fixtureValidForParserExpectation=false, proof must not claim real pipeline fail.
 * @param {object} fixture - { fixtureProvided, fixtureFileName, fixtureMime, fixtureBytes, fixtureLooksBlank?, fixtureContainsReadableTextLikely?, fixtureContainsDigitsLikely? }
 * @returns {{ valid: boolean, status: string, finalRootCauseClass: string, fixtureValidForParserExpectation: boolean, prodProofPass: boolean, codeFixNeeded: boolean }}
 */
export function fixtureValidityGate(fixture) {
  const f = fixture || {};
  const provided = !!f.fixtureProvided;
  const bytes = Number(f.fixtureBytes) || 0;
  const looksBlank = f.fixtureLooksBlank === true;
  const readableLikely = f.fixtureContainsReadableTextLikely === true;
  const digitsLikely = f.fixtureContainsDigitsLikely === true;
  const validForParser = provided && bytes >= MIN_FIXTURE_BYTES && !looksBlank && (readableLikely || digitsLikely);

  if (!provided || bytes < MIN_FIXTURE_BYTES || looksBlank) {
    return {
      valid: false,
      status: "INVALID_FIXTURE",
      finalRootCauseClass: "INVALID_TEST_FIXTURE",
      fixtureValidForParserExpectation: false,
      prodProofPass: false,
      codeFixNeeded: false,
    };
  }
  if (!validForParser) {
    return {
      valid: false,
      status: "INVALID_FIXTURE",
      finalRootCauseClass: "INVALID_TEST_FIXTURE",
      fixtureValidForParserExpectation: false,
      prodProofPass: false,
      codeFixNeeded: false,
    };
  }
  return {
    valid: true,
    status: "FIXTURE_VALID",
    finalRootCauseClass: null,
    fixtureValidForParserExpectation: true,
    prodProofPass: null,
    codeFixNeeded: null,
  };
}

/**
 * Build deterministic truth table from __iuEvidenceDebug-like object.
 * @param {object} debug - window.__iuEvidenceDebug
 * @returns {object} truth table per step: reached, passed, resolved, rejected, directlyObserved, derivedOnly
 */
export function buildTruthTableFromDebug(debug) {
  const d = debug || {};
  const createWorkerReached = !!(d.workerPath && String(d.workerPath).trim());
  const createWorkerPassed = !!d.workerLoaded;
  const loadLanguagePassed = !!d.workerInitializeSucceeded;
  const recognizePassed = !!d.recognizeSucceeded;
  const parsePassed = d.ocrFinalState === "success";
  const uiRenderPassed = !!d.resultPropagatedToUi;

  return {
    CREATE_WORKER: { reached: createWorkerReached, passed: createWorkerPassed, resolved: createWorkerPassed, rejected: false, directlyObserved: createWorkerPassed, derivedOnly: false },
    LOAD_LANGUAGE: { reached: createWorkerPassed, passed: loadLanguagePassed, resolved: loadLanguagePassed, rejected: !loadLanguagePassed && createWorkerPassed, directlyObserved: loadLanguagePassed, derivedOnly: false },
    INITIALIZE: { reached: createWorkerPassed, passed: loadLanguagePassed, resolved: loadLanguagePassed, rejected: !loadLanguagePassed && createWorkerPassed, directlyObserved: loadLanguagePassed, derivedOnly: false },
    RECOGNIZE: { reached: !!d.recognizeCalled, passed: recognizePassed, resolved: recognizePassed, rejected: !recognizePassed && !!d.recognizeCalled, directlyObserved: recognizePassed, derivedOnly: false },
    PARSE: { reached: !!d.ocrRunCompleted, passed: parsePassed, resolved: parsePassed, rejected: !parsePassed && !!d.ocrRunCompleted, directlyObserved: parsePassed, derivedOnly: false },
    UI_RENDER: { reached: !!d.resultPropagatedToUi, passed: uiRenderPassed, resolved: uiRenderPassed, rejected: false, directlyObserved: uiRenderPassed, derivedOnly: false },
  };
}

/**
 * Contradiction guard. If all steps passed=true, firstFailingPipelineStep must be null and finalRootCauseClass must not be pipeline failure.
 * If claimedFirstFailing is set while truth table has all passed, that is a contradiction (e.g. 7.3K bug).
 * @param {object} truthTable - from buildTruthTableFromDebug
 * @param {{ claimedFirstFailing?: string|null }} opts - optional claimed first failing step from buggy harness
 * @returns {{ consistent: boolean, status: string, firstFailingPipelineStep: string|null, finalRootCauseClass: string|null, codeFixNeeded: boolean, fixTarget: string|null }}
 */
export function contradictionGuard(truthTable, opts = {}) {
  const steps = PIPELINE_STEPS;
  const allPassed = steps.every((s) => truthTable[s] && truthTable[s].passed === true);
  let firstFailing = null;
  for (const s of steps) {
    const row = truthTable[s];
    if (row && row.reached && !row.passed) {
      firstFailing = s;
      break;
    }
  }
  const claimed = opts.claimedFirstFailing != null && opts.claimedFirstFailing !== "" ? String(opts.claimedFirstFailing) : null;

  if (allPassed && claimed) {
    return { consistent: false, status: "HARNESS_CONTRADICTION", firstFailingPipelineStep: null, finalRootCauseClass: "INVALID_FORENSIC_VERDICT", codeFixNeeded: true, fixTarget: "HARNESS" };
  }
  if (allPassed && firstFailing !== null) {
    return { consistent: false, status: "HARNESS_CONTRADICTION", firstFailingPipelineStep: null, finalRootCauseClass: "INVALID_FORENSIC_VERDICT", codeFixNeeded: true, fixTarget: "HARNESS" };
  }
  if (allPassed) {
    return { consistent: true, status: "TRUTH_TABLE_CONSISTENT", firstFailingPipelineStep: null, finalRootCauseClass: null, codeFixNeeded: false, fixTarget: null };
  }
  return { consistent: true, status: "TRUTH_TABLE_CONSISTENT", firstFailingPipelineStep: firstFailing, finalRootCauseClass: null, codeFixNeeded: null, fixTarget: null };
}

/**
 * Valid corpus guard. Only when validCorpusUsed && corpusHasReadableText && corpusHasDigits may parser/UI metrics be used for RCA.
 */
export function validCorpusGuard(validCorpusUsed, corpusHasReadableText, corpusHasDigits) {
  return !!(validCorpusUsed === true && corpusHasReadableText === true && corpusHasDigits === true);
}

/**
 * Verdict assembler. Allowed classes only. No pipeline failure class when fixture invalid or truth table all-passed.
 * @param {object} opts - { truthTable, fixtureValid, validCorpusUsed, corpusHasReadableText, corpusHasDigits, metrics }
 * @returns {{ finalRootCauseClass: string, firstFailingPipelineStep: string|null, prodProofPass: boolean, status: string, truthTableConsistent: boolean }}
 */
export function verdictAssembler(opts) {
  const { truthTable, validCorpusUsed, corpusHasReadableText, corpusHasDigits, metrics = {}, fixture: fixtureInput, claimedFirstFailing } = opts || {};
  const contra = contradictionGuard(truthTable || {}, { claimedFirstFailing });
  const fixtureResult = fixtureValidityGate(fixtureInput || {});

  if (!fixtureResult.valid && fixtureResult.status === "INVALID_FIXTURE") {
    return {
      finalRootCauseClass: "INVALID_TEST_FIXTURE",
      firstFailingPipelineStep: null,
      prodProofPass: false,
      status: "INVALID_FIXTURE",
      truthTableConsistent: contra.consistent,
      codeFixNeeded: false,
    };
  }

  if (!contra.consistent) {
    return {
      finalRootCauseClass: "INVALID_FORENSIC_VERDICT",
      firstFailingPipelineStep: null,
      prodProofPass: false,
      status: "HARNESS_CONTRADICTION",
      truthTableConsistent: false,
      codeFixNeeded: true,
      fixTarget: "HARNESS",
    };
  }

  const corpusOk = validCorpusGuard(validCorpusUsed, corpusHasReadableText, corpusHasDigits);
  if (contra.consistent && contra.firstFailingPipelineStep === null && corpusOk) {
    const workerInitOk = (metrics.workerInitSucceededCount || 0) >= 1;
    const parserOk = (metrics.documentsWithParserItems || 0) >= 1;
    const pass = workerInitOk && parserOk;
    return {
      finalRootCauseClass: "SUCCESS_VALID_CORPUS",
      firstFailingPipelineStep: null,
      prodProofPass: pass,
      status: "SUCCESS_VALID_CORPUS",
      truthTableConsistent: true,
      codeFixNeeded: false,
    };
  }

  if (contra.firstFailingPipelineStep && fixtureResult.valid) {
    return {
      finalRootCauseClass: "REAL_PROD_PIPELINE_FAILURE",
      firstFailingPipelineStep: contra.firstFailingPipelineStep,
      prodProofPass: false,
      status: "REAL_PROD_PIPELINE_FAILURE",
      truthTableConsistent: true,
      codeFixNeeded: true,
      fixTarget: contra.firstFailingPipelineStep,
    };
  }

  if (!corpusOk && contra.consistent) {
    return {
      finalRootCauseClass: "INVALID_TEST_FIXTURE",
      firstFailingPipelineStep: null,
      prodProofPass: false,
      status: "INVALID_FIXTURE",
      truthTableConsistent: true,
      codeFixNeeded: false,
    };
  }

  return {
    finalRootCauseClass: "INVALID_FORENSIC_VERDICT",
    firstFailingPipelineStep: null,
    prodProofPass: false,
    status: "UNKNOWN",
    truthTableConsistent: contra.consistent,
    codeFixNeeded: true,
    fixTarget: "HARNESS",
  };
}

/**
 * One-shot: run fixture gate + truth table + contradiction guard + verdict from debug + fixture + metrics.
 */
export function runHarness(debug, fixture, metrics, validCorpusUsed, corpusHasReadableText, corpusHasDigits) {
  const gate = fixtureValidityGate(fixture);
  if (!gate.valid) {
    return { status: "INVALID_FIXTURE", finalRootCauseClass: "INVALID_TEST_FIXTURE", prodProofPass: false, truthTableConsistent: null, ...gate };
  }
  const truthTable = buildTruthTableFromDebug(debug);
  const contra = contradictionGuard(truthTable);
  if (!contra.consistent) {
    return { status: "HARNESS_CONTRADICTION", finalRootCauseClass: "INVALID_FORENSIC_VERDICT", prodProofPass: false, truthTableConsistent: false, codeFixNeeded: true, fixTarget: "HARNESS" };
  }
  const verdict = verdictAssembler({
    truthTable,
    validCorpusUsed,
    corpusHasReadableText,
    corpusHasDigits,
    metrics,
    fixture,
  });
  return { ...verdict, truthTable };
}
