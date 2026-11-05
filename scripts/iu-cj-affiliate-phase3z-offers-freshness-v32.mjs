#!/usr/bin/env node
/**
 * V32/V33 — freshness policy for published CJ offers (products / coupons / actions).
 * Discovery must not block refresh of already-published rows.
 *
 * V33: never invent sourceUpdatedAt from fetch/check time.
 * Distinguish SOURCE_FRESH vs FETCH_RECENT_SOURCE_AGE_UNKNOWN.
 */
export const OFFERS_FRESHNESS_SCHEMA = "iu-cj-affiliate-phase3z-offers-freshness-v33";

/** Target intervals (ms). Documented targets; infrastructure may be slower — never claim met without proof. */
export const FRESHNESS_POLICY_V32 = Object.freeze({
  productPriceAvailabilityMs: 3 * 60 * 60 * 1000, // target 1–3h → use 3h ceiling
  couponActionSourceSyncMs: 6 * 60 * 60 * 1000,
  emailIngestTargetMs: 30 * 60 * 1000,
  joinedStatusMs: 60 * 60 * 1000,
  discoveryContinueMs: 24 * 60 * 60 * 1000,
  stalePublicHideMs: 24 * 60 * 60 * 1000, // hide price if unchecked beyond this
  note:
    "Targets depend on CJ API freshness + GitHub Actions quotas. Do not present stale prices as current. Fetch time ≠ source update time.",
});

export const SOURCE_UPDATED_AT_STATUS = Object.freeze({
  PROVIDED: "PROVIDED",
  NOT_PROVIDED: "NOT_PROVIDED",
  UNKNOWN: "UNKNOWN",
  /** Legacy rows where sourceUpdatedAt was incorrectly set to fetch/check time. */
  LEGACY_FETCH_AS_SOURCE: "LEGACY_FETCH_AS_SOURCE",
});

export const FRESHNESS_STATUS = Object.freeze({
  /** Authoritative source timestamp present and within policy. */
  SOURCE_FRESH: "SOURCE_FRESH",
  /** Recently fetched/checked, but source age unknown (CJ product rows lack lastUpdated). */
  FETCH_RECENT_SOURCE_AGE_UNKNOWN: "FETCH_RECENT_SOURCE_AGE_UNKNOWN",
  /** @deprecated Prefer SOURCE_FRESH or FETCH_RECENT_SOURCE_AGE_UNKNOWN. Kept for read compat. */
  FRESH: "FRESH",
  STALE: "STALE",
  EXPIRED: "EXPIRED",
  UNVERIFIED: "UNVERIFIED",
  HIDDEN_STALE: "HIDDEN_STALE",
  REFRESH_PENDING: "REFRESH_PENDING",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  SOURCE_OUTAGE_KEEP_INTERNAL_LKG: "SOURCE_OUTAGE_KEEP_INTERNAL_LKG",
});

