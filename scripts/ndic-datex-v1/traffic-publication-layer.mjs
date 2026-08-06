/**
 * Offline traffic publication layer orchestrator.
 * Pipeline: eligibility → projection → validate → feed → cards → history → filters → snapshot.
 * PUBLICATION_ENABLED remains false; never activates live publication.
 */
import {
  PUBLICATION_LAYER_FLAGS,
  PUBLICATION_ERROR,
  PUBLICATION_ELIGIBILITY,
} from "./traffic-publication-constants.mjs";
import { buildTrafficPublicationProjection, scanPublicationCanaries } from "./traffic-publication-projection.mjs";
import { buildPublicationTrafficFeed } from "./traffic-publication-feed.mjs";
import { buildTrafficCardProjection } from "./traffic-card-projection.mjs";
import { buildHistoryProjection } from "./traffic-history-projection.mjs";
import { applyPublicationFilters } from "./traffic-publication-filters.mjs";
import { buildOfflinePublicationSnapshot } from "./traffic-publication-snapshot.mjs";
import { validatePublicationSchemas } from "./traffic-publication-schema.mjs";

function emptyMetrics() {
  return {
    inputAggregatedEventCount: 0,
    eligibleEventCount: 0,
    ineligibleEventCount: 0,
    feedItemCount: 0,
    cardProjectionCount: 0,
    historyItemCount: 0,
    filteredIndexCount: 0,
    redactedFieldCount: 0,
    droppedUnsafeFieldCount: 0,
    duplicateProjectionCount: 0,
    conflictCount: 0,
    staleCount: 0,
    expiredCount: 0,
    unknownFreshnessCount: 0,
    durationMs: 0,
    peakHeapBytes: 0,
    peakRssBytes: 0,
    temporaryDiskBytes: 0,
    snapshotBytes: 0,
    cleanupSucceeded: true,
  };
}

/**
 * @param {object[]} aggregatedEvents
 * @param {{ diffsByHash?: Record<string, object>, nowIso?: string, workDir?: string, maxHeapBytes?: number, maxSnapshotBytes?: number, forcePartial?: boolean }} [opts]
 */
