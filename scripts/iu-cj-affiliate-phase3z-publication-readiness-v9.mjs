/**
 * Phase 3Z V9 — separate technical readiness from publication readiness.
 * TECHNICALLY_READY (READY_FOR_REVIEW) ≠ PUBLICATION_READY.
 * PUBLICATION_READY requires CONTENT_VERIFIED + DESTINATION_VERIFIED + REGION_VERIFIED + PROGRAM_AUTHORIZED.
 * Never renames or softens CONTENT_VERIFIED to inflate publication counts.
 */
export const CONTENT_STATUS = Object.freeze({
  CONTENT_VERIFIED: "CONTENT_VERIFIED",
  IDENTITY_VERIFIED: "IDENTITY_VERIFIED",
  CONTENT_INCOMPLETE: "CONTENT_INCOMPLETE",
  CONTENT_UNAVAILABLE: "CONTENT_UNAVAILABLE",
  REGION_UNVERIFIED: "REGION_UNVERIFIED",
  BLOCKED: "BLOCKED",
  NOT_VERIFIED: "NOT_VERIFIED",
});

export const PUBLICATION_GATE = Object.freeze({
  TECHNICALLY_READY: "TECHNICALLY_READY",
  CONTENT_VERIFIED: "CONTENT_VERIFIED",
  REGION_VERIFIED: "REGION_VERIFIED",
  DESTINATION_VERIFIED: "DESTINATION_VERIFIED",
  PROGRAM_AUTHORIZED: "PROGRAM_AUTHORIZED",
  PUBLICATION_READY: "PUBLICATION_READY",
});

const UNSUITABLE_DEST = new Set([
  "CHECKOUT",
  "CART",
  "AFFILIATE_SIGNUP",
  "NEWSLETTER",
  "LOGIN",
  "REGISTRATION",
  "EXTERNAL_TRACKER",
  "ERROR_PAGE",
  "UNRELATED_DESTINATION",
]);

/**
 * Build per-partner publication gates from registry + content review row.
 */
export function evaluatePublicationReadiness(partner, contentRow = null) {
  const pub = String(partner?.publishability || "");
  const hold = String(partner?.holdReason || "");
  const destType = String(partner?.destinationType || partner?.destinationRole || "");
  const contentStatus = String(
    contentRow?.reviewStatus || partner?.contentStatus || CONTENT_STATUS.NOT_VERIFIED
  );

  const technicallyReady = pub === "READY_FOR_REVIEW";
  const contentVerified = contentStatus === CONTENT_STATUS.CONTENT_VERIFIED;
  const regionVerified =
    partner?.czMarketEligibilityVerified === true ||
    partner?.triple?.visitor?.status === "CZ_AFFINITY" ||
    contentRow?.czAvailability === "YES";
  const destinationVerified =
    Boolean(partner?.selectedClickUrl) &&
    partner?.unsuitableMainDestination !== true &&
    !UNSUITABLE_DEST.has(destType) &&
    hold !== "UNSUITABLE_MAIN_DESTINATION";
  const programAuthorized =
    String(partner?.relationshipStatus || "").toLowerCase() === "joined" &&
    Boolean(partner?.selectedClickUrl) &&
    hold !== "LINK_MISSING";

  const publicationReady =
    technicallyReady &&
    contentVerified &&
    regionVerified &&
    destinationVerified &&
    programAuthorized &&
    pub !== "QUARANTINED";

  const blockers = [];
  if (!technicallyReady) blockers.push("not_technically_ready:" + (hold || pub || "unknown"));
  if (!contentVerified) blockers.push("content_not_verified:" + contentStatus);
  if (!regionVerified) blockers.push("region_not_verified");
  if (!destinationVerified) blockers.push("destination_not_verified:" + (destType || hold || "missing"));
  if (!programAuthorized) blockers.push("program_not_authorized");

  return {
    technicallyReady,
    contentVerified,
    regionVerified,
    destinationVerified,
    programAuthorized,
    publicationReady,
    contentStatus,
    gates: {
      [PUBLICATION_GATE.TECHNICALLY_READY]: technicallyReady,
      [PUBLICATION_GATE.CONTENT_VERIFIED]: contentVerified,
      [PUBLICATION_GATE.REGION_VERIFIED]: regionVerified,
      [PUBLICATION_GATE.DESTINATION_VERIFIED]: destinationVerified,
      [PUBLICATION_GATE.PROGRAM_AUTHORIZED]: programAuthorized,
      [PUBLICATION_GATE.PUBLICATION_READY]: publicationReady,
    },
    blockers,
    note: publicationReady
      ? "All publication gates passed; public swap still DISARMED until explicit GO."
      : "Publication blocked until all gates pass; technical READY alone is insufficient.",
  };
}

