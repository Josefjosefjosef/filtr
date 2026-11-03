#!/usr/bin/env node
/**
 * V32 — freshness policy for published CJ offers (products / coupons / actions).
 * Discovery must not block refresh of already-published rows.
 */
export const OFFERS_FRESHNESS_SCHEMA = "iu-cj-affiliate-phase3z-offers-freshness-v32";

/** Target intervals (ms). Documented targets; infrastructure may be slower — never claim met without proof. */
export const FRESHNESS_POLICY_V32 = Object.freeze({
  productPriceAvailabilityMs: 3 * 60 * 60 * 1000, // target 1–3h → use 3h ceiling
  couponActionSourceSyncMs: 6 * 60 * 60 * 1000,
  emailIngestTargetMs: 30 * 60 * 1000,
  joinedStatusMs: 60 * 60 * 1000,
  discoveryContinueMs: 24 * 60 * 60 * 1000,
  stalePublicHideMs: 24 * 60 * 60 * 1000, // hide price if unchecked beyond this
  note:
    "Targets depend on CJ API freshness + GitHub Actions quotas. Do not present stale prices as current.",
});

export const FRESHNESS_STATUS = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  EXPIRED: "EXPIRED",
  UNVERIFIED: "UNVERIFIED",
  HIDDEN_STALE: "HIDDEN_STALE",
  REFRESH_PENDING: "REFRESH_PENDING",
  SOURCE_OUTAGE_KEEP_INTERNAL_LKG: "SOURCE_OUTAGE_KEEP_INTERNAL_LKG",
});

export function parseOfferInstant(raw) {
  if (raw == null || raw === "") return null;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

/**
 * Render-time / sync-time expiry for coupons/actions.
 * end exclusive unless endsAtInclusive=true.
 */
export function isOfferExpiredAt(offer, nowMs = Date.now(), opts = {}) {
  const endRaw = offer?.validTo || offer?.validUntil || offer?.endDate || offer?.expiresAt || null;
  const end = parseOfferInstant(endRaw);
  if (end == null) return { expired: false, reason: "no_end_date", endMs: null };
  const inclusive = opts.endsAtInclusive === true;
  const expired = inclusive ? nowMs > end : nowMs >= end;
  return { expired, reason: expired ? "past_valid_to" : "within_window", endMs: end };
}

export function classifyProductFreshness(row, nowMs = Date.now(), policy = FRESHNESS_POLICY_V32) {
  const lastCheck = parseOfferInstant(row?.lastSuccessfulRefreshAt || row?.lastCheckedAt);
  const sourceUpdated = parseOfferInstant(row?.sourceUpdatedAt);
  if (lastCheck == null) {
    return {
      freshnessStatus: FRESHNESS_STATUS.UNVERIFIED,
      ageMs: null,
      hidePublicPrice: false,
      reason: "never_refreshed",
    };
  }
  const ageMs = Math.max(0, nowMs - lastCheck);
  if (ageMs > policy.stalePublicHideMs) {
    return {
      freshnessStatus: FRESHNESS_STATUS.HIDDEN_STALE,
      ageMs,
      hidePublicPrice: true,
      reason: "unchecked_beyond_stale_public_hide",
      sourceUpdatedAt: sourceUpdated,
    };
  }
  if (ageMs > policy.productPriceAvailabilityMs) {
    return {
      freshnessStatus: FRESHNESS_STATUS.STALE,
      ageMs,
      hidePublicPrice: false,
      reason: "beyond_target_refresh_interval",
      sourceUpdatedAt: sourceUpdated,
    };
  }
  return {
    freshnessStatus: FRESHNESS_STATUS.FRESH,
    ageMs,
    hidePublicPrice: false,
    reason: "within_target_interval",
    sourceUpdatedAt: sourceUpdated,
  };
}

/**
 * Filter public document: drop expired coupons/actions; optionally hide stale product prices.
 * Does not invent new prices. Mutates a shallow-cloned document.
 */
export function applyFreshnessToOffersDocument(doc, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const policy = opts.policy || FRESHNESS_POLICY_V32;
  const hideStalePrices = opts.hideStalePrices !== false;
  const out = {
    ...doc,
    sections: [],
    freshnessAppliedAt: new Date(nowMs).toISOString(),
    freshnessPolicy: {
      productPriceAvailabilityMs: policy.productPriceAvailabilityMs,
      stalePublicHideMs: policy.stalePublicHideMs,
      couponRenderTimeExpiry: true,
    },
  };
  const stats = {
    couponsExpiredHidden: 0,
    actionsExpiredHidden: 0,
    productsPriceHidden: 0,
    productsStaleMarked: 0,
  };
  for (const sec of doc?.sections || []) {
    const next = {
      ...sec,
      coupons: [],
      actions: [],
      products: [],
    };
    for (const c of sec.coupons || []) {
      const ex = isOfferExpiredAt(c, nowMs);
      if (ex.expired) {
        stats.couponsExpiredHidden += 1;
        continue;
      }
      next.coupons.push({
        ...c,
        lastCheckedAt: c.lastCheckedAt || null,
        freshnessStatus: FRESHNESS_STATUS.FRESH,
      });
    }
    for (const a of sec.actions || []) {
      const ex = isOfferExpiredAt(a, nowMs);
      if (ex.expired) {
        stats.actionsExpiredHidden += 1;
        continue;
      }
      next.actions.push({
        ...a,
        lastCheckedAt: a.lastCheckedAt || null,
        freshnessStatus: FRESHNESS_STATUS.FRESH,
      });
    }
    for (const p of sec.products || []) {
      const fr = classifyProductFreshness(p, nowMs, policy);
      let row = {
        ...p,
        freshnessStatus: fr.freshnessStatus,
        lastCheckedAt: p.lastCheckedAt || null,
        lastSuccessfulRefreshAt: p.lastSuccessfulRefreshAt || null,
        sourceUpdatedAt: p.sourceUpdatedAt || null,
      };
      if (fr.freshnessStatus === FRESHNESS_STATUS.STALE) stats.productsStaleMarked += 1;
      if (hideStalePrices && fr.hidePublicPrice) {
        stats.productsPriceHidden += 1;
        row = {
          ...row,
          currentPrice: null,
          originalPrice: null,
          priceHiddenReason: fr.reason,
          publicationReady: false,
          freshnessStatus: FRESHNESS_STATUS.HIDDEN_STALE,
        };
        // Do not push hidden-stale as publicationReady card
        continue;
      }
      next.products.push(row);
    }
    out.sections.push(next);
  }
  let coupons = 0;
  let actions = 0;
  let products = 0;
  for (const s of out.sections) {
    coupons += (s.coupons || []).length;
    actions += (s.actions || []).length;
    products += (s.products || []).length;
  }
  out.stats = {
    ...(doc?.stats || {}),
    partners: out.sections.length,
    coupons,
    actions,
    products,
    publicationReady: coupons + actions + products,
    freshness: stats,
  };
  return { doc: out, stats };
}

/**
 * Collect published product keys from offers-public for prioritized refresh.
 */
export function collectPublishedProductKeys(doc) {
  const keys = [];
  const seen = new Set();
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      const adv = p.advertiserId != null ? String(p.advertiserId) : "";
      const pid = p.productId != null ? String(p.productId) : "";
      if (!adv || !pid) continue;
      const k = adv + "|" + pid;
      if (seen.has(k)) continue;
      seen.add(k);
      keys.push({
        advertiserId: adv,
        productId: pid,
        feedId: p.feedId != null ? String(p.feedId) : null,
        sectionKey: sec.sectionKey || null,
      });
    }
  }
  return keys;
}

