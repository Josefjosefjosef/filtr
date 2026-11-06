#!/usr/bin/env node
/**
 * V48 — honest product progress, fetched→published reconciliation, price/availability history.
 *
 * Cursor movement alone ≠ product progress.
 * 1→1 with loaded 0→0 is NO_PROGRESS (or API_EMPTY), never CURSOR_ADVANCED / PRODUCTS_FETCHED.
 * sourceProductsFetched is API rows in one discovery window — not unique published catalog size.
 */
import { CJ_PRODUCT_SEARCH_OFFSET_FIRST } from "./iu-cj-affiliate-phase2-product-api.mjs";
import {
  classifyPriceTransition,
  PRICE_CHANGE_CLASS,
} from "./iu-cj-affiliate-phase3z-price-normalize-v49.mjs";

export const PRODUCT_PROGRESS_SCHEMA = "iu-cj-affiliate-phase3z-product-progress-v48";
export const FETCHED_PUBLISHED_FUNNEL_SCHEMA =
  "iu-cj-affiliate-phase3z-fetched-published-funnel-v48";
export const PRICE_AVAIL_HISTORY_SCHEMA = "iu-cj-affiliate-phase3z-price-availability-history-v48";

export const PARTNER_PROGRESS_STATE = Object.freeze({
  FEED_AVAILABLE: "FEED_AVAILABLE",
  FEED_UNAVAILABLE: "FEED_UNAVAILABLE",
  API_EMPTY: "API_EMPTY",
  API_PERMISSION_DENIED: "API_PERMISSION_DENIED",
  CURSOR_ADVANCED: "CURSOR_ADVANCED",
  PRODUCTS_FETCHED: "PRODUCTS_FETCHED",
  UNIQUE_PRODUCTS_ADDED: "UNIQUE_PRODUCTS_ADDED",
  EXISTING_PRODUCTS_REFRESHED: "EXISTING_PRODUCTS_REFRESHED",
  FEED_PASS_COMPLETED: "FEED_PASS_COMPLETED",
  NEW_REFRESH_CYCLE_STARTED: "NEW_REFRESH_CYCLE_STARTED",
  NO_PROGRESS: "NO_PROGRESS",
  RETRY_PENDING: "RETRY_PENDING",
  FAILED: "FAILED",
});

/**
 * Classify one partner's checkpoint delta. Product progress requires fetched rows > 0
 * or a meaningful complete-pass bump with totalCount > 0 — never timestamp-only.
 */