/**
 * Attach publication readiness to registry partners using optional content review map.
 */
export function attachPublicationReadiness(registry, contentReview = null) {
  const byCid = new Map(
    (contentReview?.partners || []).map((p) => [String(p.advertiserCid || p.advertiserId), p])
  );
  let technicallyReady = 0;
  let publicationReady = 0;
  let contentVerified = 0;
  for (const p of registry?.partners || []) {
    const row = byCid.get(String(p.advertiserId));
    const evald = evaluatePublicationReadiness(p, row);
    p.contentStatus = evald.contentStatus;
    p.publicationReadiness = evald;
    p.publicationReady = evald.publicationReady;
    p.technicallyReady = evald.technicallyReady;
    if (evald.technicallyReady) technicallyReady += 1;
    if (evald.publicationReady) publicationReady += 1;
    if (evald.contentVerified) contentVerified += 1;
  }
  registry.publicationSummary = {
    joined: (registry?.partners || []).filter(
      (p) => String(p.relationshipStatus || "").toLowerCase() === "joined"
    ).length,
    technicallyReady,
    publicationReady,
    contentVerifiedOnPartners: contentVerified,
    allPublicationReadyContentVerified:
      publicationReady === 0
        ? true
        : (registry?.partners || [])
            .filter((p) => p.publicationReady === true)
            .every((p) => p.publicationReadiness?.contentVerified === true),
    publicButtonSwapArmed: false,
    note: "TECHNICALLY_READY (READY_FOR_REVIEW) is separate from PUBLICATION_READY. Swap DISARMED.",
  };
  return registry.publicationSummary;
}

/**
 * Diagnose why content verification failed (structured reason codes).
 */
export function diagnoseContentFailure({ probe = null, evidence = null, reviewStatus = null } = {}) {
  if (reviewStatus === "CONTENT_VERIFIED") return [];
  const reasons = [];
  const http = probe?.httpStatus;
  const err = String(probe?.error || "").toLowerCase();
  const htmlHints = evidence?.diagnostics || {};
  if (http === 403) reasons.push("HTTP_403_WAF_OR_BOT");
  if (http === 429) reasons.push("HTTP_429_RATE_LIMIT");
  if (http === 502 || http === 503 || http === 504) reasons.push("HTTP_5XX_TEMPORARY");
  if (err.includes("timeout")) reasons.push("PROBE_TIMEOUT");
  if (err.includes("http_403") || err.includes("403")) reasons.push("HTTP_403_WAF_OR_BOT");
  if (err.includes("http_429") || err.includes("429")) reasons.push("HTTP_429_RATE_LIMIT");
  if (err && !reasons.length) reasons.push("PROBE_ERROR");
  if (htmlHints.spaSuspected) reasons.push("SPA_JS_RENDERED_MINIMAL_HTML");
  if (htmlHints.thinHtml) reasons.push("THIN_HTML_INSUFFICIENT_NAV_MAIN");
  if (probe?.rendered === true && evidence?.contentVerified !== true) {
    reasons.push("BROWSER_RENDER_ATTEMPTED");
  }
  if (http >= 200 && http < 400 && !evidence?.contentVerified && probe?.title) {
    reasons.push("ASSORTMENT_WEIGHT_INSUFFICIENT");
  }
  if (!probe?.ok && !reasons.length) reasons.push("CONTENT_UNAVAILABLE");
  if (reviewStatus === "REGION_UNVERIFIED") reasons.push("REGION_UNVERIFIED");
  if (reviewStatus === "BLOCKED") reasons.push("BLOCKED_QUARANTINED");
  return reasons.length ? reasons : ["UNSPECIFIED_INCOMPLETE"];
}
