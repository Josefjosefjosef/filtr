#!/usr/bin/env node
/**
 * V51.8 continuation-2 — publication LKG merge + product delta ledger.
 * Incomplete discovery/presentation windows must not erase LIVE products.
 * NOT_YET_SEEN ≠ CONFIRMED_REMOVED.
 */

export const REMOVAL_CLASS = Object.freeze({
  NOT_YET_SEEN: "NOT_YET_SEEN",
  CONFIRMED_REMOVED: "CONFIRMED_REMOVED",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  PARTNER_ENDED: "PARTNER_ENDED",
  HOLD_COLLISION: "HOLD_COLLISION",
  NO_PERMISSION: "NO_PERMISSION",
  IDENTITY_CHANGED: "IDENTITY_CHANGED",
  UNKNOWN: "UNKNOWN",
});

export const PUBLICATION_LKG_SCHEMA = "iu-cj-affiliate-phase3z-publication-lkg-v51-8";

export const CATALOG_STATUS = Object.freeze({
  CATALOG_RETAINED: "CATALOG_RETAINED",
  CONFIRMED_REMOVED: "CONFIRMED_REMOVED",
});

export const PUBLICATION_ELIGIBILITY = Object.freeze({
  PUBLICATION_ELIGIBLE: "PUBLICATION_ELIGIBLE",
  PUBLICATION_HOLD: "PUBLICATION_HOLD",
  PUBLICATION_BLOCKED: "PUBLICATION_BLOCKED",
});

export const LKG_VALIDATION_CLASS = Object.freeze({
  LKG_ELIGIBLE_VERIFIED: "LKG_ELIGIBLE_VERIFIED",
  LKG_PENDING_REVERIFY: "LKG_PENDING_REVERIFY",
  LKG_STALE_PRICE: "LKG_STALE_PRICE",
  LKG_STALE_AVAILABILITY: "LKG_STALE_AVAILABILITY",
  LKG_PARTNER_ENDED: "LKG_PARTNER_ENDED",
  LKG_PERMISSION_REVOKED: "LKG_PERMISSION_REVOKED",
  LKG_INVALID_URL: "LKG_INVALID_URL",
  LKG_IDENTITY_COLLISION: "LKG_IDENTITY_COLLISION",
  LKG_CONFIRMED_REMOVED: "LKG_CONFIRMED_REMOVED",
  LKG_BLOCKED: "LKG_BLOCKED",
});

export function compoundProductKey(advertiserId, productId) {
  return String(advertiserId || "") + "|" + String(productId || "");
}

export function isPublicOfferEligible(product) {
  if (!product || product.publicationReady === false) return false;
  if (product.publicOffer === false) return false;
  if (product.hideAsCurrent === true) return false;
  if (product.lkgPublicHold === true) return false;
  const elig = String(product.publicationEligibility || "");
  if (elig === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD) return false;
  if (elig === PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED) return false;
  return true;
}

export function collectPublicEligibleProductMap(doc) {
  const map = new Map();
  for (const [key, row] of collectUniqueProductMap(doc)) {
    if (!isPublicOfferEligible(row.product)) continue;
    map.set(key, row);
  }
  return map;
}

export function collectUniqueProductMap(doc) {
  const map = new Map();
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      if (!p || p.publicationReady === false) continue;
      const adv = String(p.advertiserId || "");
      const pid = String(p.productId || "");
      if (!adv || !pid) continue;
      const key = compoundProductKey(adv, pid);
      if (!map.has(key)) {
        map.set(key, {
          key,
          advertiserId: adv,
          productId: pid,
          sectionKey: p.sectionKey || sec.sectionKey || null,
          partnerName: p.partnerName || sec.partnerName || null,
          product: p,
          sectionKeys: new Set([p.sectionKey || sec.sectionKey].filter(Boolean)),
        });
      } else {
        const cur = map.get(key);
        const sk = p.sectionKey || sec.sectionKey;
        if (sk) cur.sectionKeys.add(sk);
      }
    }
  }
  return map;
}

/**
 * Classify why a previous LIVE product is missing from the rebuilt catalog.
 */
function isTrustedAffiliateUrl(url) {
  const s = String(url || "");
  // CJ click domains use both .com and .net (anrdoezrs.net / dpbolvw.net observed in LIVE).
  return /^https:\/\/(www\.)?(kqzyfj|jdoqocy|tkqlhce|dpbolvw|anrdoezrs|pjatr)\.(com|net)\//i.test(s);
}

function productAgeHours(product, nowMs) {
  const ts =
    product?.lastSuccessfulRefreshAt ||
    product?.lastCheckedAt ||
    product?.fetchedAt ||
    product?.sourceUpdatedAt ||
    null;
  const ms = ts ? Date.parse(ts) : NaN;
  if (!Number.isFinite(ms)) return null;
  return (nowMs - ms) / 3600000;
}

