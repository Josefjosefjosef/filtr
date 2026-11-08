/**
 * V50 — individual product reverify ledger.
 * Only products whose compound identity was compared against freshly fetched source rows count as reverify.
 */
import { compoundIdentity } from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";
import {
  classifyPriceTransition,
  PRICE_CHANGE_CLASS,
} from "./iu-cj-affiliate-phase3z-price-normalize-v49.mjs";

export const PRODUCT_REVERIFY_SCHEMA = "iu-cj-affiliate-phase3z-product-reverify-v50";

export const REVERIFY_CLASS = Object.freeze({
  NEW_PRODUCT: "NEW_PRODUCT",
  REVERIFIED_UNCHANGED: "REVERIFIED_UNCHANGED",
  REVERIFIED_PRICE_CHANGED: "REVERIFIED_PRICE_CHANGED",
  REVERIFIED_AVAILABILITY_CHANGED: "REVERIFIED_AVAILABILITY_CHANGED",
  REVERIFIED_FORMAT_ONLY: "REVERIFIED_FORMAT_ONLY",
  SOURCE_NOT_FOUND: "SOURCE_NOT_FOUND",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  RETRY_PENDING: "RETRY_PENDING",
  HOLD_COLLISION: "HOLD_COLLISION",
  KEEP_PENDING: "KEEP_PENDING",
});

function mapGet(m, k) {
  if (!m) return null;
  if (typeof m.get === "function") return m.get(k) || null;
  return m[k] || null;
}

/**
 * Build per-product reverify rows from current offers doc + refresh coverage/maps.
 */
