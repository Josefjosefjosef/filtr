#!/usr/bin/env node
/**
 * V36 — single authoritative product evidence + reconciliation.
 *
 * Layers (same snapshotId):
 * - uniqueKey = advertiserId|productId
 * - occurrence = uniqueKey + sectionKey (+ occurrenceIndex)
 *
 * refreshCoverage.publishedCatalog.* MUST be computable from occurrence rows.
 * refreshTargetPass.* is the prior-key refresh ledger (may differ when discovery rotates).
 */
import { REFRESH_RESULT } from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

export const PRODUCT_EVIDENCE_SCHEMA = "iu-cj-affiliate-phase3z-product-evidence-v36";

export const REFRESH_RESULT_V36 = Object.freeze({
  ...REFRESH_RESULT,
  /** Present in final catalog but was not in refresh target set (new this pass / rotated in). */
  NOT_IN_REFRESH_TARGET_SET: "NOT_IN_REFRESH_TARGET_SET",
});

export function productKey(advertiserId, productId) {
  return String(advertiserId || "") + "|" + String(productId || "");
}

export function occurrenceId(advertiserId, productId, sectionKey, indexInSection) {
  return productKey(advertiserId, productId) + "#" + String(sectionKey || "") + "#" + String(indexInSection);
}

/**
 * Join final published doc to refresh coverage ledger / refreshedByKey.
 * Stamps every occurrence; recomputes unique + occurrence counts that must reconcile.
 */
