#!/usr/bin/env node
/**
 * V35 — honest per-product refresh coverage for published offers.
 *
 * CJ shoppingProducts is partner-window based (offset/limit). Matching a published
 * productId requires it to appear in the scanned window. Partner scan ≠ product refresh.
 *
 * Statuses (never invent sourceUpdatedAt):
 * - SUCCESSFULLY_REFRESHED: productId matched in this pass scan window
 * - NOT_IN_SCAN_WINDOW: advertiser scanned; productId not in fetched pages (may still exist deeper)
 * - NOT_ATTEMPTED: advertiser not scanned this pass
 * - SOURCE_UNAVAILABLE: explicit gone/remove signal (rare; not inferred from window miss)
 */
import { CJ_CALL_MIN_INTERVAL_MS } from "./iu-cj-affiliate-phase1-lib.mjs";
import { CJ_PRODUCT_SEARCH_OFFSET_FIRST } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const REFRESH_COVERAGE_SCHEMA = "iu-cj-affiliate-phase3z-refresh-coverage-v35";

export const REFRESH_RESULT = Object.freeze({
  SUCCESSFULLY_REFRESHED: "SUCCESSFULLY_REFRESHED",
  NOT_IN_SCAN_WINDOW: "NOT_IN_SCAN_WINDOW",
  NOT_ATTEMPTED: "NOT_ATTEMPTED",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  ERROR: "ERROR",
});

export function emptyRefreshCheckpointDoc(nowIso = new Date().toISOString()) {
  return {
    schema: REFRESH_COVERAGE_SCHEMA,
    version: 1,
    updatedAt: nowIso,
    partners: {},
    runs: [],
    note: "Continueable refresh scan offsets per advertiser; independent of discovery checkpoints.",
  };
}

export function loadRefreshCheckpoint(raw) {
  if (!raw || typeof raw !== "object") return emptyRefreshCheckpointDoc();
  return {
    ...emptyRefreshCheckpointDoc(raw.updatedAt || undefined),
    ...raw,
    partners: raw.partners && typeof raw.partners === "object" ? raw.partners : {},
    runs: Array.isArray(raw.runs) ? raw.runs : [],
  };
}

/**
 * Order advertisers: oldest successful refresh first, then never-refreshed, then by key.
 */
export function orderAdvertisersForRefresh(keys, prevByKey = new Map()) {
  const byAdv = new Map();
  for (const k of keys) {
    if (!byAdv.has(k.advertiserId)) byAdv.set(k.advertiserId, []);
    byAdv.get(k.advertiserId).push(k);
  }
  const scored = [];
  for (const [advertiserId, list] of byAdv.entries()) {
    let oldestMs = null;
    let anyRefresh = false;
    for (const k of list) {
      const prev = prevByKey.get(advertiserId + "|" + k.productId);
      const ts = prev?.lastSuccessfulRefreshAt || prev?.fetchedAt || null;
      if (ts) {
        anyRefresh = true;
        const ms = Date.parse(ts);
        if (Number.isFinite(ms) && (oldestMs == null || ms < oldestMs)) oldestMs = ms;
      }
    }
    scored.push({
      advertiserId,
      keys: list,
      oldestMs: oldestMs == null ? 0 : oldestMs,
      anyRefresh,
    });
  }
  scored.sort((a, b) => {
    if (a.anyRefresh !== b.anyRefresh) return a.anyRefresh ? 1 : -1;
    if (a.oldestMs !== b.oldestMs) return a.oldestMs - b.oldestMs;
    return String(a.advertiserId).localeCompare(String(b.advertiserId));
  });
  return scored;
}

export function estimateFullCoverageHours(input = {}) {
  const advertisers = Math.max(0, Number(input.advertisers) || 0);
  const maxDepthProducts = Math.max(0, Number(input.maxPartnerCatalogDepth) || 5000);
  const pageSize = Math.max(1, Number(input.refreshPageSize) || 100);
  const maxPages = Math.max(1, Number(input.refreshMaxPages) || 5);
  const intervalMs = Math.max(1, Number(input.callIntervalMs) || CJ_CALL_MIN_INTERVAL_MS);
  const windowProducts = pageSize * maxPages;
  const passesNeeded = Math.max(1, Math.ceil(maxDepthProducts / windowProducts));
  const gqlCallsPerPass = advertisers * maxPages;
  const minutesPerPass = (gqlCallsPerPass * intervalMs) / 60000;
  const hoursPerFullCoverage = passesNeeded * Math.max(3, Math.ceil(minutesPerPass / 60) || 3);
  return {
    schema: REFRESH_COVERAGE_SCHEMA,
    advertisers,
    maxPartnerCatalogDepth: maxDepthProducts,
    windowProducts,
    passesNeeded,
    minutesPerPass: Number(minutesPerPass.toFixed(2)),
    achievableFullCoverageHours: hoursPerFullCoverage,
    meetsAllProductsEvery3h: passesNeeded === 1 && minutesPerPass <= 180,
    caveat:
      "Without per-productId CJ GET, coverage is scan-window based. Window miss ≠ source gone. Full re-validation of deep catalogs may need multiple 3h refresh_priority passes.",
  };
}

/**
 * Build per-product coverage rows after a refresh pass.
 */
