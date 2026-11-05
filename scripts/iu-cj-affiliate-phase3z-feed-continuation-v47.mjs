#!/usr/bin/env node
/**
 * V47 — durable feed continuation ledger + declared-count decomposition.
 * Proves previousCursor → nextCursor and previousLoaded → currentLoaded per advertiser.
 * Declared metadata sums are never treated as loaded catalog.
 */
import { CJ_PRODUCT_SEARCH_OFFSET_FIRST } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const FEED_CONTINUATION_SCHEMA = "iu-cj-affiliate-phase3z-feed-continuation-v47";

/**
 * Prefer samples that prove real offset/page advancement (not empty API partners).
 */
export function selectContinuationSamples(events = [], limit = 12) {
  const list = Array.isArray(events) ? events.slice() : [];
  const score = (e) => {
    let s = 0;
    const start = Number(e?.startedOffset);
    const next = Number(e?.nextOffset);
    if (e?.resumed === true) s += 40;
    if (Number.isFinite(start) && Number.isFinite(next) && next !== start) s += 50;
    if ((Number(e?.fetched) || 0) > 0) s += 20;
    if ((Number(e?.totalCount) || 0) > 0) s += 10;
    if (e?.completePass === true) s += 15;
    return s;
  };
  list.sort((a, b) => score(b) - score(a));
  return list.slice(0, Math.max(0, Number(limit) || 12));
}

/**
 * Compare previous vs current checkpoint partner maps.
 */
