/**
 * V51.8 — GROWTH_SHADOW_MODE (offline only).
 * Simulates uncapped public growth drip without writing projects/data or arming LIVE uncapped.
 * Production growth gate stays locked 500/500 unless owner sets IU_CJ_PUBLIC_GROWTH_UNCAPPED=1.
 */
import {
  applyPublicGrowthBudget,
  collectPublicEligibleProductMap,
  compoundProductKey,
  isPublicOfferEligible,
  buildDeferredNewLedgerDocument,
  DEFERRED_NEW_LEDGER_SCHEMA,
  DEFERRED_NEW_LEDGER_FILENAME,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

export const GROWTH_SHADOW_MODE_SCHEMA =
  "iu-cj-affiliate-phase3z-growth-shadow-mode-v51-8";

export { DEFERRED_NEW_LEDGER_SCHEMA, DEFERRED_NEW_LEDGER_FILENAME, buildDeferredNewLedgerDocument };

const TRUSTED_AFFILIATE_URL_RE =
  /^https:\/\/(www\.)?(kqzyfj|jdoqocy|tkqlhce|dpbolvw|anrdoezrs|pjatr)\.(com|net)\//i;

const IN_STOCK_RE =
  /(^|\b)(in[_ ]?stock|available|skladem|pre[_ ]?order|back[_ ]?order)\b/i;

function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc || { sections: [] }));
}

function isTrustedAffiliateUrl(url) {
  return TRUSTED_AFFILIATE_URL_RE.test(String(url || ""));
}

function availabilityOk(product) {
  const cls = String(product?.availabilityClass || "").toUpperCase();
  if (cls === "IN_STOCK" || cls === "PREORDER" || cls === "BACKORDER") return true;
  if (cls === "OUT_OF_STOCK" || cls === "OOS" || cls === "UNAVAILABLE") return false;
  const raw = String(product?.availability || "");
  if (!raw) return true; // missing → do not hard-reject in shadow (HOLD path handles)
  if (/(out[_ ]?of[_ ]?stock|sold[_ ]?out|nedostupn|unavailable)/i.test(raw)) return false;
  return IN_STOCK_RE.test(raw) || raw.toLowerCase() === "in_stock";
}

function czEligibilityOk(product) {
  // Soft check: only reject when an explicit CZ flag is present and false.
  if (product?.czEligible === false || product?.eligibleForCz === false) return false;
  if (product?.geoEligible === false) return false;
  if (Array.isArray(product?.targetCountries) && product.targetCountries.length > 0) {
    const hit = product.targetCountries.some((c) =>
      /^(CZ|CZE|Czech)/i.test(String(c || "")),
    );
    if (!hit) return false;
  }
  return true;
}

export function shadowIdentityKey(product) {
  const base = compoundProductKey(product?.advertiserId, product?.productId);
  const variant = String(product?.productVariant || "").trim();
  if (!variant || base === "|") return base;
  return base + "|" + variant;
}

function normalizeDurableMap(durableProducts) {
  if (!durableProducts) return {};
  if (Array.isArray(durableProducts)) {
    const map = {};
    for (const p of durableProducts) {
      const key = shadowIdentityKey(p);
      if (key && key !== "|") map[key] = p;
    }
    return map;
  }
  if (durableProducts.products && typeof durableProducts.products === "object") {
    return durableProducts.products;
  }
  return durableProducts;
}

function partnerIndex(joinedPartners) {
  const map = new Map();
  const list = Array.isArray(joinedPartners)
    ? joinedPartners
    : joinedPartners?.partners || [];
  for (const p of list) {
    const id = String(p?.advertiserId || "");
    if (id) map.set(id, p);
  }
  return map;
}

