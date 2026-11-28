/**
 * Pure miss-row classification. A missing verification flag is not verified.
 */
export function classifyMissRow(row) {
  const decision = String(row.decision || "");
  const api = String(row.apiResult || "");
  let classId = "UNRESOLVED";
  if (decision === "RECOVERED") classId = "TEMPORARILY_UNAVAILABLE";
  else if (decision === "HOLD_COLLISION") classId = "IDENTITY_MISMATCH";
  else if (decision === "KEEP_PENDING" && /miss/i.test(api)) classId = "NOT_IN_CURRENT_FEED";
  else if (decision === "REMOVE_CONFIRMED") classId = "PRODUCT_DISCONTINUED";
  else if (/timeout/i.test(api)) classId = "SOURCE_TIMEOUT";
  else if (/http|5\d\d|429/i.test(api)) classId = "SOURCE_HTTP_ERROR";
  // Never treat a missing classificationVerified flag as verified.
  const currentCause =
    decision === "RECOVERED" && (!row.cause || row.cause === "CAUSE_NOT_YET_VERIFIED")
      ? "PRODUCT_TEMPORARILY_UNAVAILABLE"
      : row.cause || "CAUSE_NOT_YET_VERIFIED";
  const originalMissCause =
    row.originalMissCause ||
    (decision === "RECOVERED" ? "CAUSE_NOT_YET_VERIFIED" : currentCause);
  const rootCauseVerified =
    row.rootCauseVerified === true ||
    (decision === "HOLD_COLLISION" && currentCause === "IDENTITY_OR_MAPPING_ERROR");
  return {
    compoundIdentity: row.sourceIdentity,
    advertiserId: row.advertiserId,
    productId: row.productId,
    partnerName: row.partnerName,
    title: row.title,
    sectionKey: row.sectionKey,
    lastConfirmedPrice: row.lastConfirmedPrice,
    lastConfirmedAvailability: row.lastConfirmedAvailability,
    lastSuccessfulRefreshAt: row.lastSuccessfulRefreshAt,
    lastRefreshAttemptAt: row.lastRefreshAttemptAt,
    consecutiveMisses: row.consecutiveMisses,
    apiResult: row.apiResult,
    decision: row.decision,
    cause: currentCause,
    originalMissCause,
    originalMissCauseVerified: row.originalMissCauseVerified === true || rootCauseVerified,
    classificationVerified: row.classificationVerified === true && classId !== "UNRESOLVED",
    rootCauseVerified,
    publicationSafe: row.publicationSafe,
    classId,
    nextSafeStep:
      classId === "TEMPORARILY_UNAVAILABLE"
        ? "KEEP_PUBLISHED_LKG_ALREADY_RECOVERED"
        : classId === "IDENTITY_MISMATCH"
          ? "HOLD_NO_AUTOMATIC_REMOVE"
          : classId === "NOT_IN_CURRENT_FEED"
            ? "RETRY_PRODUCTIDS_THEN_FULL_FEED_PAGE"
            : "INVESTIGATE",
  };
}