export function classifyPartnerProgress(prev, curr, opts = {}) {
  const hasFeed = opts.hasFeed === true;
  const prevOff =
    prev?.resumeOffset != null && Number.isFinite(Number(prev.resumeOffset))
      ? Number(prev.resumeOffset)
      : null;
  const nextOff =
    curr?.resumeOffset != null && Number.isFinite(Number(curr.resumeOffset))
      ? Number(curr.resumeOffset)
      : null;
  const prevPage = prev?.resumePage || null;
  const nextPage = curr?.resumePage || null;
  const fetched = curr?.lastFetchedCount != null ? Number(curr.lastFetchedCount) : 0;
  const total = curr?.lastTotalCount != null ? Number(curr.lastTotalCount) : null;
  const prevFetched = prev?.lastFetchedCount != null ? Number(prev.lastFetchedCount) : null;
  const err = curr?.lastError ? String(curr.lastError) : null;
  const completePassBumped =
    Number(curr?.completePassCount || 0) > Number(prev?.completePassCount || 0);
  const offsetAdvanced =
    prevOff != null && nextOff != null && nextOff > prevOff;
  const pageAdvanced =
    Boolean(prevPage || nextPage) && String(prevPage || "") !== String(nextPage || "") && nextPage != null;
  // Complete pass that resets cursor to first after non-empty catalog.
  const refreshCycleStarted =
    completePassBumped &&
    (total || 0) > 0 &&
    nextOff != null &&
    nextOff <= CJ_PRODUCT_SEARCH_OFFSET_FIRST &&
    prevOff != null &&
    prevOff > CJ_PRODUCT_SEARCH_OFFSET_FIRST;

  if (!hasFeed) {
    return {
      state: PARTNER_PROGRESS_STATE.FEED_UNAVAILABLE,
      cursorAdvanced: false,
      productsFetched: false,
      productProgress: false,
      reason: "no_feed_in_inventory",
    };
  }
  if (err && /403|401|permission|forbidden|unauthorized/i.test(err) && fetched === 0) {
    return {
      state: PARTNER_PROGRESS_STATE.API_PERMISSION_DENIED,
      cursorAdvanced: false,
      productsFetched: false,
      productProgress: false,
      reason: err.slice(0, 160),
    };
  }
  if ((total === 0 || total == null) && fetched === 0) {
    return {
      state: err ? PARTNER_PROGRESS_STATE.FAILED : PARTNER_PROGRESS_STATE.API_EMPTY,
      cursorAdvanced: false,
      productsFetched: false,
      productProgress: false,
      reason: err || "product_api_empty_or_zero_total",
    };
  }
  if (refreshCycleStarted) {
    return {
      state: PARTNER_PROGRESS_STATE.NEW_REFRESH_CYCLE_STARTED,
      cursorAdvanced: true,
      productsFetched: fetched > 0,
      productProgress: fetched > 0 || completePassBumped,
      reason: "complete_pass_reset_to_first",
    };
  }
  if (completePassBumped && (total || 0) > 0) {
    return {
      state: PARTNER_PROGRESS_STATE.FEED_PASS_COMPLETED,
      cursorAdvanced: offsetAdvanced || pageAdvanced || true,
      productsFetched: fetched > 0,
      productProgress: fetched > 0,
      reason: "complete_pass_count_bumped",
    };
  }
  if (offsetAdvanced || pageAdvanced) {
    if (fetched > 0) {
      return {
        state: PARTNER_PROGRESS_STATE.PRODUCTS_FETCHED,
        cursorAdvanced: true,
        productsFetched: true,
        productProgress: true,
        reason: "cursor_advanced_with_rows",
      };
    }
    return {
      state: PARTNER_PROGRESS_STATE.CURSOR_ADVANCED,
      cursorAdvanced: true,
      productsFetched: false,
      productProgress: false,
      reason: "cursor_advanced_without_rows",
    };
  }
  if (fetched > 0 && prevFetched != null && fetched !== prevFetched) {
    return {
      state: PARTNER_PROGRESS_STATE.PRODUCTS_FETCHED,
      cursorAdvanced: false,
      productsFetched: true,
      productProgress: true,
      reason: "fetched_count_changed",
    };
  }
  if (opts.retryPending === true) {
    return {
      state: PARTNER_PROGRESS_STATE.RETRY_PENDING,
      cursorAdvanced: false,
      productsFetched: false,
      productProgress: false,
      reason: "retry_pending",
    };
  }
  // Explicit: 1→1 / 0→0 is not progress.
  if (
    (prevOff == null || nextOff == null || prevOff === nextOff) &&
    (fetched === 0 || prevFetched === fetched)
  ) {
    return {
      state: PARTNER_PROGRESS_STATE.NO_PROGRESS,
      cursorAdvanced: false,
      productsFetched: false,
      productProgress: false,
      reason: "cursor_unchanged_no_new_rows",
    };
  }
  return {
    state: PARTNER_PROGRESS_STATE.NO_PROGRESS,
    cursorAdvanced: false,
    productsFetched: false,
    productProgress: false,
    reason: "no_qualifying_product_progress",
  };
}

/**
 * Per-partner progress ledger scoped to feed partners only.
 */
