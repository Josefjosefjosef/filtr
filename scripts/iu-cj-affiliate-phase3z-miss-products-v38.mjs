#!/usr/bin/env node
/**
 * V38 — individual decisions for productIds refresh misses.
 * Miss ≠ deleted. Never invent sourceUpdatedAt. Never mass-delete.
 */
export const MISS_DECISION = Object.freeze({
  KEEP_VERIFIED: "KEEP_VERIFIED",
  KEEP_PENDING: "KEEP_PENDING",
  TEMPORARILY_HIDE: "TEMPORARILY_HIDE",
  REPAIR_IDENTITY: "REPAIR_IDENTITY",
  HOLD_COLLISION: "HOLD_COLLISION",
  RECOVERED: "RECOVERED",
  REMOVE_CONFIRMED: "REMOVE_CONFIRMED",
  UNVERIFIED: "UNVERIFIED",
});

export const MISS_CAUSE = Object.freeze({
  NOT_IN_CJ_FOR_PUBLISHER: "PRODUCT_NOT_IN_CJ_FOR_PUBLISHER",
  IDENTITY_CHANGED: "PRODUCT_CHANGED_IDENTIFIER",
  OTHER_FEED: "PRODUCT_IN_OTHER_FEED",
  TEMPORARILY_UNAVAILABLE: "PRODUCT_TEMPORARILY_UNAVAILABLE",
  PUBLISHER_SCOPE: "NOT_AVAILABLE_FOR_PUBLISHER",
  PARTNER_PERMISSION: "PARTNER_PERMISSION_CHANGED",
  PARTNER_ENDED: "PARTNER_ENDED",
  REMOVED: "PRODUCT_REMOVED",
  PARTIAL_API: "CJ_API_INCOMPLETE_RESULT",
  IDENTITY_MAP_ERROR: "IDENTITY_OR_MAPPING_ERROR",
  DUPLICATE: "DUPLICATE_PRODUCT",
  UNVERIFIED: "CAUSE_NOT_YET_VERIFIED",
});

export const MISS_SCHEMA = "iu-cj-affiliate-phase3z-miss-products-v38";

/**
 * Decide publication fate for one miss after (optional) re-verify probes.
 */