export function classifyMissingPublishedProduct(prevRow, opts = {}) {
  const key = prevRow.key;
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const staleAfterHours = Math.max(1, Number(opts.staleAfterHours) || 72);
  const missByKey = opts.missByKey instanceof Map ? opts.missByKey : new Map(opts.missByKey || []);
  const incompleteAdvertisers =
    opts.incompleteAdvertisers instanceof Set
      ? opts.incompleteAdvertisers
      : new Set(opts.incompleteAdvertisers || []);
  const fetchedAdvertisers =
    opts.fetchedAdvertisers instanceof Set
      ? opts.fetchedAdvertisers
      : new Set(opts.fetchedAdvertisers || []);
  const endedAdvertisers =
    opts.endedAdvertisers instanceof Set
      ? opts.endedAdvertisers
      : new Set(opts.endedAdvertisers || []);
  const revokedAdvertisers =
    opts.revokedAdvertisers instanceof Set
      ? opts.revokedAdvertisers
      : new Set(opts.revokedAdvertisers || []);
  const holdKeys = opts.holdKeys instanceof Set ? opts.holdKeys : new Set(opts.holdKeys || []);
  const miss = missByKey.get(key) || null;
  const product = prevRow.product || {};

  if (endedAdvertisers.has(prevRow.advertiserId)) {
    return {
      classId: REMOVAL_CLASS.PARTNER_ENDED,
      carryForward: false,
      rootCauseVerified: true,
      publicationClass: "ENDED",
      note: "Partner ENDED — do not restore.",
    };
  }
  if (revokedAdvertisers.has(prevRow.advertiserId)) {
    return {
      classId: REMOVAL_CLASS.NO_PERMISSION,
      carryForward: false,
      rootCauseVerified: true,
      publicationClass: "PERMISSION_REVOKED",
      note: "Partner permission revoked — do not restore.",
    };
  }
  if (!isTrustedAffiliateUrl(product.affiliateUrl)) {
    return {
      classId: REMOVAL_CLASS.CONFIRMED_REMOVED,
      carryForward: false,
      rootCauseVerified: true,
      publicationClass: "INVALID_AFFILIATE_URL",
      note: "LKG affiliate URL missing/untrusted — do not restore.",
    };
  }
  if (holdKeys.has(key) || miss?.decision === "HOLD_COLLISION") {
    return {
      classId: REMOVAL_CLASS.HOLD_COLLISION,
      carryForward: true,
      rootCauseVerified: true,
      publicationClass: "HOLD",
      note: "HOLD_COLLISION — keep LKG visible, no remap.",
    };
  }
  if (miss?.decision === "REMOVE_CONFIRMED") {
    return {
      classId: REMOVAL_CLASS.CONFIRMED_REMOVED,
      carryForward: false,
      rootCauseVerified: true,
      publicationClass: "CONFIRMED_REMOVED",
      note: "Explicit REMOVE_CONFIRMED evidence.",
    };
  }
  const ageHours = productAgeHours(product, nowMs);
  if (ageHours != null && ageHours >= staleAfterHours && !incompleteAdvertisers.has(prevRow.advertiserId)) {
    return {
      classId: REMOVAL_CLASS.SOURCE_UNAVAILABLE,
      carryForward: false,
      rootCauseVerified: true,
      publicationClass: "SOURCE_STALE",
      ageHours,
      note: "LKG older than stale policy and partner not incomplete — refuse silent price keep.",
    };
  }
  if (
    incompleteAdvertisers.has(prevRow.advertiserId) ||
    !fetchedAdvertisers.has(prevRow.advertiserId) ||
    miss?.decision === "KEEP_PENDING" ||
    miss?.decision === "RECOVERED"
  ) {
    return {
      classId: REMOVAL_CLASS.NOT_YET_SEEN,
      carryForward: true,
      rootCauseVerified: true,
      publicationClass: ageHours != null && ageHours >= staleAfterHours ? "SOURCE_STALE" : "NOT_YET_SEEN",
      ageHours,
      note:
        "Missing from current discovery/presentation window — treat as NOT_YET_SEEN, carry LKG until confirmed. Stale prices must not be labeled CURRENT.",
      hideAsCurrent: ageHours != null && ageHours >= staleAfterHours,
    };
  }
  if (miss?.decision === "TEMPORARILY_HIDE") {
    return {
      classId: REMOVAL_CLASS.SOURCE_UNAVAILABLE,
      carryForward: false,
      rootCauseVerified: true,
      publicationClass: "SOURCE_TEMPORARILY_UNAVAILABLE",
      note: "Repeated productIds miss / age hide policy.",
    };
  }
  return {
    classId: REMOVAL_CLASS.UNKNOWN,
    carryForward: true,
    rootCauseVerified: false,
    publicationClass: "UNKNOWN",
    note: "Cause unknown — fail-closed carry LKG until verified; never mark CURRENT.",
    hideAsCurrent: true,
  };
}

/**
 * Full before/after publication delta.
 */
export function buildPublicationDeltaLedger(prevDoc, nextDoc, opts = {}) {
  const prevMap = collectUniqueProductMap(prevDoc);
  const nextMap = collectUniqueProductMap(nextDoc);
  const removed = [];
  const added = [];
  const retained = [];
  for (const [key, row] of prevMap.entries()) {
    if (nextMap.has(key)) {
      retained.push({ key, advertiserId: row.advertiserId, productId: row.productId });
      continue;
    }
    const classified = classifyMissingPublishedProduct(row, opts);
    removed.push({
      key,
      advertiserId: row.advertiserId,
      productId: row.productId,
      partnerName: row.partnerName,
      sectionKey: row.sectionKey,
      classId: classified.classId,
      publicationClass: classified.publicationClass || classified.classId,
      carryForward: classified.carryForward,
      rootCauseVerified: classified.rootCauseVerified,
      hideAsCurrent: classified.hideAsCurrent === true,
      ageHours: classified.ageHours ?? null,
      note: classified.note,
      lastConfirmedPrice: row.product?.currentPrice ?? null,
      lastConfirmedAvailability: row.product?.availability ?? null,
    });
  }
  for (const [key, row] of nextMap.entries()) {
    if (prevMap.has(key)) continue;
    added.push({
      key,
      advertiserId: row.advertiserId,
      productId: row.productId,
      partnerName: row.partnerName,
      sectionKey: row.sectionKey,
    });
  }
  const byClass = {};
  for (const r of removed) byClass[r.classId] = (byClass[r.classId] || 0) + 1;
  return {
    schema: PUBLICATION_LKG_SCHEMA + "-delta",
    at: opts.nowIso || new Date().toISOString(),
    prevUnique: prevMap.size,
    nextUnique: nextMap.size,
    netUnique: nextMap.size - prevMap.size,
    removedCount: removed.length,
    addedCount: added.length,
    retainedCount: retained.length,
    removedByClass: byClass,
    removed,
    added,
    note:
      "Net unique change ≠ removedCount. Presentation rotation can churn many identities with small net.",
  };
}