export function buildFeedContinuationLedger(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const prevPartners =
    opts.previousPartners && typeof opts.previousPartners === "object" ? opts.previousPartners : {};
  const currPartners =
    opts.currentPartners && typeof opts.currentPartners === "object" ? opts.currentPartners : {};
  const inventoryPartners = Array.isArray(opts.inventoryPartners) ? opts.inventoryPartners : [];
  const withFeedIds = new Set(
    inventoryPartners
      .filter((p) => p && (p.hasFeed === true || Number(p.feedCount) > 0))
      .map((p) => String(p.advertiserId || ""))
      .filter(Boolean)
  );
  const ids = new Set([
    ...Object.keys(prevPartners || {}),
    ...Object.keys(currPartners || {}),
    ...withFeedIds,
  ]);

  const partners = [];
  let advanced = 0;
  let completedPass = 0;
  let stuck = 0;
  let emptyApi = 0;
  let firstSeen = 0;
  // V48: when inventory withFeed set is present, only those partners enter counts.
  const idList = withFeedIds.size ? [...withFeedIds].sort() : [...ids].sort();

  for (const id of idList) {
    const prev = prevPartners[id] || null;
    const curr = currPartners[id] || null;
    const previousCursor = {
      offset: prev?.resumeOffset ?? null,
      page: prev?.resumePage ?? null,
      mode: prev?.mode || null,
    };
    const nextCursor = {
      offset: curr?.resumeOffset ?? null,
      page: curr?.resumePage ?? null,
      mode: curr?.mode || null,
    };
    const previousLoaded = prev?.lastFetchedCount != null ? Number(prev.lastFetchedCount) : null;
    const currentLoaded = curr?.lastFetchedCount != null ? Number(curr.lastFetchedCount) : null;
    const previousTotal = prev?.lastTotalCount != null ? Number(prev.lastTotalCount) : null;
    const currentTotal = curr?.lastTotalCount != null ? Number(curr.lastTotalCount) : null;

    const offsetAdvanced =
      previousCursor.offset != null &&
      nextCursor.offset != null &&
      Number(nextCursor.offset) > Number(previousCursor.offset);
    const pageAdvanced =
      Boolean(previousCursor.page || nextCursor.page) &&
      String(previousCursor.page || "") !== String(nextCursor.page || "") &&
      nextCursor.page != null;
    const completePassBumped =
      Number(curr?.completePassCount || 0) > Number(prev?.completePassCount || 0);
    // Empty API feeds bump completePassCount every run at offset 1 — not catalog progress.
    const meaningfulCompletePass =
      completePassBumped && (Number(curr?.lastTotalCount) || 0) > 0;
    const progressed = offsetAdvanced || pageAdvanced || meaningfulCompletePass;
    const empty =
      (currentLoaded === 0 || currentLoaded == null) &&
      (currentTotal === 0 || currentTotal == null) &&
      !prev;

    if (!prev && curr) firstSeen += 1;
    if (meaningfulCompletePass) completedPass += 1;
    // V48: "advanced" means product-bearing progress (rows fetched or meaningful complete pass),
    // not empty 1→1 completePass bumps or timestamp-only updates.
    if (progressed && ((Number(curr?.lastFetchedCount) || 0) > 0 || meaningfulCompletePass)) {
      advanced += 1;
    }
    else if (
      previousCursor.offset != null &&
      nextCursor.offset != null &&
      Number(previousCursor.offset) === Number(nextCursor.offset) &&
      (currentTotal || 0) > (currentLoaded || 0)
    ) {
      stuck += 1;
    }
    if ((currentLoaded === 0 || currentLoaded == null) && (currentTotal === 0 || currentTotal == null)) {
      emptyApi += 1;
    }

    partners.push({
      advertiserId: id,
      partnerName: inventoryPartners.find((p) => String(p.advertiserId) === id)?.partnerName || null,
      hasFeed: withFeedIds.size ? withFeedIds.has(id) : null,
      previousCursor,
      nextCursor,
      previousLoaded,
      currentLoaded,
      previousTotal,
      currentTotal,
      productsRemainingEstimate: curr?.productsRemainingEstimate ?? null,
      completePassCount: curr?.completePassCount ?? 0,
      lastComplete: curr?.lastComplete === true,
      lastError: curr?.lastError || null,
      lastRunAt: curr?.lastRunAt || null,
      progressed,
      emptyApi:
        (currentLoaded === 0 || currentLoaded == null) &&
        (currentTotal === 0 || currentTotal == null),
      proofLine: `${previousCursor.offset ?? previousCursor.page ?? "∅"}→${
        nextCursor.offset ?? nextCursor.page ?? "∅"
      } | loaded ${previousLoaded ?? "∅"}→${currentLoaded ?? "∅"}`,
    });
  }

  const withFeedOnly = withFeedIds.size
    ? partners.filter((p) => p.hasFeed === true)
    : partners;

  return {
    schema: FEED_CONTINUATION_SCHEMA,
    evidenceClass: opts.evidenceClass || "CURRENT_PRODUCTION",
    at: nowIso,
    runId: opts.runId || null,
    sha: opts.sha || null,
    note:
      "Continuation proof across durable checkpoints. Declared feed metadata counts are not loaded products. Presentation budget ≠ API source cap.",
    counts: {
      partnersTracked: partners.length,
      withFeedTracked: withFeedOnly.length,
      advanced,
      completedPass,
      stuck,
      emptyApi,
      firstSeen,
      resumeOffsetGtFirst: withFeedOnly.filter(
        (p) =>
          p.nextCursor?.offset != null &&
          Number(p.nextCursor.offset) > CJ_PRODUCT_SEARCH_OFFSET_FIRST
      ).length,
    },
    partners: withFeedOnly.length ? withFeedOnly : partners,
  };
}

/**
 * Decompose declared productCount sum — never equals safely publishable catalog.
 */
