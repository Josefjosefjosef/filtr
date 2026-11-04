#!/usr/bin/env node
/**
 * V40 — durable CJ shopping-product feed inventory (full list, not a 40-row sample).
 * Does not invent product counts; records only what CJ inventory returns.
 */
export const FEED_INVENTORY_SCHEMA = "iu-cj-affiliate-phase3z-feed-inventory-v40";

/**
 * Normalize inventory rows from live-sync sampleProductsForManagedPartners.
 */
export function buildFeedInventoryDocument(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const feeds = Array.isArray(opts.feeds) ? opts.feeds : [];
  const partners = Array.isArray(opts.partners) ? opts.partners : [];
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
      });
    }
    const g = byAdv.get(adv);
    g.feeds.push({
      adId: f.adId != null ? String(f.adId) : null,
      feedName: f.feedName || null,
      productCount: f.productCount != null && Number.isFinite(Number(f.productCount)) ? Number(f.productCount) : null,
      lastUpdated: f.lastUpdated || null,
      sourceFeedType: f.sourceFeedType || null,
      currency: f.currency || null,
      language: f.language || null,
      advertiserCountry: f.advertiserCountry || null,
      inventoryComplete: f.inventoryComplete === true,
    });
    g.feedCount += 1;
    if (f.productCount != null && Number.isFinite(Number(f.productCount))) {
      g.declaredProductCountSum += Number(f.productCount);
    }
    if (f.inventoryComplete !== true) g.inventoryComplete = false;
  }

  const partnerSummaries = [];
  for (const p of partners) {
    const adv = String(p.advertiserId || "");
    if (!adv) continue;
    const inv = byAdv.get(adv) || null;
    partnerSummaries.push({
      advertiserId: adv,
      partnerName: p.title || p.partnerName || inv?.partnerName || null,
      active: p.active !== false,
      joined: p.joined !== false,
      hasFeed: Boolean(inv && inv.feedCount > 0),
      feedCount: inv?.feedCount || 0,
      declaredProductCountSum: inv?.declaredProductCountSum || 0,
      inventoryComplete: inv ? inv.inventoryComplete === true : null,
    });
  }

  const withFeed = partnerSummaries.filter((p) => p.hasFeed).length;
  const withoutFeed = partnerSummaries.filter((p) => !p.hasFeed).length;
  return {
    schema: FEED_INVENTORY_SCHEMA,
    evidenceClass: opts.evidenceClass || "CURRENT_PRODUCTION",
    at: nowIso,
    runId: opts.runId || null,
    snapshotId: opts.snapshotId || nowIso,
    sha: opts.sha || null,
    source: opts.source || "shoppingProductFeeds",
    inventoryEnabled: opts.inventoryEnabled === true,
    note:
      opts.inventoryEnabled === true
        ? "Full feed list from authorized shoppingProductFeeds inventory (not extrapolated)."
        : "Inventory disabled this run — durable file records empty/partial state honestly.",
    counts: {
      feedRows: feeds.length,
      partnersInventoried: byAdv.size,
      partnersWithFeed: withFeed,
      partnersWithoutFeed: withoutFeed,
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