/**
 * Merge previous LIVE products into rebuilt doc when classified as carry-forward.
 */
export function mergeLkgPublishedProducts(nextDoc, prevDoc, opts = {}) {
  const doc = JSON.parse(JSON.stringify(nextDoc || {}));
  if (!doc.sections) doc.sections = [];
  const delta = buildPublicationDeltaLedger(prevDoc, doc, opts);
  const decisions = [];
  let carried = 0;
  let blocked = 0;

  const sectionIndex = new Map();
  for (const sec of doc.sections) {
    if (sec?.sectionKey) sectionIndex.set(String(sec.sectionKey), sec);
  }
  function ensureSection(sectionKey, advertiserId, partnerName) {
    const sk = String(sectionKey || "aff-ostatni");
    if (sectionIndex.has(sk)) return sectionIndex.get(sk);
    const sec = {
      sectionKey: sk,
      partnerSlug: null,
      partnerName: partnerName || null,
      advertiserId: advertiserId || null,
      coupons: [],
      actions: [],
      products: [],
    };
    doc.sections.push(sec);
    sectionIndex.set(sk, sec);
    return sec;
  }

  const prevMap = collectUniqueProductMap(prevDoc);
  let heldPublic = 0;
  let publicEligibleCarried = 0;
  for (const row of delta.removed) {
    const decision = {
      key: row.key,
      classId: row.classId,
      publicationClass: row.publicationClass || row.classId,
      action: row.carryForward ? "RESTORE_LKG" : "DO_NOT_RESTORE",
      rootCauseVerified: row.rootCauseVerified,
      note: row.note,
    };
    if (!row.carryForward) {
      blocked += 1;
      decision.catalogStatus = CATALOG_STATUS.CONFIRMED_REMOVED;
      decision.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED;
      decisions.push(decision);
      continue;
    }
    const prev = prevMap.get(row.key);
    if (!prev?.product) {
      decision.action = "SKIP_MISSING_PREV_PAYLOAD";
      decisions.push(decision);
      continue;
    }
    const pubClass = String(row.publicationClass || row.classId || "");
    // V51.8-final: incomplete-window NOT_YET_SEEN within freshness keeps PUBLIC_ELIGIBLE
    // (last-known price, no CURRENT claim). Only stale / unknown / collision → HOLD.
    // Root cause: treating every presentation miss as HOLD collapsed LIVE public counts.
    const forceHold =
      row.hideAsCurrent === true ||
      pubClass === "SOURCE_STALE" ||
      pubClass === "UNKNOWN" ||
      pubClass === "HOLD" ||
      pubClass === REMOVAL_CLASS.UNKNOWN ||
      pubClass === REMOVAL_CLASS.HOLD_COLLISION ||
      pubClass === REMOVAL_CLASS.SOURCE_UNAVAILABLE ||
      /SOURCE_STALE|STALE_PRICE|HOLD_COLLISION/i.test(pubClass);
    const pendingReverify =
      !forceHold &&
      (pubClass === "NOT_YET_SEEN" ||
        pubClass === REMOVAL_CLASS.NOT_YET_SEEN ||
        /NOT_YET_SEEN/i.test(pubClass));
    const holdPublic = forceHold;
    const product = {
      ...prev.product,
      publicationReady: true,
      publishable: !holdPublic,
      publicOffer: !holdPublic,
      lkgCarried: true,
      lkgPublicHold: holdPublic,
      hideAsCurrent: holdPublic,
      catalogStatus: CATALOG_STATUS.CATALOG_RETAINED,
      publicationEligibility: holdPublic
        ? PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD
        : PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE,
      refreshResult: row.classId,
      refreshReason: pendingReverify
        ? "lkg_carry_not_yet_seen_keep_public_pending_reverify"
        : "lkg_carry_incomplete_discovery_or_unverified",
      freshnessStatus: holdPublic
        ? "UNKNOWN"
        : pendingReverify
          ? "LAST_KNOWN_PENDING_REVERIFY"
          : "UNKNOWN",
      freshnessReason: holdPublic
        ? "LKG_CATALOG_RETAINED_PUBLICATION_HOLD"
        : pendingReverify
          ? "LKG_NOT_YET_SEEN_KEEP_PUBLIC_WITHIN_STALE_POLICY"
          : "LKG_CARRIED_PUBLICATION_ELIGIBLE",
      publicationClass: pubClass,
      sourceFreshLabelForbidden: true,
    };
    const sectionKeys =
      prev.sectionKeys && prev.sectionKeys.size
        ? [...prev.sectionKeys]
        : [prev.sectionKey || "aff-ostatni"];
    for (const sk of sectionKeys) {
      const sec = ensureSection(sk, prev.advertiserId, prev.partnerName);
      const exists = (sec.products || []).some(
        (p) =>
          String(p.advertiserId) === String(prev.advertiserId) &&
          String(p.productId) === String(prev.productId)
      );
      if (exists) continue;
      sec.products.push({ ...product, sectionKey: sk });
    }
    carried += 1;
    if (holdPublic) heldPublic += 1;
    else publicEligibleCarried += 1;
    decision.catalogStatus = CATALOG_STATUS.CATALOG_RETAINED;
    decision.publicationEligibility = product.publicationEligibility;
    decision.lkgValidationClass = holdPublic
      ? pubClass === "SOURCE_STALE" || /STALE/i.test(pubClass)
        ? LKG_VALIDATION_CLASS.LKG_STALE_PRICE
        : LKG_VALIDATION_CLASS.LKG_PENDING_REVERIFY
      : pendingReverify
        ? LKG_VALIDATION_CLASS.LKG_PENDING_REVERIFY
        : LKG_VALIDATION_CLASS.LKG_ELIGIBLE_VERIFIED;
    decisions.push(decision);
  }

  let products = 0;
  let productsPublicEligible = 0;
  const unique = new Set();
  const uniquePublic = new Set();
  for (const sec of doc.sections) {
    for (const p of sec.products || []) {
      if (p.publicationReady === false) continue;
      products += 1;
      unique.add(compoundProductKey(p.advertiserId, p.productId));
      if (isPublicOfferEligible(p)) {
        productsPublicEligible += 1;
        uniquePublic.add(compoundProductKey(p.advertiserId, p.productId));
      }
    }
  }
  doc.stats = {
    ...(doc.stats || {}),
    products,
    uniqueProducts: unique.size,
    productsPublicEligible,
    uniquePublicEligible: uniquePublic.size,
    lkgCarriedProducts: carried,
    lkgPublicHoldProducts: heldPublic,
  };
  doc.lkgMerge = {
    schema: PUBLICATION_LKG_SCHEMA,
    carried,
    blocked,
    heldPublic,
    publicEligibleCarried,
    prevUnique: delta.prevUnique,
    nextUniqueBeforeMerge: delta.nextUnique,
    nextUniqueAfterMerge: unique.size,
    publicEligibleAfterMerge: uniquePublic.size,
  };
  doc.note =
    (doc.note ? String(doc.note) + " | " : "") +
    "V51.8-final: NOT_YET_SEEN within freshness → CATALOG_RETAINED + PUBLICATION_ELIGIBLE (pending reverify, no CURRENT label); SOURCE_STALE/collision → PUBLICATION_HOLD.";

  return {
    doc,
    delta,
    decisions,
    carried,
    blocked,
    heldPublic,
    publicEligibleCarried,
    uniqueAfter: unique.size,
    publicEligibleAfter: uniquePublic.size,
  };
}