export function buildProductReverifyLedger(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const runId = opts.runId != null ? String(opts.runId) : null;
  const sha = opts.sha || null;
  const doc = opts.doc || {};
  const coverageByKey = opts.coverageByKey || null;
  const refreshedByKey = opts.refreshedByKey || null;
  const previousByKey = opts.previousByKey || new Map();
  const previousReverifyByKey = opts.previousReverifyByKey || new Map();

  const rows = [];
  const seen = new Set();

  for (const sec of doc.sections || []) {
    for (const p of sec.products || []) {
      const adv = p.advertiserId != null ? String(p.advertiserId) : "";
      const pid = p.productId != null ? String(p.productId) : "";
      if (!adv || !pid) continue;
      const key = compoundIdentity(adv, pid);
      if (seen.has(key)) continue;
      seen.add(key);

      const prevCard = mapGet(previousByKey, key);
      const prevRev = mapGet(previousReverifyByKey, key);
      const cov = mapGet(coverageByKey, key);
      const ref = mapGet(refreshedByKey, key);

      const previousVerificationTimestamp =
        prevRev?.currentVerificationTimestamp ||
        prevCard?.verifiedAt ||
        prevCard?.lastSuccessfulRefreshAt ||
        null;
      let previousPrice = prevCard?.currentPrice ?? prevRev?.currentPrice ?? null;
      const previousAvailability =
        prevCard?.availability ?? prevRev?.currentAvailability ?? null;
      const previousRunId =
        prevRev?.runId != null
          ? String(prevRev.runId)
          : prevCard?.runId != null
            ? String(prevCard.runId)
            : null;
      const previousSourceTimestamp =
        prevRev?.currentSourceTimestamp ||
        prevCard?.sourceTimestamp ||
        prevCard?.sourceUpdatedAt ||
        null;
      const previousFetchTimestamp =
        prevRev?.currentFetchTimestamp ||
        prevCard?.fetchTimestamp ||
        prevCard?.fetchedAt ||
        null;

      let classification = REVERIFY_CLASS.RETRY_PENDING;
      let sourceMatchResult = "NOT_ATTEMPTED";
      let reverifyAttempted = false;
      let publicationDecision =
        p.publicationReady === false ? "HOLD_OR_HIDE" : "KEEP_PUBLISHED";
      let economicChange = false;
      let formatOnlyChange = false;
      let availabilityChange = false;
      let identityCollision = false;

      if (p.rejectReason === "HOLD_COLLISION" || p.hysteresisState === "HOLD_COLLISION") {
        classification = REVERIFY_CLASS.HOLD_COLLISION;
        publicationDecision = "HOLD";
        identityCollision = true;
        reverifyAttempted = true;
      } else if (p.keepPending === true || p.freshnessReason === "KEEP_PENDING") {
        classification = REVERIFY_CLASS.KEEP_PENDING;
        publicationDecision = "KEEP_PENDING";
      } else if (ref) {
        sourceMatchResult = "SOURCE_MATCHED";
        reverifyAttempted = true;
        // V51.6: never fall back to currentPrice as baseline (that invented PRICE_CHANGED).
        // Prefer prior reverify/card price; product.previousPrice only when prior ledger missing.
        const comparisonBaselinePrice =
          previousPrice != null
            ? previousPrice
            : p.previousPrice != null && p.previousPrice !== p.currentPrice
              ? p.previousPrice
              : null;
        const priceClass = classifyPriceTransition(
          comparisonBaselinePrice,
          p.currentPrice,
          prevCard?.currency || p.currency,
          p.currency
        );
        const availChanged =
          previousAvailability != null &&
          String(previousAvailability) !== String(p.availability ?? "");
        economicChange = priceClass.economicChange === true;
        formatOnlyChange = priceClass.class === PRICE_CHANGE_CLASS.FORMAT_ONLY;
        availabilityChange = availChanged === true;
        // Overwrite stored previousPrice with the baseline actually compared.
        const storedPreviousPrice = comparisonBaselinePrice;

        if (ref.gone === true || ref.removeFromPublic === true) {
          classification = REVERIFY_CLASS.SOURCE_UNAVAILABLE;
        } else if (comparisonBaselinePrice == null) {
          // First verifiable observation this identity — not a price change.
          classification =
            !prevCard && !prevRev ? REVERIFY_CLASS.NEW_PRODUCT : REVERIFY_CLASS.REVERIFIED_UNCHANGED;
          economicChange = false;
          formatOnlyChange = false;
        } else if (priceClass.economicChange) {
          classification = REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED;
        } else if (availChanged) {
          classification = REVERIFY_CLASS.REVERIFIED_AVAILABILITY_CHANGED;
        } else if (priceClass.class === PRICE_CHANGE_CLASS.FORMAT_ONLY) {
          classification = REVERIFY_CLASS.REVERIFIED_FORMAT_ONLY;
        } else if (!prevCard && !prevRev) {
          classification = REVERIFY_CLASS.NEW_PRODUCT;
        } else {
          classification = REVERIFY_CLASS.REVERIFIED_UNCHANGED;
        }
        // Ensure row stores the compared baseline (not a null that disagrees with class).
        previousPrice = storedPreviousPrice;
      } else if (cov) {
        reverifyAttempted = true;
        const rr = String(cov.refreshResult || "");
        if (rr === "NOT_IN_SCAN_WINDOW" || rr === "SOURCE_NOT_FOUND") {
          classification = REVERIFY_CLASS.SOURCE_NOT_FOUND;
          sourceMatchResult = "SOURCE_NOT_FOUND";
        } else if (rr === "SOURCE_UNAVAILABLE") {
          classification = REVERIFY_CLASS.SOURCE_UNAVAILABLE;
          sourceMatchResult = "SOURCE_UNAVAILABLE";
        } else {
          classification = REVERIFY_CLASS.RETRY_PENDING;
          sourceMatchResult = rr || "ATTEMPTED_NO_MATCH";
        }
      } else if (!prevCard && !prevRev) {
        classification = REVERIFY_CLASS.NEW_PRODUCT;
        sourceMatchResult = "NO_PRIOR_NO_REFRESH";
      } else {
        classification = REVERIFY_CLASS.RETRY_PENDING;
        sourceMatchResult = "PRIOR_KNOWN_NOT_IN_THIS_REFRESH_PASS";
      }

      const successfullyReverified = [
        REVERIFY_CLASS.REVERIFIED_UNCHANGED,
        REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED,
        REVERIFY_CLASS.REVERIFIED_AVAILABILITY_CHANGED,
        REVERIFY_CLASS.REVERIFIED_FORMAT_ONLY,
      ].includes(classification);

      const currentSourceTimestamp = p.sourceTimestamp || p.sourceUpdatedAt || null;
      const currentFetchTimestamp = p.fetchTimestamp || p.fetchedAt || ref?.fetchedAt || null;

      rows.push({
        advertiserId: adv,
        productId: pid,
        compoundIdentity: key,
        feedId: p.feedId != null ? p.feedId : null,
        sectionKey: sec.sectionKey || null,
        previousRunId,
        currentRunId: runId,
        previousSourceTimestamp,
        currentSourceTimestamp,
        previousFetchTimestamp,
        currentFetchTimestamp,
        previousVerificationTimestamp,
        currentVerificationTimestamp: successfullyReverified
          ? p.verifiedAt || p.lastSuccessfulRefreshAt || nowIso
          : p.verifiedAt || null,
        previousPrice,
        currentPrice: p.currentPrice ?? null,
        previousAvailability,
        currentAvailability: p.availability ?? null,
        currency: p.currency || null,
        sourceMatched: sourceMatchResult === "SOURCE_MATCHED",
        sourceMatchResult,
        reverifyAttempted,
        reverifyResult: classification,
        reverifyClassification: classification,
        successfullyReverified,
        economicChange,
        formatOnlyChange,
        availabilityChange,
        retryPending: classification === REVERIFY_CLASS.RETRY_PENDING,
        identityCollision,
        runId,
        checkpoint: cov?.resumeOffset ?? cov?.startedOffset ?? null,
        retryState: classification === REVERIFY_CLASS.RETRY_PENDING ? "RETRY_PENDING" : "NONE",
        publicationDecision,
        evidenceReference: "offers-public + refresh-coverage",
        timestampInvented: false,
      });
    }
  }

  const previouslyKnown = [...previousByKey.keys?.() ? previousByKey.keys() : Object.keys(previousByKey || {})].length;
  const attempted = rows.filter((r) => r.sourceMatchResult !== "NOT_ATTEMPTED" && r.sourceMatchResult !== "NO_PRIOR_NO_REFRESH" && r.sourceMatchResult !== "PRIOR_KNOWN_NOT_IN_THIS_REFRESH_PASS").length;
  // Honest attempted: coverage or refresh presence
  const attemptedReverify = rows.filter((r) => mapGet(coverageByKey, r.compoundIdentity) || mapGet(refreshedByKey, r.compoundIdentity)).length;
  const sourceMatched = rows.filter((r) => r.sourceMatchResult === "SOURCE_MATCHED").length;
  const successfullyReverified = rows.filter((r) => r.successfullyReverified).length;
  const changed = rows.filter((r) =>
    [
      REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED,
      REVERIFY_CLASS.REVERIFIED_AVAILABILITY_CHANGED,
    ].includes(r.reverifyClassification)
  ).length;
  const unchanged = rows.filter((r) => r.reverifyClassification === REVERIFY_CLASS.REVERIFIED_UNCHANGED).length;
  const missing = rows.filter((r) => r.reverifyClassification === REVERIFY_CLASS.SOURCE_NOT_FOUND).length;
  const retryPending = rows.filter((r) => r.reverifyClassification === REVERIFY_CLASS.RETRY_PENDING).length;

  const coveragePct =
    attemptedReverify > 0
      ? Math.round((successfullyReverified / attemptedReverify) * 10000) / 100
      : null;

  const classCounts = {};
  for (const r of rows) {
    classCounts[r.reverifyClassification] = (classCounts[r.reverifyClassification] || 0) + 1;
  }

  return {
    schema: PRODUCT_REVERIFY_SCHEMA,
    at: nowIso,
    runId,
    sha,
    note:
      "successfullyReverified requires compound identity compared to freshly fetched source row this run. Timestamp-only churn ≠ reverify.",
    counts: {
      totalPublishedUniqueInDoc: rows.length,
      previouslyKnown: Number.isFinite(previouslyKnown) ? previouslyKnown : null,
      attemptedReverify,
      sourceMatched,
      successfullyReverified,
      changed,
      unchanged,
      missing,
      retryPending,
      coveragePct,
      classCounts,
    },
    rows,
  };
}

