/**
 * V50 — durable append-only price history with idempotent event keys.
 * FORMAT_ONLY never inflates economic priceChanges.
 * Re-running the same run must not duplicate events.
 */
import {
  classifyPriceTransition,
  PRICE_CHANGE_CLASS,
} from "./iu-cj-affiliate-phase3z-price-normalize-v49.mjs";

export const DURABLE_PRICE_HISTORY_SCHEMA =
  "iu-cj-affiliate-phase3z-durable-price-history-v50";

export function compoundIdentity(advertiserId, productId) {
  return String(advertiserId || "") + "|" + String(productId || "");
}

export function makePriceEventKey(ev) {
  const adv = String(ev.advertiserId || "");
  const pid = String(ev.productId || "");
  const cls = String(ev.changeClassification || "");
  const cur = String(ev.currency || "");
  const prevN = ev.previousMinorUnits != null ? String(ev.previousMinorUnits) : String(ev.previousNormalizedPrice ?? "");
  const nextN = ev.currentMinorUnits != null ? String(ev.currentMinorUnits) : String(ev.currentNormalizedPrice ?? "");
  const run = String(ev.runId || "");
  // Economic identity of the transition + run (idempotent within a run).
  return [adv, pid, cls, cur, prevN, nextN, run].join("::");
}

export function emptyDurablePriceHistory(opts = {}) {
  return {
    schema: DURABLE_PRICE_HISTORY_SCHEMA,
    at: opts.nowIso || new Date().toISOString(),
    runId: opts.runId || null,
    sha: opts.sha || null,
    evidenceClass: opts.evidenceClass || "CURRENT_PRODUCTION",
    note:
      "Append-only durable price/availability ledger. eventKey idempotent. FORMAT_ONLY is diagnostic only.",
    events: [],
    formatOnlyEvents: [],
    availabilityEvents: [],
    eventKeys: [],
    counts: {
      economicEvents: 0,
      formatOnlyEvents: 0,
      availabilityEvents: 0,
      appendedThisRun: 0,
      skippedDuplicateKeys: 0,
      priceStatus: "ZERO_OBSERVED_CHANGES",
      availabilityStatus: "ZERO_OBSERVED_CHANGES",
    },
  };
}

/**
 * Normalize a collected change row into a durable event (fills missing fields).
 */
export function toDurablePriceEvent(row, opts = {}) {
  const adv = row.advertiserId != null ? String(row.advertiserId) : "";
  const pid = row.productId != null ? String(row.productId) : "";
  const prevRaw = row.previousRawPrice != null ? row.previousRawPrice : row.previousPrice;
  const nextRaw = row.currentRawPrice != null ? row.currentRawPrice : row.newPrice;
  const currency = row.currency || null;
  const classified =
    row.previousNormalizedPrice != null && row.currentNormalizedPrice != null && row.changeClassification
      ? {
          class: row.changeClassification,
          economicChange: row.changeClassification === PRICE_CHANGE_CLASS.PRICE_CHANGED,
          prev: {
            decimalString: row.previousNormalizedPrice,
            minorUnits: row.previousMinorUnits ?? null,
          },
          next: {
            decimalString: row.currentNormalizedPrice,
            minorUnits: row.currentMinorUnits ?? null,
          },
        }
      : classifyPriceTransition(prevRaw, nextRaw, currency, currency);

  const ev = {
    advertiserId: adv,
    productId: pid,
    compoundIdentity: compoundIdentity(adv, pid),
    previousRawPrice: prevRaw,
    currentRawPrice: nextRaw,
    previousNormalizedPrice: classified.prev?.decimalString ?? row.previousNormalizedPrice ?? null,
    currentNormalizedPrice: classified.next?.decimalString ?? row.currentNormalizedPrice ?? null,
    previousMinorUnits: classified.prev?.minorUnits ?? row.previousMinorUnits ?? null,
    currentMinorUnits: classified.next?.minorUnits ?? row.currentMinorUnits ?? null,
    currency,
    previousOriginalPrice: row.previousOriginalPrice ?? null,
    currentOriginalPrice: row.newOriginalPrice ?? row.currentOriginalPrice ?? null,
    sourceId: row.source || row.sourceId || "cj_product_refresh",
    sourceTimestamp: row.sourceTimestamp || null,
    fetchTimestamp: row.fetchTimestamp || null,
    verificationTimestamp: row.verificationTimestamp || null,
    changeTimestamp: row.changeTimestamp || row.publicationTimestamp || opts.nowIso || null,
    runId: row.runId != null ? String(row.runId) : opts.runId != null ? String(opts.runId) : null,
    changeClassification: classified.class || row.changeClassification || PRICE_CHANGE_CLASS.PRICE_UNKNOWN,
    publicationResult: row.publicationResult || null,
    storageKey: null,
    evidenceReference: row.evidenceReference || "offers-public.product.card",
  };
  ev.storageKey = makePriceEventKey(ev);
  ev.eventKey = ev.storageKey;
  return ev;
}

/**
 * Append new run events into prior durable doc without rewriting history.
 */
