#!/usr/bin/env node
/**
 * V51.8 — honest partner traversal classification + fair discovery ordering.
 * Empty complete ≠ COMPLETE_NONEMPTY. Do not invent root causes.
 */

export const TRAVERSAL_STATUS = Object.freeze({
  COMPLETE_NONEMPTY: "COMPLETE_NONEMPTY",
  COMPLETE_VERIFIED_EMPTY: "COMPLETE_VERIFIED_EMPTY",
  NO_FEED_AVAILABLE: "NO_FEED_AVAILABLE",
  NO_FEED_CONFIRMED: "NO_FEED_CONFIRMED",
  FEED_DISCOVERY_PENDING: "FEED_DISCOVERY_PENDING",
  FEED_ACCESS_DENIED: "FEED_ACCESS_DENIED",
  FEED_TEMPORARILY_UNAVAILABLE: "FEED_TEMPORARILY_UNAVAILABLE",
  FEED_PAGINATION_PENDING: "FEED_PAGINATION_PENDING",
  FEED_COMPLETE_EMPTY: "FEED_COMPLETE_EMPTY",
  FEED_COMPLETE_NONEMPTY: "FEED_COMPLETE_NONEMPTY",
  NO_PERMISSION: "NO_PERMISSION",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  INCOMPLETE: "INCOMPLETE",
  STOPPED_EARLY: "STOPPED_EARLY",
  UNKNOWN: "UNKNOWN",
});

export function nextActionForTraversalStatus(status) {
  switch (String(status || "")) {
    case TRAVERSAL_STATUS.NO_FEED_AVAILABLE:
    case TRAVERSAL_STATUS.NO_FEED_CONFIRMED:
      return "NONE_NO_FEED";
    case TRAVERSAL_STATUS.FEED_DISCOVERY_PENDING:
      return "DISCOVER_FEEDS";
    case TRAVERSAL_STATUS.FEED_ACCESS_DENIED:
    case TRAVERSAL_STATUS.NO_PERMISSION:
      return "OWNER_PERMISSION_REVIEW";
    case TRAVERSAL_STATUS.FEED_TEMPORARILY_UNAVAILABLE:
    case TRAVERSAL_STATUS.SOURCE_UNAVAILABLE:
      return "RETRY_WITH_BACKOFF";
    case TRAVERSAL_STATUS.INCOMPLETE:
    case TRAVERSAL_STATUS.STOPPED_EARLY:
    case TRAVERSAL_STATUS.FEED_PAGINATION_PENDING:
      return "CONTINUE_PAGINATION";
    case TRAVERSAL_STATUS.COMPLETE_NONEMPTY:
    case TRAVERSAL_STATUS.FEED_COMPLETE_NONEMPTY:
      return "REFRESH_CYCLE";
    case TRAVERSAL_STATUS.COMPLETE_VERIFIED_EMPTY:
    case TRAVERSAL_STATUS.FEED_COMPLETE_EMPTY:
      return "NONE_EMPTY_VERIFIED";
    default:
      return "INVESTIGATE";
  }
}

/**
 * Classify one partner checkpoint against optional inventory/feed evidence.
 */