/**
 * Fail-closed gate: refuse promote when unique identities shrink without LKG merge recovery.
 */
export function evaluateProductShrinkageGate(prevDoc, nextDoc, opts = {}) {
  const prev = collectUniqueProductMap(prevDoc).size;
  const next = collectUniqueProductMap(nextDoc).size;
  const maxDropAbs =
    opts.maxDropAbs != null && Number.isFinite(Number(opts.maxDropAbs))
      ? Math.max(0, Number(opts.maxDropAbs))
      : 50;
  const maxDropRatio =
    opts.maxDropRatio != null && Number.isFinite(Number(opts.maxDropRatio))
      ? Math.min(1, Math.max(0, Number(opts.maxDropRatio)))
      : 0.03;
  const drop = Math.max(0, prev - next);
  const ratio = prev > 0 ? drop / prev : 0;
  const merged = opts.lkgMerged === true;
  const ok = drop <= maxDropAbs || ratio <= maxDropRatio || merged;
  return {
    ok,
    prevUnique: prev,
    nextUnique: next,
    drop,
    ratio,
    maxDropAbs,
    maxDropRatio,
    lkgMerged: merged,
    reason: ok
      ? "PRODUCT_SHRINKAGE_WITHIN_POLICY"
      : "PRODUCT_UNIQUE_SHRINKAGE_REFUSED",
    note: "Incomplete discovery must merge LKG or stay under drop thresholds before LIVE promote.",
  };
}

/**
 * Identity churn gate: net-stable catalogs can still be unsafe if most identities rotate.
 * Legitimate confirmed removals are allowed when classified and feed-complete.
 */
