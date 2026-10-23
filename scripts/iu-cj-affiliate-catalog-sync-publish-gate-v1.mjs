#!/usr/bin/env node
/**
 * Phase 2C PR B — publish gate for CJ_MANAGED catalog sync.
 * Fetch ≠ publish. Never touches MANUAL_PROTECTED / PAID_RESERVED / code / guards.
 *
 * Partner states: ENDED | API_OUTAGE | LINK_UNVERIFIED | PUBLISHABLE
 * Anti mass-hide: stop publish if ENDED share of managed exceeds threshold.
 */
export const WEBSITE_PID = "101883843";
export const MASS_ENDED_RATIO_STOP = 0.25;

export const PARTNER_STATE = Object.freeze({
  PUBLISHABLE: "PUBLISHABLE",
  ENDED: "ENDED",
  API_OUTAGE: "API_OUTAGE",
  LINK_UNVERIFIED: "LINK_UNVERIFIED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  PROTECTED: "PROTECTED",
  SKIP: "SKIP",
});

export function isCjTrackingUrl(url) {
  // CJ deep links use www.<network>.(com|net)/click-<PID>-<linkId>
  return /^https:\/\/www\.(anrdoezrs|jdoqocy|dpbolvw|kqzyfj|tkqlhce)\.(com|net)\/click-\d+-\d+/i.test(
    String(url || "")
  );
}

export function extractLinkIdFromUrl(url) {
  const m = String(url || "").match(/click-(\d+)-(\d+)/i);
  if (!m) return null;
  return { pid: m[1], linkId: m[2] };
}

/**
 * Real link verification: metadata must prove ownership (not URL regex alone).
 * @param {{ linkId: string, advertiserId: string, websitePid?: string, programAvailable?: boolean, linkBelongsToAdvertiser?: boolean }} meta
 */
export function verifyCjLinkOwnership(meta, expectedAdvertiserId, expectedPid = WEBSITE_PID) {
  if (!meta || typeof meta !== "object") {
    return { ok: false, state: PARTNER_STATE.LINK_UNVERIFIED, reason: "missing_meta" };
  }
  if (meta.apiError) {
    return { ok: false, state: PARTNER_STATE.API_OUTAGE, reason: String(meta.apiError) };
  }
  if (String(meta.websitePid || "") !== String(expectedPid)) {
    return { ok: false, state: PARTNER_STATE.LINK_UNVERIFIED, reason: "pid_mismatch" };
  }
  if (String(meta.advertiserId || "") !== String(expectedAdvertiserId || "")) {
    return { ok: false, state: PARTNER_STATE.LINK_UNVERIFIED, reason: "advertiser_mismatch" };
  }
  if (meta.linkBelongsToAdvertiser !== true) {
    return { ok: false, state: PARTNER_STATE.LINK_UNVERIFIED, reason: "link_not_owned" };
  }
  if (meta.programAvailable !== true) {
    if (meta.programStatus === "ENDED" || meta.programAvailable === false) {
      return { ok: false, state: PARTNER_STATE.ENDED, reason: "program_ended" };
    }
    return { ok: false, state: PARTNER_STATE.LINK_UNVERIFIED, reason: "program_unavailable" };
  }
  return { ok: true, state: PARTNER_STATE.PUBLISHABLE, reason: "verified" };
}

export function classifyManagement(policyEntry) {
  const m = policyEntry && (policyEntry.management || policyEntry.policy || policyEntry.kind);
  return String(m || "");
}

/**
 * Decide publish action for one partner against policy + API verification result.
 */
