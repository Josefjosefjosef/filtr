/**
 * Offline traffic-event aggregation orchestrator.
 * DATEX normalized inputs + RESOLVED_BASIC locations → store/diff/feed/filters/publication-model.
 * Never enables public publication or traffic cards.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildNormalizedTrafficEvent } from "./traffic-event-model.mjs";
import { deduplicateNormalizedEvents } from "./traffic-event-dedupe.mjs";
import { diffEventBatch } from "./traffic-event-diff.mjs";
import { buildTrafficFeedModel } from "./traffic-feed-model.mjs";
import { applyTrafficFilters } from "./traffic-filter-model.mjs";
import { buildPublicationProjection, attemptPublication } from "./traffic-publication-model.mjs";
import {
  AGGREGATION_FEATURE_FLAGS,
  AGGREGATION_ERROR,
} from "./traffic-event-aggregation-constants.mjs";
import { resolveDatexEventLocations, computeFreshness } from "./datex-tmc-resolver.mjs";

export const AGGREGATOR_VERSION = "iu-traffic-event-aggregator-v1";

export {
  AGGREGATION_FEATURE_FLAGS,
  AGGREGATION_ERROR,
  buildNormalizedTrafficEvent,
  deduplicateNormalizedEvents,
  diffEventBatch,
  buildTrafficFeedModel,
  applyTrafficFilters,
  buildPublicationProjection,
  attemptPublication,
};

function emptyMetrics() {
  return {
    inputCount: 0,
    builtCount: 0,
    buildRejectedCount: 0,
    uniqueCount: 0,
    duplicateCollapsed: 0,
    conflictRejected: 0,
    feedEntryCount: 0,
    filterMatchedCount: 0,
    publicationProjectionCount: 0,
    publicationAttemptsBlocked: 0,
    durationMs: 0,
    peakHeapBytes: 0,
    cleanupSucceeded: false,
  };
}

/**
 * Aggregate a batch of synthetic DATEX-like events with optional precomputed resolutions
 * or live resolve against a TMC snapshot.
 *
 * @param {object[]} datexEvents
 * @param {{
 *   snapshot?: object,
 *   previousStore?: Map|object,
 *   workDir?: string,
 *   nowIso?: string,
 *   spatialFilter?: string,
 *   temporalFilter?: string,
 *   filterOpts?: object,
 *   maxBatch?: number,
 *   maxHeapBytes?: number,
 *   forceStagingFailure?: boolean,
 *   forceCleanupFailure?: boolean,
 * }} [opts]
 */