export function evaluateIdentityChurnGate(delta = {}, opts = {}) {
  const prevUnique = Math.max(0, Number(delta.prevUnique) || 0);
  const removed = Math.max(0, Number(delta.removedCount) || 0);
  const added = Math.max(0, Number(delta.addedCount) || 0);
  const net = Number(delta.netUnique);
  const maxChurnRatio =
    opts.maxChurnRatio != null && Number.isFinite(Number(opts.maxChurnRatio))
      ? Math.min(1, Math.max(0, Number(opts.maxChurnRatio)))
      : 0.25;
  const maxGrowthAbs =
    opts.maxGrowthAbs != null && Number.isFinite(Number(opts.maxGrowthAbs))
      ? Math.max(0, Number(opts.maxGrowthAbs))
      : 500;
  const churnDenom = Math.max(1, prevUnique);
  const removedRatio = removed / churnDenom;
  const addedRatio = added / churnDenom;
  const churnRatio = Math.max(removedRatio, addedRatio);
  const removedByClass = delta.removedByClass || {};
  const confirmedRemoved =
    Number(removedByClass[REMOVAL_CLASS.CONFIRMED_REMOVED] || 0) +
    Number(removedByClass[REMOVAL_CLASS.PARTNER_ENDED] || 0);
  const notYetSeen = Number(removedByClass[REMOVAL_CLASS.NOT_YET_SEEN] || 0);
  const unknown = Number(removedByClass[REMOVAL_CLASS.UNKNOWN] || 0);
  const lkgMerged = opts.lkgMerged === true;
  const feedsComplete = opts.feedsComplete === true;

  // High NOT_YET_SEEN churn without LKG merge is unsafe even if net≈0.
  const unsafePresentationChurn =
    !lkgMerged && notYetSeen + unknown >= Math.max(20, Math.floor(prevUnique * maxChurnRatio));
  const unsafeGrowth = Number.isFinite(net) && net > maxGrowthAbs && lkgMerged;
  const ok =
    !unsafePresentationChurn &&
    !unsafeGrowth &&
    (churnRatio <= maxChurnRatio ||
      lkgMerged ||
      (feedsComplete && confirmedRemoved >= removed * 0.8));

  return {
    ok,
    prevUnique,
    removed,
    added,
    netUnique: Number.isFinite(net) ? net : added - removed,
    removedRatio,
    addedRatio,
    churnRatio,
    maxChurnRatio,
    maxGrowthAbs,
    notYetSeen,
    unknown,
    confirmedRemoved,
    lkgMerged,
    feedsComplete,
    unsafePresentationChurn,
    unsafeGrowth,
    reason: ok
      ? "IDENTITY_CHURN_WITHIN_POLICY"
      : unsafeGrowth
        ? "PRODUCT_LKG_GROWTH_REFUSED"
        : "PRODUCT_IDENTITY_CHURN_REFUSED",
    note: "Net-stable promote with massive identity rotation is refused unless LKG-merged or confirmed removals dominate.",
  };
}

/**
 * Growth protection after LKG merge.
 *
 * Catalog retention may temporarily union prev LIVE + new window identities.
 * PUBLIC offer growth must NOT be bypassed via restoreBudget — HOLD retains
 * identity without counting toward public-eligible growth.
 */
export function evaluateLkgGrowthGate(prevUnique, afterUnique, opts = {}) {
  const prev = Math.max(0, Number(prevUnique) || 0);
  const afterCatalog = Math.max(0, Number(afterUnique) || 0);
  const afterPublic =
    opts.publicEligibleAfter != null && Number.isFinite(Number(opts.publicEligibleAfter))
      ? Math.max(0, Number(opts.publicEligibleAfter))
      : afterCatalog;
  const prevPublic =
    opts.prevPublicEligible != null && Number.isFinite(Number(opts.prevPublicEligible))
      ? Math.max(0, Number(opts.prevPublicEligible))
      : prev;
  const maxGrowthAbs =
    opts.maxGrowthAbs != null && Number.isFinite(Number(opts.maxGrowthAbs))
      ? Math.max(0, Number(opts.maxGrowthAbs))
      : 500;
  const maxGrowthRatio =
    opts.maxGrowthRatio != null && Number.isFinite(Number(opts.maxGrowthRatio))
      ? Math.min(1, Math.max(0, Number(opts.maxGrowthRatio)))
      : 0.2;
  const carried = Math.max(0, Number(opts.carried) || 0);
  const heldPublic = Math.max(0, Number(opts.heldPublic) || 0);
  const addedCount = Math.max(0, Number(opts.addedCount) || 0);
  const catalogGrowth = Math.max(0, afterCatalog - prev);
  const publicGrowth = Math.max(0, afterPublic - prevPublic);
  const publicRatio = prevPublic > 0 ? publicGrowth / prevPublic : publicGrowth > 0 ? 1 : 0;
  // restoreBudget is an audit bound for CATALOG retention accounting only — never a public bypass.
  const restoreBudgetCatalog = carried + addedCount + maxGrowthAbs;
  const catalogWithinRetention =
    carried > 0 && catalogGrowth <= restoreBudgetCatalog && heldPublic >= Math.min(carried, catalogGrowth);
  const publicOk = publicGrowth <= maxGrowthAbs || publicRatio <= maxGrowthRatio;
  const forgedRestoreBypass = opts.allowRestoreBudgetPublicBypass === true;
  const ok = publicOk && !forgedRestoreBypass;
  return {
    ok,
    prevUnique: prev,
    afterUnique: afterCatalog,
    publicEligibleAfter: afterPublic,
    prevPublicEligible: prevPublic,
    growth: catalogGrowth,
    publicGrowth,
    publicRatio,
    carried,
    heldPublic,
    addedCount,
    restoreBudget: restoreBudgetCatalog,
    restoreBudgetScope: "CATALOG_RETENTION_ONLY",
    catalogWithinRetention,
    publicOk,
    forgedRestoreBypass,
    maxGrowthAbs,
    maxGrowthRatio,
    reason: ok
      ? publicOk && catalogWithinRetention
        ? "LKG_GROWTH_WITHIN_POLICY"
        : "LKG_PUBLIC_GROWTH_WITHIN_POLICY_CATALOG_RETAINED"
      : forgedRestoreBypass
        ? "PRODUCT_LKG_RESTORE_BUDGET_PUBLIC_BYPASS_REFUSED"
        : "PRODUCT_LKG_PUBLIC_GROWTH_REFUSED",
    note: "Catalog may retain NOT_YET_SEEN via PUBLICATION_HOLD; public-eligible growth uses maxGrowthAbs/ratio only.",
  };
}