export function buildProductProgressLedger(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const prevPartners = opts.previousPartners || {};
  const currPartners = opts.currentPartners || {};
  const inventoryPartners = Array.isArray(opts.inventoryPartners) ? opts.inventoryPartners : [];
  const fetchMeta = opts.fetchMetaByAdvertiser || {};
  const withFeed = inventoryPartners.filter((p) => p && (p.hasFeed === true || Number(p.feedCount) > 0));
  const rows = [];
  const stateCounts = {};
  let cursorAdvanced = 0;
  let productsFetched = 0;
  let productProgress = 0;
  let noProgress = 0;
  let apiEmpty = 0;
  let feedPassCompleted = 0;
  let refreshCycleStarted = 0;

  for (const inv of withFeed) {
    const id = String(inv.advertiserId || "");
    if (!id) continue;
    const prev = prevPartners[id] || null;
    const curr = currPartners[id] || null;
    const fm = fetchMeta[id] || null;
    const classified = classifyPartnerProgress(prev, curr, {
      hasFeed: true,
      retryPending: Boolean(fm?.retryPending),
    });
    stateCounts[classified.state] = (stateCounts[classified.state] || 0) + 1;
    if (classified.cursorAdvanced) cursorAdvanced += 1;
    if (classified.productsFetched) productsFetched += 1;
    if (classified.productProgress) productProgress += 1;
    if (classified.state === PARTNER_PROGRESS_STATE.NO_PROGRESS) noProgress += 1;
    if (classified.state === PARTNER_PROGRESS_STATE.API_EMPTY) apiEmpty += 1;
    if (classified.state === PARTNER_PROGRESS_STATE.FEED_PASS_COMPLETED) feedPassCompleted += 1;
    if (classified.state === PARTNER_PROGRESS_STATE.NEW_REFRESH_CYCLE_STARTED) refreshCycleStarted += 1;

    const prevOff = prev?.resumeOffset ?? null;
    const nextOff = curr?.resumeOffset ?? null;
    rows.push({
      advertiserId: id,
      partnerName: inv.partnerName || null,
      feedId: inv.feeds?.[0]?.adId || inv.feedId || null,
      state: classified.state,
      previousCursor: { offset: prevOff, page: prev?.resumePage || null },
      nextCursor: { offset: nextOff, page: curr?.resumePage || null },
      previousLoaded: prev?.lastFetchedCount ?? null,
      currentLoaded: curr?.lastFetchedCount ?? null,
      fetchedRows: fm?.fetched ?? curr?.lastFetchedCount ?? null,
      totalCount: fm?.totalCount ?? curr?.lastTotalCount ?? null,
      validated: fm?.validated ?? null,
      publishReady: fm?.publishReady ?? null,
      publishedSelected: fm?.publishedSelected ?? null,
      deferredPresentation: fm?.deferredPresentation ?? null,
      completePassCount: curr?.completePassCount ?? 0,
      lastComplete: curr?.lastComplete === true,
      lastError: curr?.lastError || fm?.error || null,
      lastRunAt: curr?.lastRunAt || null,
      cursorAdvanced: classified.cursorAdvanced,
      productsFetched: classified.productsFetched,
      productProgress: classified.productProgress,
      reason: classified.reason,
      proofLine: `${prevOff ?? "∅"}→${nextOff ?? "∅"} | loaded ${prev?.lastFetchedCount ?? "∅"}→${
        curr?.lastFetchedCount ?? "∅"
      } | ${classified.state}`,
    });
  }

  return {
    schema: PRODUCT_PROGRESS_SCHEMA,
    evidenceClass: opts.evidenceClass || "CURRENT_PRODUCTION",
    at: nowIso,
    runId: opts.runId || null,
    sha: opts.sha || null,
    note:
      "withFeedTracked = inventory hasFeed only. productProgress excludes 1→1/0→0 and empty-API completePass bumps. Cursor advance without rows is CURSOR_ADVANCED, not product progress.",
    counts: {
      withFeedTracked: rows.length,
      cursorAdvanced,
      productsFetched,
      productProgress,
      noProgress,
      apiEmpty,
      feedPassCompleted,
      refreshCycleStarted,
      stateCounts,
    },
    partners: rows,
  };
}

/**
 * Explain sourceProductsFetched (API rows this run) vs published occurrences.
 * V49: never treat UNKNOWN accepted as rejected=all; expose unknown explicitly.
 * Occurrences in multiple sections are not automatic identity duplicates.
 */