function classifyPartnerTraversalStatusRaw(cp = {}, opts = {}) {
  const total = cp.lastTotalCount != null ? Number(cp.lastTotalCount) : null;
  const fetched = cp.lastFetchedCount != null ? Number(cp.lastFetchedCount) : null;
  const complete = cp.lastComplete === true;
  const stoppedEarly = cp.lastStoppedEarlyForBudget === true;
  const err = cp.lastError != null ? String(cp.lastError) : "";
  const hasFeed =
    opts.hasFeed === true ||
    (opts.feedCount != null && Number(opts.feedCount) > 0) ||
    opts.inventoryStatus === "HAS_FEED";
  const noFeed =
    opts.hasFeed === false ||
    opts.inventoryStatus === "NO_FEED" ||
    (opts.feedCount != null && Number(opts.feedCount) === 0 && opts.inventoryComplete === true);
  const permissionDenied = /403|permission|unauthorized|forbidden/i.test(err);
  const sourceUnavailable = /5\d\d|timeout|ECONN|ENOTFOUND|429|unavailable/i.test(err);

  if (permissionDenied) {
    return {
      status: TRAVERSAL_STATUS.NO_PERMISSION,
      verifiedEmpty: false,
      authoritativeSource: Boolean(err),
      note: "Source returned permission/authorization failure.",
    };
  }
  if (sourceUnavailable && !complete) {
    return {
      status: TRAVERSAL_STATUS.SOURCE_UNAVAILABLE,
      verifiedEmpty: false,
      authoritativeSource: Boolean(err),
      note: "Transient or hard source failure — not a completed catalog pass.",
    };
  }
  if (noFeed && (total === 0 || total == null) && (fetched === 0 || fetched == null)) {
    const confirmed = opts.inventoryComplete === true;
    return {
      status: confirmed ? TRAVERSAL_STATUS.NO_FEED_CONFIRMED : TRAVERSAL_STATUS.NO_FEED_AVAILABLE,
      verifiedEmpty: false,
      authoritativeSource: confirmed,
      nextAction: nextActionForTraversalStatus(
        confirmed ? TRAVERSAL_STATUS.NO_FEED_CONFIRMED : TRAVERSAL_STATUS.NO_FEED_AVAILABLE
      ),
      note: confirmed
        ? "Inventory completed with no product feed — do not paginate."
        : "Inventory reports no product feed for partner.",
    };
  }
  const everCompleted = Number(cp.completePassCount || 0) > 0 || complete;
  const everCompletedNonempty = everCompleted && total != null && total > 0;
  // Current window may restart after a prior complete pass (resume reset) and look STOPPED_EARLY.
  // Historical completion is tracked via completePassCount / lastCompletePassAt.
  if (complete && total != null && total > 0) {
    return {
      status: TRAVERSAL_STATUS.COMPLETE_NONEMPTY,
      verifiedEmpty: false,
      authoritativeSource: true,
      everCompleted: true,
      everCompletedNonempty: true,
      note: "Authoritative complete pass with declared totalCount > 0 (current window).",
    };
  }
  if (complete && total === 0 && (fetched === 0 || fetched == null) && !err) {
    return {
      status: TRAVERSAL_STATUS.COMPLETE_VERIFIED_EMPTY,
      verifiedEmpty: true,
      authoritativeSource: true,
      everCompleted: true,
      everCompletedNonempty: false,
      note:
        "Authoritative shoppingProducts empty response (totalCount=0, no error). Valid empty catalog — not product progress.",
    };
  }
  if (stoppedEarly && total != null && total > 0) {
    return {
      status: TRAVERSAL_STATUS.STOPPED_EARLY,
      verifiedEmpty: false,
      authoritativeSource: true,
      everCompleted,
      everCompletedNonempty,
      note: everCompletedNonempty
        ? "Prior complete pass exists; current window stopped early mid-cycle."
        : "Page/budget stop mid-catalog; continuation required.",
    };
  }
  if (!complete && total != null && total > 0) {
    return {
      status: TRAVERSAL_STATUS.INCOMPLETE,
      verifiedEmpty: false,
      authoritativeSource: true,
      everCompleted,
      everCompletedNonempty,
      note: everCompletedNonempty
        ? "Prior complete pass exists; current window incomplete."
        : "Declared totalCount > 0 without completed pass evidence.",
    };
  }
  if (!complete && stoppedEarly) {
    return {
      status: TRAVERSAL_STATUS.STOPPED_EARLY,
      verifiedEmpty: false,
      authoritativeSource: true,
      note: "Stopped early without complete flag.",
    };
  }
  return {
    status: TRAVERSAL_STATUS.UNKNOWN,
    verifiedEmpty: false,
    authoritativeSource: false,
    nextAction: nextActionForTraversalStatus(TRAVERSAL_STATUS.UNKNOWN),
    note: "Insufficient evidence to classify traversal.",
  };
}

function withNextAction(result) {
  if (!result || result.nextAction) return result;
  return { ...result, nextAction: nextActionForTraversalStatus(result.status) };
}

export function classifyPartnerTraversalStatus(cp = {}, opts = {}) {
  return withNextAction(classifyPartnerTraversalStatusRaw(cp, opts));
}

/**
 * Fair discovery order: starve-prevention + age-based incomplete priority.
 * Processes all partners when limit=0; otherwise takes top-N by priority.
 */
