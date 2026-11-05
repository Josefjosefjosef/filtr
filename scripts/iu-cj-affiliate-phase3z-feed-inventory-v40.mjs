#!/usr/bin/env node
/**
 * V40/V45 — durable CJ shopping-product feed inventory (full list, not a 40-row sample).
 * Does not invent product counts; records only what CJ inventory returns.
 * V45: progressive merge across runs so JOINED partners reach inventoried without
 * requiring a single daily pass to succeed at artifact persistence.
 */
export const FEED_INVENTORY_SCHEMA = "iu-cj-affiliate-phase3z-feed-inventory-v40";

export const PARTNER_INVENTORY_STATUS = {
  NOT_YET_INVENTORIED: "NOT_YET_INVENTORIED",
  INVENTORIED_HAS_FEED: "INVENTORIED_HAS_FEED",
  INVENTORIED_NO_FEED: "INVENTORIED_NO_FEED",
  ERROR: "ERROR",
  PERMISSION_BLOCKED: "PERMISSION_BLOCKED",
  INCOMPLETE: "INCOMPLETE",
};

/** Plain JSON-safe feed row (strip non-enumerables / odd API shapes). */
export function sanitizeFeedRow(f = {}) {
  const productCount =
    f.productCount != null && Number.isFinite(Number(f.productCount)) ? Number(f.productCount) : null;
  return {
    advertiserId: f.advertiserId != null ? String(f.advertiserId) : null,
    partnerName: f.partnerName != null ? String(f.partnerName) : null,
    adId: f.adId != null ? String(f.adId) : null,
    feedName: f.feedName != null ? String(f.feedName) : null,
    productCount,
    lastUpdated: f.lastUpdated != null ? String(f.lastUpdated) : null,
    sourceFeedType: f.sourceFeedType != null ? String(f.sourceFeedType) : null,
    currency: f.currency != null ? String(f.currency) : null,
    language: f.language != null ? String(f.language) : null,
    advertiserCountry: f.advertiserCountry != null ? String(f.advertiserCountry) : null,
    inventoryComplete: f.inventoryComplete === true,
    inventoryError: f.inventoryError != null ? String(f.inventoryError) : null,
    inventoriedAt: f.inventoriedAt != null ? String(f.inventoriedAt) : null,
    runId: f.runId != null ? String(f.runId) : null,
  };
}

/**
 * Normalize inventory rows from live-sync sampleProductsForManagedPartners.
 */