export function buildFetchedPublishedFunnel(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const fetchedRows = Number(opts.fetchedRows) || 0;
  const uniqueInWindow = Number(opts.uniqueInWindow);
  const validated = Number(opts.validated);
  const czEligible = Number(opts.czEligible);
  const authorized = Number(opts.authorized);
  const categoryAssigned = Number(opts.categoryAssigned);
  const ready = Number(opts.ready);
  const selected = Number(opts.selected);
  const published = Number(opts.published);
  const publishedUnique = Number(opts.publishedUnique);
  const publishedOccurrences = Number(
    opts.publishedOccurrences != null ? opts.publishedOccurrences : opts.published
  );
  const domRendered = opts.domRendered != null ? Number(opts.domRendered) : null;
  const rejectReasons = opts.rejectReasons && typeof opts.rejectReasons === "object" ? opts.rejectReasons : {};
  const duplicateApiRows = Number(opts.duplicateApiRows);

  const stage = (name, input, accepted, extra = {}) => {
    const knownAccepted = accepted != null && Number.isFinite(Number(accepted));
    const acc = knownAccepted ? Number(accepted) : null;
    const dup = extra.duplicates != null && Number.isFinite(Number(extra.duplicates))
      ? Number(extra.duplicates)
      : null;
    let unknown = extra.unknown != null ? Number(extra.unknown) : null;
    let rejected = extra.rejected != null ? Number(extra.rejected) : null;
    if (!knownAccepted) {
      // V49 fix: unknown accepted must NOT become rejected = input.
      if (unknown == null) unknown = Number(input) || 0;
      if (rejected == null) rejected = null;
    } else if (rejected == null) {
      rejected = Math.max(0, (Number(input) || 0) - acc - (dup || 0));
    }
    return {
      name,
      input: Number(input) || 0,
      accepted: acc,
      rejected,
      unknown: unknown != null ? unknown : 0,
      duplicates: dup,
      reasonCode: extra.reasonCode || null,
      note: extra.note || null,
    };
  };

  const uniq = Number.isFinite(uniqueInWindow) ? uniqueInWindow : null;
  const dupApi =
    Number.isFinite(duplicateApiRows)
      ? duplicateApiRows
      : uniq != null
        ? Math.max(0, fetchedRows - uniq)
        : null;
  const val = Number.isFinite(validated) ? validated : null;
  const cze = Number.isFinite(czEligible) ? czEligible : val;
  const auth = Number.isFinite(authorized) ? authorized : cze;
  const cat = Number.isFinite(categoryAssigned) ? categoryAssigned : auth;
  const rdy = Number.isFinite(ready) ? ready : cat;
  const sel = Number.isFinite(selected) ? selected : Number.isFinite(published) ? published : null;
  const pubOcc = Number.isFinite(publishedOccurrences)
    ? publishedOccurrences
    : Number.isFinite(published)
      ? published
      : 0;
  const pubU = Number.isFinite(publishedUnique) ? publishedUnique : null;

  return {
    schema: FETCHED_PUBLISHED_FUNNEL_SCHEMA,
    at: nowIso,
    runId: opts.runId || null,
    sha: opts.sha || null,
    interpretation: {
      fetchedRowsMeaning:
        "API shoppingProducts rows returned in this discovery window (sum across partners/pages). Includes duplicates across partners, window re-reads, and rows later rejected. NOT unique published catalog size.",
      publishedMeaning:
        "Offer occurrences in offers-public after presentation budget + validation gates. Unique identities ≤ occurrences. Multi-section placement is intentional, not an identity error.",
      whyFetchedExceedsPublished:
        "Presentation budget (publishPerPartner), validation rejects, empty/incomplete partners, and multi-page windows accumulate rows far above the public slice.",
      uniqueUnknownRule:
        "If uniqueInWindow was not measured, UNIQUE.accepted=null and UNIQUE.unknown=input — never UNIQUE.rejected=input.",
    },
    stages: [
      stage("API_FETCHED", fetchedRows, fetchedRows, { rejected: 0, note: "raw API rows this run" }),
      stage("UNIQUE_IDENTITIES", fetchedRows, uniq, {
        duplicates: dupApi,
        note: "unique advertiserId|productId in discovery window when measured",
        reasonCode: uniq == null ? "UNIQUE_NOT_MEASURED" : null,
      }),
      stage("VALIDATED", uniq ?? fetchedRows, val, {
        note: "trusted URL + price + currency + https image",
        reasonCode: val == null ? "VALIDATED_NOT_SEPARATED" : null,
      }),
      stage("CZ_ELIGIBLE", val ?? uniq ?? fetchedRows, cze, { note: "CZ usability gates" }),
      stage("AUTHORIZED", cze ?? val ?? fetchedRows, auth, { note: "joined/managed publication permission" }),
      stage("CATEGORY_ASSIGNED", auth ?? cze ?? fetchedRows, cat, { note: "section map assignment" }),
      stage("PUBLICATION_READY", cat ?? auth ?? fetchedRows, rdy, { note: "publicationReady=true" }),
      stage("SELECTED", rdy ?? fetchedRows, sel, {
        note: "presentation budget selection (publishPerPartner / rotate)",
      }),
      stage("PUBLISHED_UNIQUE", sel ?? pubOcc, pubU, {
        note: "unique identities in public catalog",
        reasonCode: pubU == null ? "PUBLISHED_UNIQUE_NOT_MEASURED" : null,
      }),
      stage("PUBLISHED_OCCURRENCES", pubU ?? sel ?? rdy ?? fetchedRows, pubOcc, {
        note: "section occurrences (one identity may appear in multiple sections)",
      }),
      stage("DOM_RENDERED", pubOcc, domRendered, {
        note: "requires browser proof; unknown when not measured",
        reasonCode: domRendered == null ? "DOM_NOT_MEASURED" : null,
      }),
    ],
    rejectReasons,
    snapshot: {
      fetchedRows,
      uniqueInWindow: uniq,
      uniqueMeasured: uniq != null,
      duplicateApiRows: dupApi,
      ready: rdy,
      selected: sel,
      publishedOccurrences: pubOcc,
      publishedUnique: pubU,
      ratioPublishedToFetched:
        fetchedRows > 0 ? Number((pubOcc / fetchedRows).toFixed(6)) : null,
    },
  };
}

