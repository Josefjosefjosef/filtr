export function classifyMissRow(row) {
  const decision = String(row.decision || "");
  const api = String(row.apiResult || "");
  let classId = "UNRESOLVED";
  if (decision === "RECOVERED") classId = "TEMPORARILY_UNAVAILABLE";
  else if (decision === "HOLD_COLLISION") classId = "IDENTITY_MISMATCH";
  else if (decision === "KEEP_PENDING") classId = "NOT_IN_CURRENT_FEED";
  else if (decision === "REMOVE_CONFIRMED") classId = "PRODUCT_DISCONTINUED";
  else if (/timeout/i.test(api)) classId = "SOURCE_TIMEOUT";
  else if (/http|5\d\d|429/i.test(api)) classId = "SOURCE_HTTP_ERROR";
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
    decision: row.decision,
    cause: currentCause,
    originalMissCause,
    classificationVerified: row.classificationVerified === true && classId !== "UNRESOLVED",
    rootCauseVerified,
    classId,
    apiResult: row.apiResult,
    consecutiveMisses: row.consecutiveMisses,
    publicationReady: row.publicationReady === true,
    publicationSafe: row.publicationSafe === true,
    lastSuccessfulRefreshAt: row.lastSuccessfulRefreshAt,
    lastRefreshAttemptAt: row.lastRefreshAttemptAt,
    lastConfirmedPrice: row.lastConfirmedPrice,
    lastConfirmedAvailability: row.lastConfirmedAvailability,
    nextSafeStep:
      decision === "RECOVERED"
        ? "KEEP_PUBLISHED_LKG_ALREADY_RECOVERED"
        : decision === "HOLD_COLLISION"
          ? "HOLD_NO_AUTOMATIC_REMOVE"
          : "RETRY_PRODUCTIDS_THEN_FULL_FEED_PAGE",
  };
}