export function buildRefreshCoverageLedger(opts = {}) {
  const keys = opts.keys || [];
  const matchedKeys = opts.matchedKeys instanceof Set ? opts.matchedKeys : new Set(opts.matchedKeys || []);
  const scannedAdvertisers =
    opts.scannedAdvertisers instanceof Set
      ? opts.scannedAdvertisers
      : new Set(opts.scannedAdvertisers || []);
  const errorAdvertisers =
    opts.errorAdvertisers instanceof Set ? opts.errorAdvertisers : new Set(opts.errorAdvertisers || []);
  const nowIso = opts.nowIso || new Date().toISOString();
  const prevByKey = opts.prevByKey instanceof Map ? opts.prevByKey : new Map();
  const rows = [];
  const counts = {
    publishedProducts: keys.length,
    refreshAttempted: 0,
    sourceMatched: 0,
    successfullyRefreshed: 0,
    notInScanWindow: 0,
    notAttempted: 0,
    errors: 0,
  };
  for (const k of keys) {
    const key = k.advertiserId + "|" + k.productId;
    const prev = prevByKey.get(key) || {};
    let refreshResult = REFRESH_RESULT.NOT_ATTEMPTED;
    let refreshReason = "advertiser_not_scanned_this_pass";
    if (errorAdvertisers.has(k.advertiserId)) {
      refreshResult = REFRESH_RESULT.ERROR;
      refreshReason = "advertiser_refresh_error";
      counts.errors += 1;
      counts.refreshAttempted += 1;
    } else if (matchedKeys.has(key)) {
      refreshResult = REFRESH_RESULT.SUCCESSFULLY_REFRESHED;
      refreshReason = "productId_matched_in_scan_window";
      counts.sourceMatched += 1;
      counts.successfullyRefreshed += 1;
      counts.refreshAttempted += 1;
    } else if (scannedAdvertisers.has(k.advertiserId)) {
      refreshResult = REFRESH_RESULT.NOT_IN_SCAN_WINDOW;
      refreshReason = "advertiser_scanned_productId_not_in_window";
      counts.notInScanWindow += 1;
      counts.refreshAttempted += 1;
    } else {
      counts.notAttempted += 1;
    }
    rows.push({
      productId: k.productId,
      advertiserId: k.advertiserId,
      sourceIdentity: key,
      sectionKey: k.sectionKey || null,
      feedId: k.feedId || null,
      lastRefreshAttemptAt: scannedAdvertisers.has(k.advertiserId) || errorAdvertisers.has(k.advertiserId) ? nowIso : prev.lastRefreshAttemptAt || null,
      lastSuccessfulRefreshAt:
        refreshResult === REFRESH_RESULT.SUCCESSFULLY_REFRESHED
          ? nowIso
          : prev.lastSuccessfulRefreshAt || null,
      refreshResult,
      refreshReason,
      nextRefreshAt: null,
      sourceUpdatedAt: prev.sourceUpdatedAt ?? null,
      sourceUpdatedAtStatus: prev.sourceUpdatedAtStatus ?? null,
      fetchedAt: refreshResult === REFRESH_RESULT.SUCCESSFULLY_REFRESHED ? nowIso : prev.fetchedAt || null,
      freshnessStatus: prev.freshnessStatus || null,
    });
  }
  return {
    schema: REFRESH_COVERAGE_SCHEMA,
    at: nowIso,
    counts,
    rows,
  };
}

export function advanceRefreshPartnerCheckpoint(prevPartner, scan) {
  const pageSize = Math.max(1, Number(scan.pageSize) || 100);
  const maxPages = Math.max(1, Number(scan.maxPages) || 5);
  const started =
    scan.startedOffset != null
      ? Math.max(CJ_PRODUCT_SEARCH_OFFSET_FIRST, Number(scan.startedOffset))
      : CJ_PRODUCT_SEARCH_OFFSET_FIRST;
  const fetched = Math.max(0, Number(scan.fetchedCount) || 0);
  const totalCount = scan.totalCount != null && Number.isFinite(Number(scan.totalCount)) ? Number(scan.totalCount) : null;
  let nextOffset = started + Math.max(fetched, pageSize * Math.min(maxPages, Math.ceil(fetched / pageSize) || 1));
  let wrapped = false;
  if (totalCount != null && nextOffset > totalCount) {
    nextOffset = CJ_PRODUCT_SEARCH_OFFSET_FIRST;
    wrapped = true;
  } else if (fetched === 0) {
    nextOffset = CJ_PRODUCT_SEARCH_OFFSET_FIRST;
    wrapped = true;
  }
  return {
    advertiserId: String(scan.advertiserId || prevPartner?.advertiserId || ""),
    resumeOffset: nextOffset,
    lastStartedOffset: started,
    lastFetchedCount: fetched,
    lastTotalCount: totalCount,
    lastMatched: Number(scan.matched) || 0,
    lastNotInWindow: Number(scan.notInWindow) || 0,
    lastScanAt: scan.at || new Date().toISOString(),
    wrapped,
    mode: "offset",
  };
}

export function summarizeCoverageFromLedger(ledger) {
  const c = ledger?.counts || {};
  const attempted = Number(c.refreshAttempted) || 0;
  const matched = Number(c.sourceMatched) || 0;
  const published = Number(c.publishedProducts) || 0;
  return {
    publishedProducts: published,
    refreshAttempted: attempted,
    sourceMatched: matched,
    successfullyRefreshed: Number(c.successfullyRefreshed) || matched,
    notInScanWindow: Number(c.notInScanWindow) || 0,
    notAttempted: Number(c.notAttempted) || 0,
    errors: Number(c.errors) || 0,
    matchRateOfAttempted: attempted > 0 ? Number((matched / attempted).toFixed(4)) : null,
    matchRateOfPublished: published > 0 ? Number((matched / published).toFixed(4)) : null,
    honestNote:
      "successfullyRefreshed counts only productId matches in the scanned partner window; notInScanWindow is not treated as deleted.",
  };
}