function snapshotPaidPositions(doc) {
  // Coupons/actions are commercial surface; ads live outside offers — fingerprint both.
  const coupons = [];
  const actions = [];
  for (const sec of doc?.sections || []) {
    const sk = sec.sectionKey || sec.sectionId || "";
    for (const c of sec.coupons || []) {
      coupons.push(
        [sk, c.id || c.couponId || c.code || "", c.url || c.affiliateUrl || ""].join("|"),
      );
    }
    for (const a of sec.actions || []) {
      actions.push(
        [sk, a.id || a.actionId || a.title || "", a.url || a.affiliateUrl || ""].join("|"),
      );
    }
  }
  coupons.sort();
  actions.sort();
  return { coupons, actions, fingerprint: coupons.join(";") + "##" + actions.join(";") };
}

/**
 * Reconstruct deferred-new candidate keys from durable PUBLICATION_ELIGIBLE not-in-public.
 * Live run 447648 reported deferredNew=3633 but only sample≤200 keys persisted.
 */
export function reconstructDeferredCandidatesFromDurable(opts = {}) {
  const offersDoc = opts.offersDoc || opts.prevDoc || { sections: [] };
  const durableMap = normalizeDurableMap(opts.durableProducts);
  const publicMap = collectPublicEligibleProductMap(offersDoc);
  const keys = [];
  const productsByKey = new Map();
  let durablePeTotal = 0;
  for (const [key, raw] of Object.entries(durableMap)) {
    if (!raw) continue;
    if (String(raw.publicationEligibility || "") !== "PUBLICATION_ELIGIBLE") continue;
    if (raw.publicOffer === false) continue;
    if (raw.publicationReady === false) continue;
    if (raw.hideAsCurrent === true || raw.lkgPublicHold === true) continue;
    durablePeTotal += 1;
    if (publicMap.has(key)) continue;
    keys.push(key);
    productsByKey.set(key, raw);
  }
  keys.sort();
  const reportedDeferred =
    opts.reportedDeferredNew != null
      ? Number(opts.reportedDeferredNew)
      : Number(offersDoc?.publicGrowthBudget?.deferredNew) || null;
  const gap =
    reportedDeferred != null && Number.isFinite(reportedDeferred)
      ? reportedDeferred - keys.length
      : "HISTORICAL_EVIDENCE_UNAVAILABLE";
  return {
    keys,
    productsByKey,
    durablePeTotal,
    publicEligibleInOffers: publicMap.size,
    reconstructedNotInPublic: keys.length,
    reportedDeferredNew:
      reportedDeferred != null && Number.isFinite(reportedDeferred)
        ? reportedDeferred
        : "UNKNOWN",
    gap,
    gapNote:
      gap === "HISTORICAL_EVIDENCE_UNAVAILABLE"
        ? "No reported deferredNew to compare (UNKNOWN / HISTORICAL_EVIDENCE_UNAVAILABLE)."
        : gap === 0
          ? "Reconstructed keys match reported deferredNew."
          : "GAP: live deferredNew count includes identities not present as durable PUBLICATION_ELIGIBLE not-in-public (or eligibility/publicOffer drift). Full keys were never persisted historically (sample≤200 only).",
  };
}

/**
 * Validate one shadow candidate. Returns {ok, hold, rejectReason, category, partner}.
 */
