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
export function classifyMissingPublishedProduct(prevRow, opts = {}) {
  const key = prevRow.key;
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
  const holdKeys = opts.holdKeys instanceof Set ? opts.holdKeys : new Set(opts.holdKeys || []);
  const miss = missByKey.get(key) || null;

  if (endedAdvertisers.has(prevRow.advertiserId)) {
    return {
      classId: REMOVAL_CLASS.PARTNER_ENDED,
      carryForward: false,
      rootCauseVerified: true,
      note: "Partner ENDED — do not restore.",
    };
  }
  if (holdKeys.has(key) || miss?.decision === "HOLD_COLLISION") {
    return {
      classId: REMOVAL_CLASS.HOLD_COLLISION,
      carryForward: true,
      rootCauseVerified: true,
      note: "HOLD_COLLISION — keep LKG visible, no remap.",
    };
  }
  if (miss?.decision === "REMOVE_CONFIRMED") {
    return {
      classId: REMOVAL_CLASS.CONFIRMED_REMOVED,
      carryForward: false,
      rootCauseVerified: true,
      note: "Explicit REMOVE_CONFIRMED evidence.",
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
      note:
        "Missing from current discovery/presentation window — treat as NOT_YET_SEEN, carry LKG until confirmed.",
    };
  }
  if (miss?.decision === "TEMPORARILY_HIDE") {
    return {
      classId: REMOVAL_CLASS.SOURCE_UNAVAILABLE,
      carryForward: false,
      rootCauseVerified: true,
      note: "Repeated productIds miss / age hide policy.",
    };
  }
  return {
    classId: REMOVAL_CLASS.UNKNOWN,
    carryForward: true,
    rootCauseVerified: false,
    note: "Cause unknown — fail-closed carry LKG until verified.",
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
      carryForward: classified.carryForward,
      rootCauseVerified: classified.rootCauseVerified,
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
    const product = {
      ...prev.product,
      publicationReady: true,
      publishable: true,
      lkgCarried: true,
      refreshResult: row.classId,
      refreshReason: "lkg_carry_incomplete_discovery_or_unverified",
      freshnessStatus: "UNKNOWN",
      freshnessReason: "LKG_CARRIED_NOT_CURRENT_WINDOW",
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
