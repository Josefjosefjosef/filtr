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

/** Documented diagnostic retention for format-only / availability windows. */
export const RETENTION_POLICY_VERSION = "iu-cj-durable-retention-v51.2";
export const DEFAULT_MAX_ECONOMIC = 2000;
export const DEFAULT_MAX_FORMAT_ONLY = 1000;
export const DEFAULT_MAX_AVAILABILITY = 1000;

export const DURABLE_KEY_CLASS = Object.freeze({
  ECONOMIC_PRESERVED: "ECONOMIC_PRESERVED",
  ECONOMIC_MISSING: "ECONOMIC_MISSING",
  FORMAT_ONLY_PRESERVED: "FORMAT_ONLY_PRESERVED",
  FORMAT_ONLY_RETAINED_OUT: "FORMAT_ONLY_RETAINED_OUT",
  FORMAT_ONLY_UNEXPECTED_MISSING: "FORMAT_ONLY_UNEXPECTED_MISSING",
  AVAILABILITY_PRESERVED: "AVAILABILITY_PRESERVED",
  AVAILABILITY_RETAINED_OUT: "AVAILABILITY_RETAINED_OUT",
  AVAILABILITY_MISSING: "AVAILABILITY_MISSING",
  DUPLICATE_KEYS: "DUPLICATE_KEYS",
  INVALID_KEYS: "INVALID_KEYS",
});

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

  // Bound growth for Pages/artifact size.
  // Economic: keep newest within MAX_ECON (hard gate: unexpected economic trim = BLOCKED).
  // Format-only / availability: intentional rolling diagnostic windows (documented retention).
  const MAX_ECON = Number(opts.maxEconomic || DEFAULT_MAX_ECONOMIC);
  const MAX_FMT = Number(opts.maxFormatOnly || DEFAULT_MAX_FORMAT_ONLY);
  const MAX_AVAIL = Number(opts.maxAvailability || DEFAULT_MAX_AVAILABILITY);
  // Deterministic trim: array order is append order (oldest first). Keep newest = slice(end).
  // Tie-breaker: eventKey string (stable) when re-sorting by timestamp.
  const sortOldestFirst = (arr) =>
    arr
      .slice()
      .sort((a, b) => {
        const ta = String(a.changeTimestamp || a.at || "");
        const tb = String(b.changeTimestamp || b.at || "");
        if (ta !== tb) return ta < tb ? -1 : 1;
        const ka = String(a.eventKey || "");
        const kb = String(b.eventKey || "");
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
  const trimKeepNewest = (arr, n) => {
    const sorted = sortOldestFirst(arr);
    if (sorted.length <= n) return { kept: sorted, retired: [] };
    return { kept: sorted.slice(sorted.length - n), retired: sorted.slice(0, sorted.length - n) };
  };

  const econTrim = trimKeepNewest(events, MAX_ECON);
  const fmtTrim = trimKeepNewest(formatOnlyEvents, MAX_FMT);
  const availTrim = trimKeepNewest(availabilityEvents, MAX_AVAIL);
  const nextEvents = econTrim.kept;
  const nextFmt = fmtTrim.kept;
  const nextAvail = availTrim.kept;
  const eventKeys = [
    ...nextEvents.map((e) => e.eventKey),
    ...nextFmt.map((e) => e.eventKey),
    ...nextAvail.map((e) => e.eventKey),
  ];

  const retentionLedger = buildFormatOnlyRetentionLedger({
    retiredEvents: fmtTrim.retired,
    nowIso,
    runId,
    sha: opts.sha || base.sha || null,
    priorArtifactSha: base.sha || null,
    maxFormatOnly: MAX_FMT,
    policyVersion: RETENTION_POLICY_VERSION,
  });
  const availabilityRetentionLedger = buildFormatOnlyRetentionLedger({
    retiredEvents: availTrim.retired,
    nowIso,
    runId,
    sha: opts.sha || base.sha || null,
    priorArtifactSha: base.sha || null,
    maxFormatOnly: MAX_AVAIL,
    policyVersion: RETENTION_POLICY_VERSION,
    reason: "AVAILABILITY_ROLLING_WINDOW",
  });

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
    retention: {
      policyVersion: RETENTION_POLICY_VERSION,
      maxEconomic: MAX_ECON,
      maxFormatOnly: MAX_FMT,
      maxAvailability: MAX_AVAIL,
      economicRetiredCount: econTrim.retired.length,
      retiredFormatOnlyCount: fmtTrim.retired.length,
      retiredAvailabilityCount: availTrim.retired.length,
      retiredFormatOnlyKeysSample: fmtTrim.retired.map((e) => e.eventKey).slice(-50),
      // Active window only — not a durable archive store.
      archiveStatus: "NOT_ARCHIVED_ACTIVE_WINDOW_ONLY",
      formatOnlyRetentionLedger: retentionLedger,
      availabilityRetentionLedger,
    },
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
 * Individual retention decisions for format-only (or availability) retired rows.
 * These are NOT archived elsewhere unless a separate archive writer persists them.
 */
export function buildFormatOnlyRetentionLedger(opts = {}) {
  const retired = Array.isArray(opts.retiredEvents) ? opts.retiredEvents : [];
  const nowIso = opts.nowIso || new Date().toISOString();
  const reason = opts.reason || "FORMAT_ONLY_ROLLING_WINDOW";
  const rows = retired.map((e) => ({
    eventKey: e.eventKey || e.storageKey || null,
    advertiserId: e.advertiserId != null ? String(e.advertiserId) : null,
    productId: e.productId != null ? String(e.productId) : null,
    compoundIdentity: e.compoundIdentity || compoundIdentity(e.advertiserId, e.productId),
    previousTimestamp: e.changeTimestamp || e.at || null,
    retentionTimestamp: nowIso,
    retentionReason: reason,
    retentionPolicyVersion: opts.policyVersion || RETENTION_POLICY_VERSION,
    sourceRunId: e.runId != null ? String(e.runId) : null,
    previousArtifactSha: opts.priorArtifactSha || null,
    newArtifactSha: opts.sha || null,
    archivedStatus: "NOT_ARCHIVED",
    archiveLocation: null,
    maxWindow: opts.maxFormatOnly != null ? Number(opts.maxFormatOnly) : DEFAULT_MAX_FORMAT_ONLY,
  }));
  return {
    schema: "iu-cj-affiliate-phase3z-format-only-retention-ledger-v51.2",
    policyVersion: opts.policyVersion || RETENTION_POLICY_VERSION,
    at: nowIso,
    runId: opts.runId != null ? String(opts.runId) : null,
    count: rows.length,
    rows,
  };
}

function listEventKeys(doc, field) {
  const arr = Array.isArray(doc?.[field]) ? doc[field] : [];
  return arr.map((e) => String(e?.eventKey || "")).filter(Boolean);
}

function retentionKeySet(ledger) {
  const rows = Array.isArray(ledger?.rows) ? ledger.rows : [];
  return new Set(rows.map((r) => String(r.eventKey || "")).filter(Boolean));
}

function archivedKeySet(ledger) {
  const rows = Array.isArray(ledger?.rows) ? ledger.rows : [];
  return new Set(
    rows
      .filter((r) => String(r.archivedStatus || "") === "ARCHIVED" && r.archiveLocation)
      .map((r) => String(r.eventKey || ""))
      .filter(Boolean)
  );
}

/**
 * Individual set comparison: previous durable artifact vs current.
 * Classification uses typed event arrays (not key-prefix heuristics).
 */
export function compareDurableKeySets(priorDoc, nextDoc) {
  const prevEcon = new Set(listEventKeys(priorDoc, "events"));
  const prevFmt = new Set(listEventKeys(priorDoc, "formatOnlyEvents"));
  const prevAvail = new Set(listEventKeys(priorDoc, "availabilityEvents"));
  const nextEcon = new Set(listEventKeys(nextDoc, "events"));
  const nextFmt = new Set(listEventKeys(nextDoc, "formatOnlyEvents"));
  const nextAvail = new Set(listEventKeys(nextDoc, "availabilityEvents"));
  const priorAll = new Set([
    ...(priorDoc?.eventKeys || []).map(String).filter(Boolean),
    ...prevEcon,
    ...prevFmt,
    ...prevAvail,
  ]);
  const nextAll = new Set([
    ...(nextDoc?.eventKeys || []).map(String).filter(Boolean),
    ...nextEcon,
    ...nextFmt,
    ...nextAvail,
  ]);

  const fmtLedger = nextDoc?.retention?.formatOnlyRetentionLedger || null;
  const availLedger = nextDoc?.retention?.availabilityRetentionLedger || null;
  const fmtRetained = retentionKeySet(fmtLedger);
  const fmtArchived = archivedKeySet(fmtLedger);
  const availRetained = retentionKeySet(availLedger);
  const availArchived = archivedKeySet(availLedger);

  const econPreserved = [...prevEcon].filter((k) => nextEcon.has(k));
  const econMissing = [...prevEcon].filter((k) => !nextEcon.has(k));
  const fmtPreserved = [...prevFmt].filter((k) => nextFmt.has(k));
  const fmtRetainedOut = [...prevFmt].filter((k) => !nextFmt.has(k) && fmtRetained.has(k));
  const fmtArchivedKeys = [...prevFmt].filter((k) => !nextFmt.has(k) && fmtArchived.has(k));
  const fmtUnexpected = [...prevFmt].filter(
    (k) => !nextFmt.has(k) && !fmtRetained.has(k) && !fmtArchived.has(k)
  );
  const availPreserved = [...prevAvail].filter((k) => nextAvail.has(k));
  const availRetainedOut = [...prevAvail].filter((k) => !nextAvail.has(k) && availRetained.has(k));
  const availArchivedKeys = [...prevAvail].filter((k) => !nextAvail.has(k) && availArchived.has(k));
  const availUnexpected = [...prevAvail].filter(
    (k) => !nextAvail.has(k) && !availRetained.has(k) && !availArchived.has(k)
  );

  const preserved = [...priorAll].filter((k) => nextAll.has(k));
  const removed = [...priorAll].filter((k) => !nextAll.has(k));
  const added = [...nextAll].filter((k) => !priorAll.has(k));

  const nextKeyList = [
    ...listEventKeys(nextDoc, "events"),
    ...listEventKeys(nextDoc, "formatOnlyEvents"),
    ...listEventKeys(nextDoc, "availabilityEvents"),
  ];
  const seen = new Map();
  const dupes = [];
  for (const k of nextKeyList) {
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n === 2) dupes.push(k);
  }
  const invalid = nextKeyList.filter((k) => !k);

  return {
    schema: "iu-cj-affiliate-phase3z-durable-key-comparison-v51.2",
    priorKeys: priorAll.size,
    nextKeys: nextAll.size,
    preservedTotal: preserved.length,
    removedTotal: removed.length,
    addedTotal: added.length,
    removedKeysSample: removed.slice(0, 20),
    economic: {
      previousKeys: [...prevEcon],
      currentKeys: [...nextEcon],
      preservedKeys: econPreserved,
      missingKeys: econMissing,
      addedKeys: [...nextEcon].filter((k) => !prevEcon.has(k)),
    },
    formatOnly: {
      previousKeys: [...prevFmt],
      currentKeys: [...nextFmt],
      preservedKeys: fmtPreserved,
      retainedOutKeys: fmtRetainedOut,
      archivedKeys: fmtArchivedKeys,
      unexpectedMissingKeys: fmtUnexpected,
      addedKeys: [...nextFmt].filter((k) => !prevFmt.has(k)),
    },
    availability: {
      previousKeys: [...prevAvail],
      currentKeys: [...nextAvail],
      preservedKeys: availPreserved,
      retainedOutKeys: availRetainedOut,
      archivedKeys: availArchivedKeys,
      unexpectedMissingKeys: availUnexpected,
      addedKeys: [...nextAvail].filter((k) => !prevAvail.has(k)),
    },
    duplicates: { count: dupes.length, keys: dupes.slice(0, 50) },
    invalid: { count: invalid.length, keys: invalid.slice(0, 50) },
  };
}

/**
 * Prove next-run read with honest multi-status split (V51.2).
 * Keeps (priorDoc, nextDoc) signature used by live sync.
 * readable = economic integrity only (NOT aggregate all-keys preserved).
 */
export function assertDurableHistoryReadable(priorDoc, nextDoc) {
  const ledger = compareDurableKeySets(priorDoc, nextDoc);
  const economicMissing = ledger.economic.missingKeys.length;
  const availUnexpected = ledger.availability.unexpectedMissingKeys.length;
  const fmtUnexpected = ledger.formatOnly.unexpectedMissingKeys.length;
  const readbackReadable =
    nextDoc != null && typeof nextDoc === "object" && Array.isArray(nextDoc.eventKeys);
  const economicHistoryComplete = economicMissing === 0;
  const availabilityHistoryComplete = availUnexpected === 0;
  const allHistoricalKeysPreserved =
    economicMissing === 0 &&
    availUnexpected === 0 &&
    fmtUnexpected === 0 &&
    ledger.formatOnly.retainedOutKeys.length === 0 &&
    ledger.availability.retainedOutKeys.length === 0;
  const durableAccountingPass =
    economicHistoryComplete &&
    availabilityHistoryComplete &&
    fmtUnexpected === 0 &&
    ledger.duplicates.count === 0 &&
    ledger.invalid.count === 0 &&
    readbackReadable;

  return {
    schema: "iu-cj-affiliate-phase3z-durable-history-readproof-v51.2",
    priorKeys: ledger.priorKeys,
    nextKeys: ledger.nextKeys,
    preserved: ledger.preservedTotal,
    missing: ledger.removedTotal,
    missingKeysSample: ledger.removedKeysSample,
    // Hard gate: economic append-only. Aggregate missing may be format-only retention.
    readable: economicHistoryComplete && readbackReadable,
    readbackReadable,
    economicHistoryComplete,
    availabilityHistoryComplete,
    allHistoricalKeysPreserved,
    durableAccountingPass,
    economic: {
      prior: ledger.economic.previousKeys.length,
      preserved: ledger.economic.preservedKeys.length,
      missing: economicMissing,
      missingKeysSample: ledger.economic.missingKeys.slice(0, 20),
      preservedKeysSample: ledger.economic.preservedKeys.slice(0, 20),
      status: economicHistoryComplete ? "ECONOMIC_INTACT" : "ECONOMIC_HISTORY_LOSS",
    },
    formatOnly: {
      prior: ledger.formatOnly.previousKeys.length,
      preserved: ledger.formatOnly.preservedKeys.length,
      missing: ledger.formatOnly.retainedOutKeys.length + fmtUnexpected,
      retainedOut: ledger.formatOnly.retainedOutKeys.length,
      archived: ledger.formatOnly.archivedKeys.length,
      unexpectedMissing: fmtUnexpected,
      retainedOutKeysSample: ledger.formatOnly.retainedOutKeys.slice(0, 20),
      unexpectedMissingKeysSample: ledger.formatOnly.unexpectedMissingKeys.slice(0, 20),
      retentionCap: Number(nextDoc?.retention?.maxFormatOnly || DEFAULT_MAX_FORMAT_ONLY),
      status:
        fmtUnexpected === 0
          ? ledger.formatOnly.retainedOutKeys.length
            ? "FORMAT_ONLY_RETENTION_DOCUMENTED"
            : "FORMAT_ONLY_INTACT"
          : "FORMAT_ONLY_UNEXPECTED_MISSING",
      note:
        "Format-only diagnostic history is intentionally capped (default MAX_FMT=1000). " +
        "retainedOut is documented rolling retention, NOT economic price-history loss. " +
        "archivedStatus remains NOT_ARCHIVED unless a separate archive writer exists.",
    },
    availability: {
      prior: ledger.availability.previousKeys.length,
      preserved: ledger.availability.preservedKeys.length,
      retainedOut: ledger.availability.retainedOutKeys.length,
      missing: availUnexpected,
      missingKeysSample: ledger.availability.unexpectedMissingKeys.slice(0, 20),
      retentionCap: Number(nextDoc?.retention?.maxAvailability || DEFAULT_MAX_AVAILABILITY),
      status: availabilityHistoryComplete
        ? ledger.availability.retainedOutKeys.length
          ? "AVAILABILITY_RETENTION_DOCUMENTED"
          : "AVAILABILITY_INTACT"
        : "AVAILABILITY_HISTORY_LOSS",
    },
    duplicates: ledger.duplicates,
    invalid: ledger.invalid,
    retention: nextDoc?.retention || null,
    statuses: {
      readbackTechnical: readbackReadable ? "READBACK_OK" : "READBACK_FAILED",
      economicIntegrity: economicHistoryComplete ? "PASS" : "BLOCKED",
      formatOnlyRetentionIntegrity: fmtUnexpected === 0 ? "PASS" : "BLOCKED",
      availabilityIntegrity: availabilityHistoryComplete ? "PASS" : "BLOCKED",
      overallDurableIntegrity: durableAccountingPass ? "DURABLE_ACCOUNTING_PASS" : "BLOCKED",
    },
    classification: durableAccountingPass
      ? ledger.formatOnly.retainedOutKeys.length || ledger.availability.retainedOutKeys.length
        ? "ECONOMIC_AVAIL_INTACT_DIAGNOSTIC_RETENTION"
        : "FULLY_READABLE"
      : economicMissing > 0
        ? "ECONOMIC_HISTORY_LOSS"
        : availUnexpected > 0
          ? "AVAILABILITY_HISTORY_LOSS"
          : "UNEXPECTED_KEY_LOSS_OR_INVALID",
    ledger,
  };
}