export function decideMissProduct(row = {}, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const consecutiveMisses = Math.max(0, Number(row.consecutiveMisses) || 0);
  const recovered = row.recovered === true || row.decision === MISS_DECISION.RECOVERED;
  const identityRepair = row.identityRepair || null;
  const partnerEnded = row.partnerEnded === true;
  const confirmedRemoved = row.confirmedRemoved === true;
  const lastOkMs = row.lastSuccessfulRefreshAt ? Date.parse(row.lastSuccessfulRefreshAt) : NaN;
  const ageHours = Number.isFinite(lastOkMs) ? (nowMs - lastOkMs) / 3600000 : null;
  const hideAfterHours = Math.max(1, Number(opts.hideAfterHours) || 24);
  const hideAfterMisses = Math.max(1, Number(opts.hideAfterConsecutiveMisses) || 3);

  if (recovered) {
    // Recovery is verified; original miss root cause usually is not.
    // Do NOT coerce null cause → CAUSE_NOT_YET_VERIFIED via || fallback.
    const originalMissCause = row.originalMissCause || MISS_CAUSE.UNVERIFIED;
    const originalMissCauseVerified = row.originalMissCauseVerified === true;
    return {
      decision: MISS_DECISION.RECOVERED,
      cause: MISS_CAUSE.TEMPORARILY_UNAVAILABLE,
      originalMissCause,
      originalMissCauseVerified,
      classificationVerified: true,
      rootCauseVerified: originalMissCauseVerified,
      publicationSafe: true,
      hidePrice: false,
      note:
        "Re-found via authorized CJ productIds (or identity repair). Original miss cause stays separate and unverified unless evidence is provided.",
    };
  }
  // V40: V39 collision verdict / collision payload must not become REPAIR_IDENTITY or KEEP_PENDING.
  const verdictDecision = String(row.identityRepairVerdict?.decision || "");
  const collision = row.collision || null;
  if (
    verdictDecision === "HOLD_COLLISION" ||
    (collision &&
      String(collision.oldAdvertiserId || "") &&
      String(collision.newAdvertiserId || "") &&
      String(collision.oldAdvertiserId) !== String(collision.newAdvertiserId))
  ) {
    return {
      decision: MISS_DECISION.HOLD_COLLISION,
      cause: MISS_CAUSE.IDENTITY_MAP_ERROR,
      originalMissCause: MISS_CAUSE.IDENTITY_MAP_ERROR,
      originalMissCauseVerified: true,
      classificationVerified: true,
      rootCauseVerified: true,
      publicationSafe: true,
      hidePrice: false,
      collision: collision || null,
      identityRepairVerdict: row.identityRepairVerdict || null,
      note:
        "Same productId under a different advertiser without verified remap proof — HOLD_COLLISION; do not remap or delete.",
    };
  }
  if (identityRepair?.newAdvertiserId || identityRepair?.newProductId) {
    return {
      decision: MISS_DECISION.REPAIR_IDENTITY,
      cause: MISS_CAUSE.IDENTITY_CHANGED,
      originalMissCause: MISS_CAUSE.IDENTITY_CHANGED,
      originalMissCauseVerified: true,
      classificationVerified: true,
      rootCauseVerified: true,
      publicationSafe: true,
      hidePrice: false,
      identityRepair,
      note: "Product found under different advertiserId/productId — repair mapping; do not delete.",
    };
  }
  if (partnerEnded) {
    return {
      decision: MISS_DECISION.REMOVE_CONFIRMED,
      cause: MISS_CAUSE.PARTNER_ENDED,
      originalMissCause: MISS_CAUSE.PARTNER_ENDED,
      originalMissCauseVerified: true,
      classificationVerified: true,
      rootCauseVerified: true,
      publicationSafe: false,
      hidePrice: true,
      note: "Partner ENDED confirmed via registry lifecycle — not inferred from productIds miss alone.",
    };
  }
  if (confirmedRemoved) {
    return {
      decision: MISS_DECISION.REMOVE_CONFIRMED,
      cause: MISS_CAUSE.REMOVED,
      originalMissCause: MISS_CAUSE.REMOVED,
      originalMissCauseVerified: true,
      classificationVerified: true,
      rootCauseVerified: true,
      publicationSafe: false,
      hidePrice: true,
      note: "Explicit CJ gone/remove signal — not a bare productIds miss.",
    };
  }

  const agedOut = ageHours != null && ageHours >= hideAfterHours;
  const missStreak = consecutiveMisses >= hideAfterMisses;
  if (agedOut || missStreak) {
    return {
      decision: MISS_DECISION.TEMPORARILY_HIDE,
      cause: MISS_CAUSE.NOT_IN_CJ_FOR_PUBLISHER,
      originalMissCause: MISS_CAUSE.NOT_IN_CJ_FOR_PUBLISHER,
      // Repeated miss proves absence in productIds scan window, not merchant deletion.
      originalMissCauseVerified: true,
      classificationVerified: true,
      rootCauseVerified: true,
      publicationSafe: false,
      hidePrice: true,
      note:
        "Repeated productIds miss / age exceeds safe freshness window — hide stale price; not confirmed deleted.",
      ageHours,
      consecutiveMisses,
    };
  }

  return {
    decision: MISS_DECISION.KEEP_PENDING,
    cause: MISS_CAUSE.UNVERIFIED,
    originalMissCause: MISS_CAUSE.UNVERIFIED,
    originalMissCauseVerified: false,
    classificationVerified: true,
    rootCauseVerified: false,
    publicationSafe: true,
    hidePrice: false,
    note: "Single/low-streak productIds miss — keep LKG, do not treat as deleted.",
    ageHours,
    consecutiveMisses,
  };
}

/**
 * Build individual miss audit rows from published products + optional probe results.
 */