export function decidePublishAction({
  candidate,
  policyEntry,
  linkMeta,
  sectionMap,
  existingManagedIds,
  blockedAdvertiserIds = [],
}) {
  const advertiserId = String(candidate?.advertiserId || "");
  const management = classifyManagement(policyEntry);

  if (management === "MANUAL_PROTECTED" || management === "PAID_RESERVED") {
    return {
      action: "KEEP",
      state: PARTNER_STATE.PROTECTED,
      reason: "immutable_" + management,
      publish: false,
    };
  }

  if (blockedAdvertiserIds.map(String).includes(advertiserId)) {
    return {
      action: "HIDE",
      state: PARTNER_STATE.NEEDS_REVIEW,
      reason: "manual_block",
      publish: false,
    };
  }

  if (candidate?.needsReview === true || candidate?.status === "NEEDS_REVIEW") {
    return {
      action: "HIDE",
      state: PARTNER_STATE.NEEDS_REVIEW,
      reason: "needs_review",
      publish: false,
    };
  }

  const sectionId = candidate?.sectionId || sectionMap?.[advertiserId];
  if (!sectionId) {
    return {
      action: "HIDE",
      state: PARTNER_STATE.NEEDS_REVIEW,
      reason: "missing_section",
      publish: false,
    };
  }

  if (!isCjTrackingUrl(candidate?.url)) {
    return {
      action: "HIDE",
      state: PARTNER_STATE.LINK_UNVERIFIED,
      reason: "url_not_cj_tracking",
      publish: false,
    };
  }

  const ids = extractLinkIdFromUrl(candidate.url);
  if (!ids || ids.pid !== WEBSITE_PID) {
    return {
      action: "HIDE",
      state: PARTNER_STATE.LINK_UNVERIFIED,
      reason: "pid_or_link_parse",
      publish: false,
    };
  }

  const verified = verifyCjLinkOwnership(linkMeta, advertiserId, WEBSITE_PID);
  if (verified.state === PARTNER_STATE.API_OUTAGE) {
    return {
      action: "KEEP_LKG",
      state: PARTNER_STATE.API_OUTAGE,
      reason: verified.reason,
      publish: false,
    };
  }
  if (verified.state === PARTNER_STATE.ENDED) {
    return {
      action: "HIDE",
      state: PARTNER_STATE.ENDED,
      reason: verified.reason,
      publish: false,
      hideManagedOnly: true,
    };
  }
  if (!verified.ok) {
    return {
      action: "HIDE",
      state: PARTNER_STATE.LINK_UNVERIFIED,
      reason: verified.reason,
      publish: false,
    };
  }

  if (management && management !== "CJ_MANAGED" && existingManagedIds?.has?.(advertiserId) !== true) {
    // New partner without CJ_MANAGED classification stays review-only unless already managed.
    if (management !== "") {
      return {
        action: "HIDE",
        state: PARTNER_STATE.NEEDS_REVIEW,
        reason: "not_cj_managed_class",
        publish: false,
      };
    }
  }

  return {
    action: "PUBLISH",
    state: PARTNER_STATE.PUBLISHABLE,
    reason: "gate_pass",
    publish: true,
    sectionId,
    advertiserId,
    url: candidate.url,
    title: candidate.title,
  };
}

/**
 * Build publish plan with anti mass-hide + API outage last-known-good.
 */