/**
 * Append-only price/availability change records (compound identity).
 * V49: priceChanges = economic PRICE_CHANGED only; formatOnly separate.
 * ZERO_OBSERVED_CHANGES when economic array empty.
 */
export function buildPriceAvailabilityHistory(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const priceChanges = Array.isArray(opts.priceChanges) ? opts.priceChanges : [];
  const formatOnlyChanges = Array.isArray(opts.formatOnlyChanges) ? opts.formatOnlyChanges : [];
  const availabilityChanges = Array.isArray(opts.availabilityChanges)
    ? opts.availabilityChanges
    : [];
  return {
    schema: PRICE_AVAIL_HISTORY_SCHEMA,
    at: nowIso,
    runId: opts.runId || null,
    sha: opts.sha || null,
    evidenceClass: opts.evidenceClass || "CURRENT_PRODUCTION",
    note:
      "V49: priceChanges are economic PRICE_CHANGED only. FORMAT_ONLY is diagnostic and must not inflate priceStatus. Synthetic selftest must stay out of production ledger.",
    counts: {
      priceChanges: priceChanges.length,
      formatOnlyChanges: formatOnlyChanges.length,
      availabilityChanges: availabilityChanges.length,
      priceStatus: priceChanges.length ? "OBSERVED" : "ZERO_OBSERVED_CHANGES",
      formatOnlyStatus: formatOnlyChanges.length ? "OBSERVED_FORMAT_ONLY" : "ZERO_FORMAT_ONLY",
      availabilityStatus: availabilityChanges.length ? "OBSERVED" : "ZERO_OBSERVED_CHANGES",
    },
    priceChanges,
    formatOnlyChanges,
    availabilityChanges,
  };
}

/**
 * Collect change rows from applyPublishedRefreshToDoc merge trail on cards.
 * V49: re-validate with normalize; format-only never enters priceChanges.
 */
