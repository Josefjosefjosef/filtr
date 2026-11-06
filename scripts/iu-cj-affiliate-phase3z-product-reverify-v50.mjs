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
      const previousPrice = prevCard?.currentPrice ?? prevRev?.currentPrice ?? null;
      const previousAvailability =
        prevCard?.availability ?? prevRev?.currentAvailability ?? null;

      let classification = REVERIFY_CLASS.RETRY_PENDING;
      let sourceMatchResult = "NOT_ATTEMPTED";
      let publicationDecision =
        p.publicationReady === false ? "HOLD_OR_HIDE" : "KEEP_PUBLISHED";

      if (p.rejectReason === "HOLD_COLLISION" || p.hysteresisState === "HOLD_COLLISION") {
        classification = REVERIFY_CLASS.HOLD_COLLISION;
        publicationDecision = "HOLD";
      } else if (p.keepPending === true || p.freshnessReason === "KEEP_PENDING") {
        classification = REVERIFY_CLASS.KEEP_PENDING;
        publicationDecision = "KEEP_PENDING";
      } else if (ref) {
        sourceMatchResult = "SOURCE_MATCHED";
        const priceClass = classifyPriceTransition(
          previousPrice != null ? previousPrice : p.previousPrice ?? p.currentPrice,
          p.currentPrice,
          prevCard?.currency || p.currency,
          p.currency
        );
        const availChanged =
          previousAvailability != null &&
          String(previousAvailability) !== String(p.availability ?? "");

        if (ref.gone === true || ref.removeFromPublic === true) {
          classification = REVERIFY_CLASS.SOURCE_UNAVAILABLE;
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
      } else if (cov) {
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

      rows.push({
        advertiserId: adv,
        productId: pid,
        compoundIdentity: key,
        feedId: p.feedId != null ? p.feedId : null,
        sectionKey: sec.sectionKey || null,
        previousVerificationTimestamp,
        currentVerificationTimestamp: successfullyReverified
          ? p.verifiedAt || p.lastSuccessfulRefreshAt || nowIso
          : p.verifiedAt || null,
        previousPrice,
        currentPrice: p.currentPrice ?? null,
        previousAvailability,
        currentAvailability: p.availability ?? null,
        currency: p.currency || null,
        sourceMatchResult,
        reverifyClassification: classification,
        successfullyReverified,
        runId,
        checkpoint: cov?.resumeOffset ?? cov?.startedOffset ?? null,
        retryState: classification === REVERIFY_CLASS.RETRY_PENDING ? "RETRY_PENDING" : "NONE",
        publicationDecision,
        evidenceReference: "offers-public + refresh-coverage",
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