/**
 * Build per-identity LKG validation rows for a removed/carried delta.
 */
export function buildLkgIdentityValidationLedger(delta = {}, decisions = []) {
  const byKey = new Map((decisions || []).map((d) => [d.key, d]));
  const rows = [];
  for (const r of delta.removed || []) {
    const d = byKey.get(r.key) || {};
    let lkgClass = d.lkgValidationClass || null;
    if (!lkgClass) {
      if (!r.carryForward) {
        if (r.classId === REMOVAL_CLASS.PARTNER_ENDED) lkgClass = LKG_VALIDATION_CLASS.LKG_PARTNER_ENDED;
        else if (r.classId === REMOVAL_CLASS.NO_PERMISSION)
          lkgClass = LKG_VALIDATION_CLASS.LKG_PERMISSION_REVOKED;
        else if (r.publicationClass === "INVALID_AFFILIATE_URL")
          lkgClass = LKG_VALIDATION_CLASS.LKG_INVALID_URL;
        else if (r.classId === REMOVAL_CLASS.HOLD_COLLISION)
          lkgClass = LKG_VALIDATION_CLASS.LKG_IDENTITY_COLLISION;
        else if (r.classId === REMOVAL_CLASS.CONFIRMED_REMOVED)
          lkgClass = LKG_VALIDATION_CLASS.LKG_CONFIRMED_REMOVED;
        else lkgClass = LKG_VALIDATION_CLASS.LKG_BLOCKED;
      } else if (r.publicationClass === "SOURCE_STALE" || r.hideAsCurrent) {
        lkgClass = LKG_VALIDATION_CLASS.LKG_STALE_PRICE;
      } else if (r.classId === REMOVAL_CLASS.NOT_YET_SEEN) {
        lkgClass = LKG_VALIDATION_CLASS.LKG_PENDING_REVERIFY;
      } else {
        lkgClass = LKG_VALIDATION_CLASS.LKG_PENDING_REVERIFY;
      }
    }
    rows.push({
      compoundIdentity: r.key,
      advertiserId: r.advertiserId,
      productId: r.productId,
      partnerName: r.partnerName || null,
      classId: r.classId,
      publicationClass: r.publicationClass || null,
      carryForward: r.carryForward === true,
      catalogStatus: d.catalogStatus || null,
      publicationEligibility: d.publicationEligibility || null,
      lkgValidationClass: lkgClass,
      lastConfirmedPrice: r.lastConfirmedPrice ?? null,
      lastConfirmedAvailability: r.lastConfirmedAvailability ?? null,
      ageHours: r.ageHours ?? null,
      note: r.note || d.note || null,
      decisionAction: d.action || null,
    });
  }
  const byClass = {};
  for (const row of rows) {
    byClass[row.lkgValidationClass] = (byClass[row.lkgValidationClass] || 0) + 1;
  }
  return {
    schema: PUBLICATION_LKG_SCHEMA + "-identity-validation",
    count: rows.length,
    byClass,
    rows,
  };
}

/**
 * Release PUBLICATION_HOLD when the identity is source-verified in the current fetch window.
 * Does not invent products — only clears hold flags on already-retained identities.
 */