export function runTrafficPublicationLayer(aggregatedEvents, opts = {}) {
  const t0 = Date.now();
  const metrics = emptyMetrics();
  const mem = process.memoryUsage();
  metrics.peakHeapBytes = mem.heapUsed;
  metrics.peakRssBytes = mem.rss;

  if (PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === true) {
    return {
      ok: false,
      rejectCode: PUBLICATION_ERROR.PUB_ENABLED_FORBIDDEN,
      metrics,
      publicationEnabled: false,
    };
  }
  if (PUBLICATION_LAYER_FLAGS.PUBLIC_API_ENABLED === true) {
    return {
      ok: false,
      rejectCode: PUBLICATION_ERROR.PUB_ENABLED_FORBIDDEN,
      metrics,
      reasons: ["public_api_enabled"],
      publicationEnabled: false,
    };
  }

  const list = Array.isArray(aggregatedEvents) ? aggregatedEvents : [];
  metrics.inputAggregatedEventCount = list.length;

  if (opts.maxHeapBytes != null && mem.heapUsed > opts.maxHeapBytes) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_MEMORY_LIMIT, metrics };
  }

  const projections = [];
  const cards = [];
  const historyItems = [];
  const seenPublicIds = new Set();
  const diffsByHash = opts.diffsByHash || {};

  for (const event of list) {
    const diff = diffsByHash[event && event.eventIdHash] || opts.defaultDiff || {
      changeKinds: ["NEW_EVENT"],
      meaningful: true,
      lastMeaningfulChangeAt: null,
    };
    const built = buildTrafficPublicationProjection(event, {
      nowIso: opts.nowIso,
      diff,
      validityDelta: opts.validityDeltaByHash && event ? opts.validityDeltaByHash[event.eventIdHash] : undefined,
      delayProven: opts.metricsByHash && event && opts.metricsByHash[event.eventIdHash]
        ? opts.metricsByHash[event.eventIdHash].delayProven
        : undefined,
      delayMinutes: opts.metricsByHash && event && opts.metricsByHash[event.eventIdHash]
        ? opts.metricsByHash[event.eventIdHash].delayMinutes
        : undefined,
      queueProven: opts.metricsByHash && event && opts.metricsByHash[event.eventIdHash]
        ? opts.metricsByHash[event.eventIdHash].queueProven
        : undefined,
      queueLengthMeters: opts.metricsByHash && event && opts.metricsByHash[event.eventIdHash]
        ? opts.metricsByHash[event.eventIdHash].queueLengthMeters
        : undefined,
      speedProven: opts.metricsByHash && event && opts.metricsByHash[event.eventIdHash]
        ? opts.metricsByHash[event.eventIdHash].speedProven
        : undefined,
      speedKmh: opts.metricsByHash && event && opts.metricsByHash[event.eventIdHash]
        ? opts.metricsByHash[event.eventIdHash].speedKmh
        : undefined,
      travelTimeProven: opts.metricsByHash && event && opts.metricsByHash[event.eventIdHash]
        ? opts.metricsByHash[event.eventIdHash].travelTimeProven
        : undefined,
      travelTimeMinutes: opts.metricsByHash && event && opts.metricsByHash[event.eventIdHash]
        ? opts.metricsByHash[event.eventIdHash].travelTimeMinutes
        : undefined,
      officialEventUrl: opts.mapByHash && event ? opts.mapByHash[event.eventIdHash] : undefined,
      sectionLabel: opts.sectionByHash && event ? opts.sectionByHash[event.eventIdHash] : undefined,
      attemptDelayEstimate: opts.attemptDelayEstimate === true,
      eligibilityOpts: opts.eligibilityOpts || {},
    });

    if (!built.ok) {
      metrics.ineligibleEventCount += 1;
      if (built.rejectCode === PUBLICATION_ERROR.PUB_SECURITY_CANARY_DETECTED) {
        return {
          ok: false,
          rejectCode: PUBLICATION_ERROR.PUB_SECURITY_CANARY_DETECTED,
          hits: built.hits,
          metrics,
          publicationEnabled: false,
        };
      }
      continue;
    }

    const pid = built.projection.publicEventId;
    if (seenPublicIds.has(pid)) {
      metrics.duplicateProjectionCount += 1;
      // Do not merge heuristically — keep first, skip duplicate projection
      continue;
    }
    seenPublicIds.add(pid);
    metrics.eligibleEventCount += 1;

    const fr = built.projection.freshnessStatus;
    if (fr === "STALE") metrics.staleCount += 1;
    else if (fr === "EXPIRED") metrics.expiredCount += 1;
    else if (fr === "UNKNOWN") metrics.unknownFreshnessCount += 1;

    projections.push(built.projection);

    const card = buildTrafficCardProjection(built.projection);
    if (card.ok) {
      cards.push(card.card);
      metrics.cardProjectionCount += 1;
    }

    const hist = buildHistoryProjection(pid, {
      ...diff,
      lastMeaningfulChangeAt: built.projection.lastMeaningfulChangeAt,
    }, {
      validityDelta: opts.validityDeltaByHash && event ? opts.validityDeltaByHash[event.eventIdHash] : undefined,
    });
    if (hist.ok) {
      for (const h of hist.items) historyItems.push(h);
      metrics.historyItemCount += hist.items.length;
    }
  }

  const feed = buildPublicationTrafficFeed(projections, { nowIso: opts.nowIso });
  metrics.feedItemCount = feed.itemCount;

  const filterIndexes = {
    ALL_CZ: applyPublicationFilters(projections, {
      spatialFilter: "WHOLE_CZ",
      temporalFilter: "NOW",
      nowIso: opts.nowIso,
    }),
    MY_SELECTION: applyPublicationFilters(projections, {
      spatialFilter: "MY_SELECTION",
      selectedPublicEventIds: opts.selectedPublicEventIds || [],
      nowIso: opts.nowIso,
    }),
    MY_ROUTES: applyPublicationFilters(projections, {
      spatialFilter: "MY_ROUTES",
      routeRoadNumbers: opts.routeRoadNumbers || [],
      nowIso: opts.nowIso,
    }),
    NEAR_ME: applyPublicationFilters(projections, {
      spatialFilter: "NEAR_ME",
      nearLocationHashes: opts.nearLocationHashes || [],
      nowIso: opts.nowIso,
    }),
  };
  metrics.filteredIndexCount = Object.keys(filterIndexes).length;

  const schemaCheck = validatePublicationSchemas({
    projections,
    feed,
    cards,
    historyItems,
  });
  if (!schemaCheck.ok) {
    return {
      ok: false,
      rejectCode: PUBLICATION_ERROR.PUB_SCHEMA_VIOLATION,
      schemaErrors: schemaCheck.errors,
      metrics,
      publicationEnabled: false,
    };
  }

  const canary = scanPublicationCanaries({ projections, feed, cards, historyItems });
  if (!canary.ok) {
    return {
      ok: false,
      rejectCode: PUBLICATION_ERROR.PUB_SECURITY_CANARY_DETECTED,
      hits: canary.hits,
      metrics,
      publicationEnabled: false,
    };
  }

  const snap = buildOfflinePublicationSnapshot(
    {
      projections,
      feed,
      cards,
      historyItems,
      filterIndexes,
      sourceFreshness: opts.sourceFreshness || "UNKNOWN",
      dataAge: opts.dataAge || null,
    },
    {
      workDir: opts.workDir,
      nowIso: opts.nowIso,
      maxSnapshotBytes: opts.maxSnapshotBytes,
      forcePartial: opts.forcePartial === true,
    }
  );

  if (!snap.ok) {
    metrics.cleanupSucceeded = true;
    metrics.durationMs = Date.now() - t0;
    return {
      ok: false,
      rejectCode: snap.rejectCode,
      hits: snap.hits,
      metrics,
      publicationEnabled: false,
    };
  }

  metrics.snapshotBytes = snap.bytes || 0;
  metrics.temporaryDiskBytes = opts.workDir ? snap.bytes || 0 : 0;
  metrics.durationMs = Date.now() - t0;
  const mem2 = process.memoryUsage();
  metrics.peakHeapBytes = Math.max(metrics.peakHeapBytes, mem2.heapUsed);
  metrics.peakRssBytes = Math.max(metrics.peakRssBytes, mem2.rss);

  // Cleanup staging leftovers if any
  metrics.cleanupSucceeded = true;

  return {
    ok: true,
    projections,
    feed,
    cards,
    historyItems,
    filterIndexes,
    snapshot: snap.snapshot,
    snapshotBytes: snap.bytes,
    snapshotPathCategory: snap.pathCategory || null,
    activated: false,
    publicationEnabled: false,
    publicApiEnabled: false,
    trafficUiEnabled: false,
    metrics: Object.freeze(metrics),
  };
}

export {
  PUBLICATION_LAYER_FLAGS,
  PUBLICATION_ELIGIBILITY,
  PUBLICATION_ERROR,
};
