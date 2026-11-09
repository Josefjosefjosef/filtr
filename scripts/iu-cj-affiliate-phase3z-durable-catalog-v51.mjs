#!/usr/bin/env node
/**
 * V51.8 final — durable product catalog independent of presentation window.
 *
 * Root cause this fixes:
 * offers-public was both "catalog" and "UI presentation slice". Each run rebuilt
 * a partner presentation budget, then LKG treated missing presentation identities
 * as HOLD → public LIVE collapsed even though products were only unseen in-window.
 *
 * Layer A: durable catalog (all validated identities, retain across incomplete windows)
 * Layer B: public selection (only publication-eligible; presentation budget applied later)
 */
import {
  compoundProductKey,
  PUBLICATION_ELIGIBILITY,
  CATALOG_STATUS,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

function trustedUrl(url) {
  const s = String(url || "");
  return /^https:\/\/(www\.)?(kqzyfj|jdoqocy|tkqlhce|dpbolvw|anrdoezrs|pjatr)\.(com|net)\//i.test(s);
}

export const DURABLE_CATALOG_SCHEMA = "iu-cj-affiliate-phase3z-durable-catalog-v51";
export const DURABLE_CATALOG_REL = "projects/data/iu-affiliate-cj-durable-catalog-v51.json";

export function emptyDurableCatalog(nowIso = new Date().toISOString()) {
  return {
    schema: DURABLE_CATALOG_SCHEMA,
    updatedAt: nowIso,
    products: {},
    stats: {
      catalogUnique: 0,
      publicEligible: 0,
      hold: 0,
      blocked: 0,
      confirmedRemoved: 0,
    },
  };
}

function productAgeHours(entry, nowMs) {
  const ts =
    entry?.lastSourceMatchAt ||
    entry?.lastSuccessfulRefreshAt ||
    entry?.priceVerifiedAt ||
    entry?.updatedAt ||
    null;
  const ms = ts ? Date.parse(ts) : NaN;
  if (!Number.isFinite(ms)) return null;
  return (nowMs - ms) / 3600000;
}

/**
 * Upsert source-verified rows into durable catalog; retain unseen identities.
 */
export function mergeIntoDurableCatalog(priorDoc, sourceRows, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  const staleAfterHours = Math.max(1, Number(opts.staleAfterHours) || 72);
  const ended =
    opts.endedAdvertisers instanceof Set
      ? opts.endedAdvertisers
      : new Set(opts.endedAdvertisers || []);
  const revoked =
    opts.revokedAdvertisers instanceof Set
      ? opts.revokedAdvertisers
      : new Set(opts.revokedAdvertisers || []);
  const incomplete =
    opts.incompleteAdvertisers instanceof Set
      ? opts.incompleteAdvertisers
      : new Set(opts.incompleteAdvertisers || []);
  // When provided, ONLY previously-LIVE identities may stay public as LAST_KNOWN_PENDING_REVERIFY.
  // Catalog retention of never-LIVE unseen identities must not imply PUBLICATION_ELIGIBLE.
  const livePublicKeys =
    opts.livePublicKeys == null
      ? null
      : opts.livePublicKeys instanceof Set
        ? opts.livePublicKeys
        : new Set(opts.livePublicKeys || []);

  const doc = priorDoc?.products
    ? JSON.parse(JSON.stringify(priorDoc))
    : emptyDurableCatalog(nowIso);
  doc.schema = DURABLE_CATALOG_SCHEMA;
  doc.updatedAt = nowIso;
  if (!doc.products) doc.products = {};

  const seen = new Set();
  let upserted = 0;
  for (const row of sourceRows || []) {
    const adv = String(row.advertiserId || "");
    const pid = String(row.productId || "");
    if (!adv || !pid) continue;
    const key = compoundProductKey(adv, pid);
    seen.add(key);
    const prev = doc.products[key] || {};
    const url = row.affiliateUrl || prev.affiliateUrl || null;
    const urlOk = trustedUrl(url);
    let eligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE;
    const catalogStatus = CATALOG_STATUS.CATALOG_RETAINED;
    if (ended.has(adv) || revoked.has(adv) || !urlOk) {
      eligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED;
    }
    const price = row.currentPrice ?? prev.currentPrice ?? null;
    doc.products[key] = {
      ...prev,
      advertiserId: adv,
      productId: pid,
      partnerName: row.partnerName || prev.partnerName || null,
      sectionKey: row.sectionKey || prev.sectionKey || null,
      title: row.title || row.name || prev.title || null,
      imageUrl: row.imageUrl || prev.imageUrl || null,
      currentPrice: price,
      originalPrice: row.originalPrice ?? prev.originalPrice ?? null,
      currency: row.currency || prev.currency || null,
      availability: row.availability || prev.availability || null,
      affiliateUrl: url,
      feedId: row.feedId || prev.feedId || null,
      catalogStatus,
      publicationEligibility: eligibility,
      publicOffer: eligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE,
      lkgPublicHold: false,
      hideAsCurrent: false,
      lastSourceMatchAt: nowIso,
      priceVerifiedAt: nowIso,
      availabilityVerifiedAt: nowIso,
      affiliateUrlVerifiedAt: urlOk ? nowIso : prev.affiliateUrlVerifiedAt || null,
      lastSuccessfulRefreshAt: nowIso,
      sourceFreshLabelForbidden: false,
      freshnessStatus: "SOURCE_VERIFIED",
      freshnessReason: "DURABLE_CATALOG_SOURCE_UPSERT",
      updatedAt: nowIso,
      publicationReady: true,
    };
    upserted += 1;
  }

  let retainedUnseen = 0;
  let heldStale = 0;
  let keptPublicPending = 0;
  for (const [key, prev] of Object.entries(doc.products)) {
    if (seen.has(key)) continue;
    if (prev.catalogStatus === CATALOG_STATUS.CONFIRMED_REMOVED) continue;
    if (prev.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED) continue;
    const adv = String(prev.advertiserId || "");
    if (ended.has(adv) || revoked.has(adv)) {
      prev.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED;
      prev.publicOffer = false;
      prev.lkgPublicHold = false;
      prev.hideAsCurrent = true;
      prev.freshnessReason = "PARTNER_ENDED_OR_REVOKED";
      prev.updatedAt = nowIso;
      continue;
    }
    if (!trustedUrl(prev.affiliateUrl)) {
      prev.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED;
      prev.publicOffer = false;
      prev.hideAsCurrent = true;
      prev.freshnessReason = "INVALID_AFFILIATE_URL";
      prev.updatedAt = nowIso;
      continue;
    }
    const age = productAgeHours(prev, nowMs);
    const partnerIncomplete = incomplete.has(adv) || incomplete.size > 0;
    const wasLive =
      livePublicKeys != null
        ? livePublicKeys.has(key)
        : prev.publicOffer === true ||
          prev.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE;
    if (age != null && age >= staleAfterHours) {
      prev.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD;
      prev.publicOffer = false;
      prev.lkgPublicHold = true;
      prev.hideAsCurrent = true;
      prev.catalogStatus = CATALOG_STATUS.CATALOG_RETAINED;
      prev.freshnessStatus = "UNKNOWN";
      prev.freshnessReason = "DURABLE_CATALOG_STALE_HOLD";
      prev.sourceFreshLabelForbidden = true;
      heldStale += 1;
    } else if (wasLive) {
      // Keep already-LIVE cards pending reverify; do not claim SOURCE_VERIFIED/CURRENT.
      prev.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE;
      prev.publicOffer = true;
      prev.lkgPublicHold = false;
      prev.hideAsCurrent = false;
      prev.catalogStatus = CATALOG_STATUS.CATALOG_RETAINED;
      prev.freshnessStatus = "LAST_KNOWN_PENDING_REVERIFY";
      prev.freshnessReason = partnerIncomplete
        ? "NOT_YET_SEEN_INCOMPLETE_WINDOW_KEEP_PUBLIC"
        : "NOT_YET_SEEN_KEEP_PUBLIC_WITHIN_STALE_POLICY";
      prev.sourceFreshLabelForbidden = true;
      keptPublicPending += 1;
    } else {
      // Never-LIVE + unseen in this window: retain in durable catalog, HOLD for publication.
      prev.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD;
      prev.publicOffer = false;
      prev.lkgPublicHold = true;
      prev.hideAsCurrent = true;
      prev.catalogStatus = CATALOG_STATUS.CATALOG_RETAINED;
      prev.freshnessStatus = "LAST_KNOWN_PENDING_REVERIFY";
      prev.freshnessReason = "NOT_YET_SEEN_NEVER_LIVE_PUBLICATION_HOLD";
      prev.sourceFreshLabelForbidden = true;
      heldStale += 1;
    }
    prev.updatedAt = nowIso;
    retainedUnseen += 1;
  }

  const stats = summarizeDurableCatalog(doc);
  doc.stats = stats;
  doc.lastMerge = {
    at: nowIso,
    sourceUpserted: upserted,
    retainedUnseen,
    heldStale,
    keptPublicPending,
    seenCount: seen.size,
  };
  return { doc, seen, stats };
}

export function summarizeDurableCatalog(doc) {
  let catalogUnique = 0;
  let publicEligible = 0;
  let hold = 0;
  let blocked = 0;
  let confirmedRemoved = 0;
  let sourceVerified = 0;
  let pendingReverify = 0;
  for (const p of Object.values(doc?.products || {})) {
    catalogUnique += 1;
    if (p.catalogStatus === CATALOG_STATUS.CONFIRMED_REMOVED) {
      confirmedRemoved += 1;
      continue;
    }
    if (p.freshnessStatus === "SOURCE_VERIFIED") sourceVerified += 1;
    if (p.freshnessStatus === "LAST_KNOWN_PENDING_REVERIFY") pendingReverify += 1;
    if (p.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED) blocked += 1;
    else if (
      p.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD ||
      p.lkgPublicHold === true
    )
      hold += 1;
    else if (
      p.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE &&
      p.publicOffer !== false
    )
      publicEligible += 1;
  }
  return {
    catalogUnique,
    publicEligible,
    hold,
    blocked,
    confirmedRemoved,
    sourceVerified,
    pendingReverify,
  };
}

/**
 * Build presentation product list from durable catalog public-eligible entries.
 */
export function selectPublicProductsFromDurableCatalog(doc, opts = {}) {
  const publishPerPartner = Math.max(0, Number(opts.publishPerPartner) || 0);
  const eligible = [];
  for (const p of Object.values(doc?.products || {})) {
    if (p.catalogStatus === CATALOG_STATUS.CONFIRMED_REMOVED) continue;
    if (p.publicationEligibility !== PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE) continue;
    if (p.publicOffer === false || p.lkgPublicHold === true) continue;
    if (!trustedUrl(p.affiliateUrl)) continue;
    if (p.currentPrice == null || !(Number(p.currentPrice) > 0)) continue;
    eligible.push(p);
  }
  eligible.sort((a, b) =>
    String(b.lastSourceMatchAt || "").localeCompare(String(a.lastSourceMatchAt || ""))
  );
  if (!publishPerPartner) return eligible;
  const selected = [];
  const counts = new Map();
  for (const p of eligible) {
    const adv = String(p.advertiserId || "");
    const n = counts.get(adv) || 0;
    if (n >= publishPerPartner) continue;
    counts.set(adv, n + 1);
    selected.push(p);
  }
  return selected;
}

/**
 * Public population gates — previous LIVE public vs next public only.
 */
export function evaluatePublicPopulationGates(prevPublicDoc, nextPublicDoc, opts = {}) {
  function publicUnique(doc) {
    const s = new Set();
    for (const sec of doc?.sections || []) {
      for (const p of sec.products || []) {
        if (!p || p.publicationReady === false) continue;
        if (p.publicOffer === false || p.lkgPublicHold === true) continue;
        if (p.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD) continue;
        if (p.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED) continue;
        s.add(compoundProductKey(p.advertiserId, p.productId));
      }
    }
    return s;
  }
  const prev = publicUnique(prevPublicDoc);
  const next = publicUnique(nextPublicDoc);
  let removed = 0;
  let added = 0;
  for (const k of prev) if (!next.has(k)) removed += 1;
  for (const k of next) if (!prev.has(k)) added += 1;
  const prevN = prev.size;
  const nextN = next.size;
  const drop = Math.max(0, prevN - nextN);
  const growth = Math.max(0, nextN - prevN);
  const maxDropAbs = opts.maxDropAbs != null ? Number(opts.maxDropAbs) : 50;
  const maxDropRatio = opts.maxDropRatio != null ? Number(opts.maxDropRatio) : 0.03;
  const maxGrowthAbs = opts.maxGrowthAbs != null ? Number(opts.maxGrowthAbs) : 500;
  const maxGrowthRatio = opts.maxGrowthRatio != null ? Number(opts.maxGrowthRatio) : 0.2;
  const incompleteFeeds = opts.incompleteFeeds === true;
  const dropRatio = prevN > 0 ? drop / prevN : 0;
  const growthRatio = prevN > 0 ? growth / prevN : growth > 0 ? 1 : 0;
  const shrinkOk =
    drop <= maxDropAbs || dropRatio <= maxDropRatio || (incompleteFeeds && dropRatio <= 0.25);
  const growthOk = growth <= maxGrowthAbs || growthRatio <= maxGrowthRatio;
  const churnRatio = prevN > 0 ? Math.max(removed, added) / prevN : 0;
  const churnOk = churnRatio <= 0.25 || (incompleteFeeds && removed === 0);
  return {
    ok: shrinkOk && growthOk,
    shrinkOk,
    growthOk,
    churnOk,
    prevPublicUnique: prevN,
    nextPublicUnique: nextN,
    removed,
    added,
    drop,
    growth,
    dropRatio,
    growthRatio,
    churnRatio,
    incompleteFeeds,
    reason: !shrinkOk
      ? "PUBLIC_SHRINKAGE_REFUSED"
      : !growthOk
        ? "PUBLIC_GROWTH_REFUSED"
        : "PUBLIC_POPULATION_WITHIN_POLICY",
  };
}

/**
 * Seed durable catalog from a LIVE offers-public document (bootstrap).
 */
export function seedDurableCatalogFromOffersPublic(offersDoc, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const rows = [];
  for (const sec of offersDoc?.sections || []) {
    for (const p of sec.products || []) {
      if (!p || p.publicationReady === false) continue;
      rows.push({
        advertiserId: p.advertiserId,
        productId: p.productId,
        partnerName: p.partnerName || sec.partnerName,
        sectionKey: p.sectionKey || sec.sectionKey,
        title: p.title || p.name,
        imageUrl: p.imageUrl,
        currentPrice: p.currentPrice,
        originalPrice: p.originalPrice,
        currency: p.currency,
        availability: p.availability,
        affiliateUrl: p.affiliateUrl,
        feedId: p.feedId,
      });
    }
  }
  return mergeIntoDurableCatalog(emptyDurableCatalog(nowIso), rows, {
    ...opts,
    nowIso,
    incompleteAdvertisers: new Set(),
  });
}