export function releaseLkgHoldsAgainstSource(doc, sourceVerifiedKeys, opts = {}) {
  const keys =
    sourceVerifiedKeys instanceof Set
      ? sourceVerifiedKeys
      : new Set(sourceVerifiedKeys || []);
  const endedAdvertisers =
    opts.endedAdvertisers instanceof Set
      ? opts.endedAdvertisers
      : new Set(opts.endedAdvertisers || []);
  const revokedAdvertisers =
    opts.revokedAdvertisers instanceof Set
      ? opts.revokedAdvertisers
      : new Set(opts.revokedAdvertisers || []);
  const out = JSON.parse(JSON.stringify(doc || {}));
  const seen = new Set();
  let holdTotal = 0;
  let reverifyAttempted = 0;
  let reverified = 0;
  let released = 0;
  let remainingHold = 0;
  let confirmedRemoved = 0;
  let blocked = 0;
  const releases = [];

  for (const sec of out.sections || []) {
    for (const p of sec.products || []) {
      if (!p || p.publicationReady === false) continue;
      const key = compoundProductKey(p.advertiserId, p.productId);
      const isHold =
        p.lkgPublicHold === true ||
        p.publicOffer === false ||
        p.hideAsCurrent === true ||
        p.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD;
      if (!isHold && !p.lkgCarried) continue;
      const firstSeen = !seen.has(key);
      if (firstSeen) seen.add(key);
      if (firstSeen && isHold) holdTotal += 1;
      if (firstSeen) reverifyAttempted += 1;
      if (endedAdvertisers.has(String(p.advertiserId))) {
        if (firstSeen) blocked += 1;
        if (firstSeen && isHold) remainingHold += 1;
        p.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED;
        p.lkgValidationClass = LKG_VALIDATION_CLASS.LKG_PARTNER_ENDED;
        continue;
      }
      if (revokedAdvertisers.has(String(p.advertiserId))) {
        if (firstSeen) blocked += 1;
        if (firstSeen && isHold) remainingHold += 1;
        p.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED;
        p.lkgValidationClass = LKG_VALIDATION_CLASS.LKG_PERMISSION_REVOKED;
        continue;
      }
      if (!isTrustedAffiliateUrl(p.affiliateUrl)) {
        if (firstSeen) blocked += 1;
        if (firstSeen && isHold) remainingHold += 1;
        p.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED;
        p.lkgValidationClass = LKG_VALIDATION_CLASS.LKG_INVALID_URL;
        continue;
      }
      if (!keys.has(key)) {
        if (firstSeen && isHold) remainingHold += 1;
        continue;
      }
      if (firstSeen) reverified += 1;
      if (!isHold) continue;
      p.lkgPublicHold = false;
      p.hideAsCurrent = false;
      p.publicOffer = true;
      p.publishable = true;
      p.publicationEligibility = PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE;
      p.freshnessStatus = "SOURCE_VERIFIED";
      p.freshnessReason = "LKG_HOLD_RELEASED_SOURCE_MATCH";
      p.lkgValidationClass = LKG_VALIDATION_CLASS.LKG_ELIGIBLE_VERIFIED;
      p.sourceFreshLabelForbidden = false;
      if (firstSeen) {
        released += 1;
        releases.push({ key, action: "RELEASE_HOLD_TO_PUBLIC_ELIGIBLE" });
      }
    }
  }

  const progress = {
    schema: PUBLICATION_LKG_SCHEMA + "-hold-reverify-progress",
    LKG_HOLD_TOTAL: holdTotal,
    LKG_REVERIFY_ATTEMPTED: reverifyAttempted,
    LKG_REVERIFIED: reverified,
    LKG_RELEASED_TO_PUBLIC: released,
    LKG_REMAINING_HOLD: Math.max(0, holdTotal - released),
    LKG_CONFIRMED_REMOVED: confirmedRemoved,
    LKG_BLOCKED: blocked,
    releasesSample: releases.slice(0, 40),
  };
  out.lkgHoldReverify = progress;
  // Refresh public-eligible stats
  let productsPublicEligible = 0;
  const uniquePublic = new Set();
  for (const sec of out.sections || []) {
    for (const p of sec.products || []) {
      if (!isPublicOfferEligible(p)) continue;
      productsPublicEligible += 1;
      uniquePublic.add(compoundProductKey(p.advertiserId, p.productId));
    }
  }
  out.stats = {
    ...(out.stats || {}),
    productsPublicEligible,
    uniquePublicEligible: uniquePublic.size,
  };
  return { doc: out, progress, publicEligibleAfter: uniquePublic.size };
}

export function summarizeLkgHoldProgress(doc) {
  let hold = 0;
  let eligible = 0;
  let blocked = 0;
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      if (!p || p.publicationReady === false) continue;
      if (p.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED) blocked += 1;
      else if (
        p.lkgPublicHold === true ||
        p.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD
      )
        hold += 1;
      else if (isPublicOfferEligible(p)) eligible += 1;
    }
  }
  return {
    LKG_HOLD_TOTAL: hold,
    PUBLICATION_ELIGIBLE: eligible,
    PUBLICATION_BLOCKED: blocked,
  };
}

export const PUBLIC_GROWTH_BUDGET_SCHEMA = "iu-cj-affiliate-phase3z-public-growth-budget-v51";

/**
 * Per-run + cumulative public growth budget.
 * Prevents splitting one exceptional +47% candidate into repeated +500 batches.
 */
export function computePublicGrowthBudget(prevPublicUnique, opts = {}) {
  const prev = Math.max(0, Number(prevPublicUnique) || 0);
  const maxGrowthAbs =
    opts.maxGrowthAbs != null && Number.isFinite(Number(opts.maxGrowthAbs))
      ? Math.max(0, Number(opts.maxGrowthAbs))
      : 500;
  const maxGrowthRatio =
    opts.maxGrowthRatio != null && Number.isFinite(Number(opts.maxGrowthRatio))
      ? Math.min(1, Math.max(0, Number(opts.maxGrowthRatio)))
      : 0.2;
  const perRun = Math.min(maxGrowthAbs, Math.floor(prev * maxGrowthRatio + 1e-9));
  const cumulativeAdded = Math.max(0, Number(opts.cumulativeAddedSinceBaseline) || 0);
  const maxCumulativeAbs =
    opts.maxCumulativeAbs != null && Number.isFinite(Number(opts.maxCumulativeAbs))
      ? Math.max(0, Number(opts.maxCumulativeAbs))
      : maxGrowthAbs;
  const cumulativeRemaining = Math.max(0, maxCumulativeAbs - cumulativeAdded);
  const allowedNew = Math.min(perRun, cumulativeRemaining);
  return {
    prevPublicUnique: prev,
    maxGrowthAbs,
    maxGrowthRatio,
    perRunBudget: perRun,
    maxCumulativeAbs,
    cumulativeAddedSinceBaseline: cumulativeAdded,
    cumulativeRemaining,
    allowedNew,
    exceptionalGrowthRequiresOwner: cumulativeRemaining <= 0 && cumulativeAdded >= maxCumulativeAbs,
  };
}