export function collectChangeRowsFromOffersDoc(doc, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const runId = opts.runId || null;
  const priceChanges = [];
  const formatOnlyChanges = [];
  const availabilityChanges = [];

  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      const adv = p.advertiserId != null ? String(p.advertiserId) : "";
      const pid = p.productId != null ? String(p.productId) : "";
      if (!adv || !pid) continue;

      const stampedEconomic = Boolean(p.priceChangedAt && p.previousPrice != null);
      const stampedFormat = Boolean(p.priceFormatOnlyAt);
      const hasPrev =
        p.previousPrice != null || p.previousRawPriceFormatOnly != null;
      if (stampedEconomic || stampedFormat || (opts.acceptAny === true && hasPrev)) {
        if (
          opts.acceptAny === true ||
          p.priceChangedAt === nowIso ||
          p.priceFormatOnlyAt === nowIso ||
          p.verifiedAt === nowIso
        ) {
          const prevRaw =
            p.previousPrice != null ? p.previousPrice : p.previousRawPriceFormatOnly;
          const c = classifyPriceTransition(prevRaw, p.currentPrice, p.currency, p.currency);
          const classification = c.class;
          const economic = c.economicChange === true;

          const row = {
            advertiserId: adv,
            productId: pid,
            previousRawPrice: prevRaw,
            currentRawPrice: p.currentPrice,
            previousPrice: prevRaw,
            newPrice: p.currentPrice,
            previousNormalizedPrice: c.prev?.decimalString ?? null,
            currentNormalizedPrice: c.next?.decimalString ?? null,
            currency: p.currency || null,
            previousOriginalPrice: p.previousOriginalPrice ?? null,
            newOriginalPrice: p.originalPrice ?? null,
            source: p.priceChangeSource || "cj_product_refresh",
            sourceTimestamp: p.sourceUpdatedAt || null,
            fetchTimestamp: p.fetchedAt || null,
            verificationTimestamp: p.verifiedAt || p.priceChangedAt || p.priceFormatOnlyAt || null,
            publicationTimestamp: nowIso,
            runId,
            changeClassification: classification,
            publicationResult: p.publicationReady === false ? "NOT_READY" : "PUBLISHED_CARD",
          };

          if (economic || classification === PRICE_CHANGE_CLASS.PRICE_CHANGED) {
            priceChanges.push(row);
          } else if (classification === PRICE_CHANGE_CLASS.FORMAT_ONLY || stampedFormat) {
            formatOnlyChanges.push(row);
          }
        }
      }
      if (
        p.availabilityChangedAt &&
        p.previousAvailability != null &&
        String(p.previousAvailability) !== String(p.availability ?? "")
      ) {
        if (
          opts.acceptAny === true ||
          p.availabilityChangedAt === nowIso ||
          p.verifiedAt === nowIso
        ) {
          availabilityChanges.push({
            advertiserId: adv,
            productId: pid,
            previousAvailability: p.previousAvailability,
            currentAvailability: p.availability ?? null,
            source: p.availabilityChangeSource || "cj_product_refresh",
            verificationTime: p.verifiedAt || p.availabilityChangedAt || null,
            runId,
            publicationDecision: p.publicationReady === false ? "HOLD_OR_HIDE" : "KEEP_PUBLISHED",
            hysteresisState: p.hysteresisState || null,
          });
        }
      }
    }
  }
  return { priceChanges, formatOnlyChanges, availabilityChanges };
}

/**
 * Honest continuation counts: advanced/productProgress only among withFeed.
 */
export function summarizeHonestContinuationCounts(progressLedger) {
  const c = progressLedger?.counts || {};
  return {
    withFeedTracked: c.withFeedTracked || 0,
    cursorAdvanced: c.cursorAdvanced || 0,
    productsFetched: c.productsFetched || 0,
    productProgress: c.productProgress || 0,
    noProgress: c.noProgress || 0,
    apiEmpty: c.apiEmpty || 0,
    feedPassCompleted: c.feedPassCompleted || 0,
    refreshCycleStarted: c.refreshCycleStarted || 0,
    // Explicit aliases so dashboards cannot confuse with V47 skewed "advanced=165"
    advancedProductProgress: c.productProgress || 0,
    advancedCursorOnly: Math.max(0, (c.cursorAdvanced || 0) - (c.productsFetched || 0)),
  };
}