export function validateShadowCandidate(product, opts = {}) {
  const partners = opts.partnerById instanceof Map ? opts.partnerById : partnerIndex(opts.joinedPartners);
  const adv = String(product?.advertiserId || "");
  const pid = String(product?.productId || "");
  const key = shadowIdentityKey(product);
  const partner = partners.get(adv) || null;
  const category =
    product?.sectionKey ||
    product?.category ||
    partner?.primaryCategory ||
    partner?.category ||
    "unknown";

  if (!adv || !pid || key === "|") {
    return { ok: false, hold: false, rejectReason: "IDENTITY_MISSING", category, partner, key };
  }
  if (!isTrustedAffiliateUrl(product?.affiliateUrl)) {
    return { ok: false, hold: false, rejectReason: "BAD_AFFILIATE_URL", category, partner, key };
  }
  if (!czEligibilityOk(product)) {
    return { ok: false, hold: false, rejectReason: "CZ_ELIGIBILITY_FALSE", category, partner, key };
  }
  if (!(Number(product?.currentPrice) > 0)) {
    return { ok: false, hold: false, rejectReason: "INVALID_PRICE", category, partner, key };
  }
  if (!availabilityOk(product)) {
    return { ok: false, hold: true, rejectReason: "AVAILABILITY_HOLD", category, partner, key };
  }
  if (product?.publicationEligibility === "PUBLICATION_HOLD") {
    return { ok: false, hold: true, rejectReason: "PUBLICATION_HOLD", category, partner, key };
  }
  if (product?.publicationEligibility === "PUBLICATION_BLOCKED") {
    return { ok: false, hold: false, rejectReason: "PUBLICATION_BLOCKED", category, partner, key };
  }
  if (product?.publicationReady === false || product?.publicOffer === false) {
    return { ok: false, hold: true, rejectReason: "NOT_PUBLIC_READY", category, partner, key };
  }
  return { ok: true, hold: false, rejectReason: null, category, partner, key };
}

function ensureSection(doc, product, partner) {
  const sectionKey = product.sectionKey || "aff-shadow";
  let sec = (doc.sections || []).find((s) => s.sectionKey === sectionKey);
  if (!sec) {
    sec = {
      sectionKey,
      advertiserId: String(product.advertiserId || ""),
      partnerName: product.partnerName || partner?.name || sectionKey,
      coupons: [],
      actions: [],
      products: [],
    };
    if (!Array.isArray(doc.sections)) doc.sections = [];
    doc.sections.push(sec);
  }
  if (!Array.isArray(sec.products)) sec.products = [];
  if (!Array.isArray(sec.coupons)) sec.coupons = [];
  if (!Array.isArray(sec.actions)) sec.actions = [];
  return sec;
}

function toOfferProduct(raw) {
  return {
    advertiserId: String(raw.advertiserId),
    productId: String(raw.productId),
    partnerName: raw.partnerName || null,
    sectionKey: raw.sectionKey || null,
    title: raw.title || `P-${raw.productId}`,
    imageUrl: raw.imageUrl || null,
    currentPrice:
      typeof raw.currentPrice === "string" ? Number(raw.currentPrice) : raw.currentPrice,
    originalPrice: raw.originalPrice ?? null,
    currency: raw.currency || "CZK",
    availability: raw.availability || raw.availabilityClass || "IN_STOCK",
    availabilityClass: raw.availabilityClass || null,
    affiliateUrl: raw.affiliateUrl,
    publicationReady: raw.publicationReady !== false,
    publicOffer: raw.publicOffer !== false,
    publicationEligibility: raw.publicationEligibility || "PUBLICATION_ELIGIBLE",
    hideAsCurrent: raw.hideAsCurrent === true,
    lkgPublicHold: raw.lkgPublicHold === true,
    lastSourceMatchAt: raw.lastSourceMatchAt || null,
    priceVerifiedAt: raw.priceVerifiedAt || null,
    updatedAt: raw.updatedAt || null,
    czEligible: raw.czEligible,
    eligibleForCz: raw.eligibleForCz,
    geoEligible: raw.geoEligible,
    targetCountries: raw.targetCountries,
  };
}

function estimateImpact(prevPublicSize, nextPublicSize, admitted) {
  const delta = Math.max(0, nextPublicSize - prevPublicSize);
  const bytesPerProduct = 420; // compact offer row estimate
  const loadBytes = delta * bytesPerProduct;
  return {
    deltaPublicSize: delta,
    pagesBuildImpactEstimate: {
      extraProducts: delta,
      extraSectionsTouched: Math.min(delta, admitted?.byCategory ? Object.keys(admitted.byCategory).length : delta),
      relativeGrowth:
        prevPublicSize > 0 ? Number((delta / prevPublicSize).toFixed(4)) : delta > 0 ? 1 : 0,
      note: "Offline estimate only — no HTML/pages written.",
    },
    pwaImpactEstimate: {
      cacheEntriesDelta: delta,
      approxJsonBytesDelta: loadBytes,
      note: "PWA cache/workbox impact estimate from product delta.",
    },
    loadEstimate: {
      approxBytesDelta: loadBytes,
      approxKbDelta: Number((loadBytes / 1024).toFixed(1)),
      productsDelta: delta,
    },
  };
}