/**
 * Cross-run intersection of successfully reverified identities.
 */
export function compareReverifyRuns(prevLedger, nextLedger) {
  const prevOk = new Set(
    (prevLedger?.rows || []).filter((r) => r.successfullyReverified).map((r) => r.compoundIdentity)
  );
  const nextOk = new Set(
    (nextLedger?.rows || []).filter((r) => r.successfullyReverified).map((r) => r.compoundIdentity)
  );
  let intersection = 0;
  for (const k of nextOk) if (prevOk.has(k)) intersection += 1;
  return {
    previousRunId: prevLedger?.runId || null,
    nextRunId: nextLedger?.runId || null,
    previousSuccessfullyReverified: prevOk.size,
    nextSuccessfullyReverified: nextOk.size,
    intersectionSuccessfullyReverified: intersection,
    note: "Intersection = identities successfully source-compared in both runs.",
  };
}

/**
 * Resolve honest timestamp provenance for age buckets (V51.5).
 * Never treat artifact generation / publication time as CJ source fetch.
 */
export function resolveReverifyTimestampProvenance(row) {
  const fetchTs =
    row?.currentFetchTimestamp ||
    row?.fetchTimestamp ||
    row?.fetchedAt ||
    null;
  const sourceTs =
    row?.currentSourceTimestamp ||
    row?.sourceTimestamp ||
    row?.sourceUpdatedAt ||
    null;
  const verificationTs =
    row?.currentVerificationTimestamp ||
    row?.verificationTimestamp ||
    row?.verifiedAt ||
    null;
  if (fetchTs) {
    return {
      timestamp: fetchTs,
      provenance: "FETCH_TIMESTAMP_VERIFIED",
      sourceTimestampStatus: sourceTs ? "PRESENT" : "SOURCE_TIMESTAMP_UNAVAILABLE",
      fetchTimestampStatus: "PRESENT",
      verificationTimestampStatus: verificationTs ? "PRESENT" : "ABSENT",
    };
  }
  if (sourceTs) {
    return {
      timestamp: sourceTs,
      provenance: "SOURCE_TIMESTAMP_PRESENT",
      sourceTimestampStatus: "PRESENT",
      fetchTimestampStatus: "SOURCE_TIMESTAMP_UNAVAILABLE",
      verificationTimestampStatus: verificationTs ? "PRESENT" : "ABSENT",
    };
  }
  if (verificationTs) {
    return {
      timestamp: verificationTs,
      provenance: "VERIFICATION_BATCH_OR_LOCAL_ONLY",
      sourceTimestampStatus: "SOURCE_TIMESTAMP_UNAVAILABLE",
      fetchTimestampStatus: "SOURCE_TIMESTAMP_UNAVAILABLE",
      verificationTimestampStatus: "PRESENT",
      note: "Verification timestamp alone is not claimed as CJ source fetch time.",
    };
  }
  return {
    timestamp: null,
    provenance: "NO_VERIFIABLE_TIMESTAMP",
    sourceTimestampStatus: "SOURCE_TIMESTAMP_UNAVAILABLE",
    fetchTimestampStatus: "SOURCE_TIMESTAMP_UNAVAILABLE",
    verificationTimestampStatus: "ABSENT",
  };
}

