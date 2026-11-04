#!/usr/bin/env node
/**
 * V35/V37 — honest per-product refresh coverage for published offers.
 *
 * V35: partner-window scan (offset/limit). Window miss ≠ deleted.
 * V37: prefer documented shoppingProducts(productIds: [...]) targeted refresh when available.
 *
 * Statuses (never invent sourceUpdatedAt):
 * - SUCCESSFULLY_REFRESHED: productId matched this pass (window or productIds query)
 * - NOT_IN_SCAN_WINDOW: advertiser queried; productId not returned (may still exist / ID drift)
 * - NOT_ATTEMPTED: advertiser not scanned this pass
 * - SOURCE_UNAVAILABLE: explicit gone/remove signal (rare; not inferred from miss)
 */
import { CJ_CALL_MIN_INTERVAL_MS } from "./iu-cj-affiliate-phase1-lib.mjs";
import { CJ_PRODUCT_SEARCH_OFFSET_FIRST } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const REFRESH_COVERAGE_SCHEMA = "iu-cj-affiliate-phase3z-refresh-coverage-v35";
export const REFRESH_COVERAGE_SCHEMA_V37 = "iu-cj-affiliate-phase3z-refresh-coverage-v37";
export const REFRESH_MODE = Object.freeze({
  PRODUCT_IDS: "productIds",
  SCAN_WINDOW: "scanWindow",
});

export const REFRESH_RESULT = Object.freeze({
  SUCCESSFULLY_REFRESHED: "SUCCESSFULLY_REFRESHED",
  NOT_IN_SCAN_WINDOW: "NOT_IN_SCAN_WINDOW",
  NOT_ATTEMPTED: "NOT_ATTEMPTED",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  ERROR: "ERROR",
});

export function emptyRefreshCheckpointDoc(nowIso = new Date().toISOString()) {
  return {
    schema: REFRESH_COVERAGE_SCHEMA_V37,
    version: 2,
    updatedAt: nowIso,
    partners: {},
    runs: [],
    cumulative: emptyCumulativeCoverage(),
    note:
      "V37: prefer productIds targeted refresh; scan-window offsets remain as fallback. Independent of discovery checkpoints.",
  };
}

export function emptyCumulativeCoverage() {
  return {
    schema: REFRESH_COVERAGE_SCHEMA_V37,
    everMatchedUniqueKeys: [],
    everMatchedCount: 0,
    firstSeenAtByKey: {},
    horizons: {
      "1pass": { status: "PENDING_OBSERVATION", note: "filled after first measured pass" },
      "3h": { status: "PENDING_OBSERVATION" },
      "6h": { status: "PENDING_OBSERVATION" },
      "12h": { status: "PENDING_OBSERVATION" },
      "24h": { status: "PENDING_OBSERVATION" },
      "48h": { status: "PENDING_OBSERVATION" },
    },
    snapshots: [],
  };
}