export function buildFeedInventoryDocument(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const feeds = (Array.isArray(opts.feeds) ? opts.feeds : []).map(sanitizeFeedRow).filter((f) => f.advertiserId);
  const partners = Array.isArray(opts.partners) ? opts.partners : [];
  const partnerErrors = opts.partnerErrors && typeof opts.partnerErrors === "object" ? opts.partnerErrors : {};
  const byAdv = new Map();
  for (const f of feeds) {
    const adv = String(f.advertiserId || "");
    if (!adv) continue;
    if (!byAdv.has(adv)) {
      byAdv.set(adv, {
        advertiserId: adv,
        partnerName: f.partnerName || null,
        feeds: [],
        feedCount: 0,
        declaredProductCountSum: 0,
        inventoryComplete: true,
        inventoriedAt: f.inventoriedAt || nowIso,
        runId: f.runId || opts.runId || null,
        inventoryError: null,
      });
    }
    const g = byAdv.get(adv);
    g.feeds.push({
      adId: f.adId,
      feedName: f.feedName,
      productCount: f.productCount,
      lastUpdated: f.lastUpdated,
      sourceFeedType: f.sourceFeedType,
      currency: f.currency,
      language: f.language,
      advertiserCountry: f.advertiserCountry,
      inventoryComplete: f.inventoryComplete === true,
    });
    g.feedCount += 1;
    if (f.productCount != null && Number.isFinite(Number(f.productCount))) {
      g.declaredProductCountSum += Number(f.productCount);
    }
    if (f.inventoryComplete !== true) g.inventoryComplete = false;
    if (f.inventoryError) g.inventoryError = f.inventoryError;
    if (f.inventoriedAt) g.inventoriedAt = f.inventoriedAt;
    if (f.runId) g.runId = f.runId;
  }

  const partnerSummaries = [];
  for (const p of partners) {
    const adv = String(p.advertiserId || "");
    if (!adv) continue;
    const inv = byAdv.get(adv) || null;
    const err = partnerErrors[adv] || inv?.inventoryError || null;
    let status = PARTNER_INVENTORY_STATUS.NOT_YET_INVENTORIED;
    if (err) {
      const e = String(err).toLowerCase();
      status =
        e.includes("permission") || e.includes("auth") || e.includes("forbidden") || e.includes("401")
          ? PARTNER_INVENTORY_STATUS.PERMISSION_BLOCKED
          : PARTNER_INVENTORY_STATUS.ERROR;
    } else if (inv && inv.feedCount > 0) {
      status =
        inv.inventoryComplete === true
          ? PARTNER_INVENTORY_STATUS.INVENTORIED_HAS_FEED
          : PARTNER_INVENTORY_STATUS.INCOMPLETE;
    } else if (inv && inv.feedCount === 0 && (opts.inventoriedAdvertiserIds?.has?.(adv) || inv.inventoriedAt)) {
      status = PARTNER_INVENTORY_STATUS.INVENTORIED_NO_FEED;
    } else if (opts.inventoriedAdvertiserIds?.has?.(adv) && !inv) {
      status = PARTNER_INVENTORY_STATUS.INVENTORIED_NO_FEED;
    }
    partnerSummaries.push({
      advertiserId: adv,
      partnerName: p.title || p.partnerName || p.displayNameCs || p.cjName || inv?.partnerName || null,
      active: p.active !== false,
      joined: p.joined !== false,
      hasFeed: Boolean(inv && inv.feedCount > 0),
      feedCount: inv?.feedCount || 0,
      declaredProductCountSum: inv?.declaredProductCountSum || 0,
      inventoryComplete: inv ? inv.inventoryComplete === true : null,
      inventoryStatus: status,
      inventoriedAt: inv?.inventoriedAt || null,
      inventoryError: err || null,
      runId: inv?.runId || null,
    });
  }

  const withFeed = partnerSummaries.filter((p) => p.hasFeed).length;
  const withoutFeed = partnerSummaries.filter(
    (p) => p.inventoryStatus === PARTNER_INVENTORY_STATUS.INVENTORIED_NO_FEED
  ).length;
  const notYet = partnerSummaries.filter(
    (p) => p.inventoryStatus === PARTNER_INVENTORY_STATUS.NOT_YET_INVENTORIED
  ).length;
  const errored = partnerSummaries.filter(
    (p) =>
      p.inventoryStatus === PARTNER_INVENTORY_STATUS.ERROR ||
      p.inventoryStatus === PARTNER_INVENTORY_STATUS.PERMISSION_BLOCKED
  ).length;
  return {
    schema: FEED_INVENTORY_SCHEMA,
    evidenceClass: opts.evidenceClass || "CURRENT_PRODUCTION",
    at: nowIso,
    runId: opts.runId || null,
    snapshotId: opts.snapshotId || nowIso,
    sha: opts.sha || null,
    source: opts.source || "shoppingProductFeeds",
    inventoryEnabled: opts.inventoryEnabled === true,
    inventoryMode: opts.inventoryMode || (opts.inventoryEnabled === true ? "full" : "disabled"),
    progressiveLimit: opts.progressiveLimit != null ? Number(opts.progressiveLimit) : null,
    note:
      opts.note ||
      (opts.inventoryEnabled === true
        ? "Full feed list from authorized shoppingProductFeeds inventory (not extrapolated)."
        : opts.inventoryMode === "progressive"
          ? "Progressive durable inventory — merge across runs; not extrapolated."
          : "Inventory disabled this run — durable file records empty/partial state honestly."),
    counts: {
      feedRows: feeds.length,
      partnersInventoried: partnerSummaries.filter(
        (p) => p.inventoryStatus !== PARTNER_INVENTORY_STATUS.NOT_YET_INVENTORIED
      ).length,
      partnersWithFeed: withFeed,
      partnersWithoutFeed: withoutFeed,
      partnersNotYetInventoried: notYet,
      partnersErrorOrBlocked: errored,
      partnersListed: partnerSummaries.length,
      declaredProductCountSum: feeds.reduce(
        (n, f) => n + (f.productCount != null && Number.isFinite(Number(f.productCount)) ? Number(f.productCount) : 0),
        0
      ),
    },
    partners: partnerSummaries,
    feeds,
    byAdvertiser: [...byAdv.values()],
  };
}

/**
 * Merge previous durable inventory with this-run feed rows.
 * This-run rows win per advertiser; other advertisers keep prior evidence.
 */