export function selectPartnersForFairDiscovery(partners = [], checkpointPartners = {}, opts = {}) {
  const list = Array.isArray(partners) ? partners.filter((p) => p && p.advertiserId != null) : [];
  const limitRaw = opts.limit != null ? Number(opts.limit) : 0;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 0;
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const inventoryById =
    opts.inventoryById instanceof Map
      ? opts.inventoryById
      : new Map(
          (opts.inventoryPartners || []).map((p) => [String(p.advertiserId || ""), p])
        );

  const scored = list.map((p, idx) => {
    const id = String(p.advertiserId);
    const cp = checkpointPartners[id] || {};
    const inv = inventoryById.get(id) || {};
    const classified = classifyPartnerTraversalStatus(cp, {
      hasFeed: inv.hasFeed,
      feedCount: inv.feedCount,
      inventoryStatus: inv.inventoryStatus,
      inventoryComplete: inv.inventoryComplete,
    });
    const lastRunMs = cp.lastRunAt ? Date.parse(cp.lastRunAt) : 0;
    const ageHours = lastRunMs ? (nowMs - lastRunMs) / 3600000 : 9999;
    const remaining =
      cp.productsRemainingEstimate != null
        ? Number(cp.productsRemainingEstimate)
        : Math.max(0, Number(cp.lastTotalCount || 0) - Math.max(0, Number(cp.resumeOffset || 1) - 1));
    let band = 50;
    if (
      classified.status === TRAVERSAL_STATUS.INCOMPLETE ||
      classified.status === TRAVERSAL_STATUS.STOPPED_EARLY
    ) {
      band = 10;
    } else if (classified.status === TRAVERSAL_STATUS.UNKNOWN && !cp.lastRunAt) {
      band = 15;
    } else if (classified.status === TRAVERSAL_STATUS.SOURCE_UNAVAILABLE) {
      band = 20;
    } else if (classified.status === TRAVERSAL_STATUS.COMPLETE_NONEMPTY) {
      band = 70;
    } else if (
      classified.status === TRAVERSAL_STATUS.COMPLETE_VERIFIED_EMPTY ||
      classified.status === TRAVERSAL_STATUS.NO_FEED_AVAILABLE
    ) {
      band = 90;
    }
    // Within band: older lastRun first (starvation detection), then larger remaining.
    const score = band * 1e9 - ageHours * 1e5 - Math.min(1e7, remaining);
    return {
      partner: p,
      advertiserId: id,
      status: classified.status,
      ageHours: Number(ageHours.toFixed(3)),
      remaining,
      score,
      stableIndex: idx,
    };
  });

  scored.sort((a, b) => a.score - b.score || a.stableIndex - b.stableIndex);
  const selected = limit > 0 ? scored.slice(0, limit) : scored;
  const starved = scored.filter(
    (s) =>
      (s.status === TRAVERSAL_STATUS.INCOMPLETE || s.status === TRAVERSAL_STATUS.STOPPED_EARLY) &&
      s.ageHours >= Number(opts.starvationHours || 12)
  );

  return {
    schema: "iu-cj-affiliate-phase3z-catalog-fairness-v51-8",
    selected: selected.map((s) => s.partner),
    order: selected.map((s) => ({
      advertiserId: s.advertiserId,
      status: s.status,
      ageHours: s.ageHours,
      remaining: s.remaining,
      score: s.score,
    })),
    counts: {
      input: list.length,
      selected: selected.length,
      starved: starved.length,
      byStatus: scored.reduce((acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      }, {}),
    },
    starvedAdvertiserIds: starved.map((s) => s.advertiserId),
    note: "Fair order prioritizes incomplete/stoppedEarly by age; empty completes deprioritized.",
  };
}

/**
 * Summarize traversal classifications for audits.
 */
export function summarizeTraversalClassifications(rows = []) {
  const byStatus = {};
  let everCompletedNonempty = 0;
  for (const r of rows) {
    const st = String(r.status || TRAVERSAL_STATUS.UNKNOWN);
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (r.everCompletedNonempty === true) everCompletedNonempty += 1;
  }
  return {
    partnerCount: rows.length,
    byStatus,
    completeNonempty: byStatus[TRAVERSAL_STATUS.COMPLETE_NONEMPTY] || 0,
    completeVerifiedEmpty: byStatus[TRAVERSAL_STATUS.COMPLETE_VERIFIED_EMPTY] || 0,
    everCompletedNonempty,
    incomplete: byStatus[TRAVERSAL_STATUS.INCOMPLETE] || 0,
    stoppedEarly: byStatus[TRAVERSAL_STATUS.STOPPED_EARLY] || 0,
    noFeed: byStatus[TRAVERSAL_STATUS.NO_FEED_AVAILABLE] || 0,
    unknown: byStatus[TRAVERSAL_STATUS.UNKNOWN] || 0,
  };
}