export function loadRefreshCheckpoint(raw) {
  if (!raw || typeof raw !== "object") return emptyRefreshCheckpointDoc();
  const base = emptyRefreshCheckpointDoc(raw.updatedAt || undefined);
  return {
    ...base,
    ...raw,
    schema: raw.schema || REFRESH_COVERAGE_SCHEMA_V37,
    partners: raw.partners && typeof raw.partners === "object" ? raw.partners : {},
    runs: Array.isArray(raw.runs) ? raw.runs : [],
    cumulative:
      raw.cumulative && typeof raw.cumulative === "object"
        ? { ...emptyCumulativeCoverage(), ...raw.cumulative }
        : emptyCumulativeCoverage(),
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
  const mode = String(input.mode || REFRESH_MODE.SCAN_WINDOW);
  const advertisers = Math.max(0, Number(input.advertisers) || 0);
  const publishedProducts = Math.max(0, Number(input.publishedProducts) || 0);
  const maxDepthProducts = Math.max(0, Number(input.maxPartnerCatalogDepth) || 5000);
  const pageSize = Math.max(1, Number(input.refreshPageSize) || 100);
  const maxPages = Math.max(1, Number(input.refreshMaxPages) || 5);
  const intervalMs = Math.max(1, Number(input.callIntervalMs) || CJ_CALL_MIN_INTERVAL_MS);
  const productIdsBatchSize = Math.max(1, Number(input.productIdsBatchSize) || 100);

  if (mode === REFRESH_MODE.PRODUCT_IDS) {
    // One (or few) targeted calls per advertiser with published keys — independent of catalog depth.
    const gqlCallsPerPass = Math.max(
      advertisers,
      Math.ceil(publishedProducts / productIdsBatchSize) || advertisers
    );
    const minutesPerPass = (gqlCallsPerPass * intervalMs) / 60000;
    return {
      schema: REFRESH_COVERAGE_SCHEMA_V37,
      mode: REFRESH_MODE.PRODUCT_IDS,
      advertisers,
      publishedProducts,
      productIdsBatchSize,
      windowProducts: null,
      passesNeeded: 1,
      gqlCallsPerPass,
      minutesPerPass: Number(minutesPerPass.toFixed(2)),
      achievableFullCoverageHours: Number((minutesPerPass / 60).toFixed(2)),
      meetsAllProductsEvery3h: minutesPerPass <= 180,
      caveat:
        "V37 productIds mode uses documented shoppingProducts(productIds) filter. Miss ≠ deleted without stronger evidence. Capacity is advertiser/batch based, not catalog-depth scan.",
    };
  }

  const windowProducts = pageSize * maxPages;
  const passesNeeded = Math.max(1, Math.ceil(maxDepthProducts / windowProducts));
  const gqlCallsPerPass = advertisers * maxPages;
  const minutesPerPass = (gqlCallsPerPass * intervalMs) / 60000;
  const hoursPerFullCoverage = passesNeeded * Math.max(3, Math.ceil(minutesPerPass / 60) || 3);
  return {
    schema: REFRESH_COVERAGE_SCHEMA,
    mode: REFRESH_MODE.SCAN_WINDOW,
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
      refreshReason =
        opts.refreshMode === REFRESH_MODE.PRODUCT_IDS
          ? "productId_matched_by_productIds_query"
          : "productId_matched_in_scan_window";
      counts.sourceMatched += 1;
      counts.successfullyRefreshed += 1;
      counts.refreshAttempted += 1;
    } else if (scannedAdvertisers.has(k.advertiserId)) {
      refreshResult = REFRESH_RESULT.NOT_IN_SCAN_WINDOW;
      refreshReason =
        opts.refreshMode === REFRESH_MODE.PRODUCT_IDS
          ? "advertiser_productIds_query_miss_not_deleted"
          : "advertiser_scanned_productId_not_in_window";
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
    refreshMode: opts.refreshMode || REFRESH_MODE.SCAN_WINDOW,
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
  const mode = ledger?.refreshMode || null;
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
    refreshMode: mode,
    honestNote:
      mode === REFRESH_MODE.PRODUCT_IDS
        ? "successfullyRefreshed counts only productId matches from shoppingProducts(productIds); miss is not treated as deleted."
        : "successfullyRefreshed counts only productId matches in the scanned partner window; notInScanWindow is not treated as deleted.",
  };
}

/**
 * Record measured pass into cumulative coverage. Never extrapolates horizons.
 * Horizons without elapsed wall-clock remain PENDING_OBSERVATION.
 */
export function updateCumulativeCoverage(prevCumulative, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const publishedKeys = (opts.publishedKeys || []).map(String);
  const matchedKeys = [...(opts.matchedKeys instanceof Set ? opts.matchedKeys : opts.matchedKeys || [])].map(String);
  const publishedN = publishedKeys.length;
  const base = { ...emptyCumulativeCoverage(), ...(prevCumulative || {}) };
  const ever = new Set([...(base.everMatchedUniqueKeys || []), ...matchedKeys]);
  const firstSeen = { ...(base.firstSeenAtByKey || {}) };
  for (const k of matchedKeys) {
    if (!firstSeen[k]) firstSeen[k] = nowIso;
  }
  const passMatched = matchedKeys.length;
  const passCoveragePct =
    publishedN > 0 ? Number(((passMatched / publishedN) * 100).toFixed(2)) : null;
  const cumulativeMatched = [...ever].filter((k) => publishedKeys.includes(k)).length;
  const cumulativePct =
    publishedN > 0 ? Number(((cumulativeMatched / publishedN) * 100).toFixed(2)) : null;

  const snapshot = {
    at: nowIso,
    runId: opts.runId || null,
    refreshMode: opts.refreshMode || null,
    publishedUnique: publishedN,
    passMatchedUnique: passMatched,
    passNotMatchedUnique: Math.max(0, publishedN - passMatched),
    passCoveragePct,
    cumulativeMatchedUnique: cumulativeMatched,
    cumulativeNotMatchedUnique: Math.max(0, publishedN - cumulativeMatched),
    cumulativeCoveragePct: cumulativePct,
    apiRequests: opts.apiRequests != null ? Number(opts.apiRequests) : null,
    repeatedProducts: opts.repeatedProducts != null ? Number(opts.repeatedProducts) : null,
    priceChanges: opts.priceChanges != null ? Number(opts.priceChanges) : null,
    availabilityChanges: opts.availabilityChanges != null ? Number(opts.availabilityChanges) : null,
    errors: opts.errors != null ? Number(opts.errors) : null,
    staleHidden: opts.staleHidden != null ? Number(opts.staleHidden) : null,
    recovered: opts.recovered != null ? Number(opts.recovered) : null,
    measured: true,
    note: "Measured pass only — not a simulation or capacity estimate.",
  };

  const snapshots = [...(base.snapshots || []), snapshot].slice(-48);
  const originMs = snapshots.length
    ? Date.parse(snapshots[0].at)
    : Number.isFinite(nowMs)
      ? nowMs
      : null;

  function horizonStatus(hours) {
    if (!Number.isFinite(originMs) || !Number.isFinite(nowMs)) {
      return { status: "PENDING_OBSERVATION", reason: "clock_unavailable" };
    }
    const elapsedH = (nowMs - originMs) / 3600000;
    if (elapsedH + 1e-9 < hours) {
      return {
        status: "PENDING_OBSERVATION",
        elapsedHours: Number(elapsedH.toFixed(2)),
        requiredHours: hours,
        note: "Wall-clock horizon not yet elapsed; not extrapolated.",
      };
    }
    // Best measured cumulative snapshot at/after horizon window end.
    const targetMs = originMs + hours * 3600000;
    let best = null;
    for (const s of snapshots) {
      const ms = Date.parse(s.at);
      if (!Number.isFinite(ms) || ms < targetMs) continue;
      if (!best || Date.parse(best.at) > ms) best = s;
    }
    // If none exactly after target, use latest (horizon elapsed).
    if (!best) best = snapshots[snapshots.length - 1];
    return {
      status: "MEASURED",
      elapsedHours: Number(elapsedH.toFixed(2)),
      requiredHours: hours,
      publishedUnique: best.publishedUnique,
      cumulativeMatchedUnique: best.cumulativeMatchedUnique,
      cumulativeNotMatchedUnique: best.cumulativeNotMatchedUnique,
      cumulativeCoveragePct: best.cumulativeCoveragePct,
      at: best.at,
      measured: true,
    };
  }

  return {
    schema: REFRESH_COVERAGE_SCHEMA_V37,
    everMatchedUniqueKeys: [...ever].sort(),
    everMatchedCount: ever.size,
    firstSeenAtByKey: firstSeen,
    lastPass: snapshot,
    horizons: {
      "1pass": {
        status: "MEASURED",
        ...snapshot,
        note: "Single-pass measured coverage (not cumulative across time).",
      },
      "3h": horizonStatus(3),
      "6h": horizonStatus(6),
      "12h": horizonStatus(12),
      "24h": horizonStatus(24),
      "48h": horizonStatus(48),
    },
    snapshots,
  };
}