/**
 * Merge refreshed product fields into public cards (never regress with older sourceUpdatedAt).
 */
export function mergeRefreshedProductIntoCard(card, refreshed, nowIso) {
  if (!card || !refreshed) return { card, changed: false, skipped: "missing" };
  const prevSrc = parseOfferInstant(card.sourceUpdatedAt);
  const nextSrc = parseOfferInstant(refreshed.sourceUpdatedAt);
  if (prevSrc != null && nextSrc != null && nextSrc < prevSrc) {
    return {
      card: {
        ...card,
        lastCheckedAt: nowIso,
        freshnessStatus: FRESHNESS_STATUS.FRESH,
        note: "kept_newer_local_sourceUpdatedAt",
      },
      changed: false,
      skipped: "older_source",
    };
  }
  const priceChanged =
    refreshed.currentPrice != null && String(refreshed.currentPrice) !== String(card.currentPrice);
  const availChanged =
    refreshed.availability != null &&
    String(refreshed.availability) !== String(card.availability ?? "");
  const next = {
    ...card,
    currentPrice: refreshed.currentPrice != null ? refreshed.currentPrice : card.currentPrice,
    originalPrice: refreshed.originalPrice != null ? refreshed.originalPrice : card.originalPrice,
    currency: refreshed.currency || card.currency,
    availability: refreshed.availability != null ? refreshed.availability : card.availability,
    imageUrl: refreshed.imageUrl || card.imageUrl,
    affiliateUrl: refreshed.affiliateUrl || card.affiliateUrl,
    feedId: refreshed.feedId != null ? refreshed.feedId : card.feedId ?? null,
    sourceUpdatedAt: refreshed.sourceUpdatedAt || card.sourceUpdatedAt || null,
    lastCheckedAt: nowIso,
    lastSuccessfulRefreshAt: nowIso,
    freshnessStatus: FRESHNESS_STATUS.FRESH,
  };
  if (refreshed.gone === true || refreshed.removeFromPublic === true) {
    next.publicationReady = false;
    next.freshnessStatus = FRESHNESS_STATUS.EXPIRED;
    next.rejectReason = refreshed.rejectReason || "source_unavailable";
  }
  return { card: next, changed: priceChanged || availChanged, priceChanged, availChanged };
}

export function describeFreshnessPolicy() {
  return {
    schema: OFFERS_FRESHNESS_SCHEMA,
    policy: FRESHNESS_POLICY_V32,
    statuses: FRESHNESS_STATUS,
    separation: {
      discovery: "continueable feed paging via checkpoints",
      refresh: "prioritized re-check of published product/coupon/action keys",
      renderExpiry: "coupons/actions filtered by validTo at sync and client render",
    },
  };
}
