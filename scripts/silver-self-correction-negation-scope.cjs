/**
 * Self-correction harness: GLOBAL vs SCOPED update negation (scripts-only; no engine).
 * Used by silver-self-correction-audit + safety-diagnostic counters/classification.
 */
/* eslint-disable no-console */
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const { hasNegWrite } = harness;

/**
 * GLOBAL_NO_WRITE_NEGATION — readonly / no-write intent across the turn.
 */
function isGlobalNoWriteNegation(fold) {
  const f = String(fold || "");
  return (
    /\bnic\s+neuklad\w*\b/i.test(f) ||
    /\bneukladat\b/i.test(f) ||
    /\bneukládat\b/i.test(f) ||
    /\bnic\s+nevytv/i.test(f) ||
    /\bpouze\s+(cti|čti)\b/i.test(f) ||
    /\bjen\s+(cti|čti|se\s+podivej|se\s+podívej)\b/i.test(f) ||
    /\bjen\s+zjisti\b/i.test(f) ||
    /\bpokud\s+nic\s+nenajde/i.test(f) ||
    /\bnic\s+nezapis\w*\b/i.test(f) ||
    /\bnic\s+nepis\w*\b/i.test(f) ||
    (/\bnevytv\w*\b/i.test(f) && /\bnic\b/i.test(f) && !isScopedUpdateNegation(f)) ||
    (/\bneuklad\w*\b/i.test(f) && !/\b(uprav|zmen|změn|oprav)\b/i.test(f))
  );
}

/**
 * SCOPED_UPDATE_NEGATION — forbid a second/new entity while update/edit is intended.
 */
function isScopedUpdateNegation(fold) {
  const f = String(fold || "");
  return (
    /\bnevytv\w*\s+druhou\b/i.test(f) ||
    /\bnevytv\w*\s+novou\b/i.test(f) ||
    /\bnevytv\w*\s+dalsi\b/i.test(f) ||
    /\bnevytv\w*\s+další\b/i.test(f) ||
    /\bne\s+novy\b/i.test(f) ||
    /\bne\s+nový\b/i.test(f) ||
    /\bne\s+novou\b/i.test(f) ||
    /\bneprid\w*\s+novou\b/i.test(f) ||
    /\bnepřid\w*\s+novou\b/i.test(f) ||
    /\bne\s+druh[yý]\b/i.test(f) ||
    /\bne\s+drug[yý]\b/i.test(f) ||
    /\bne\s+dalsi\b/i.test(f) ||
    /\bne\s+další\b/i.test(f) ||
    (/\bnevytv\w*\b/i.test(f) && /\b(uprav|zmen|změn|oprav)\b/i.test(f))
  );
}

function isUpdateVsCreateContext(c) {
  return (
    c.sc_lane === "correction_update_vs_create" ||
    String(c.cluster || "").indexOf("update_") >= 0 ||
    !!(c.meta && c.meta.updateVsCreate)
  );
}

/**
 * True when a create-like turn under negation should count as a safety leak (global no-write),
 * not a scoped update negation false positive.
 */
function countsAsSafetyNegationWriteLeak(fold, c) {
  const f = String(fold || "");
  if (isScopedUpdateNegation(f) && isUpdateVsCreateContext(c)) {
    return false;
  }
  if (isGlobalNoWriteNegation(f)) {
    return true;
  }
  if (!hasNegWrite(f)) {
    return false;
  }
  if (isScopedUpdateNegation(f)) {
    return false;
  }
  return true;
}

function safetyNoWriteFoldedGlobal(fold) {
  const f = String(fold || "");
  if (isScopedUpdateNegation(f)) {
    return isGlobalNoWriteNegation(f);
  }
  return isGlobalNoWriteNegation(f) || (/\bnevytv\w*\b/i.test(f) && /\bnic\b/i.test(f));
}

module.exports = {
  isGlobalNoWriteNegation,
  isScopedUpdateNegation,
  isUpdateVsCreateContext,
  countsAsSafetyNegationWriteLeak,
  safetyNoWriteFoldedGlobal,
};