/**
 * Age buckets from verifiable timestamps (never artifact download time).
 */
export function buildReverifyAgeBuckets(ledger, opts = {}) {
  const nowMs = Date.parse(opts.nowIso || ledger?.at || new Date().toISOString());
  const buckets = {
    "0_3h": { label: "Do 3 hodin", minH: 0, maxH: 3, count: 0, identities: [], byProvenance: {} },
    "3_6h": { label: "3–6 hodin", minH: 3, maxH: 6, count: 0, identities: [], byProvenance: {} },
    "6_12h": { label: "6–12 hodin", minH: 6, maxH: 12, count: 0, identities: [], byProvenance: {} },
    "12_24h": { label: "12–24 hodin", minH: 12, maxH: 24, count: 0, identities: [], byProvenance: {} },
    "24_48h": { label: "24–48 hodin", minH: 24, maxH: 48, count: 0, identities: [], byProvenance: {} },
    "over_48h": { label: "Více než 48 hodin", minH: 48, maxH: null, count: 0, identities: [], byProvenance: {} },
    never_source_verified: {
      label: "Nikdy zdrojově neověřeno",
      minH: null,
      maxH: null,
      count: 0,
      identities: [],
      byProvenance: {},
    },
  };
  const missingTimestamps = [];
  const provenanceCounts = {};
  for (const r of ledger?.rows || []) {
    const prov = resolveReverifyTimestampProvenance(r);
    provenanceCounts[prov.provenance] = (provenanceCounts[prov.provenance] || 0) + 1;
    const id = r.compoundIdentity;
    const ts = prov.timestamp;
    if (!ts) {
      buckets.never_source_verified.count += 1;
      buckets.never_source_verified.byProvenance[prov.provenance] =
        (buckets.never_source_verified.byProvenance[prov.provenance] || 0) + 1;
      if (buckets.never_source_verified.identities.length < 50) {
        buckets.never_source_verified.identities.push(id);
      }
      missingTimestamps.push({
        compoundIdentity: id,
        advertiserId: r.advertiserId,
        productId: r.productId,
        reason: "NO_VERIFIABLE_TIMESTAMP",
        provenance: prov.provenance,
        invented: false,
      });
      continue;
    }
    const ageH = (nowMs - Date.parse(ts)) / 3600000;
    if (!Number.isFinite(ageH)) {
      buckets.never_source_verified.count += 1;
      missingTimestamps.push({
        compoundIdentity: id,
        advertiserId: r.advertiserId,
        productId: r.productId,
        reason: "UNPARSEABLE_TIMESTAMP",
        raw: ts,
        provenance: prov.provenance,
        invented: false,
      });
      continue;
    }
    let key = "over_48h";
    if (ageH < 3) key = "0_3h";
    else if (ageH < 6) key = "3_6h";
    else if (ageH < 12) key = "6_12h";
    else if (ageH < 24) key = "12_24h";
    else if (ageH < 48) key = "24_48h";
    buckets[key].count += 1;
    buckets[key].byProvenance[prov.provenance] =
      (buckets[key].byProvenance[prov.provenance] || 0) + 1;
    if (buckets[key].identities.length < 50) {
      buckets[key].identities.push({
        compoundIdentity: id,
        timestamp: ts,
        provenance: prov.provenance,
        source: r.sourceMatchResult || null,
        reverifyClassification: r.reverifyClassification || null,
      });
    }
  }
  return {
    schema: "iu-cj-affiliate-phase3z-reverify-age-buckets-v51.5",
    at: opts.nowIso || ledger?.at || new Date().toISOString(),
    runId: ledger?.runId || null,
    sha: ledger?.sha || null,
    note:
      "Buckets prefer FETCH_TIMESTAMP_VERIFIED, then SOURCE_TIMESTAMP_PRESENT. " +
      "VERIFICATION_BATCH_OR_LOCAL_ONLY is disclosed and is NOT claimed as CJ source fetch. " +
      "Artifact download time is never used.",
    provenanceCounts,
    buckets,
    missingTimestampsCount: missingTimestamps.length,
    missingTimestampsSample: missingTimestamps.slice(0, 50),
  };
}

