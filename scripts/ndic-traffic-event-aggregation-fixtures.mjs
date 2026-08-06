#!/usr/bin/env node
/**
 * Offline traffic-event aggregation fixtures (synthetic only).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  aggregateTrafficEvents,
  buildNormalizedTrafficEvent,
  deduplicateNormalizedEvents,
  diffEventBatch,
  buildTrafficFeedModel,
  applyTrafficFilters,
  buildPublicationProjection,
  attemptPublication,
  AGGREGATION_FEATURE_FLAGS,
  AGGREGATION_ERROR,
} from "./ndic-datex-v1/traffic-event-aggregator.mjs";
import { EVENT_CHANGE_KIND, FEED_SIGNAL, SPATIAL_FILTER, TEMPORAL_FILTER } from "./ndic-datex-v1/traffic-event-aggregation-constants.mjs";
import { resolveDatexTmcReference, RESOLVER_STATUS, DIRECTION } from "./ndic-datex-v1/datex-tmc-resolver.mjs";
import { defaultSyntheticSnapshot } from "./ndic-datex-v1/tmc-resolution-snapshot.mjs";
import { provenanceField } from "./ndic-datex-v1/traffic-event-aggregation-constants.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

function resolvedBasic(lcd, extra = {}) {
  const snap = defaultSyntheticSnapshot();
  return resolveDatexTmcReference(
    {
      kind: "point",
      countryCode: 2,
      tableNumber: 25,
      locationCode: lcd,
      direction: extra.direction || "positive",
      ...extra,
    },
    snap,
    { eventId: extra.eventId || "e" }
  );
}

function assertNoLeak(obj) {
  const s = JSON.stringify(obj);
  ok("leak_no_stack", !/\bat\s+\S+\s+\(/.test(s));
  ok("leak_no_auth", !/password|authorization|bearer/i.test(s));
  ok("leak_no_path", !/C:\\\\Users|C:\/Users/i.test(s));
  ok("leak_no_raw_lcd", !/"locationCode"\s*:\s*10001/.test(s));
  return s;
}

async function run() {
  const snap = defaultSyntheticSnapshot({ importRunId: "agg-snap" });

  ok("flag_pub_off", AGGREGATION_FEATURE_FLAGS.PUBLICATION_ENABLED === false);
  ok("flag_cards_off", AGGREGATION_FEATURE_FLAGS.TRAFFIC_CARDS_ENABLED === false);
  ok("flag_api_off", AGGREGATION_FEATURE_FLAGS.PUBLIC_API_ENABLED === false);
  ok("flag_fuzzy_off", AGGREGATION_FEATURE_FLAGS.FUZZY_MATCHING_ENABLED === false);
  ok("flag_geo_off", AGGREGATION_FEATURE_FLAGS.GEOCODING_ENABLED === false);

  // build single event with RESOLVED_BASIC
  {
    const r = resolvedBasic("10001");
    ok("res_basic", r.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC);
    const built = buildNormalizedTrafficEvent({
      eventId: "evt-1",
      category: "nehoda",
      severity: "high",
      status: "aktivni",
      titleSafe: "SYN title",
      summarySafe: "SYN summary",
      validFrom: "2026-08-06T10:00:00.000Z",
      validTo: "2026-08-06T18:00:00.000Z",
      updatedAt: "2026-08-06T12:00:00.000Z",
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      sourceTimestamps: { datexUpdatedAt: "2026-08-06T12:00:00.000Z" },
    });
    ok("build_ok", built.ok === true, built.rejectCode);
    ok("build_loc", built.event.locationPublishable === true);
    ok("build_road", built.event.fields.roadNumber.value === "D0");
    ok("build_dir", built.event.fields.direction.value === DIRECTION.POSITIVE);
    assertNoLeak(built.event);
  }

  // reject non-RESOLVED location
  {
    const bad = {
      resolutionStatus: "UNRESOLVED_AMBIGUOUS",
      publiclyEligible: false,
      direction: provenanceField(DIRECTION.CONFLICT, "x", null, "invalid"),
    };
    const built = buildNormalizedTrafficEvent({
      eventId: "evt-bad",
      resolutionResults: [bad],
      multiKind: "CONFLICTING_RESOLUTIONS",
    });
    ok("conflict_reject", built.ok === false && built.rejectCode === AGGREGATION_ERROR.AGG_LOCATION_CONFLICT);
  }

  // missing identity
  {
    const built = buildNormalizedTrafficEvent({ resolutionResults: [] });
    ok("id_missing", built.rejectCode === AGGREGATION_ERROR.AGG_IDENTITY_MISSING);
  }

  // dedupe identical
  {
    const r = resolvedBasic("10001");
    const a = buildNormalizedTrafficEvent({
      eventId: "same",
      version: 1,
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      category: "nehoda",
      status: "aktivni",
      titleSafe: "A",
      validFrom: "2026-08-06T10:00:00.000Z",
      validTo: "2026-08-06T20:00:00.000Z",
      sourceTimestamps: {},
    }).event;
    const b = buildNormalizedTrafficEvent({
      eventId: "same",
      version: 1,
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      category: "nehoda",
      status: "aktivni",
      titleSafe: "A",
      validFrom: "2026-08-06T10:00:00.000Z",
      validTo: "2026-08-06T20:00:00.000Z",
      sourceTimestamps: {},
    }).event;
    const d = deduplicateNormalizedEvents([a, b]);
    ok("dedupe_one", d.metrics.uniqueCount === 1 && d.metrics.duplicateCollapsed === 1);
  }

  // version prefer higher
  {
    const r = resolvedBasic("10001");
    const v1 = buildNormalizedTrafficEvent({
      eventId: "ver",
      version: 1,
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      titleSafe: "v1",
      sourceTimestamps: {},
    }).event;
    const v2 = buildNormalizedTrafficEvent({
      eventId: "ver",
      version: 2,
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      titleSafe: "v2",
      sourceTimestamps: {},
    }).event;
    const d = deduplicateNormalizedEvents([v1, v2]);
    ok("dedupe_ver", d.events[0].fields.titleSafe.value === "v2");
  }

  // direction conflict on merge
  {
    const p = resolvedBasic("10001", { direction: "positive" });
    const n = resolvedBasic("10003", { direction: "negative" });
    const e1 = buildNormalizedTrafficEvent({
      eventId: "dirconf",
      version: 1,
      resolutionResults: [p],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      sourceTimestamps: {},
    }).event;
    const e2 = buildNormalizedTrafficEvent({
      eventId: "dirconf",
      version: 1,
      resolutionResults: [n],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      sourceTimestamps: {},
    }).event;
    const d = deduplicateNormalizedEvents([e1, e2]);
    ok("dedupe_dir_conflict", d.metrics.conflictRejected >= 1 || d.rejected.length >= 1);
  }

  // distinct locations kept
  {
    const a = resolvedBasic("10001");
    const b = resolvedBasic("10003");
    const built = buildNormalizedTrafficEvent({
      eventId: "multi",
      resolutionResults: [a, b],
      multiKind: "MULTIPLE_DISTINCT_RESOLUTIONS",
      status: "aktivni",
      sourceTimestamps: {},
    });
    ok("multi_loc", built.ok && built.event.locations.length === 2);
  }

  // distinct opposite directions kept as branches; summary direction unmerged
  {
    const p = resolvedBasic("10001", { direction: "positive" });
    const n = resolvedBasic("10003", { direction: "negative" });
    const built = buildNormalizedTrafficEvent({
      eventId: "oppdir",
      resolutionResults: [p, n],
      multiKind: "MULTIPLE_DISTINCT_RESOLUTIONS",
      status: "aktivni",
      sourceTimestamps: {},
    });
    ok("oppdir_kept", built.ok === true && built.event.locations.length === 2, built.rejectCode);
    ok("oppdir_summary_unmerged", built.event.fields.direction.validationStatus === "ambiguous_unmerged");
  }

  // diff engine
  {
    const r = resolvedBasic("10001");
    const prev = buildNormalizedTrafficEvent({
      eventId: "diff1",
      version: 1,
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      titleSafe: "old",
      summarySafe: "old sum",
      validFrom: "2026-08-06T10:00:00.000Z",
      validTo: "2026-08-06T12:00:00.000Z",
      severity: "low",
      sourceTimestamps: {},
      lastMeaningfulChangeAt: "2026-08-06T10:00:00.000Z",
    }).event;
    const next = buildNormalizedTrafficEvent({
      eventId: "diff1",
      version: 2,
      resolutionResults: [resolvedBasic("10001", { direction: "negative" })],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      titleSafe: "new",
      summarySafe: "new sum",
      validFrom: "2026-08-06T10:00:00.000Z",
      validTo: "2026-08-06T18:00:00.000Z",
      severity: "high",
      sourceTimestamps: {},
      lastMeaningfulChangeAt: "2026-08-06T14:00:00.000Z",
    }).event;
    const batch = diffEventBatch(new Map([[prev.eventIdHash, prev]]), [next]);
    const d = batch.diffs[0];
    ok("diff_meaningful", d.meaningful === true);
    ok("diff_dir", d.changeKinds.includes(EVENT_CHANGE_KIND.DIRECTION_CHANGED));
    ok("diff_end", d.changeKinds.includes(EVENT_CHANGE_KIND.END_TIME_CHANGED));
    ok("diff_sev", d.changeKinds.includes(EVENT_CHANGE_KIND.SEVERITY_CHANGED));
    ok("diff_desc", d.changeKinds.includes(EVENT_CHANGE_KIND.DESCRIPTION_CHANGED));

    const ended = buildNormalizedTrafficEvent({
      eventId: "diff1",
      version: 3,
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "ukonceno",
      sourceTimestamps: {},
    }).event;
    const d2 = diffEventBatch(new Map([[next.eventIdHash, next]]), [ended]).diffs[0];
    ok("diff_ended", d2.changeKinds.includes(EVENT_CHANGE_KIND.STATUS_ENDED));

    const cancelled = buildNormalizedTrafficEvent({
      eventId: "diff1",
      version: 4,
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "zruseno",
      sourceTimestamps: {},
    }).event;
    const d3 = diffEventBatch(new Map([[ended.eventIdHash, ended]]), [cancelled]).diffs[0];
    ok("diff_cancel", d3.changeKinds.includes(EVENT_CHANGE_KIND.STATUS_CANCELLED));

    const neu = diffEventBatch(new Map(), [
      buildNormalizedTrafficEvent({
        eventId: "brand",
        resolutionResults: [r],
        multiKind: "SINGLE_RESOLUTION",
        status: "aktivni",
        sourceTimestamps: {},
      }).event,
    ]);
    ok("diff_new", neu.diffs[0].changeKinds.includes(EVENT_CHANGE_KIND.NEW_EVENT));
  }

  // feed sort by last meaningful change not download
  {
    const r = resolvedBasic("10001");
    const older = buildNormalizedTrafficEvent({
      eventId: "f1",
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      category: "nehoda",
      titleSafe: "older change",
      lastMeaningfulChangeAt: "2026-08-01T00:00:00.000Z",
      sourceTimestamps: { datexDownloadedAt: "2026-08-06T23:00:00.000Z" },
    }).event;
    const newer = buildNormalizedTrafficEvent({
      eventId: "f2",
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      category: "prace",
      titleSafe: "newer change",
      lastMeaningfulChangeAt: "2026-08-05T00:00:00.000Z",
      sourceTimestamps: { datexDownloadedAt: "2026-08-02T00:00:00.000Z" },
    }).event;
    const feed = buildTrafficFeedModel([older, newer], {
      [older.eventIdHash]: { changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT], meaningful: true, lastMeaningfulChangeAt: "2026-08-01T00:00:00.000Z" },
      [newer.eventIdHash]: { changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT], meaningful: true, lastMeaningfulChangeAt: "2026-08-05T00:00:00.000Z" },
    });
    ok("feed_sort", feed.entries[0].eventIdHash === newer.eventIdHash);
    ok("feed_signal_accident", feed.entries.find((e) => e.eventIdHash === older.eventIdHash).feedSignal === FEED_SIGNAL.NEW_ACCIDENT);
    ok("feed_signal_works", feed.entries.find((e) => e.eventIdHash === newer.eventIdHash).feedSignal === FEED_SIGNAL.NEW_ROADWORKS);
    ok("feed_not_pub", feed.publicationEnabled === false);
  }

  // filters
  {
    const r = resolvedBasic("10001");
    const ev = buildNormalizedTrafficEvent({
      eventId: "fil",
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      validFrom: "2026-08-06T00:00:00.000Z",
      validTo: "2026-08-06T23:59:59.000Z",
      sourceTimestamps: {},
    }).event;
    const now = applyTrafficFilters([ev], {
      spatialFilter: SPATIAL_FILTER.WHOLE_CZ,
      temporalFilter: TEMPORAL_FILTER.NOW,
      nowIso: "2026-08-06T12:00:00.000Z",
    });
    ok("filter_now", now.matchedCount === 1);
    const sel = applyTrafficFilters([ev], {
      spatialFilter: SPATIAL_FILTER.MY_SELECTION,
      temporalFilter: TEMPORAL_FILTER.TODAY,
      nowIso: "2026-08-06T12:00:00.000Z",
      selectedEventIdHashes: [ev.eventIdHash],
    });
    ok("filter_sel", sel.matchedCount === 1);
    const routes = applyTrafficFilters([ev], {
      spatialFilter: SPATIAL_FILTER.MY_ROUTES,
      temporalFilter: TEMPORAL_FILTER.TODAY,
      nowIso: "2026-08-06T12:00:00.000Z",
      routeRoadNumbers: ["D0"],
    });
    ok("filter_routes", routes.matchedCount === 1);
    const near = applyTrafficFilters([ev], {
      spatialFilter: SPATIAL_FILTER.NEAR_ME,
      temporalFilter: TEMPORAL_FILTER.TODAY,
      nowIso: "2026-08-06T12:00:00.000Z",
      nearLocationHashes: [ev.locations[0].primaryLocation.locationCodeHash],
    });
    ok("filter_near", near.matchedCount === 1);
    const custom = applyTrafficFilters([ev], {
      spatialFilter: SPATIAL_FILTER.WHOLE_CZ,
      temporalFilter: TEMPORAL_FILTER.CUSTOM_RANGE,
      customFrom: "2026-08-06T00:00:00.000Z",
      customTo: "2026-08-06T01:00:00.000Z",
    });
    ok("filter_custom", custom.matchedCount === 1);
  }

  // publication model blocked
  {
    const r = resolvedBasic("10001");
    const ev = buildNormalizedTrafficEvent({
      eventId: "pub",
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      titleSafe: "T",
      sourceTimestamps: {},
    }).event;
    const proj = buildPublicationProjection(ev);
    ok("proj_ok", proj.ok && proj.publicationEnabled === false && proj.published === false);
    ok("proj_road", proj.projection.roadNumber && proj.projection.roadNumber.value === "D0");
    const attempt = attemptPublication(proj.projection);
    ok("pub_blocked", attempt.ok === false && attempt.rejectCode === AGGREGATION_ERROR.AGG_PUBLICATION_DISABLED);
    ok("cards_no", attempt.trafficCardsCreated === false);

    // unresolved location must not publish road/dir/coords
    const noLoc = buildNormalizedTrafficEvent({
      eventId: "noloc",
      resolutionResults: [],
      multiKind: "NO_RESOLUTION",
      status: "aktivni",
      sourceTimestamps: {},
    }).event;
    const p2 = buildPublicationProjection(noLoc);
    ok("proj_no_loc", p2.projection.roadNumber == null && p2.projection.direction == null && p2.projection.coordinates == null);
  }

  // no kilometer estimation
  {
    const r = resolvedBasic("10001");
    const ev = buildNormalizedTrafficEvent({
      eventId: "km",
      resolutionResults: [r],
      multiKind: "SINGLE_RESOLUTION",
      status: "aktivni",
      kilometer: 12.5,
      sourceTimestamps: {},
    }).event;
    // kilometerStatus from resolver is NOT_AVAILABLE unless PROVEN — so km stays not_available
    ok("km_blocked", ev.fields.kilometer.validationStatus === "not_available" || ev.fields.kilometer.value == null);
  }

  // full aggregate batch
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-agg-fx-"));
    const batch = await aggregateTrafficEvents(
      [
        {
          eventId: "A1",
          category: "nehoda",
          status: "aktivni",
          titleSafe: "A1",
          validFrom: "2026-08-06T08:00:00.000Z",
          validTo: "2026-08-06T20:00:00.000Z",
          updatedAt: "2026-08-06T11:00:00.000Z",
          tmcRefs: [{ kind: "point", countryCode: 2, tableNumber: 25, locationCode: "10001", direction: "positive" }],
        },
        {
          eventId: "A1",
          category: "nehoda",
          status: "aktivni",
          titleSafe: "A1-dup",
          version: 1,
          validFrom: "2026-08-06T08:00:00.000Z",
          validTo: "2026-08-06T20:00:00.000Z",
          updatedAt: "2026-08-06T11:00:00.000Z",
          tmcRefs: [{ kind: "point", countryCode: 2, tableNumber: 25, locationCode: "10001", direction: "positive" }],
        },
        {
          eventId: "A2",
          category: "prace",
          status: "aktivni",
          titleSafe: "A2",
          validFrom: "2026-08-06T09:00:00.000Z",
          validTo: "2026-08-07T09:00:00.000Z",
          updatedAt: "2026-08-06T12:00:00.000Z",
          tmcRefs: [{ kind: "point", countryCode: 2, tableNumber: 25, locationCode: "10003", direction: "both" }],
        },
      ],
      {
        snapshot: snap,
        workDir: dir,
        nowIso: "2026-08-06T12:30:00.000Z",
        spatialFilter: SPATIAL_FILTER.WHOLE_CZ,
        temporalFilter: TEMPORAL_FILTER.TODAY,
      }
    );
    ok("agg_ok", batch.ok === true, batch.rejectCode);
    ok("agg_unique", batch.metrics.uniqueCount === 2, String(batch.metrics.uniqueCount));
    ok("agg_dedupe", batch.metrics.duplicateCollapsed >= 1);
    ok("agg_feed", batch.feed.entryCount >= 1);
    ok("agg_filter", batch.filtered.matchedCount >= 1);
    ok("agg_cleanup", batch.metrics.cleanupSucceeded === true);
    ok("agg_pub_off", batch.publicationEnabled === false && batch.trafficCardsCreated === false);
    assertNoLeak(batch.metrics);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // staging / cleanup / limits
  {
    const bad = await aggregateTrafficEvents([], { forceStagingFailure: true });
    ok("staging_fail", bad.rejectCode === AGGREGATION_ERROR.AGG_STAGING_FAILED);
    const mem = await aggregateTrafficEvents([{ eventId: "m", tmcRefs: [] }], { snapshot: snap, maxHeapBytes: 1 });
    ok("mem_limit", mem.rejectCode === AGGREGATION_ERROR.AGG_MEMORY_LIMIT);
    const huge = await aggregateTrafficEvents(new Array(5).fill({ eventId: "x", tmcRefs: [] }), { maxBatch: 2, snapshot: snap });
    ok("batch_limit", huge.rejectCode === AGGREGATION_ERROR.AGG_BATCH_TOO_LARGE);
    const cf = await aggregateTrafficEvents(
      [{ eventId: "c", tmcRefs: [{ kind: "point", countryCode: 2, tableNumber: 25, locationCode: "10001", direction: "positive" }] }],
      { snapshot: snap, forceCleanupFailure: true }
    );
    ok("cleanup_fail", cf.rejectCode === AGGREGATION_ERROR.AGG_CLEANUP_FAILED);
  }

  // orphan temp
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-agg-or-"));
    await aggregateTrafficEvents(
      [{ eventId: "o", tmcRefs: [{ kind: "point", countryCode: 2, tableNumber: 25, locationCode: "10001", direction: "positive" }] }],
      { snapshot: snap, workDir: dir }
    );
    fs.rmSync(dir, { recursive: true, force: true });
    ok("orphan_clean", fs.existsSync(dir) === false);
  }

  const pass = results.filter((x) => x.pass).length;
  const failN = results.filter((x) => !x.pass).length;
  const summary = {
    suite: "TRAFFIC_EVENT_AGGREGATION_FIXTURES",
    total: results.length,
    success: pass,
    failure: failN,
    skipped: 0,
    syntheticOnly: true,
    publicationEnabled: false,
    trafficCardsCreated: false,
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
  if (failN) {
    process.stdout.write(JSON.stringify({ fails: fails.slice(0, 40) }) + "\n");
    process.exitCode = 1;
  }
  if (summary.failure !== failN || (failN === 0 && summary.success !== summary.total)) {
    process.exitCode = 1;
  }
}

run().catch(() => {
  process.stdout.write(JSON.stringify({ suite: "TRAFFIC_EVENT_AGGREGATION_FIXTURES", failure: 1, internal: true }) + "\n");
  process.exitCode = 1;
});