function emptyCounters() {
  return {
    processed: 0,
    validCandidates: 0,
    hold: 0,
    rejected: 0,
    duplicates: 0,
    errors: 0,
    byPartner: {},
    byCategory: {},
  };
}

function bump(map, key, n = 1) {
  const k = String(key || "unknown");
  map[k] = (map[k] || 0) + n;
}

/**
 * Offline growth shadow simulation. Never writes projects/data.
 *
 * @param {object} opts
 * @param {object} opts.offersDoc baseline / live public offers
 * @param {object|array} [opts.durableProducts] durable catalog products map/array
 * @param {object} [opts.prevDoc] alias for offersDoc
 * @param {object|array} [opts.joinedPartners]
 * @param {number} [opts.iterations=3]
 * @param {number} [opts.batchSize] optional hard admit cap per iteration (else ratio budget)
 * @param {boolean} [opts.uncappedShadow=true] simulate uncappedMode in applyPublicGrowthBudget
 */
export function runGrowthShadowMode(opts = {}) {
  const offersDoc = opts.offersDoc || opts.prevDoc;
  if (!offersDoc || typeof offersDoc !== "object") {
    throw new Error("runGrowthShadowMode requires offersDoc or prevDoc");
  }
  if (opts.uncappedShadow !== true && opts.uncappedShadow !== false) {
    // default true for shadow sims; never confuses with LIVE env arming
  }
  const uncappedShadow = opts.uncappedShadow !== false;
  const iterations = Math.max(1, Math.min(50, Number(opts.iterations) || 3));
  const batchSize =
    opts.batchSize != null && Number.isFinite(Number(opts.batchSize))
      ? Math.max(1, Number(opts.batchSize))
      : null;

  const partnerById = partnerIndex(opts.joinedPartners);
  const reconstructed = reconstructDeferredCandidatesFromDurable({
    offersDoc,
    durableProducts: opts.durableProducts,
    reportedDeferredNew: opts.reportedDeferredNew,
  });

  const paidBefore = snapshotPaidPositions(offersDoc);
  let working = cloneDoc(offersDoc);
  // Shadow must never flip LIVE publish flags on disk — keep liveEnabled as-is in memory only.
  const baselinePublic = collectPublicEligibleProductMap(offersDoc).size;

  const poolKeys = [...reconstructed.keys];
  const remaining = [...poolKeys];
  const admittedKeys = new Set();
  const totals = emptyCounters();
  const iterationRows = [];
  let monotonicOk = true;
  let prevSize = baselinePublic;

  for (let i = 0; i < iterations; i++) {
    const iterCounters = emptyCounters();
    const errors = [];
    const next = cloneDoc(working);
    const alreadyPublic = collectPublicEligibleProductMap(next);
    const seenInBatch = new Set();
    const staged = [];

    // Pull a generous candidate window; growth budget decides actual admit size.
    const windowCap = batchSize != null ? batchSize * 4 : Math.max(200, Math.floor(prevSize * 0.8) || 200);
    let scanned = 0;
    while (remaining.length > 0 && scanned < windowCap) {
      const key = remaining.shift();
      scanned += 1;
      iterCounters.processed += 1;
      totals.processed += 1;
      if (alreadyPublic.has(key) || admittedKeys.has(key) || seenInBatch.has(key)) {
        iterCounters.duplicates += 1;
        totals.duplicates += 1;
        continue;
      }
      const raw = reconstructed.productsByKey.get(key);
      if (!raw) {
        iterCounters.errors += 1;
        totals.errors += 1;
        errors.push({ key, error: "MISSING_DURABLE_ROW" });
        continue;
      }
      let product;
      try {
        product = toOfferProduct(raw);
      } catch (err) {
        iterCounters.errors += 1;
        totals.errors += 1;
        errors.push({ key, error: String(err?.message || err) });
        continue;
      }
      const v = validateShadowCandidate(product, { partnerById });
      if (v.hold) {
        iterCounters.hold += 1;
        totals.hold += 1;
        bump(iterCounters.byCategory, v.category);
        bump(totals.byCategory, v.category);
        continue;
      }
      if (!v.ok) {
        iterCounters.rejected += 1;
        totals.rejected += 1;
        bump(iterCounters.byPartner, product.advertiserId);
        bump(totals.byPartner, product.advertiserId);
        bump(iterCounters.byCategory, v.category);
        bump(totals.byCategory, v.category);
        continue;
      }
      seenInBatch.add(key);
      staged.push({ key, product, category: v.category, partner: v.partner });
    }

    for (const row of staged) {
      const sec = ensureSection(next, row.product, row.partner);
      sec.products.push(row.product);
    }

    const growthOpts = {
      uncappedMode: uncappedShadow === true,
      preferredCurrency: opts.preferredCurrency || "CZK",
      // Shadow simulations intentionally ignore cumulative 500 lock to measure drip capacity.
      // This does NOT write LIVE ledger / does NOT set IU_CJ_PUBLIC_GROWTH_UNCAPPED.
      cumulativeAddedSinceBaseline: uncappedShadow ? 0 : 500,
      maxCumulativeAbs: uncappedShadow ? Number.MAX_SAFE_INTEGER : 500,
      maxGrowthAbs: uncappedShadow ? null : 500,
      maxGrowthRatio: opts.maxGrowthRatio != null ? Number(opts.maxGrowthRatio) : 0.2,
      surgeRatio: opts.surgeRatio != null ? Number(opts.surgeRatio) : 0.5,
    };
    const applied = applyPublicGrowthBudget(next, working, growthOpts);

    // Optional hard batchSize clamp after budget (never exceeds uncapped ratio admit).
    let kept = applied.keptNew;
    if (batchSize != null && kept.length > batchSize) {
      const drop = new Set(kept.slice(batchSize));
      kept = kept.slice(0, batchSize);
      const prevPublicKeys = collectPublicEligibleProductMap(working);
      for (const sec of applied.doc.sections || []) {
        if (!Array.isArray(sec.products)) continue;
        sec.products = sec.products.filter((p) => {
          if (!isPublicOfferEligible(p)) return true;
          const k = shadowIdentityKey(p);
          if (prevPublicKeys.has(k)) return true;
          if (p.lkgCarried === true || p.lkgRecovered === true) return true;
          return !drop.has(k);
        });
      }
    }

    const keptSet = new Set(kept);
    for (const row of staged) {
      if (keptSet.has(row.key)) {
        admittedKeys.add(row.key);
        iterCounters.validCandidates += 1;
        totals.validCandidates += 1;
        const partnerName =
          row.partner?.name || row.product.partnerName || row.product.advertiserId;
        bump(iterCounters.byPartner, partnerName);
        bump(totals.byPartner, partnerName);
        bump(iterCounters.byCategory, row.category);
        bump(totals.byCategory, row.category);
      } else {
        // Not admitted this round — return to pool for later iterations.
        remaining.push(row.key);
      }
    }

    const afterSize = collectPublicEligibleProductMap(applied.doc).size;
    if (afterSize < prevSize) monotonicOk = false;
    const impact = estimateImpact(prevSize, afterSize, iterCounters);
    const paidAfter = snapshotPaidPositions(applied.doc);
    const paidUntouched = paidAfter.fingerprint === paidBefore.fingerprint;

    const rollbackPlan = {
      schema: "iu-cj-affiliate-phase3z-growth-shadow-rollback-v51-8",
      restorePublicEligibleTo: prevSize,
      dropKeys: kept,
      note: "Shadow-only: discard in-memory applied.doc and keep prior working snapshot; never wrote projects/data.",
    };

    iterationRows.push({
      iteration: i + 1,
      uncappedShadow: uncappedShadow === true,
      processed: iterCounters.processed,
      staged: staged.length,
      validCandidates: iterCounters.validCandidates,
      hold: iterCounters.hold,
      rejected: iterCounters.rejected,
      duplicates: iterCounters.duplicates,
      errors: iterCounters.errors,
      errorSamples: errors.slice(0, 5),
      byPartner: iterCounters.byPartner,
      byCategory: iterCounters.byCategory,
      prevPublicSize: prevSize,
      nextPublicSize: afterSize,
      deltaPublicSize: impact.deltaPublicSize,
      pagesBuildImpactEstimate: impact.pagesBuildImpactEstimate,
      pwaImpactEstimate: impact.pwaImpactEstimate,
      loadEstimate: impact.loadEstimate,
      paidPositionsUntouched: paidUntouched,
      monotonicVsPrev: afterSize >= prevSize,
      allowedNew: applied.budget?.allowedNew ?? null,
      deferredNew: applied.deferredNew?.length ?? 0,
      rollbackPlan,
      growthGateNote:
        "LIVE growth gate remains locked 500/500; uncappedShadow is offline simulation only.",
    });

    working = applied.doc;
    prevSize = afterSize;
  }

  const finalSize = collectPublicEligibleProductMap(working).size;
  const impactTotal = estimateImpact(baselinePublic, finalSize, totals);
  const paidFinal = snapshotPaidPositions(working);

  return {
    schema: GROWTH_SHADOW_MODE_SCHEMA,
    at: new Date().toISOString(),
    ok: monotonicOk && paidFinal.fingerprint === paidBefore.fingerprint,
    wroteProjectsData: false,
    uncappedShadow: uncappedShadow === true,
    growthGateStillLocked: true,
    productionNote:
      "Shadow mode never sets IU_CJ_PUBLIC_GROWTH_UNCAPPED and never publishes deferred products to production.",
    iterations: iterationRows.length,
    iterationRows,
    processed: totals.processed,
    validCandidates: totals.validCandidates,
    hold: totals.hold,
    rejected: totals.rejected,
    duplicates: totals.duplicates,
    errors: totals.errors,
    byPartner: totals.byPartner,
    byCategory: totals.byCategory,
    baselinePublicSize: baselinePublic,
    finalPublicSize: finalSize,
    deltaPublicSize: impactTotal.deltaPublicSize,
    pagesBuildImpactEstimate: impactTotal.pagesBuildImpactEstimate,
    pwaImpactEstimate: impactTotal.pwaImpactEstimate,
    loadEstimate: impactTotal.loadEstimate,
    paidPositionsUntouched: paidFinal.fingerprint === paidBefore.fingerprint,
    monotonicityOk: monotonicOk,
    deferredReconstruction: {
      reportedDeferredNew: reconstructed.reportedDeferredNew,
      reconstructedNotInPublic: reconstructed.reconstructedNotInPublic,
      durablePeTotal: reconstructed.durablePeTotal,
      publicEligibleInOffers: reconstructed.publicEligibleInOffers,
      gap: reconstructed.gap,
      gapNote: reconstructed.gapNote,
      poolRemaining: remaining.length,
    },
    rollbackPlan: {
      schema: "iu-cj-affiliate-phase3z-growth-shadow-rollback-v51-8",
      restorePublicEligibleTo: baselinePublic,
      dropAdmittedKeys: [...admittedKeys],
      note: "Discard shadow working doc; baseline offersDoc remains authoritative. No disk rollback needed (no writes).",
    },
    deferredLedgerSchema: DEFERRED_NEW_LEDGER_SCHEMA,
    deferredLedgerFile: DEFERRED_NEW_LEDGER_FILENAME,
  };
}