export function decomposeDeclaredProductCounts(feeds = []) {
  const rows = Array.isArray(feeds) ? feeds : [];
  let sum = 0;
  let withCount = 0;
  let zero = 0;
  let missing = 0;
  const byCurrency = {};
  const byLanguage = {};
  const byCountry = {};
  const byFeedType = {};
  const byAdvertiser = {};
  const seenFeedKeys = new Set();
  let duplicateFeedKeys = 0;

  for (const f of rows) {
    const adv = String(f.advertiserId || "");
    const adId = f.adId != null ? String(f.adId) : "";
    const key = adv + "|" + adId;
    if (adId && seenFeedKeys.has(key)) duplicateFeedKeys += 1;
    else if (adId) seenFeedKeys.add(key);

    const n = f.productCount != null ? Number(f.productCount) : null;
    if (n == null || !Number.isFinite(n)) {
      missing += 1;
      continue;
    }
    if (n === 0) {
      zero += 1;
      continue;
    }
    withCount += 1;
    sum += n;
    const cur = f.currency || "UNKNOWN";
    const lang = f.language || "UNKNOWN";
    const country = f.advertiserCountry || "UNKNOWN";
    const typ = f.sourceFeedType || "UNKNOWN";
    byCurrency[cur] = (byCurrency[cur] || 0) + n;
    byLanguage[lang] = (byLanguage[lang] || 0) + n;
    byCountry[country] = (byCountry[country] || 0) + n;
    byFeedType[typ] = (byFeedType[typ] || 0) + n;
    if (adv) byAdvertiser[adv] = (byAdvertiser[adv] || 0) + n;
  }

  const topAdvertisers = Object.entries(byAdvertiser)
    .map(([advertiserId, declaredProductCountSum]) => ({ advertiserId, declaredProductCountSum }))
    .sort((a, b) => b.declaredProductCountSum - a.declaredProductCountSum)
    .slice(0, 25);

  return {
    schema: "iu-cj-affiliate-declared-product-count-decomposition-v47",
    feedRows: rows.length,
    declaredProductCountSum: sum,
    feedsWithPositiveCount: withCount,
    feedsWithZeroCount: zero,
    feedsMissingCount: missing,
    duplicateFeedKeys,
    byCurrency,
    byLanguage,
    byCountry,
    byFeedType,
    topAdvertisers,
    interpretation:
      "Sum aggregates CJ feed metadata productCount (may include alt feeds, currencies, languages, non-CZ). Not loaded and not publication-safe count.",
  };
}

/**
 * Individual audit for withFeed partners absent from public catalog.
 */
export function buildMissingFeedPartnersAudit(opts = {}) {
  const funnelPartners = Array.isArray(opts.funnelPartners) ? opts.funnelPartners : [];
  const inventoryById = opts.inventoryByAdvertiser || {};
  const checkpoints = opts.checkpoints || {};
  const missing = funnelPartners.filter((p) => p?.stages?.FEED && !p.inPublicCatalog);
  return {
    schema: "iu-cj-affiliate-missing-feed-partners-v47",
    at: opts.nowIso || new Date().toISOString(),
    count: missing.length,
    partners: missing.map((p) => {
      const id = String(p.advertiserId || "");
      const inv = inventoryById[id] || null;
      const cp = checkpoints[id] || null;
      return {
        advertiserId: id,
        name: p.name || inv?.partnerName || null,
        joined: inv?.joined ?? null,
        feedId: (inv?.feeds && inv.feeds[0] && inv.feeds[0].adId) || null,
        declaredProductCountSum: inv?.declaredProductCountSum ?? p.counts?.declared ?? null,
        apiFetched: p.counts?.fetched ?? cp?.lastFetchedCount ?? null,
        apiTotalCount: p.counts?.totalCount ?? cp?.lastTotalCount ?? null,
        excludeReason: p.excludeReason || null,
        lastError: cp?.lastError || null,
        lastRunAt: cp?.lastRunAt || null,
        nextAction:
          p.excludeReason === "PRODUCT_API_EMPTY_OR_NO_ACCESS"
            ? "KEEP_MONITOR_NO_PUBLISH_WITHOUT_API_ROWS"
            : p.excludeReason === "NOT_IN_OFFERS_UNKNOWN"
              ? "REVERIFY_NEXT_FULL_SYNC"
              : "INVESTIGATE",
        rootCause:
          p.excludeReason === "PRODUCT_API_EMPTY_OR_NO_ACCESS"
            ? "Feed metadata present; Product Search API returns empty/no access — not a pagination bug."
            : p.excludeReason || "unknown",
      };
    }),
  };
}