export async function aggregateTrafficEvents(datexEvents, opts = {}) {
  const t0 = Date.now();
  const metrics = emptyMetrics();
  const batchId = opts.batchId || crypto.randomBytes(8).toString("hex");
  const workDir = opts.workDir || path.join(os.tmpdir(), "iu-agg-" + batchId);
  let stagingRoot = null;
  let cleanupSucceeded = false;

  const fail = (code) => {
    if (stagingRoot) {
      try {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      } catch (_) {}
    }
    metrics.durationMs = Date.now() - t0;
    metrics.cleanupSucceeded = cleanupSucceeded;
    return {
      ok: false,
      rejectCode: code,
      metrics,
      batchId,
      featureFlags: { ...AGGREGATION_FEATURE_FLAGS },
      publicationEnabled: false,
      trafficCardsCreated: false,
    };
  };

  try {
    if (opts.forceStagingFailure === true) return fail(AGGREGATION_ERROR.AGG_STAGING_FAILED);

    const list = Array.isArray(datexEvents) ? datexEvents : null;
    if (!list) return fail(AGGREGATION_ERROR.AGG_INPUT_INVALID);
    metrics.inputCount = list.length;
    if (list.length > (opts.maxBatch || 10_000)) return fail(AGGREGATION_ERROR.AGG_BATCH_TOO_LARGE);
    if (opts.maxHeapBytes != null && process.memoryUsage().heapUsed > opts.maxHeapBytes) {
      return fail(AGGREGATION_ERROR.AGG_MEMORY_LIMIT);
    }

    fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
    stagingRoot = path.join(workDir, "staging-" + batchId);
    fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });

    const built = [];
    const buildRejected = [];
    const nowIso = opts.nowIso || new Date().toISOString();

    for (const raw of list) {
      let resolutionResults = raw.resolutionResults;
      let multiKind = raw.multiKind;
      if ((!resolutionResults || !resolutionResults.length) && opts.snapshot && raw.tmcRefs) {
        const resolved = resolveDatexEventLocations(
          {
            eventId: raw.eventId || raw.situationId || raw.id,
            tmcRefs: raw.tmcRefs,
            coordinates: raw.coordinates,
            roadNumber: raw.roadNumber,
            kilometer: raw.kilometer,
            publishedAt: raw.publishedAt,
            updatedAt: raw.updatedAt,
            downloadedAt: raw.downloadedAt,
            measuredAt: raw.measuredAt,
            languagesFifthField: raw.languagesFifthField,
          },
          opts.snapshot,
          opts.resolverOpts || {}
        );
        resolutionResults = resolved.results;
        multiKind = resolved.multiKind;
      }

      const freshness = computeFreshness(
        {
          datexUpdatedAt: raw.updatedAt,
          datexDownloadedAt: raw.downloadedAt,
          datexPublishedAt: raw.publishedAt,
        },
        Date.parse(nowIso),
        opts.freshnessLimits
      );

      const builtOne = buildNormalizedTrafficEvent(
        {
          eventId: raw.eventId || raw.situationId || raw.id,
          version: raw.version,
          category: raw.category || raw.eventType,
          severity: raw.severity,
          status: raw.status,
          titleSafe: raw.titleSafe,
          summarySafe: raw.summarySafe,
          summaryFull: raw.summaryFull,
          validFrom: raw.validFrom,
          validTo: raw.validTo,
          kilometer: raw.kilometer,
          quarantine: raw.quarantine,
          quarantineReason: raw.quarantineReason,
          resolutionResults,
          multiKind,
          freshness,
          lastMeaningfulChangeAt: raw.lastMeaningfulChangeAt || raw.updatedAt,
          sourceTimestamps: {
            datexPublishedAt: raw.publishedAt || null,
            datexUpdatedAt: raw.updatedAt || null,
            datexMeasuredAt: raw.measuredAt || null,
            datexDownloadedAt: raw.downloadedAt || null,
          },
        },
        { nowIso }
      );

      if (!builtOne.ok) {
        metrics.buildRejectedCount += 1;
        buildRejected.push({ rejectCode: builtOne.rejectCode, eventIdHash: builtOne.eventIdHash || null });
        continue;
      }
      built.push(builtOne.event);
      metrics.builtCount += 1;
    }

    const deduped = deduplicateNormalizedEvents(built);
    metrics.uniqueCount = deduped.metrics.uniqueCount;
    metrics.duplicateCollapsed = deduped.metrics.duplicateCollapsed;
    metrics.conflictRejected = deduped.metrics.conflictRejected;

    const prev = opts.previousStore || new Map();
    const batchDiff = diffEventBatch(prev, deduped.events);
    const diffsByHash = Object.create(null);
    for (const d of batchDiff.diffs) {
      diffsByHash[d.eventIdHash] = d;
    }

    // Apply lastMeaningfulChangeAt from diff when meaningful
    const eventsWithDiffTime = deduped.events.map((ev) => {
      const d = diffsByHash[ev.eventIdHash];
      if (d && d.meaningful && d.lastMeaningfulChangeAt) {
        return {
          ...ev,
          fields: {
            ...ev.fields,
            lastMeaningfulChangeAt: {
              ...ev.fields.lastMeaningfulChangeAt,
              value: d.lastMeaningfulChangeAt,
            },
          },
        };
      }
      return ev;
    });

    const feed = buildTrafficFeedModel(eventsWithDiffTime, diffsByHash, { nowIso });
    metrics.feedEntryCount = feed.entryCount;

    const filtered = applyTrafficFilters(eventsWithDiffTime, {
      spatialFilter: opts.spatialFilter,
      temporalFilter: opts.temporalFilter,
      nowIso,
      ...(opts.filterOpts || {}),
    });
    metrics.filterMatchedCount = filtered.matchedCount;

    const projections = [];
    for (const ev of eventsWithDiffTime) {
      const p = buildPublicationProjection(ev);
      if (p.ok) {
        projections.push(p.projection);
        metrics.publicationProjectionCount += 1;
      }
      const attempt = attemptPublication(p.projection);
      if (!attempt.ok) metrics.publicationAttemptsBlocked += 1;
    }

    const stagingPayload = Buffer.from(
      JSON.stringify({
        schema: "iu-traffic-aggregation-batch-v1",
        batchId,
        aggregatorVersion: AGGREGATOR_VERSION,
        uniqueCount: metrics.uniqueCount,
        feedEntryCount: metrics.feedEntryCount,
        publicationEnabled: false,
        // no raw location codes / names
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(stagingRoot, "batch.json"), stagingPayload, { mode: 0o600 });

    if (opts.forceCleanupFailure === true) {
      metrics.cleanupSucceeded = false;
      metrics.durationMs = Date.now() - t0;
      return {
        ok: false,
        rejectCode: AGGREGATION_ERROR.AGG_CLEANUP_FAILED,
        metrics,
        batchId,
        events: eventsWithDiffTime,
        feed,
        filtered,
        diffs: batchDiff.diffs,
        projections,
        featureFlags: { ...AGGREGATION_FEATURE_FLAGS },
        publicationEnabled: false,
        trafficCardsCreated: false,
      };
    }

    try {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      cleanupSucceeded = true;
      stagingRoot = null;
    } catch (_) {
      cleanupSucceeded = false;
    }

    metrics.cleanupSucceeded = cleanupSucceeded;
    metrics.durationMs = Date.now() - t0;
    metrics.peakHeapBytes = process.memoryUsage().heapUsed;

    return {
      ok: true,
      batchId,
      aggregatorVersion: AGGREGATOR_VERSION,
      metrics,
      events: eventsWithDiffTime,
      buildRejected,
      dedupeRejected: deduped.rejected,
      diffs: batchDiff.diffs,
      feed,
      filtered,
      projections,
      featureFlags: { ...AGGREGATION_FEATURE_FLAGS },
      publicationEnabled: false,
      trafficCardsCreated: false,
      publicApiEnabled: false,
    };
  } catch (_) {
    return fail(AGGREGATION_ERROR.AGG_INTERNAL_SAFE_FAILURE);
  } finally {
    if (stagingRoot) {
      try {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}
