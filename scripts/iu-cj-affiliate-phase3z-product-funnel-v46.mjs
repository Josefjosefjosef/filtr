#!/usr/bin/env node
/**
 * V46 — FEED → FETCHED → VALIDATED → CZ_ELIGIBLE → CATEGORY_ASSIGNED → READY → PUBLISHED funnel.
 * Counts are measured only; never invent product availability from feed metadata alone.
 */
export const PRODUCT_FUNNEL_SCHEMA = "iu-cj-affiliate-phase3z-product-funnel-v46";

export const FUNNEL_EXCLUDE = Object.freeze({
  NO_FEED: "NO_FEED",
  PRODUCT_API_EMPTY: "PRODUCT_API_EMPTY_OR_NO_ACCESS",
  FETCHED_NOT_READY: "FETCHED_BUT_NOT_PUBLICATION_READY",
  NO_CATEGORY: "NO_CATEGORY_SECTION",
  PRESENTATION_BUDGET: "VALID_NOT_PUBLISHED_PRESENTATION_BUDGET",
  NOT_IN_OFFERS: "NOT_IN_OFFERS_UNKNOWN",
});

/**
 * Honest offers stats: partners = unique advertisers (not section count).
 */
export function computeHonestOffersStats(sections = [], opts = {}) {
  const productAdv = new Set();
  const couponAdv = new Set();
  const actionAdv = new Set();
  let coupons = 0;
  let actions = 0;
  let products = 0;
  let publicationReady = 0;
  let crossCategoryOfferPlacements =
    opts.crossCategoryOfferPlacements != null ? Number(opts.crossCategoryOfferPlacements) : 0;
  const list = Array.isArray(sections) ? sections : [];
  for (const sec of list) {
    for (const c of sec.coupons || []) {
      coupons += 1;
      if (c.advertiserId != null) couponAdv.add(String(c.advertiserId));
      if (c.publicationReady !== false) publicationReady += 1;
    }
    for (const a of sec.actions || []) {
      actions += 1;
      if (a.advertiserId != null) actionAdv.add(String(a.advertiserId));
      if (a.publicationReady !== false) publicationReady += 1;
    }
    for (const p of sec.products || []) {
      products += 1;
      if (p.advertiserId != null) productAdv.add(String(p.advertiserId));
      if (p.publicationReady !== false) publicationReady += 1;
    }
  }
  const any = new Set([...productAdv, ...couponAdv, ...actionAdv]);
  const sectionsWithOffers = list.filter(
    (s) => (s.coupons?.length || 0) + (s.actions?.length || 0) + (s.products?.length || 0) > 0
  ).length;
  return {
    // V46: unique advertisers with ≥1 coupon/action/product (was wrongly sections.length).
    partners: any.size,
    sections: list.length,
    sectionsWithOffers,
    productAdvertisers: productAdv.size,
    couponAdvertisers: couponAdv.size,
    actionAdvertisers: actionAdv.size,
    coupons,
    actions,
    products,
    publicationReady,
    crossCategoryOfferPlacements,
    statsSemantics:
      "partners=unique advertisers with offers; sections=section bucket count; productAdvertisers=unique product advertisers",
  };
}

/**
 * Build per-partner funnel rows from inventory + checkpoints + offers + optional fetch meta.
 */
