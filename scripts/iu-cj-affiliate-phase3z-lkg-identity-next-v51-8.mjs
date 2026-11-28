/**
 * Next step for a hold or LKG identity.
 * Absence from a later offers snapshot is not publication and is not a reason to delete the last valid copy.
 * Does not arm growth, IMAP, or publication.
 */

export const LKG_IDENTITY_NEXT_SCHEMA = "iu-cj-lkg-identity-next-v51-8";

function text(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

export function planIdentityNext(row) {
  const key = text(row && row.key);
  const nextState = text(row && (row.nextState || row.primaryState)) || "UNKNOWN_WITH_REASON";
  const lkgReason = text(row && (row.lkgReason || row.stateReason));
  const lastValidSource = text(row && (row.lastValidSource || row.sourceUpdatedAt));
  const lastVerificationAt = text(row && (row.lastVerificationAt || row.lastVerifiedAt));
  const missing = [];
  if (!key) missing.push("key");
  if (nextState === "lkg") {
    if (!lkgReason) missing.push("lkgReason");
    if (!lastValidSource) missing.push("lastValidSource");
    if (!lastVerificationAt) missing.push("lastVerificationAt");
  }
  let nextStep = "ENTER_VERIFICATION_QUEUE";
  if (!key) nextStep = "INVALID_DATA";
  else if (nextState === "lkg") nextStep = "RETRY_SOURCE_READ_KEEP_LAST_VALID";
  else if (nextState === "pending_verification") nextStep = "ENTER_VERIFICATION_QUEUE";
  else if (nextState === "published") nextStep = "KEEP_PUBLISHED_PENDING_FRESHNESS";
  return {
    schema: LKG_IDENTITY_NEXT_SCHEMA,
    key,
    nextState,
    lkgReason,
    lastValidSource,
    lastVerificationAt,
    missing,
    nextStep,
    retry: nextStep === "RETRY_SOURCE_READ_KEEP_LAST_VALID" || nextStep === "ENTER_VERIFICATION_QUEUE",
    restoreOrSafeRemove: nextState === "lkg" ? "KEEP_UNTIL_SOURCE_SAYS_UNAVAILABLE" : "NOT_AN_LKG_ROW",
    absenceIsNotRecovery: row ? row.absenceIsNotRecovery !== false : true,
    publishedProof: false,
    publicationExecute: false,
    growthExecute: "DISARMED",
  };
}

export function planIdentityNextBatch(rows) {
  const list = Array.isArray(rows) ? rows.map(planIdentityNext) : [];
  const byStep = {};
  let missingEvidence = 0;
  for (const row of list) {
    byStep[row.nextStep] = (byStep[row.nextStep] || 0) + 1;
    if (row.missing.length) missingEvidence += 1;
  }
  return {
    schema: LKG_IDENTITY_NEXT_SCHEMA,
    count: list.length,
    byStep,
    missingEvidence,
    growthExecute: "DISARMED",
    publicationExecute: false,
    rows: list,
  };
}