export function buildPublishPlan({
  candidates = [],
  policyPartners = [],
  linkMetaByAdvertiser = {},
  sectionMap = {},
  lastKnownGood = [],
  blockedAdvertiserIds = [],
  massEndedRatioStop = MASS_ENDED_RATIO_STOP,
}) {
  const policyById = new Map();
  for (const p of policyPartners) {
    if (p?.advertiserId != null) policyById.set(String(p.advertiserId), p);
  }
  const managedIds = new Set(
    policyPartners
      .filter((p) => classifyManagement(p) === "CJ_MANAGED")
      .map((p) => String(p.advertiserId))
  );
  const lkgById = new Map(lastKnownGood.map((p) => [String(p.advertiserId), p]));

  const decisions = [];
  let apiOutage = false;
  let endedManaged = 0;
  let managedConsidered = 0;

  for (const candidate of candidates) {
    const advertiserId = String(candidate.advertiserId || "");
    const policyEntry = policyById.get(advertiserId) || null;
    const isManaged = managedIds.has(advertiserId) || classifyManagement(policyEntry) === "CJ_MANAGED";
    if (isManaged) managedConsidered += 1;

    const decision = decidePublishAction({
      candidate,
      policyEntry,
      linkMeta: linkMetaByAdvertiser[advertiserId],
      sectionMap,
      existingManagedIds: managedIds,
      blockedAdvertiserIds,
    });
    decisions.push({
      advertiserId,
      ...decision,
      title: candidate.title,
      url: candidate.url || decision.url,
      sectionId: candidate.sectionId || decision.sectionId,
    });

    if (decision.state === PARTNER_STATE.API_OUTAGE) apiOutage = true;
    if (decision.state === PARTNER_STATE.ENDED && isManaged) endedManaged += 1;
  }

  const endedRatio = managedConsidered > 0 ? endedManaged / managedConsidered : 0;
  /* Require a meaningful cohort so a single verified ENDED partner can still hide. */
  const massEndedStop = managedConsidered >= 4 && endedRatio > massEndedRatioStop;

  /** @type {object[]} */
  let publishSlice = [];
  let publishBlockedReason = null;

  if (apiOutage) {
    publishBlockedReason = "API_OUTAGE_KEEP_LKG";
    publishSlice = lastKnownGood.slice();
  } else if (massEndedStop) {
    publishBlockedReason = "MASS_ENDED_STOP";
    publishSlice = lastKnownGood.slice();
  } else {
    const byId = new Map(lkgById);
    for (const d of decisions) {
      if (d.state === PARTNER_STATE.PROTECTED) continue;
      if (d.publish === true) {
        byId.set(d.advertiserId, {
          advertiserId: d.advertiserId,
          title: d.title,
          url: d.url,
          sectionId: d.sectionId,
          management: "CJ_MANAGED",
          active: true,
        });
      } else if (d.state === PARTNER_STATE.ENDED && d.hideManagedOnly) {
        /* Explicit active:false so public overlay can hide baked CJ_MANAGED chips.
           Deleting from slice would leave baked catalog showing the partner (LKG keep-if-missing). */
        const prev = byId.get(d.advertiserId) || {};
        byId.set(d.advertiserId, {
          advertiserId: d.advertiserId,
          title: d.title || prev.title,
          url: d.url || prev.url,
          sectionId: d.sectionId || prev.sectionId,
          management: "CJ_MANAGED",
          active: false,
          endedReason: d.reason || "program_ended",
        });
      }
    }
    publishSlice = [...byId.values()];
  }

  const protectedCount = decisions.filter((d) => d.state === PARTNER_STATE.PROTECTED).length;
  const publishedCount = decisions.filter((d) => d.publish).length;
  const needsReviewCount = decisions.filter(
    (d) => d.state === PARTNER_STATE.NEEDS_REVIEW || d.state === PARTNER_STATE.LINK_UNVERIFIED
  ).length;

  return {
    ok: !apiOutage && !massEndedStop,
    apiOutage,
    massEndedStop,
    endedRatio,
    publishBlockedReason,
    counts: {
      candidates: candidates.length,
      published: publishedCount,
      needs_review: needsReviewCount,
      protected: protectedCount,
      ended_managed: endedManaged,
      managed_considered: managedConsidered,
      publish_slice: publishSlice.length,
    },
    decisions,
    publishSlice,
    // Sync job must never rewrite these paths:
    forbiddenWritePaths: [
      "assets/",
      "scripts/",
      ".github/workflows/",
      "projects/index.html",
      "projects/data/iu-affiliate-slot-policy-v1.json",
    ],
    allowedWritePaths: [
      "projects/data/iu-affiliate-cj-staging-v1.json",
      "projects/data/iu-affiliate-cj-managed-registry-v1.json",
      "projects/data/iu-affiliate-cj-managed-public-v1.json",
      "projects/data/iu-affiliate-cj-managed-public-lkg-v1.json",
      "projects/data/iu-affiliate-cj-sync-audit-v1.json",
    ],
  };
}

/**
 * Materialize browser-facing overlay JSON from managed registry slice.
 * Schema consumed by assets/iu-affiliate-catalog.js applyManagedPublicOverlay.
 */
export function materializeManagedPublic(registryOrSlice, opts = {}) {
  const partnersIn = Array.isArray(registryOrSlice)
    ? registryOrSlice
    : Array.isArray(registryOrSlice?.partners)
      ? registryOrSlice.partners
      : [];
  const partners = [];
  const seen = new Set();
  for (const p of partnersIn) {
    if (!p || p.advertiserId == null) continue;
    const id = String(p.advertiserId);
    if (seen.has(id)) continue;
    seen.add(id);
    const active = p.active !== false;
    const url = String(p.url || "");
    if (active && !isCjTrackingUrl(url)) continue;
    partners.push({
      advertiserId: id,
      sectionId: p.sectionId || null,
      title: p.title || "",
      url: url || null,
      active,
    });
  }
  return {
    schema: "iu-affiliate-cj-managed-public-v1",
    version: 1,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    websitePid: String(opts.websitePid || WEBSITE_PID),
    partners,
  };
}

export function assertAllowedDataWrite(filePath) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  const allowed = [
    "projects/data/iu-affiliate-cj-staging-v1.json",
    "projects/data/iu-affiliate-cj-managed-registry-v1.json",
    "projects/data/iu-affiliate-cj-managed-public-v1.json",
    "projects/data/iu-affiliate-cj-managed-public-lkg-v1.json",
    "projects/data/iu-affiliate-cj-sync-audit-v1.json",
  ];
  if (!allowed.some((a) => norm.endsWith(a) || norm.includes("/" + a))) {
    throw new Error("FORBIDDEN_SYNC_WRITE:" + norm);
  }
  return true;
}