export function mergeFeedInventoryDocuments(prevDoc, nextFeeds, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const partners = Array.isArray(opts.partners) ? opts.partners : prevDoc?.partners || [];
  const prevFeeds = Array.isArray(prevDoc?.feeds) ? prevDoc.feeds.map(sanitizeFeedRow) : [];
  const incoming = (Array.isArray(nextFeeds) ? nextFeeds : []).map(sanitizeFeedRow);
  const touched = new Set(
    incoming.map((f) => String(f.advertiserId || "")).filter(Boolean)
  );
  // Also mark explicit no-feed / error partners from this run.
  for (const id of opts.inventoriedAdvertiserIds || []) touched.add(String(id));
  for (const id of Object.keys(opts.partnerErrors || {})) touched.add(String(id));

  const kept = prevFeeds.filter((f) => f.advertiserId && !touched.has(String(f.advertiserId)));
  const stampedIncoming = incoming.map((f) => ({
    ...f,
    inventoriedAt: f.inventoriedAt || nowIso,
    runId: f.runId || opts.runId || null,
  }));
  const mergedFeeds = [...kept, ...stampedIncoming];

  // Carry forward inventoried-no-feed markers from prev partner summaries.
  const inventoriedIds = new Set(
    (prevDoc?.partners || [])
      .filter(
        (p) =>
          p &&
          p.inventoryStatus &&
          p.inventoryStatus !== PARTNER_INVENTORY_STATUS.NOT_YET_INVENTORIED
      )
      .map((p) => String(p.advertiserId))
  );
  for (const id of touched) inventoriedIds.add(String(id));

  const partnerErrors = { ...(opts.partnerErrors || {}) };
  for (const p of prevDoc?.partners || []) {
    if (p?.inventoryError && !touched.has(String(p.advertiserId))) {
      partnerErrors[String(p.advertiserId)] = p.inventoryError;
    }
  }

  return buildFeedInventoryDocument({
    feeds: mergedFeeds,
    partners,
    nowIso,
    runId: opts.runId || null,
    snapshotId: opts.snapshotId || null,
    sha: opts.sha || null,
    inventoryEnabled: opts.inventoryEnabled === true,
    inventoryMode: opts.inventoryMode || "progressive",
    progressiveLimit: opts.progressiveLimit,
    inventoriedAdvertiserIds: inventoriedIds,
    partnerErrors,
    evidenceClass: opts.evidenceClass || prevDoc?.evidenceClass || "CURRENT_PRODUCTION",
    note: opts.note,
    source: opts.source || prevDoc?.source || "shoppingProductFeeds",
  });
}

/**
 * Pick JOINED/active partners that still need inventory (progressive slice).
 */
export function selectPartnersForProgressiveInventory(partners, prevDoc, opts = {}) {
  const limit = Math.max(0, Math.min(500, Number(opts.limit) || 30));
  const list = Array.isArray(partners) ? partners.filter((p) => p && p.active !== false && p.advertiserId != null) : [];
  const statusByAdv = new Map(
    (prevDoc?.partners || []).map((p) => [String(p.advertiserId), p.inventoryStatus || null])
  );
  const need = [];
  const done = [];
  for (const p of list) {
    const st = statusByAdv.get(String(p.advertiserId));
    if (
      !st ||
      st === PARTNER_INVENTORY_STATUS.NOT_YET_INVENTORIED ||
      (opts.retryErrors === true &&
        (st === PARTNER_INVENTORY_STATUS.ERROR || st === PARTNER_INVENTORY_STATUS.INCOMPLETE))
    ) {
      need.push(p);
    } else {
      done.push(p);
    }
  }
  return {
    limit,
    selected: need.slice(0, limit),
    remaining: Math.max(0, need.length - limit),
    alreadyInventoried: done.length,
    needingInventory: need.length,
  };
}

/**
 * Slim cumulative coverage export for audits (no everMatchedUniqueKeys explosion).
 */
export function buildCumulativeCoverageLedgerV40(refreshDoc = {}, opts = {}) {
  const cum = refreshDoc?.cumulative || {};
  const horizons = cum.horizons || {};
  const snapshots = Array.isArray(cum.snapshots) ? cum.snapshots : [];
  return {
    schema: "iu-cj-affiliate-phase3z-cumulative-coverage-v40",
    evidenceClass: opts.evidenceClass || "CURRENT_PRODUCTION",
    at: opts.nowIso || new Date().toISOString(),
    runId: opts.runId || null,
    snapshotId: opts.snapshotId || null,
    sha: opts.sha || null,
    source: "iu-affiliate-cj-refresh-coverage-v35.json#cumulative",
    everMatchedCount: cum.everMatchedCount != null ? Number(cum.everMatchedCount) : null,
    lastPass: cum.lastPass || null,
    horizons: {
      "3h": horizons["3h"] || { status: "INSUFFICIENT_EVIDENCE" },
      "6h": horizons["6h"] || { status: "INSUFFICIENT_EVIDENCE" },
      "12h": horizons["12h"] || { status: "INSUFFICIENT_EVIDENCE" },
      "24h": horizons["24h"] || { status: "INSUFFICIENT_EVIDENCE" },
      "48h": horizons["48h"] || { status: "INSUFFICIENT_EVIDENCE" },
    },
    snapshotCount: snapshots.length,
    snapshots: snapshots.map((s) => ({
      at: s.at,
      runId: s.runId,
      refreshMode: s.refreshMode,
      publishedUnique: s.publishedUnique,
      passMatchedUnique: s.passMatchedUnique,
      passNotMatchedUnique: s.passNotMatchedUnique,
      passCoveragePct: s.passCoveragePct,
      cumulativeMatchedUnique: s.cumulativeMatchedUnique,
      cumulativeNotMatchedUnique: s.cumulativeNotMatchedUnique,
      cumulativeCoveragePct: s.cumulativeCoveragePct,
      priceChanges: s.priceChanges,
      availabilityChanges: s.availabilityChanges,
      errors: s.errors,
      measured: s.measured === true,
    })),
    note: "Horizons use wall-clock elapsed evidence only; never extrapolated.",
  };
}