export function buildMissProductAudit(opts = {}) {
  const products = opts.products || [];
  const probeByKey = opts.probeByKey instanceof Map ? opts.probeByKey : new Map(opts.probeByKey || []);
  const prevMissByKey =
    opts.prevMissByKey instanceof Map ? opts.prevMissByKey : new Map(opts.prevMissByKey || []);
  const nowIso = opts.nowIso || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const rows = [];
  const counts = {
    uniqueMisses: 0,
    KEEP_VERIFIED: 0,
    KEEP_PENDING: 0,
    TEMPORARILY_HIDE: 0,
    REPAIR_IDENTITY: 0,
    HOLD_COLLISION: 0,
    RECOVERED: 0,
    REMOVE_CONFIRMED: 0,
    UNVERIFIED: 0,
    classificationVerified: 0,
    rootCauseVerified: 0,
    rootCauseUnverified: 0,
  };

  for (const p of products) {
    const advertiserId = String(p.advertiserId || "");
    const productId = String(p.productId || "");
    const key = advertiserId + "|" + productId;
    if (!advertiserId || !productId) continue;
    const isMiss =
      p.refreshResult === "NOT_IN_SCAN_WINDOW" ||
      String(p.refreshReason || "").includes("productIds_query_miss");
    if (!isMiss) continue;

    const prev = prevMissByKey.get(key) || {};
    const probe = probeByKey.get(key) || null;
    const consecutiveMisses =
      probe?.recovered === true
        ? 0
        : (Number(prev.consecutiveMisses) || 0) + 1;

    const decided = decideMissProduct(
      {
        consecutiveMisses,
        lastSuccessfulRefreshAt: p.lastSuccessfulRefreshAt || prev.lastSuccessfulRefreshAt || null,
        recovered: probe?.recovered === true,
        identityRepair: probe?.identityRepair || null,
        collision: probe?.collision || null,
        identityRepairVerdict: probe?.identityRepairVerdict || null,
        partnerEnded: probe?.partnerEnded === true,
        confirmedRemoved: probe?.confirmedRemoved === true,
      },
      { nowMs, hideAfterHours: opts.hideAfterHours, hideAfterConsecutiveMisses: opts.hideAfterConsecutiveMisses }
    );

    const row = {
      schema: MISS_SCHEMA,
      sourceIdentity: key,
      advertiserId,
      productId,
      partnerName: p.partnerName || null,
      title: p.title || p.name || null,
      sectionKey: p.sectionKey || null,
      publicationReady: p.publicationReady !== false,
      lastSuccessfulRefreshAt: p.lastSuccessfulRefreshAt || null,
      lastRefreshAttemptAt: p.lastRefreshAttemptAt || nowIso,
      lastConfirmedPrice: p.currentPrice ?? p.price ?? null,
      lastConfirmedAvailability: p.availability ?? null,
      endpoint: "shoppingProducts",
      filter: "productIds+partnerIds",
      apiResult: probe?.apiResult || "productIds_miss",
      sourceIdentityStatus: probe?.identityRepair
        ? "REPAIR_CANDIDATE"
        : decided.decision === MISS_DECISION.HOLD_COLLISION
          ? "HOLD_COLLISION"
          : "AS_PUBLISHED",
      consecutiveMisses,
      cause: decided.cause != null ? decided.cause : MISS_CAUSE.UNVERIFIED,
      originalMissCause:
        decided.originalMissCause != null ? decided.originalMissCause : MISS_CAUSE.UNVERIFIED,
      originalMissCauseVerified: decided.originalMissCauseVerified === true,
      classificationVerified: decided.classificationVerified !== false,
      rootCauseVerified: decided.rootCauseVerified === true,
      decision: decided.decision,
      hidePrice: decided.hidePrice === true,
      publicationSafe: decided.publicationSafe !== false,
      note: decided.note,
      probe: probe
        ? {
            recovered: probe.recovered === true,
            identityRepair: probe.identityRepair || null,
            collision: probe.collision || null,
            identityRepairVerdict: probe.identityRepairVerdict || null,
            apiResult: probe.apiResult || null,
          }
        : null,
      at: nowIso,
      runId: opts.runId || null,
      snapshotId: opts.snapshotId || null,
    };
    rows.push(row);
    counts.uniqueMisses += 1;
    counts[decided.decision] = (counts[decided.decision] || 0) + 1;
    if (row.classificationVerified) counts.classificationVerified += 1;
    if (row.rootCauseVerified) counts.rootCauseVerified += 1;
    else counts.rootCauseUnverified += 1;
  }

  return {
    schema: MISS_SCHEMA,
    at: nowIso,
    runId: opts.runId || null,
    snapshotId: opts.snapshotId || null,
    counts,
    rows,
    note: "Miss ≠ deleted. REMOVE_CONFIRMED only with explicit lifecycle/remove evidence.",
  };
}

/**
 * Summarize causes from audit rows.
 */
export function summarizeMissCauses(audit) {
  const byCause = {};
  const byDecision = {};
  for (const r of audit?.rows || []) {
    byCause[r.cause || "UNKNOWN"] = (byCause[r.cause || "UNKNOWN"] || 0) + 1;
    byDecision[r.decision || "UNKNOWN"] = (byDecision[r.decision || "UNKNOWN"] || 0) + 1;
  }
  return { byCause, byDecision, uniqueMisses: audit?.counts?.uniqueMisses || 0 };
}