export function parseOfferInstant(raw) {
  if (raw == null || raw === "") return null;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

/**
 * Normalize sourceUpdatedAt provenance. Never treat fetch/check clocks as source clocks.
 */
export function resolveSourceUpdatedAtProvenance(row, opts = {}) {
  const raw = row?.sourceUpdatedAt;
  const statusIn = row?.sourceUpdatedAtStatus != null ? String(row.sourceUpdatedAtStatus) : null;
  const fetchedAt = parseOfferInstant(row?.fetchedAt);
  const lastCheckedAt = parseOfferInstant(row?.lastCheckedAt);
  const lastSuccessfulRefreshAt = parseOfferInstant(row?.lastSuccessfulRefreshAt);
  const src = parseOfferInstant(raw);

  if (statusIn === SOURCE_UPDATED_AT_STATUS.PROVIDED && src != null) {
    return {
      sourceUpdatedAt: new Date(src).toISOString(),
      sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.PROVIDED,
      sourceUpdatedAtMs: src,
    };
  }
  if (statusIn === SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED || statusIn === SOURCE_UPDATED_AT_STATUS.UNKNOWN) {
    return {
      sourceUpdatedAt: null,
      sourceUpdatedAtStatus: statusIn,
      sourceUpdatedAtMs: null,
    };
  }

  // Heuristic: identical to fetchedAt/lastCheckedAt/lastSuccessfulRefreshAt ⇒ invented at sync.
  if (
    src != null &&
    ((fetchedAt != null && src === fetchedAt) ||
      (lastCheckedAt != null && src === lastCheckedAt) ||
      (lastSuccessfulRefreshAt != null && src === lastSuccessfulRefreshAt) ||
      opts.treatEqualCheckAsLegacy === true)
  ) {
    return {
      sourceUpdatedAt: null,
      sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.LEGACY_FETCH_AS_SOURCE,
      sourceUpdatedAtMs: null,
      legacyInventedAt: new Date(src).toISOString(),
    };
  }

  if (src != null && statusIn == null) {
    // Distinct timestamp without status — treat as provided only when explicitly opted in.
    if (opts.acceptUntaggedSource === true) {
      return {
        sourceUpdatedAt: new Date(src).toISOString(),
        sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.PROVIDED,
        sourceUpdatedAtMs: src,
      };
    }
    return {
      sourceUpdatedAt: null,
      sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.UNKNOWN,
      sourceUpdatedAtMs: null,
      untrustedRaw: new Date(src).toISOString(),
    };
  }

  return {
    sourceUpdatedAt: null,
    sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED,
    sourceUpdatedAtMs: null,
  };
}

/**
 * Stamp fields after a successful CJ fetch/refresh. Does not invent sourceUpdatedAt.
 */
export function stampProductFetchClocks(row, nowIso, opts = {}) {
  const iso = nowIso || new Date().toISOString();
  const prov = resolveSourceUpdatedAtProvenance(
    {
      ...row,
      sourceUpdatedAt: opts.sourceUpdatedAt != null ? opts.sourceUpdatedAt : row?.sourceUpdatedAt,
      sourceUpdatedAtStatus:
        opts.sourceUpdatedAtStatus != null ? opts.sourceUpdatedAtStatus : row?.sourceUpdatedAtStatus,
      fetchedAt: iso,
      lastCheckedAt: iso,
    },
    { acceptUntaggedSource: opts.acceptUntaggedSource === true }
  );
  const hasAuthoritativeSource = prov.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.PROVIDED;
  return {
    ...row,
    fetchedAt: iso,
    lastCheckedAt: iso,
    lastSuccessfulRefreshAt: iso,
    sourceUpdatedAt: prov.sourceUpdatedAt,
    sourceUpdatedAtStatus: hasAuthoritativeSource
      ? SOURCE_UPDATED_AT_STATUS.PROVIDED
      : SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED,
    freshnessStatus: hasAuthoritativeSource
      ? FRESHNESS_STATUS.SOURCE_FRESH
      : FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN,
    freshnessReason: hasAuthoritativeSource
      ? "authoritative_source_timestamp"
      : "fetched_recent_source_age_unknown",
  };
}

/**
 * Render-time / sync-time expiry for coupons/actions.
 * end exclusive unless endsAtInclusive=true.
 * Missing end date ⇒ not treated as unlimited (unknownValidity).
 */
export function isOfferExpiredAt(offer, nowMs = Date.now(), opts = {}) {
  const endRaw = offer?.validTo || offer?.validUntil || offer?.endDate || offer?.expiresAt || null;
  const end = parseOfferInstant(endRaw);
  if (end == null) {
    return {
      expired: false,
      unknownValidity: true,
      reason: "no_end_date_not_unlimited",
      endMs: null,
    };
  }
  const inclusive = opts.endsAtInclusive === true;
  const expired = inclusive ? nowMs > end : nowMs >= end;
  return { expired, unknownValidity: false, reason: expired ? "past_valid_to" : "within_window", endMs: end };
}

export function classifyProductFreshness(row, nowMs = Date.now(), policy = FRESHNESS_POLICY_V32) {
  const lastCheck = parseOfferInstant(row?.lastSuccessfulRefreshAt || row?.lastCheckedAt || row?.fetchedAt);
  const prov = resolveSourceUpdatedAtProvenance(row, { treatEqualCheckAsLegacy: true });
  if (lastCheck == null) {
    return {
      freshnessStatus: FRESHNESS_STATUS.UNVERIFIED,
      freshnessReason: "never_refreshed",
      ageMs: null,
      hidePublicPrice: false,
      sourceUpdatedAtStatus: prov.sourceUpdatedAtStatus,
    };
  }
  const ageMs = Math.max(0, nowMs - lastCheck);
  if (ageMs > policy.stalePublicHideMs) {
    return {
      freshnessStatus: FRESHNESS_STATUS.HIDDEN_STALE,
      freshnessReason: "unchecked_beyond_stale_public_hide",
      ageMs,
      hidePublicPrice: true,
      sourceUpdatedAtStatus: prov.sourceUpdatedAtStatus,
      sourceUpdatedAt: prov.sourceUpdatedAt,
    };
  }
  if (ageMs > policy.productPriceAvailabilityMs) {
    return {
      freshnessStatus: FRESHNESS_STATUS.STALE,
      freshnessReason: "beyond_target_refresh_interval",
      ageMs,
      hidePublicPrice: false,
      sourceUpdatedAtStatus: prov.sourceUpdatedAtStatus,
      sourceUpdatedAt: prov.sourceUpdatedAt,
    };
  }
  if (prov.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.PROVIDED && prov.sourceUpdatedAtMs != null) {
    const sourceAge = Math.max(0, nowMs - prov.sourceUpdatedAtMs);
    if (sourceAge > policy.stalePublicHideMs) {
      return {
        freshnessStatus: FRESHNESS_STATUS.HIDDEN_STALE,
        freshnessReason: "authoritative_source_too_old",
        ageMs,
        hidePublicPrice: true,
        sourceUpdatedAtStatus: prov.sourceUpdatedAtStatus,
        sourceUpdatedAt: prov.sourceUpdatedAt,
      };
    }
    if (sourceAge > policy.productPriceAvailabilityMs) {
      return {
        freshnessStatus: FRESHNESS_STATUS.STALE,
        freshnessReason: "authoritative_source_beyond_target",
        ageMs,
        hidePublicPrice: false,
        sourceUpdatedAtStatus: prov.sourceUpdatedAtStatus,
        sourceUpdatedAt: prov.sourceUpdatedAt,
      };
    }
    return {
      freshnessStatus: FRESHNESS_STATUS.SOURCE_FRESH,
      freshnessReason: "authoritative_source_within_target",
      ageMs,
      hidePublicPrice: false,
      sourceUpdatedAtStatus: prov.sourceUpdatedAtStatus,
      sourceUpdatedAt: prov.sourceUpdatedAt,
    };
  }
  return {
    freshnessStatus: FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN,
    freshnessReason: "fetch_recent_source_age_unknown",
    ageMs,
    hidePublicPrice: false,
    sourceUpdatedAtStatus: prov.sourceUpdatedAtStatus,
    sourceUpdatedAt: null,
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
  const hideUnknownValidity = opts.hideUnknownValidity !== false;
  const out = {
    ...doc,
    sections: [],
    freshnessAppliedAt: new Date(nowMs).toISOString(),
    freshnessPolicy: {
      productPriceAvailabilityMs: policy.productPriceAvailabilityMs,
      stalePublicHideMs: policy.stalePublicHideMs,
      couponRenderTimeExpiry: true,
      unknownValidityNotUnlimited: true,
      sourceUpdatedAtNeverInventedFromFetch: true,
    },
  };
  const stats = {
    couponsExpiredHidden: 0,
    couponsUnknownValidityHidden: 0,
    actionsExpiredHidden: 0,
    actionsUnknownValidityHidden: 0,
    productsPriceHidden: 0,
    productsStaleMarked: 0,
    productsSourceFresh: 0,
    productsFetchRecentSourceAgeUnknown: 0,
    productsLegacyFetchAsSourceCleared: 0,
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
      const hasId = c.offerId != null && String(c.offerId).trim() !== "";
      if (!hasId) {
        stats.couponsUnknownValidityHidden += 1;
        continue;
      }
      if (ex.expired) {
        stats.couponsExpiredHidden += 1;
        continue;
      }
      if (ex.unknownValidity && hideUnknownValidity) {
        stats.couponsUnknownValidityHidden += 1;
        continue;
      }
      // publicationReady must not follow from mere existence — require identity + bounded (or explicit) validity.
      const validityStatus = ex.unknownValidity ? "UNKNOWN" : "BOUNDED";
      next.coupons.push({
        ...c,
        offerId: String(c.offerId),
        validFrom: c.validFrom || c.validFromDate || c.startDate || null,
        validTo: c.validTo || c.validUntil || c.endDate || null,
        lastCheckedAt: c.lastCheckedAt || null,
        fetchedAt: c.fetchedAt || null,
        freshnessStatus: ex.unknownValidity ? FRESHNESS_STATUS.UNVERIFIED : FRESHNESS_STATUS.SOURCE_FRESH,
        freshnessReason: ex.reason,
        validityStatus,
        publicationReady: c.publicationReady === true && !ex.unknownValidity && hasId,
      });
    }
    for (const a of sec.actions || []) {
      const ex = isOfferExpiredAt(a, nowMs);
      const hasId = a.offerId != null && String(a.offerId).trim() !== "";
      if (!hasId) {
        stats.actionsUnknownValidityHidden += 1;
        continue;
      }
      if (ex.expired) {
        stats.actionsExpiredHidden += 1;
        continue;
      }
      if (ex.unknownValidity && hideUnknownValidity) {
        stats.actionsUnknownValidityHidden += 1;
        continue;
      }
      const validityStatus = ex.unknownValidity ? "UNKNOWN" : "BOUNDED";
      next.actions.push({
        ...a,
        offerId: String(a.offerId),
        validFrom: a.validFrom || a.validFromDate || a.startDate || null,
        validTo: a.validTo || a.validUntil || a.endDate || null,
        lastCheckedAt: a.lastCheckedAt || null,
        fetchedAt: a.fetchedAt || null,
        freshnessStatus: ex.unknownValidity ? FRESHNESS_STATUS.UNVERIFIED : FRESHNESS_STATUS.SOURCE_FRESH,
        freshnessReason: ex.reason,
        validityStatus,
        publicationReady: a.publicationReady === true && !ex.unknownValidity && hasId,
      });
    }
    for (const p of sec.products || []) {
      const fr = classifyProductFreshness(p, nowMs, policy);
      if (fr.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.LEGACY_FETCH_AS_SOURCE) {
        stats.productsLegacyFetchAsSourceCleared += 1;
      }
      if (fr.freshnessStatus === FRESHNESS_STATUS.SOURCE_FRESH) stats.productsSourceFresh += 1;
      if (fr.freshnessStatus === FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN) {
        stats.productsFetchRecentSourceAgeUnknown += 1;
      }
      let row = {
        ...p,
        freshnessStatus: fr.freshnessStatus,
        freshnessReason: fr.freshnessReason,
        lastCheckedAt: p.lastCheckedAt || null,
        lastSuccessfulRefreshAt: p.lastSuccessfulRefreshAt || null,
        fetchedAt: p.fetchedAt || p.lastCheckedAt || null,
        sourceUpdatedAt: fr.sourceUpdatedAt != null ? fr.sourceUpdatedAt : null,
        sourceUpdatedAtStatus: fr.sourceUpdatedAtStatus || SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED,
      };
      if (fr.freshnessStatus === FRESHNESS_STATUS.STALE) stats.productsStaleMarked += 1;
      if (hideStalePrices && fr.hidePublicPrice) {
        stats.productsPriceHidden += 1;
        row = {
          ...row,
          currentPrice: null,
          originalPrice: null,
          priceHiddenReason: fr.freshnessReason,
          publicationReady: false,
          freshnessStatus: FRESHNESS_STATUS.HIDDEN_STALE,
        };
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
  // V46: do not overwrite honest unique-advertiser partners with section count.
  const prevStats = doc?.stats && typeof doc.stats === "object" ? doc.stats : {};
  out.stats = {
    ...prevStats,
    partners: prevStats.partners != null ? prevStats.partners : out.sections.length,
    sections: prevStats.sections != null ? prevStats.sections : out.sections.length,
    productAdvertisers: prevStats.productAdvertisers,
    coupons,
    actions,
    products,
    publicationReady: coupons + actions + products,
    freshness: {
      ...stats,
      displayClass: {
        CURRENT: stats.productsSourceFresh,
        STALE: (stats.productsStaleMarked || 0) + (stats.productsPriceHidden || 0),
        UNKNOWN: stats.productsFetchRecentSourceAgeUnknown || 0,
        UNAVAILABLE: 0,
        note:
          "CURRENT=SOURCE_FRESH only (authoritative sourceUpdatedAt). UNKNOWN must never be presented as CURRENT. Fetch time ≠ source time.",
      },
      // V47: verification clock ≠ source freshness. VERIFIED_RECENT uses lastSuccessfulRefreshAt only.
      verificationClass: {
        VERIFIED_RECENT: stats.productsFetchRecentSourceAgeUnknown || 0,
        SOURCE_CURRENT: stats.productsSourceFresh || 0,
        STALE: (stats.productsStaleMarked || 0) + (stats.productsPriceHidden || 0),
        UNAVAILABLE: 0,
        note:
          "VERIFIED_RECENT=successful fetch/refresh within policy window (not inventable as CURRENT). SOURCE_CURRENT requires CJ sourceUpdatedAt.",
      },
    },
  };
  return { doc: out, stats: out.stats.freshness };
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
 * Merge refreshed product fields into public cards.
 * Never invent sourceUpdatedAt. Never regress with older authoritative source timestamps.
 */
export function mergeRefreshedProductIntoCard(card, refreshed, nowIso) {
  if (!card || !refreshed) return { card, changed: false, skipped: "missing" };
  const prevProv = resolveSourceUpdatedAtProvenance(card, { treatEqualCheckAsLegacy: true });
  const nextProv = resolveSourceUpdatedAtProvenance(
    {
      sourceUpdatedAt: refreshed.sourceUpdatedAt,
      sourceUpdatedAtStatus: refreshed.sourceUpdatedAtStatus,
      fetchedAt: refreshed.fetchedAt || nowIso,
      lastCheckedAt: refreshed.lastCheckedAt || nowIso,
    },
    { acceptUntaggedSource: refreshed.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.PROVIDED }
  );

  if (
    prevProv.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.PROVIDED &&
    nextProv.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.PROVIDED &&
    prevProv.sourceUpdatedAtMs != null &&
    nextProv.sourceUpdatedAtMs != null &&
    nextProv.sourceUpdatedAtMs < prevProv.sourceUpdatedAtMs
  ) {
    return {
      card: {
        ...card,
        fetchedAt: nowIso,
        lastCheckedAt: nowIso,
        freshnessStatus: FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN,
        freshnessReason: "kept_newer_authoritative_sourceUpdatedAt",
        sourceUpdatedAt: prevProv.sourceUpdatedAt,
        sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.PROVIDED,
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

  const stamped = stampProductFetchClocks(
    {
      ...card,
      currentPrice: refreshed.currentPrice != null ? refreshed.currentPrice : card.currentPrice,
      originalPrice: refreshed.originalPrice != null ? refreshed.originalPrice : card.originalPrice,
      currency: refreshed.currency || card.currency,
      availability: refreshed.availability != null ? refreshed.availability : card.availability,
      imageUrl: refreshed.imageUrl || card.imageUrl,
      affiliateUrl: refreshed.affiliateUrl || card.affiliateUrl,
      feedId: refreshed.feedId != null ? refreshed.feedId : card.feedId ?? null,
      feedIdStatus: refreshed.feedIdStatus || card.feedIdStatus || null,
    },
    nowIso,
    {
      sourceUpdatedAt: nextProv.sourceUpdatedAt,
      sourceUpdatedAtStatus: nextProv.sourceUpdatedAtStatus,
      acceptUntaggedSource: nextProv.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.PROVIDED,
    }
  );

  // V47: durable per-product price/availability change trail (compound identity unchanged).
  stamped.verifiedAt = nowIso;
  if (priceChanged) {
    stamped.previousPrice = card.currentPrice;
    stamped.priceChangedAt = nowIso;
    stamped.priceChangeSource = "cj_product_refresh";
  }
  if (availChanged) {
    stamped.previousAvailability = card.availability ?? null;
    stamped.availabilityChangedAt = nowIso;
    stamped.availabilityChangeSource = "cj_product_refresh";
  }

  if (refreshed.gone === true || refreshed.removeFromPublic === true) {
    stamped.publicationReady = false;
    stamped.freshnessStatus = FRESHNESS_STATUS.SOURCE_UNAVAILABLE;
    stamped.freshnessReason = refreshed.rejectReason || "source_unavailable";
    stamped.rejectReason = refreshed.rejectReason || "source_unavailable";
  }
  return { card: stamped, changed: priceChanged || availChanged, priceChanged, availChanged };
}

export function describeFreshnessPolicy() {
  return {
    schema: OFFERS_FRESHNESS_SCHEMA,
    policy: FRESHNESS_POLICY_V32,
    statuses: FRESHNESS_STATUS,
    sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS,
    separation: {
      discovery: "continueable feed paging via checkpoints",
      refresh: "prioritized re-check of published product/coupon/action keys",
      renderExpiry: "coupons/actions filtered by validTo at sync and client render; unknown end ≠ unlimited",
      clocks:
        "sourceUpdatedAt (authoritative only) ≠ fetchedAt ≠ lastCheckedAt ≠ lastSuccessfulRefreshAt ≠ publishedAt",
    },
  };
}
