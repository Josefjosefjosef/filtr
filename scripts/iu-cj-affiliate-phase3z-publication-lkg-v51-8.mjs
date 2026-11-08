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

export function compoundProductKey(advertiserId, productId) {
  return String(advertiserId || "") + "|" + String(productId || "");
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
  for (const row of delta.removed) {
    const decision = {
      key: row.key,
      classId: row.classId,
      action: row.carryForward ? "RESTORE_LKG" : "DO_NOT_RESTORE",
      rootCauseVerified: row.rootCauseVerified,
      note: row.note,
    };
    if (!row.carryForward) {
      blocked += 1;
      decisions.push(decision);
      continue;
    }
    const prev = prevMap.get(row.key);
    if (!prev?.product) {
      decision.action = "SKIP_MISSING_PREV_PAYLOAD";
      decisions.push(decision);
      continue;
    }
    const classified = {
      hideAsCurrent: row.publicationClass === "SOURCE_STALE" || row.publicationClass === "UNKNOWN",
      publicationClass: row.publicationClass || row.classId,
    };
    // Re-read classification flags from decisions note path
    const hideAsCurrent = /STALE|UNKNOWN|HOLD/i.test(String(row.publicationClass || row.classId));
    const product = {
      ...prev.product,
      publicationReady: true,
      publishable: true,
      lkgCarried: true,
      refreshResult: row.classId,
      refreshReason: "lkg_carry_incomplete_discovery_or_unverified",
      freshnessStatus: hideAsCurrent ? "UNKNOWN" : "UNKNOWN",
      freshnessReason: hideAsCurrent
        ? "LKG_CARRIED_NOT_CURRENT_DO_NOT_LABEL_CURRENT"
        : "LKG_CARRIED_NOT_CURRENT_WINDOW",
      publicationClass: classified.publicationClass,
      // Never present LKG-only prices as source-verified CURRENT.
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
    decisions.push(decision);
  }

  // Recompute naive product stats if helper unavailable here.
  let products = 0;
  const unique = new Set();
  for (const sec of doc.sections) {
    for (const p of sec.products || []) {
      if (p.publicationReady === false) continue;
      products += 1;
      unique.add(compoundProductKey(p.advertiserId, p.productId));
    }
  }
  doc.stats = {
    ...(doc.stats || {}),
    products,
    uniqueProducts: unique.size,
    lkgCarriedProducts: carried,
  };
  doc.lkgMerge = {
    schema: PUBLICATION_LKG_SCHEMA,
    carried,
    blocked,
    prevUnique: delta.prevUnique,
    nextUniqueBeforeMerge: delta.nextUnique,
    nextUniqueAfterMerge: unique.size,
  };
  doc.note =
    (doc.note ? String(doc.note) + " | " : "") +
    "V51.8-c2: LKG merge carried NOT_YET_SEEN/UNKNOWN/HOLD products across incomplete discovery windows.";

  return {
    doc,
    delta,
    decisions,
    carried,
    blocked,
    uniqueAfter: unique.size,
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
 * Growth protection after LKG merge: refuse unbounded accumulation.
 */
export function evaluateLkgGrowthGate(prevUnique, afterUnique, opts = {}) {
  const prev = Math.max(0, Number(prevUnique) || 0);
  const after = Math.max(0, Number(afterUnique) || 0);
  const maxGrowthAbs =
    opts.maxGrowthAbs != null && Number.isFinite(Number(opts.maxGrowthAbs))
      ? Math.max(0, Number(opts.maxGrowthAbs))
      : 500;
  const maxGrowthRatio =
    opts.maxGrowthRatio != null && Number.isFinite(Number(opts.maxGrowthRatio))
      ? Math.min(1, Math.max(0, Number(opts.maxGrowthRatio)))
      : 0.2;
  const carried = Math.max(0, Number(opts.carried) || 0);
  const addedCount = Math.max(0, Number(opts.addedCount) || 0);
  const growth = Math.max(0, after - prev);
  const ratio = prev > 0 ? growth / prev : growth > 0 ? 1 : 0;
  // LKG restore of NOT_YET_SEEN may temporarily union prev+new window identities.
  // Allow growth up to carried + newly added + abs slack; refuse unbounded invent.
  const restoreBudget = carried + addedCount + maxGrowthAbs;
  const withinRestoreBudget = carried > 0 && growth <= restoreBudget;
  const ok = growth <= maxGrowthAbs || ratio <= maxGrowthRatio || withinRestoreBudget;
  return {
    ok,
    prevUnique: prev,
    afterUnique: after,
    growth,
    ratio,
    carried,
    addedCount,
    restoreBudget,
    withinRestoreBudget,
    maxGrowthAbs,
    maxGrowthRatio,
    reason: ok ? "LKG_GROWTH_WITHIN_POLICY" : "PRODUCT_LKG_GROWTH_REFUSED",
  };
}