export function buildProductFunnelDocument(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const inventoryPartners = Array.isArray(opts.inventoryPartners) ? opts.inventoryPartners : [];
  const checkpoints = opts.checkpoints && typeof opts.checkpoints === "object" ? opts.checkpoints : {};
  const publishedByAdv =
    opts.publishedByAdvertiser && typeof opts.publishedByAdvertiser === "object"
      ? opts.publishedByAdvertiser
      : {};
  const fetchMetaByAdv =
    opts.fetchMetaByAdvertiser && typeof opts.fetchMetaByAdvertiser === "object"
      ? opts.fetchMetaByAdvertiser
      : {};

  const rows = [];
  for (const inv of inventoryPartners) {
    const id = String(inv.advertiserId || "");
    if (!id) continue;
    const cp = checkpoints[id] || null;
    const pub = publishedByAdv[id] || null;
    const fm = fetchMetaByAdv[id] || null;
    const hasFeed = inv.hasFeed === true || Number(inv.feedCount) > 0;
    const declared =
      inv.declaredProductCountSum != null && Number.isFinite(Number(inv.declaredProductCountSum))
        ? Number(inv.declaredProductCountSum)
        : null;
    const fetched =
      fm?.fetched != null
        ? Number(fm.fetched)
        : cp?.lastFetchedCount != null
          ? Number(cp.lastFetchedCount)
          : null;
    const total =
      fm?.totalCount != null
        ? Number(fm.totalCount)
        : cp?.lastTotalCount != null
          ? Number(cp.lastTotalCount)
          : null;
    const validated = fm?.validated != null ? Number(fm.validated) : null;
    const ready = fm?.publishReady != null ? Number(fm.publishReady) : null;
    const publishedOcc = pub?.occurrences != null ? Number(pub.occurrences) : 0;
    const publishedUnique = pub?.unique != null ? Number(pub.unique) : 0;

    let excludeReason = null;
    if (!hasFeed) excludeReason = FUNNEL_EXCLUDE.NO_FEED;
    else if (publishedOcc <= 0) {
      if (fetched === 0 && (total === 0 || total == null)) excludeReason = FUNNEL_EXCLUDE.PRODUCT_API_EMPTY;
      else if ((fetched || 0) > 0 && (ready == null || ready === 0)) excludeReason = FUNNEL_EXCLUDE.FETCHED_NOT_READY;
      else if ((ready || 0) > 0 && publishedOcc <= 0) excludeReason = FUNNEL_EXCLUDE.PRESENTATION_BUDGET;
      else excludeReason = FUNNEL_EXCLUDE.NOT_IN_OFFERS;
    }

    rows.push({
      advertiserId: id,
      partnerName: inv.partnerName || null,
      stages: {
        FEED: hasFeed,
        feedCount: inv.feedCount || 0,
        declaredProductCountSum: declared,
        FETCHED: fetched,
        sourceTotalCount: total,
        VALIDATED: validated,
        CZ_ELIGIBLE: ready,
        CATEGORY_ASSIGNED: pub?.sections ? pub.sections.length : publishedOcc > 0 ? null : 0,
        READY: ready,
        PUBLISHED: publishedOcc,
        PUBLISHED_UNIQUE: publishedUnique,
        DOM_RENDERED: null,
      },
      inventoryStatus: inv.inventoryStatus || null,
      checkpoint: cp
        ? {
            resumeOffset: cp.resumeOffset ?? null,
            lastComplete: cp.lastComplete === true,
            completePassCount: cp.completePassCount ?? null,
            presentationCursor: cp.presentationCursor ?? null,
            productsRemainingEstimate: cp.productsRemainingEstimate ?? null,
            lastError: cp.lastError ?? null,
          }
        : null,
      excludeReason,
      inPublicCatalog: publishedOcc > 0,
    });
  }

  const withFeed = rows.filter((r) => r.stages.FEED).length;
  const inCatalog = rows.filter((r) => r.inPublicCatalog).length;
  const reasons = {};
  for (const r of rows) {
    if (!r.excludeReason) continue;
    reasons[r.excludeReason] = (reasons[r.excludeReason] || 0) + 1;
  }

  return {
    schema: PRODUCT_FUNNEL_SCHEMA,
    evidenceClass: opts.evidenceClass || "CURRENT_PRODUCTION",
    at: nowIso,
    runId: opts.runId || null,
    sha: opts.sha || null,
    note:
      "Feed metadata declared counts are not loaded catalog. PUBLISHED is offers-public occurrences. DOM_RENDERED requires separate browser proof.",
    counts: {
      partnersListed: rows.length,
      withFeed,
      inPublicCatalog: inCatalog,
      missingFromCatalog: withFeed - inCatalog,
      excludeReasons: reasons,
    },
    partners: rows,
  };
}