function pricesDiffer(a, b) {
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na !== nb;
  return String(a) !== String(b);
}

/**
 * Build individual cross-run ledger rows for audit (previous + current).
 * V51.5: boolean flags are derived consistently from classification AND observed deltas.
 * Distinguishes within-run classification changes vs cross-run observed price/availability deltas.
 */
export function buildCrossRunIndividualLedger(prevLedger, nextLedger) {
  const prevById = new Map((prevLedger?.rows || []).map((r) => [r.compoundIdentity, r]));
  const nextById = new Map((nextLedger?.rows || []).map((r) => [r.compoundIdentity, r]));
  const all = new Set([...prevById.keys(), ...nextById.keys()]);
  const rows = [];
  for (const id of all) {
    const prev = prevById.get(id) || null;
    const cur = nextById.get(id) || null;
    const classResult = cur?.reverifyClassification || cur?.reverifyResult || null;
    const sourceMatched =
      cur?.sourceMatched === true || cur?.sourceMatchResult === "SOURCE_MATCHED";
    const reverifyAttempted =
      cur?.reverifyAttempted === true ||
      sourceMatched ||
      [
        REVERIFY_CLASS.SOURCE_NOT_FOUND,
        REVERIFY_CLASS.SOURCE_UNAVAILABLE,
        REVERIFY_CLASS.REVERIFIED_UNCHANGED,
        REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED,
        REVERIFY_CLASS.REVERIFIED_AVAILABILITY_CHANGED,
        REVERIFY_CLASS.REVERIFIED_FORMAT_ONLY,
      ].includes(classResult);
    const classEconomic =
      classResult === REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED || cur?.economicChange === true;
    const classAvailability =
      classResult === REVERIFY_CLASS.REVERIFIED_AVAILABILITY_CHANGED ||
      cur?.availabilityChange === true;
    const classFormatOnly =
      classResult === REVERIFY_CLASS.REVERIFIED_FORMAT_ONLY || cur?.formatOnlyChange === true;
    // Cross-run: previous ledger currentPrice vs current ledger currentPrice
    const crossPrevPrice = prev?.currentPrice ?? prev?.previousPrice ?? null;
    const crossCurPrice = cur?.currentPrice ?? null;
    // Within-run: baseline stored on current row vs current price (authoritative for class truth)
    const withinPrevPrice = cur?.previousPrice ?? null;
    const withinCurPrice = cur?.currentPrice ?? null;
    const prevAvail = prev?.currentAvailability ?? prev?.previousAvailability ?? null;
    const curAvail = cur?.currentAvailability ?? null;
    const crossRunObservedEconomicDelta = pricesDiffer(crossPrevPrice, crossCurPrice);
    const withinRunStoredPricesDiffer = pricesDiffer(withinPrevPrice, withinCurPrice);
    const crossRunObservedAvailabilityDelta =
      prevAvail != null && curAvail != null && String(prevAvail) !== String(curAvail);
    const formatOnlyChange = classFormatOnly === true;
    const tsProv = resolveReverifyTimestampProvenance({
      ...cur,
      currentFetchTimestamp: cur?.currentFetchTimestamp || cur?.fetchedAt || null,
      currentSourceTimestamp: cur?.currentSourceTimestamp || cur?.sourceUpdatedAt || null,
    });
    // V51.6 resolved outcome for audit truth
    let resolvedPriceOutcome = null;
    let classificationPriceMismatch = null;
    if (classEconomic) {
      if (withinPrevPrice == null) {
        resolvedPriceOutcome = "INSUFFICIENT_COMPARISON_DATA";
        classificationPriceMismatch = "CLASS_SAYS_PRICE_CHANGED_BUT_BASELINE_MISSING";
      } else if (withinRunStoredPricesDiffer) {
        resolvedPriceOutcome = "PRICE_CHANGED_CONFIRMED";
        classificationPriceMismatch = null;
      } else {
        resolvedPriceOutcome = "CLASSIFICATION_MISMATCH";
        classificationPriceMismatch = "CLASS_SAYS_PRICE_CHANGED_BUT_STORED_PRICES_EQUAL";
      }
    } else if (withinPrevPrice == null && cur?.successfullyReverified) {
      resolvedPriceOutcome = "INSUFFICIENT_COMPARISON_DATA";
    } else if (withinRunStoredPricesDiffer === false && cur?.successfullyReverified) {
      resolvedPriceOutcome = "PRICE_UNCHANGED_CONFIRMED";
    }
    const economicChangeConfirmed =
      resolvedPriceOutcome === "PRICE_CHANGED_CONFIRMED" ||
      (cur?.economicChange === true && withinRunStoredPricesDiffer);
    rows.push({
      advertiserId: cur?.advertiserId || prev?.advertiserId || null,
      productId: cur?.productId || prev?.productId || null,
      compoundIdentity: id,
      previousRunId: prev?.runId || prevLedger?.runId || null,
      currentRunId: cur?.runId || nextLedger?.runId || null,
      previousSourceTimestamp: prev?.currentSourceTimestamp || prev?.previousSourceTimestamp || null,
      currentSourceTimestamp: cur?.currentSourceTimestamp || null,
      previousFetchTimestamp: prev?.currentFetchTimestamp || prev?.previousFetchTimestamp || null,
      currentFetchTimestamp: cur?.currentFetchTimestamp || null,
      previousVerificationTimestamp: prev?.currentVerificationTimestamp || null,
      currentVerificationTimestamp: cur?.currentVerificationTimestamp || null,
      timestampProvenance: tsProv.provenance,
      sourceTimestampStatus: tsProv.sourceTimestampStatus,
      fetchTimestampStatus: tsProv.fetchTimestampStatus,
      // Prefer within-run baseline for individual audit; also expose cross-run prices
      previousPrice: withinPrevPrice != null ? withinPrevPrice : crossPrevPrice,
      currentPrice: withinCurPrice != null ? withinCurPrice : crossCurPrice,
      crossRunPreviousPrice: crossPrevPrice,
      crossRunCurrentPrice: crossCurPrice,
      withinRunPreviousPrice: withinPrevPrice,
      withinRunCurrentPrice: withinCurPrice,
      previousAvailability: prevAvail,
      currentAvailability: curAvail,
      sourceMatched,
      reverifyAttempted,
      reverifyResult: classResult,
      // Within-run classification (from current ledger class)
      withinRunClassification: classResult,
      withinRunClassEconomicChange: classEconomic,
      withinRunClassAvailabilityChange: classAvailability,
      withinRunClassFormatOnlyChange: classFormatOnly,
      // Cross-run observed deltas (previous run value vs current run value)
      crossRunObservedEconomicDelta,
      crossRunObservedAvailabilityDelta,
      withinRunStoredPricesDiffer,
      resolvedPriceOutcome,
      // economicChange true only when within-row prices confirm a real change
      economicChange: economicChangeConfirmed === true,
      formatOnlyChange,
      availabilityChange: classAvailability || (crossRunObservedAvailabilityDelta && cur?.successfullyReverified === true),
      classificationPriceMismatch,
      retryPending: cur?.retryPending === true || classResult === REVERIFY_CLASS.RETRY_PENDING,
      identityCollision: cur?.identityCollision === true,
      previouslySuccessfullyReverified: prev?.successfullyReverified === true,
      currentlySuccessfullyReverified: cur?.successfullyReverified === true,
      inPrevious: !!prev,
      inCurrent: !!cur,
    });
  }
  const previousKnown = prevById.size;
  const currentFound = nextById.size;
  const intersection = rows.filter((r) => r.inPrevious && r.inCurrent).length;
  const reverifySuccess = rows.filter((r) => r.currentlySuccessfullyReverified).length;
  const withinRunChangedByClassification = rows.filter(
    (r) => r.withinRunClassEconomicChange || r.withinRunClassAvailabilityChange
  ).length;
  const crossRunObservedChanged = rows.filter(
    (r) => r.crossRunObservedEconomicDelta || r.crossRunObservedAvailabilityDelta
  ).length;
  const classificationPriceMismatchCount = rows.filter((r) => r.classificationPriceMismatch).length;
  const priceChangedConfirmed = rows.filter(
    (r) => r.resolvedPriceOutcome === "PRICE_CHANGED_CONFIRMED"
  ).length;
  const insufficientComparison = rows.filter(
    (r) => r.resolvedPriceOutcome === "INSUFFICIENT_COMPARISON_DATA"
  ).length;
  const unchanged = rows.filter(
    (r) => r.reverifyResult === REVERIFY_CLASS.REVERIFIED_UNCHANGED
  ).length;
  const unavailable = rows.filter(
    (r) =>
      r.reverifyResult === REVERIFY_CLASS.SOURCE_UNAVAILABLE ||
      r.reverifyResult === REVERIFY_CLASS.SOURCE_NOT_FOUND
  ).length;
  const pending = rows.filter((r) => r.retryPending).length;
  const collisions = rows.filter((r) => r.identityCollision).length;
  const attempted = rows.filter((r) => r.reverifyAttempted).length;
  const sourceMatchedCount = rows.filter((r) => r.sourceMatched).length;
  return {
    schema: "iu-cj-affiliate-phase3z-cross-run-individual-ledger-v51.6",
    previousRunId: prevLedger?.runId || null,
    currentRunId: nextLedger?.runId || null,
    definitions: {
      reverifyAttempted:
        "Source lookup or classification attempt this run (SOURCE_MATCHED / NOT_FOUND / UNAVAILABLE / REVERIFIED_*).",
      withinRunChangedByClassification:
        "Count of rows whose CURRENT ledger classification is REVERIFIED_PRICE_CHANGED or REVERIFIED_AVAILABILITY_CHANGED (may include false positives if baseline missing — see resolvedPriceOutcome).",
      priceChangedConfirmed:
        "Within-row previousPrice and currentPrice both present and numerically different; class PRICE_CHANGED trusted.",
      insufficientComparisonData:
        "Class claimed PRICE_CHANGED (or first observation) but previousPrice baseline missing — not a confirmed economic event.",
      crossRunObservedChanged:
        "Count of rows where previous-run stored price/availability differs from current-run stored values.",
      changed:
        "Alias of priceChangedConfirmed (V51.6 — only confirmed economic changes).",
      coveragePctOfPublished:
        "successfullyReverified / identities present in current ledger (published unique).",
      coveragePctOfAttempted: "successfullyReverified / reverifyAttempted.",
    },
    counts: {
      previouslyKnownIdentities: previousKnown,
      identitiesInNewSource: currentFound,
      intersectionIdentities: intersection,
      reverifyAttempted: attempted,
      sourceMatched: sourceMatchedCount,
      actuallyReverified: reverifySuccess,
      withinRunChangedByClassification,
      crossRunObservedChanged,
      classificationPriceMismatchCount,
      priceChangedConfirmed,
      insufficientComparisonData: insufficientComparison,
      changed: priceChangedConfirmed,
      unchanged,
      unavailable,
      pending,
      collisions,
      coveragePctOfPublished:
        currentFound > 0 ? Math.round((reverifySuccess / currentFound) * 10000) / 100 : null,
      coveragePctOfAttempted:
        attempted > 0 ? Math.round((reverifySuccess / attempted) * 10000) / 100 : null,
      coveragePct:
        currentFound > 0 ? Math.round((reverifySuccess / currentFound) * 10000) / 100 : null,
    },
    rows,
  };
}

/**
 * Index products from an offers doc by compound identity (first occurrence wins).
 */
export function indexProductsByCompoundIdentity(doc) {
  const m = new Map();
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      const adv = p.advertiserId != null ? String(p.advertiserId) : "";
      const pid = p.productId != null ? String(p.productId) : "";
      if (!adv || !pid) continue;
      const key = compoundIdentity(adv, pid);
      if (!m.has(key)) m.set(key, p);
    }
  }
  return m;
}