export function reconcilePublishedProductEvidence(opts = {}) {
  const doc = opts.doc;
  const nowIso = opts.nowIso || new Date().toISOString();
  const snapshotId = opts.snapshotId || nowIso;
  const catalogSha = opts.catalogSha || null;
  const sourceRunId = opts.sourceRunId || null;
  const refreshRunId = opts.refreshRunId || sourceRunId;
  const coverageByKey = opts.coverageByKey instanceof Map ? opts.coverageByKey : new Map();
  const refreshedByKey = opts.refreshedByKey instanceof Map ? opts.refreshedByKey : new Map();
  const targetPassCounts = opts.targetPassCounts || null;

  const uniqueMap = new Map();
  const occurrenceRows = [];
  const sections = [];
  let occurrenceIndex = 0;

  for (const sec of doc?.sections || []) {
    const products = [];
    let idxInSec = 0;
    for (const p of sec.products || []) {
      const adv = p.advertiserId != null ? String(p.advertiserId) : "";
      const pid = p.productId != null ? String(p.productId) : "";
      const key = productKey(adv, pid);
      const secKey = sec.sectionKey || p.sectionKey || null;
      const cov = coverageByKey.get(key) || null;
      const ref = refreshedByKey.get(key) || null;

      let refreshResult;
      let refreshReason;
      if (ref || cov?.refreshResult === REFRESH_RESULT.SUCCESSFULLY_REFRESHED) {
        refreshResult = REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED;
        refreshReason = cov?.refreshReason || "productId_matched_in_scan_window";
      } else if (cov?.refreshResult === REFRESH_RESULT.NOT_IN_SCAN_WINDOW) {
        refreshResult = REFRESH_RESULT_V36.NOT_IN_SCAN_WINDOW;
        refreshReason = cov.refreshReason || "advertiser_scanned_productId_not_in_window";
      } else if (cov?.refreshResult === REFRESH_RESULT.ERROR) {
        refreshResult = REFRESH_RESULT_V36.ERROR;
        refreshReason = cov.refreshReason || "advertiser_refresh_error";
      } else if (cov?.refreshResult === REFRESH_RESULT.NOT_ATTEMPTED) {
        refreshResult = REFRESH_RESULT_V36.NOT_ATTEMPTED;
        refreshReason = cov.refreshReason || "advertiser_not_scanned_this_pass";
      } else if (coverageByKey.size > 0 || refreshedByKey.size > 0) {
        // Final catalog key was not a refresh target (rotated in by discovery).
        refreshResult = REFRESH_RESULT_V36.NOT_IN_REFRESH_TARGET_SET;
        refreshReason = "published_this_pass_but_not_in_refresh_target_set";
      } else {
        refreshResult = REFRESH_RESULT_V36.NOT_ATTEMPTED;
        refreshReason = "no_refresh_pass";
      }

      const lastSuccessfulRefreshAt =
        refreshResult === REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED
          ? nowIso
          : p.lastSuccessfulRefreshAt || cov?.lastSuccessfulRefreshAt || null;
      const lastRefreshAttemptAt =
        cov?.lastRefreshAttemptAt ||
        (refreshResult !== REFRESH_RESULT_V36.NOT_IN_REFRESH_TARGET_SET &&
        refreshResult !== REFRESH_RESULT_V36.NOT_ATTEMPTED
          ? nowIso
          : p.lastRefreshAttemptAt || null);

      const card = {
        ...p,
        productKey: key,
        occurrenceId: occurrenceId(adv, pid, secKey, idxInSec),
        refreshResult,
        refreshReason,
        lastRefreshAttemptAt,
        lastSuccessfulRefreshAt,
        snapshotId,
      };
      products.push(card);

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          productKey: key,
          advertiserId: adv,
          productId: pid,
          refreshResult,
          refreshReason,
          lastRefreshAttemptAt,
          lastSuccessfulRefreshAt,
          fetchedAt: card.fetchedAt || null,
          sourceUpdatedAt: card.sourceUpdatedAt ?? null,
          sourceUpdatedAtStatus: card.sourceUpdatedAtStatus ?? null,
          freshnessStatus: card.freshnessStatus || null,
          occurrenceCount: 0,
          sectionKeys: [],
        });
      }
      const u = uniqueMap.get(key);
      u.occurrenceCount += 1;
      if (secKey && !u.sectionKeys.includes(secKey)) u.sectionKeys.push(secKey);
      // Unique status: SUCCESS wins; else keep first / prefer more severe attempt
      if (refreshResult === REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED) {
        u.refreshResult = refreshResult;
        u.refreshReason = refreshReason;
        u.lastSuccessfulRefreshAt = lastSuccessfulRefreshAt;
      }

      occurrenceRows.push({
        snapshotId,
        catalogSha,
        sourceRunId,
        refreshRunId,
        productKey: key,
        advertiserId: adv,
        productId: pid,
        sourceIdentity: key,
        category: secKey,
        occurrenceId: card.occurrenceId,
        occurrenceIndex: occurrenceIndex++,
        refreshStatus: refreshResult,
        refreshReason,
        lastRefreshAttemptAt,
        lastSuccessfulRefreshAt,
        fetchedAt: card.fetchedAt || null,
        sourceUpdatedAt: card.sourceUpdatedAt ?? null,
        sourceUpdatedAtStatus: card.sourceUpdatedAtStatus ?? null,
        price: card.currentPrice ?? null,
        originalPrice: card.originalPrice ?? null,
        currency: card.currency || null,
        availability: card.availability ?? null,
        publicationStatus: card.publicationReady === true ? "READY" : "NOT_READY",
        publicationReason: card.freshnessReason || card.refreshReason || null,
        freshnessStatus: card.freshnessStatus || null,
      });
      idxInSec += 1;
    }
    sections.push({ ...sec, products });
  }

  const uniqueRows = [...uniqueMap.values()];
  const occurrenceByStatus = tallyStatus(occurrenceRows.map((r) => r.refreshStatus));
  const uniqueByStatus = tallyStatus(uniqueRows.map((r) => r.refreshResult));

  const occurrenceSum = Object.values(occurrenceByStatus).reduce((a, b) => a + b, 0);
  const uniqueSum = Object.values(uniqueByStatus).reduce((a, b) => a + b, 0);

  const invariants = {
    occurrenceStatusSumEqualsRows: occurrenceSum === occurrenceRows.length,
    uniqueStatusSumEqualsRows: uniqueSum === uniqueRows.length,
    uniqueKeysEqualMapSize: uniqueRows.length === uniqueMap.size,
    everyOccurrenceHasProductKey: occurrenceRows.every((r) => Boolean(r.productKey) && r.productKey !== "|"),
    everyOccurrenceHasOccurrenceId: occurrenceRows.every((r) => Boolean(r.occurrenceId)),
    successfullyRefreshedUniqueLteOccurrences: (uniqueByStatus.SUCCESSFULLY_REFRESHED || 0) <= (occurrenceByStatus.SUCCESSFULLY_REFRESHED || 0) || true,
  };
  // successful unique should be <= successful occurrences (one key can have many occurrences)
  invariants.successfullyRefreshedUniqueLteOccurrences =
    (uniqueByStatus[REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED] || 0) <=
    (occurrenceByStatus[REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED] || 0);

  const ok = Object.values(invariants).every(Boolean);

  const publishedCatalog = {
    uniqueKeys: uniqueRows.length,
    occurrences: occurrenceRows.length,
    uniqueByStatus,
    occurrenceByStatus,
    successfullyRefreshedUnique: uniqueByStatus[REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED] || 0,
    successfullyRefreshedOccurrences: occurrenceByStatus[REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED] || 0,
    notInScanWindowUnique: uniqueByStatus[REFRESH_RESULT_V36.NOT_IN_SCAN_WINDOW] || 0,
    notInRefreshTargetSetUnique: uniqueByStatus[REFRESH_RESULT_V36.NOT_IN_REFRESH_TARGET_SET] || 0,
    notAttemptedUnique: uniqueByStatus[REFRESH_RESULT_V36.NOT_ATTEMPTED] || 0,
  };

  const evidence = {
    schema: PRODUCT_EVIDENCE_SCHEMA,
    snapshotId,
    catalogSha,
    sourceRunId,
    refreshRunId,
    at: nowIso,
    refreshTargetPass: targetPassCounts,
    publishedCatalog,
    invariants,
    reconcileOk: ok,
    uniqueRows,
    occurrenceRows,
  };

  return {
    doc: {
      ...doc,
      sections,
      snapshotId,
      productEvidence: {
        schema: PRODUCT_EVIDENCE_SCHEMA,
        snapshotId,
        at: nowIso,
        publishedCatalog,
        refreshTargetPass: targetPassCounts,
        reconcileOk: ok,
        invariants,
      },
      refreshCoverage: {
        schema: PRODUCT_EVIDENCE_SCHEMA,
        at: nowIso,
        // Authoritative for published catalog reconciliation:
        counts: {
          publishedProducts: publishedCatalog.uniqueKeys,
          occurrences: publishedCatalog.occurrences,
          refreshAttempted:
            publishedCatalog.uniqueKeys - publishedCatalog.notInRefreshTargetSetUnique - publishedCatalog.notAttemptedUnique,
          sourceMatched: publishedCatalog.successfullyRefreshedUnique,
          successfullyRefreshed: publishedCatalog.successfullyRefreshedUnique,
          notInScanWindow: publishedCatalog.notInScanWindowUnique,
          notInRefreshTargetSet: publishedCatalog.notInRefreshTargetSetUnique,
          notAttempted: publishedCatalog.notAttemptedUnique,
          errors: uniqueByStatus[REFRESH_RESULT_V36.ERROR] || 0,
        },
        summary: publishedCatalog,
        refreshTargetPass: targetPassCounts,
        reconcileOk: ok,
        note:
          "publishedCatalog counts are derived from stamped occurrences in this snapshot. refreshTargetPass is the prior-key refresh ledger (may differ when discovery rotates the published set).",
      },
    },
    evidence,
  };
}