/**
 * Trim NEXT public doc so newly added identities respect growth budget.
 * Always keeps previously-LIVE public identities. Prefers preferredCurrency for new slots.
 */
export function applyPublicGrowthBudget(nextDoc, prevDoc, opts = {}) {
  const doc = JSON.parse(JSON.stringify(nextDoc || {}));
  const prevMap = collectPublicEligibleProductMap(prevDoc);
  const budget = computePublicGrowthBudget(prevMap.size, opts);
  const preferredCurrency = String(opts.preferredCurrency || "CZK").toUpperCase();
  const requirePrice = opts.requirePrice !== false;

  const newCandidates = [];
  const seenNew = new Set();
  for (const sec of doc.sections || []) {
    for (const p of sec.products || []) {
      if (!isPublicOfferEligible(p)) continue;
      const key = compoundProductKey(p.advertiserId, p.productId);
      if (!key || key === "|" || prevMap.has(key) || seenNew.has(key)) continue;
      if (requirePrice && !(Number(p.currentPrice) > 0)) continue;
      seenNew.add(key);
      const cur = String(p.currency || "").toUpperCase();
      newCandidates.push({
        key,
        product: p,
        prefer: cur === preferredCurrency ? 1 : 0,
        ts: String(p.lastSourceMatchAt || p.priceVerifiedAt || p.updatedAt || ""),
      });
    }
  }
  newCandidates.sort((a, b) => {
    if (b.prefer !== a.prefer) return b.prefer - a.prefer;
    return String(b.ts).localeCompare(String(a.ts));
  });

  const keepNew = new Set(newCandidates.slice(0, budget.allowedNew).map((r) => r.key));
  const deferredNew = newCandidates.slice(budget.allowedNew).map((r) => r.key);

  for (const sec of doc.sections || []) {
    if (!Array.isArray(sec.products)) continue;
    sec.products = sec.products.filter((p) => {
      if (!p || p.publicationReady === false) return true;
      const key = compoundProductKey(p.advertiserId, p.productId);
      if (prevMap.has(key)) return true;
      // Non-eligible rows (HOLD/BLOCKED) may remain for audit; they are not public growth.
      if (!isPublicOfferEligible(p)) return true;
      // Any NEW public-eligible identity must be explicitly inside the budgeted keep set.
      return keepNew.has(key);
    });
  }

  let uniquePublic = 0;
  const u = new Set();
  for (const sec of doc.sections || []) {
    for (const p of sec.products || []) {
      if (!isPublicOfferEligible(p)) continue;
      u.add(compoundProductKey(p.advertiserId, p.productId));
    }
  }
  uniquePublic = u.size;

  doc.publicGrowthBudget = {
    schema: PUBLIC_GROWTH_BUDGET_SCHEMA,
    ...budget,
    preferredCurrency,
    newCandidates: newCandidates.length,
    keptNew: keepNew.size,
    deferredNew: deferredNew.length,
    publicEligibleAfter: uniquePublic,
    note:
      deferredNew.length > 0
        ? "ROUTINE_SAFE_NEW_PRODUCT capped; remainder is EXCEPTIONAL_GROWTH (owner approval / cumulative budget)."
        : "Within routine public growth budget",
  };

  return {
    doc,
    budget,
    keptNew: [...keepNew],
    deferredNew,
    publicEligibleAfter: uniquePublic,
    prevPublicEligible: prevMap.size,
    publicGrowth: Math.max(0, uniquePublic - prevMap.size),
  };
}

export function emptyPublicGrowthBudgetLedger(opts = {}) {
  return {
    schema: PUBLIC_GROWTH_BUDGET_SCHEMA,
    updatedAt: opts.nowIso || new Date().toISOString(),
    baselineLiveUnique: Number(opts.baselineLiveUnique) || 0,
    baselineSnapshotAt: opts.baselineSnapshotAt || null,
    baselineSnapshotId: opts.baselineSnapshotId || null,
    maxCumulativeAbs: opts.maxCumulativeAbs != null ? Number(opts.maxCumulativeAbs) : 500,
    cumulativeAddedSinceBaseline: 0,
    lastAdded: 0,
    lastRunId: null,
    lastDecision: null,
    exceptionalCandidate: null,
    ownerUnlock: null,
  };
}

export function applyCumulativeGrowthLedger(ledger, applied) {
  const out = {
    ...(ledger && typeof ledger === "object" ? ledger : emptyPublicGrowthBudgetLedger()),
  };
  out.schema = PUBLIC_GROWTH_BUDGET_SCHEMA;
  out.updatedAt = applied?.nowIso || new Date().toISOString();
  if (!out.baselineSnapshotAt && applied?.baselineSnapshotAt) {
    out.baselineSnapshotAt = applied.baselineSnapshotAt;
    out.baselineLiveUnique = Number(applied.baselineLiveUnique) || out.baselineLiveUnique || 0;
    out.baselineSnapshotId = applied.baselineSnapshotId || null;
  }
  const added = Math.max(0, Number(applied?.keptNewCount) || 0);
  out.cumulativeAddedSinceBaseline = Math.max(0, Number(out.cumulativeAddedSinceBaseline) || 0) + added;
  out.lastAdded = added;
  out.lastRunId = applied?.runId || null;
  out.lastDecision = applied?.decision || null;
  if (applied?.exceptionalCandidate) out.exceptionalCandidate = applied.exceptionalCandidate;
  if (applied?.ownerUnlock) out.ownerUnlock = applied.ownerUnlock;
  return out;
}