export function appendDurablePriceHistory(priorDoc, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const runId = opts.runId != null ? String(opts.runId) : null;
  const base =
    priorDoc && priorDoc.schema === DURABLE_PRICE_HISTORY_SCHEMA
      ? priorDoc
      : emptyDurablePriceHistory({ nowIso, runId, sha: opts.sha });

  const keySet = new Set(
    Array.isArray(base.eventKeys) && base.eventKeys.length
      ? base.eventKeys
      : [
          ...(base.events || []).map((e) => e.eventKey || e.storageKey || makePriceEventKey(e)),
          ...(base.formatOnlyEvents || []).map((e) => e.eventKey || e.storageKey || makePriceEventKey(e)),
          ...(base.availabilityEvents || []).map((e) => e.eventKey || e.storageKey || makePriceEventKey(e)),
        ]
  );

  const events = Array.isArray(base.events) ? base.events.slice() : [];
  const formatOnlyEvents = Array.isArray(base.formatOnlyEvents) ? base.formatOnlyEvents.slice() : [];
  const availabilityEvents = Array.isArray(base.availabilityEvents)
    ? base.availabilityEvents.slice()
    : [];

  let appended = 0;
  let skipped = 0;

  for (const raw of opts.priceChanges || []) {
    const ev = toDurablePriceEvent(raw, { nowIso, runId });
    if (!ev.advertiserId || !ev.productId) continue;
    if (ev.changeClassification !== PRICE_CHANGE_CLASS.PRICE_CHANGED) continue;
    if (keySet.has(ev.eventKey)) {
      skipped += 1;
      continue;
    }
    keySet.add(ev.eventKey);
    events.push(ev);
    appended += 1;
  }

  for (const raw of opts.formatOnlyChanges || []) {
    const ev = toDurablePriceEvent(
      { ...raw, changeClassification: PRICE_CHANGE_CLASS.FORMAT_ONLY },
      { nowIso, runId }
    );
    if (!ev.advertiserId || !ev.productId) continue;
    if (keySet.has(ev.eventKey)) {
      skipped += 1;
      continue;
    }
    keySet.add(ev.eventKey);
    formatOnlyEvents.push(ev);
    appended += 1;
  }

  for (const raw of opts.availabilityChanges || []) {
    const adv = raw.advertiserId != null ? String(raw.advertiserId) : "";
    const pid = raw.productId != null ? String(raw.productId) : "";
    if (!adv || !pid) continue;
    const ev = {
      advertiserId: adv,
      productId: pid,
      compoundIdentity: compoundIdentity(adv, pid),
      previousAvailability: raw.previousAvailability ?? null,
      currentAvailability: raw.currentAvailability ?? null,
      sourceId: raw.source || "cj_product_refresh",
      verificationTimestamp: raw.verificationTime || null,
      changeTimestamp: nowIso,
      runId,
      publicationDecision: raw.publicationDecision || null,
      hysteresisState: raw.hysteresisState || null,
      evidenceReference: "offers-public.product.card",
    };
    ev.storageKey = ["avail", adv, pid, String(ev.previousAvailability), String(ev.currentAvailability), String(runId)].join(
      "::"
    );
    ev.eventKey = ev.storageKey;
    if (keySet.has(ev.eventKey)) {
      skipped += 1;
      continue;
    }
    keySet.add(ev.eventKey);
    availabilityEvents.push(ev);
    appended += 1;
  }

  // Bound growth for Pages/artifact size; keep newest economic first.
  const MAX_ECON = Number(opts.maxEconomic || 2000);
  const MAX_FMT = Number(opts.maxFormatOnly || 1000);
  const MAX_AVAIL = Number(opts.maxAvailability || 1000);
  const trim = (arr, n) => (arr.length > n ? arr.slice(arr.length - n) : arr);

  const nextEvents = trim(events, MAX_ECON);
  const nextFmt = trim(formatOnlyEvents, MAX_FMT);
  const nextAvail = trim(availabilityEvents, MAX_AVAIL);
  const eventKeys = [
    ...nextEvents.map((e) => e.eventKey),
    ...nextFmt.map((e) => e.eventKey),
    ...nextAvail.map((e) => e.eventKey),
  ];

  return {
    schema: DURABLE_PRICE_HISTORY_SCHEMA,
    at: nowIso,
    runId,
    sha: opts.sha || base.sha || null,
    evidenceClass: opts.evidenceClass || base.evidenceClass || "CURRENT_PRODUCTION",
    note: base.note,
    priorEventCount: (base.events || []).length + (base.formatOnlyEvents || []).length,
    events: nextEvents,
    formatOnlyEvents: nextFmt,
    availabilityEvents: nextAvail,
    eventKeys,
    counts: {
      economicEvents: nextEvents.length,
      formatOnlyEvents: nextFmt.length,
      availabilityEvents: nextAvail.length,
      appendedThisRun: appended,
      skippedDuplicateKeys: skipped,
      priceStatus: nextEvents.length ? "OBSERVED" : "ZERO_OBSERVED_CHANGES",
      formatOnlyStatus: nextFmt.length ? "OBSERVED_FORMAT_ONLY" : "ZERO_FORMAT_ONLY",
      availabilityStatus: nextAvail.length ? "OBSERVED" : "ZERO_OBSERVED_CHANGES",
    },
    thisRun: {
      economicAppended: (opts.priceChanges || []).length,
      formatOnlyAppended: (opts.formatOnlyChanges || []).length,
      availabilityAppended: (opts.availabilityChanges || []).length,
      economicKeptAfterDedupe: nextEvents.filter((e) => String(e.runId) === String(runId)).length,
    },
  };
}

/**
 * Prove next-run read: prior durable keys are still present after append.
 */
export function assertDurableHistoryReadable(priorDoc, nextDoc) {
  const priorKeys = new Set(priorDoc?.eventKeys || []);
  const nextKeys = new Set(nextDoc?.eventKeys || []);
  let preserved = 0;
  let missing = 0;
  for (const k of priorKeys) {
    if (nextKeys.has(k)) preserved += 1;
    else missing += 1;
  }
  return {
    priorKeys: priorKeys.size,
    nextKeys: nextKeys.size,
    preserved,
    missing,
    readable: missing === 0,
  };
}