function tallyStatus(list) {
  const out = {};
  for (const s of list) {
    const k = s || "(none)";
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Offline audit: given a public doc, verify occurrence stamps reconcile with refreshCoverage.summary.
 */
export function auditReconcilePublicDoc(doc) {
  const occ = [];
  const uniq = new Map();
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      const key = p.productKey || productKey(p.advertiserId, p.productId);
      occ.push(p.refreshResult || "(none)");
      if (!uniq.has(key)) uniq.set(key, p.refreshResult || "(none)");
      else if (p.refreshResult === REFRESH_RESULT_V36.SUCCESSFULLY_REFRESHED) uniq.set(key, p.refreshResult);
    }
  }
  const occurrenceByStatus = tallyStatus(occ);
  const uniqueByStatus = tallyStatus([...uniq.values()]);
  const pe = doc?.productEvidence?.publishedCatalog || doc?.refreshCoverage?.summary || null;
  const mismatches = [];
  if (pe) {
    if (pe.occurrences != null && pe.occurrences !== occ.length) {
      mismatches.push({ field: "occurrences", expected: pe.occurrences, actual: occ.length });
    }
    if (pe.uniqueKeys != null && pe.uniqueKeys !== uniq.size) {
      mismatches.push({ field: "uniqueKeys", expected: pe.uniqueKeys, actual: uniq.size });
    }
    const peOcc = pe.occurrenceByStatus || null;
    if (peOcc) {
      for (const [k, v] of Object.entries(occurrenceByStatus)) {
        if ((peOcc[k] || 0) !== v) mismatches.push({ field: "occurrence:" + k, expected: peOcc[k] || 0, actual: v });
      }
    }
  }
  return {
    ok: mismatches.length === 0,
    occurrenceN: occ.length,
    uniqueN: uniq.size,
    occurrenceByStatus,
    uniqueByStatus,
    mismatches,
  };
}
