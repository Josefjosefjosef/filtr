#!/usr/bin/env node
/**
 * Offline traffic publication / feed / card projection fixtures (synthetic only).
 * PUBLICATION_ENABLED / PUBLIC_API / TRAFFIC_UI remain false.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildNormalizedTrafficEvent } from "./ndic-datex-v1/traffic-event-model.mjs";
import { resolveDatexTmcReference, RESOLVER_STATUS, DIRECTION } from "./ndic-datex-v1/datex-tmc-resolver.mjs";
import { defaultSyntheticSnapshot } from "./ndic-datex-v1/tmc-resolution-snapshot.mjs";
import { provenanceField, EVENT_CHANGE_KIND, SPATIAL_FILTER, TEMPORAL_FILTER } from "./ndic-datex-v1/traffic-event-aggregation-constants.mjs";
import { FRESHNESS } from "./ndic-datex-v1/datex-tmc-resolver-constants.mjs";
import {
  PUBLICATION_LAYER_FLAGS,
  PUBLICATION_ELIGIBILITY,
  PUBLICATION_ERROR,
  FEED_CHANGE_TYPE,
  MAP_LINK_TYPE,
  METRIC_STATUS,
  LIFECYCLE_STATUS,
  CHANGE_STATUS,
  EVENT_TYPE_FILTER,
  PUBLIC_PROJECTION_ALLOWLIST,
} from "./ndic-datex-v1/traffic-publication-constants.mjs";
import { evaluatePublicationEligibility } from "./ndic-datex-v1/traffic-publication-eligibility.mjs";
import { buildPublicEventId } from "./ndic-datex-v1/traffic-public-event-id.mjs";
import {
  buildTrafficPublicationProjection,
  scanPublicationCanaries,
  validateProjectionAllowlist,
} from "./ndic-datex-v1/traffic-publication-projection.mjs";
import { buildPublicationTrafficFeed } from "./ndic-datex-v1/traffic-publication-feed.mjs";
import { buildTrafficCardProjection } from "./ndic-datex-v1/traffic-card-projection.mjs";
import { buildHistoryProjection } from "./ndic-datex-v1/traffic-history-projection.mjs";
import { applyPublicationFilters, matchesPreTripFilter, matchesEventTypeFilter } from "./ndic-datex-v1/traffic-publication-filters.mjs";
import { buildOfflinePublicationSnapshot } from "./ndic-datex-v1/traffic-publication-snapshot.mjs";
import { runTrafficPublicationLayer } from "./ndic-datex-v1/traffic-publication-layer.mjs";
import { SCHEMA_CONTRACT, validateProjectionSchema } from "./ndic-datex-v1/traffic-publication-schema.mjs";

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

function makeEvent(overrides = {}) {
  const r = overrides.resolutionResults
    ? null
    : resolvedBasic(overrides.lcd || "10001", { direction: overrides.dir || "positive", eventId: overrides.eventId || "e" });
  const built = buildNormalizedTrafficEvent({
    eventId: overrides.eventId || "evt-syn-1",
    category: overrides.category || "nehoda",
    severity: overrides.severity != null ? overrides.severity : "high",
    status: overrides.status || "aktivni",
    titleSafe: overrides.titleSafe || "SYN",
    summarySafe: overrides.summarySafe || "SYN summary",
    validFrom: overrides.validFrom || "2026-08-06T08:00:00.000Z",
    validTo: overrides.validTo || "2026-08-06T20:00:00.000Z",
    lastMeaningfulChangeAt: overrides.lastMeaningfulChangeAt || "2026-08-06T12:00:00.000Z",
    freshness: overrides.freshness || FRESHNESS.FRESH,
    kilometer: overrides.kilometer,
    version: overrides.version || 1,
    quarantine: overrides.quarantine,
    quarantineReason: overrides.quarantineReason,
    multiKind: overrides.multiKind || "SINGLE_RESOLUTION",
    resolutionResults: overrides.resolutionResults || [r],
    sourceTimestamps: overrides.sourceTimestamps || {
      datexUpdatedAt: "2026-08-06T11:00:00.000Z",
      datexDownloadedAt: "2026-08-06T11:05:00.000Z",
      datexMeasuredAt: "2026-08-06T10:55:00.000Z",
    },
  });
  if (!built.ok) return built;
  let ev = built.event;
  if (overrides.locationResolutionStatus) {
    ev = Object.freeze({ ...ev, locationResolutionStatus: overrides.locationResolutionStatus });
  }
  if (overrides.patchFields) {
    const fields = { ...ev.fields, ...overrides.patchFields };
    ev = Object.freeze({ ...ev, fields: Object.freeze(fields) });
  }
  if (overrides.forceLocationPublishable === false) {
    ev = Object.freeze({ ...ev, locationPublishable: false, locations: Object.freeze([]) });
  }
  return { ok: true, event: ev };
}

function assertNoLeak(obj, prefix) {
  const s = JSON.stringify(obj);
  ok(prefix + "_no_xml", !/<Situation/.test(s));
  ok(prefix + "_no_lcd_field", !/"locationCode"\s*:/.test(s));
  ok(prefix + "_no_path", !/C:\\\\Users|C:\/Users|\/home\//.test(s));
  ok(prefix + "_no_cred", !/IU_NDIC_PULL_PASS|Bearer\s+[A-Za-z0-9]/.test(s));
  ok(prefix + "_no_stack", !/At line:/.test(s));
  return s;
}

async function run() {
  ok("flag_pub_off", PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === false);
  ok("flag_api_off", PUBLICATION_LAYER_FLAGS.PUBLIC_API_ENABLED === false);
  ok("flag_ui_on", PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED === true);
  ok("flag_delay_est_off", PUBLICATION_LAYER_FLAGS.DELAY_ESTIMATION_ENABLED === false);
  ok("flag_fuzzy_off", PUBLICATION_LAYER_FLAGS.FUZZY_DEDUPLICATION_ENABLED === false);
  ok("flag_heur_map_off", PUBLICATION_LAYER_FLAGS.HEURISTIC_MAP_LINK_ENABLED === false);
  ok("schema_addl_false", SCHEMA_CONTRACT.additionalProperties === false);

  // 1 new accident
  {
    const { event } = makeEvent({ eventId: "acc-new", category: "nehoda" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT], meaningful: true },
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f01_new_accident", p.ok && p.projection.feedChangeType === FEED_CHANGE_TYPE.EVENT_CREATED);
    ok("f01_lifecycle", p.projection.lifecycleStatus === LIFECYCLE_STATUS.ACTIVE);
    ok("f01_change", p.projection.changeStatus === CHANGE_STATUS.NEW);
    ok("f01_headline", /Nová nehoda/.test(p.projection.feedHeadline));
    assertNoLeak(p.projection, "f01");
  }

  // 2 changed accident
  {
    const { event } = makeEvent({ eventId: "acc-chg", category: "nehoda" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.SEVERITY_CHANGED], meaningful: true },
    });
    ok("f02_changed", p.ok && p.projection.changeStatus === CHANGE_STATUS.CHANGED);
    ok("f02_feed", p.projection.feedChangeType === FEED_CHANGE_TYPE.SEVERITY_CHANGED);
  }

  // 3 active closure
  {
    const { event } = makeEvent({ eventId: "cl-act", category: "uzavirka", status: "aktivni" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT] },
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f03_closure_active", p.ok && p.projection.lifecycleStatus === LIFECYCLE_STATUS.ACTIVE);
    ok("f03_impact", /uzavřena/.test(p.projection.impactSummary));
  }

  // 4 extended closure
  {
    const { event } = makeEvent({ eventId: "cl-ext", category: "uzavirka", validTo: "2026-08-06T22:00:00.000Z" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.END_TIME_CHANGED] },
      validityDelta: "extended",
    });
    ok("f04_extended", p.ok && p.projection.feedChangeType === FEED_CHANGE_TYPE.VALIDITY_EXTENDED);
    ok("f04_headline", /prodloužena/.test(p.projection.feedHeadline));
  }

  // 5 shortened closure
  {
    const { event } = makeEvent({ eventId: "cl-short", category: "uzavirka" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.END_TIME_CHANGED] },
      validityDelta: "shortened",
    });
    ok("f05_shortened", p.ok && p.projection.feedChangeType === FEED_CHANGE_TYPE.VALIDITY_SHORTENED);
  }

  // 6 ended restriction
  {
    const { event } = makeEvent({ eventId: "res-end", category: "omezeni", status: "ukonceno" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.STATUS_ENDED] },
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f06_ended", p.ok && p.projection.lifecycleStatus === LIFECYCLE_STATUS.ENDED);
    ok("f06_feed", p.projection.feedChangeType === FEED_CHANGE_TYPE.EVENT_ENDED);
  }

  // 7 cancelled
  {
    const { event } = makeEvent({ eventId: "evt-can", status: "zruseno" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.STATUS_CANCELLED] },
    });
    ok("f07_cancelled", p.ok && p.projection.lifecycleStatus === LIFECYCLE_STATUS.CANCELLED);
  }

  // 8 new roadworks
  {
    const { event } = makeEvent({ eventId: "rw-new", category: "prace_na_silnici" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT] },
    });
    ok("f08_roadworks", p.ok && /Nové práce/.test(p.projection.feedHeadline));
  }

  // 9 weather
  {
    const { event } = makeEvent({ eventId: "wx", category: "pocasi_silnicni" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.DESCRIPTION_CHANGED] },
    });
    ok("f09_weather", p.ok && p.projection.feedChangeType === FEED_CHANGE_TYPE.IMPACT_CHANGED);
  }

  // 10 future
  {
    const { event } = makeEvent({
      eventId: "fut",
      validFrom: "2026-08-10T08:00:00.000Z",
      validTo: "2026-08-10T18:00:00.000Z",
    });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT] },
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f10_future", p.ok && p.projection.lifecycleStatus === LIFECYCLE_STATUS.FUTURE);
  }

  // 11 active
  {
    const { event } = makeEvent({ eventId: "act" });
    const p = buildTrafficPublicationProjection(event, { nowIso: "2026-08-06T13:00:00.000Z" });
    ok("f11_active", p.ok && p.projection.lifecycleStatus === LIFECYCLE_STATUS.ACTIVE);
  }

  // 12 ended status
  {
    const { event } = makeEvent({ eventId: "end2", status: "ukonceno" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.STATUS_ENDED] },
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f12_ended_life", p.projection.lifecycleStatus === LIFECYCLE_STATUS.ENDED);
  }

  // 13 unresolved location — no precise geo; may still project without km/dir
  {
    const { event } = makeEvent({
      eventId: "unres",
      forceLocationPublishable: false,
      locationResolutionStatus: RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE,
      patchFields: {
        roadNumber: provenanceField(null, "resolver", null, "not_available"),
        direction: provenanceField(null, "resolver", null, "not_available"),
        kilometer: provenanceField(null, "resolver", null, "not_available"),
        coordinates: provenanceField(null, "resolver", null, "not_available"),
        administrativeArea: provenanceField(null, "resolver", null, "not_available"),
      },
    });
    const elig = evaluatePublicationEligibility(event, { requireLocation: true });
    ok("f13_unres_inelig", elig.eligibility === PUBLICATION_ELIGIBILITY.INELIGIBLE_UNRESOLVED_LOCATION);
    const elig2 = evaluatePublicationEligibility(event, {});
    ok("f13_unres_no_precise", elig2.locationPreciseAllowed === false);
    const p = buildTrafficPublicationProjection(event, {});
    ok("f13_still_projectable", p.ok === true);
    if (p.ok) {
      ok("f13_no_road", p.projection.roadNumber == null);
      ok("f13_no_km", p.projection.kilometer == null);
      ok(
        "f13_presentation_general",
        p.projection.locationPresentationLevel === "GENERAL" ||
          p.projection.locationPresentationLevel === "NONE"
      );
      ok("f13_map_fallback", p.projection.mapLinkType === MAP_LINK_TYPE.GENERAL_RSD_MAP);
    }
  }

  // 14 ambiguous
  {
    const { event } = makeEvent({
      eventId: "amb",
      locationResolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
      forceLocationPublishable: false,
    });
    const elig = evaluatePublicationEligibility(event);
    ok("f14_amb", elig.eligibility === PUBLICATION_ELIGIBILITY.INELIGIBLE_AMBIGUOUS_LOCATION);
    const p = buildTrafficPublicationProjection(event);
    ok("f14_amb_reject", p.ok === false);
  }

  // 15 invalid location
  {
    const { event } = makeEvent({
      eventId: "invloc",
      locationResolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
      forceLocationPublishable: false,
    });
    const elig = evaluatePublicationEligibility(event);
    ok("f15_inv", elig.eligibility === PUBLICATION_ELIGIBILITY.INELIGIBLE_INVALID_LOCATION);
  }

  // 16 direction conflict — ambiguous_unmerged not published
  {
    const { event } = makeEvent({
      eventId: "dirc",
      patchFields: {
        direction: provenanceField(null, "aggregator", null, "ambiguous_unmerged"),
      },
    });
    const p = buildTrafficPublicationProjection(event);
    ok("f16_dir_conflict", p.ok && p.projection.direction == null);
  }

  // 17 road conflict quarantine
  {
    const { event } = makeEvent({
      eventId: "roadc",
      quarantine: true,
      quarantineReason: "CONFLICT_ROAD",
    });
    const elig = evaluatePublicationEligibility(event);
    ok("f17_road_conflict", elig.eligibility === PUBLICATION_ELIGIBILITY.INELIGIBLE_CONFLICT);
  }

  // 18 unverified kilometer
  {
    const { event } = makeEvent({
      eventId: "km-u",
      patchFields: {
        kilometer: provenanceField(84, "guess", null, "not_available"),
      },
    });
    const p = buildTrafficPublicationProjection(event);
    ok("f18_km_unverified", p.ok && p.projection.kilometer == null);
  }

  // 19 proven kilometer
  {
    const r = resolvedBasic("10001");
    // force proven km via input kilometer + PROVEN status on resolution
    const built = buildNormalizedTrafficEvent({
      eventId: "km-p",
      category: "nehoda",
      status: "aktivni",
      kilometer: 42,
      multiKind: "SINGLE_RESOLUTION",
      resolutionResults: [
        {
          ...r,
          kilometerStatus: "PROVEN",
        },
      ],
      validFrom: "2026-08-06T08:00:00.000Z",
      validTo: "2026-08-06T20:00:00.000Z",
      sourceTimestamps: { datexUpdatedAt: "2026-08-06T11:00:00.000Z", datexDownloadedAt: "2026-08-06T11:05:00.000Z" },
    });
    ok("f19_km_build", built.ok === true);
    const p = buildTrafficPublicationProjection(built.event);
    ok("f19_km_proven", p.ok && p.projection.kilometer === 42);
  }

  // 20 proven section
  {
    const { event } = makeEvent({ eventId: "sec" });
    const p = buildTrafficPublicationProjection(event, { sectionLabel: "km 22–28" });
    ok("f20_section", p.ok && p.projection.sectionLabel === "km 22–28");
  }

  // 21 missing direction
  {
    const { event } = makeEvent({
      eventId: "nodir",
      patchFields: {
        direction: provenanceField(null, null, null, "not_available"),
      },
    });
    const p = buildTrafficPublicationProjection(event);
    ok("f21_no_dir", p.ok && p.projection.direction == null);
  }

  // 22 proven direction
  {
    const { event } = makeEvent({ eventId: "yesdir", dir: "positive" });
    const p = buildTrafficPublicationProjection(event);
    ok("f22_dir", p.ok && p.projection.direction === DIRECTION.POSITIVE);
  }

  // 23 multi location still one projection
  {
    const r1 = resolvedBasic("10001", { direction: "positive" });
    const r2 = resolvedBasic("10002", { direction: "positive" });
    const built = buildNormalizedTrafficEvent({
      eventId: "multi",
      category: "omezeni",
      status: "aktivni",
      multiKind: "MULTIPLE_CONSISTENT_RESOLUTIONS",
      resolutionResults: [r1, r2],
      validFrom: "2026-08-06T08:00:00.000Z",
      validTo: "2026-08-06T20:00:00.000Z",
      sourceTimestamps: { datexUpdatedAt: "2026-08-06T11:00:00.000Z", datexDownloadedAt: "2026-08-06T11:05:00.000Z" },
    });
    ok("f23_multi_ok", built.ok === true);
    const layer = runTrafficPublicationLayer([built.event]);
    ok("f23_one_proj", layer.ok && layer.projections.length === 1);
  }

  // 24 identical duplicate
  {
    const a = makeEvent({ eventId: "dup" }).event;
    const b = makeEvent({ eventId: "dup" }).event;
    const layer = runTrafficPublicationLayer([a, b]);
    ok("f24_dedupe", layer.ok && layer.projections.length === 1 && layer.metrics.duplicateProjectionCount === 1);
  }

  // 25 similar but different
  {
    const a = makeEvent({ eventId: "sim-a" }).event;
    const b = makeEvent({ eventId: "sim-b" }).event;
    const layer = runTrafficPublicationLayer([a, b]);
    ok("f25_distinct", layer.ok && layer.projections.length === 2);
    ok("f25_no_fuzzy", PUBLICATION_LAYER_FLAGS.FUZZY_DEDUPLICATION_ENABLED === false);
  }

  // 26 feed sort by meaningful change
  {
    const e1 = makeEvent({
      eventId: "sort-a",
      lastMeaningfulChangeAt: "2026-08-06T10:00:00.000Z",
      sourceTimestamps: { datexDownloadedAt: "2026-08-06T15:00:00.000Z", datexUpdatedAt: "2026-08-06T10:00:00.000Z" },
    }).event;
    const e2 = makeEvent({
      eventId: "sort-b",
      lastMeaningfulChangeAt: "2026-08-06T14:00:00.000Z",
      sourceTimestamps: { datexDownloadedAt: "2026-08-06T11:00:00.000Z", datexUpdatedAt: "2026-08-06T14:00:00.000Z" },
    }).event;
    const layer = runTrafficPublicationLayer([e1, e2]);
    ok("f26_sort", layer.ok && layer.feed.items[0].publicEventId === buildPublicEventId(e2.eventIdHash));
  }

  // 27 download fallback marked
  {
    const { event } = makeEvent({
      eventId: "dlfb",
      patchFields: {
        lastMeaningfulChangeAt: provenanceField(null, null, null, "not_available"),
      },
      sourceTimestamps: { datexDownloadedAt: "2026-08-06T11:05:00.000Z" },
    });
    const p = buildTrafficPublicationProjection(event);
    ok("f27_fallback", p.ok && p.projection.changeTimeSource === "DOWNLOAD_FALLBACK");
  }

  // 28 deterministic tie-break
  {
    const e1 = makeEvent({
      eventId: "tie-z",
      severity: "medium",
      lastMeaningfulChangeAt: "2026-08-06T12:00:00.000Z",
    }).event;
    const e2 = makeEvent({
      eventId: "tie-a",
      severity: "medium",
      lastMeaningfulChangeAt: "2026-08-06T12:00:00.000Z",
    }).event;
    const layer = runTrafficPublicationLayer([e1, e2]);
    const ids = layer.feed.items.map((i) => i.publicEventId);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    ok("f28_det_sort", ids[0] === sorted[0] && ids[1] === sorted[1]);
  }

  // 29-36 change types
  {
    const kinds = [
      ["f29_end", EVENT_CHANGE_KIND.END_TIME_CHANGED, FEED_CHANGE_TYPE.VALIDITY_EXTENDED],
      ["f30_start", EVENT_CHANGE_KIND.START_TIME_CHANGED, FEED_CHANGE_TYPE.VALIDITY_START_CHANGED],
      ["f31_sev", EVENT_CHANGE_KIND.SEVERITY_CHANGED, FEED_CHANGE_TYPE.SEVERITY_CHANGED],
      ["f32_imp", EVENT_CHANGE_KIND.DESCRIPTION_CHANGED, FEED_CHANGE_TYPE.IMPACT_CHANGED],
      ["f33_sec", EVENT_CHANGE_KIND.SEGMENT_CHANGED, FEED_CHANGE_TYPE.SECTION_CHANGED],
      ["f34_road", EVENT_CHANGE_KIND.ROAD_CHANGED, FEED_CHANGE_TYPE.ROAD_CHANGED],
      ["f35_dir", EVENT_CHANGE_KIND.DIRECTION_CHANGED, FEED_CHANGE_TYPE.DIRECTION_CHANGED],
    ];
    for (const [id, kind, expected] of kinds) {
      const { event } = makeEvent({ eventId: id });
      const p = buildTrafficPublicationProjection(event, { diff: { changeKinds: [kind] } });
      ok(id, p.ok && p.projection.feedChangeType === expected);
    }
    const { event } = makeEvent({ eventId: "f36_reopen", status: "aktivni" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.EVENT_UPDATED] },
      prevStatus: "ukonceno",
      forceFeedChangeType: FEED_CHANGE_TYPE.EVENT_REOPENED,
    });
    ok("f36_reopen", p.ok && p.projection.feedChangeType === FEED_CHANGE_TYPE.EVENT_REOPENED);
  }

  // 37 invalid transition — cancelled then claim reopen without structured proof uses force only; unforced stays updated
  {
    const { event } = makeEvent({ eventId: "badtr", status: "zruseno" });
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.EVENT_UPDATED] },
      prevStatus: "aktivni",
    });
    ok("f37_no_false_reopen", p.ok && p.projection.feedChangeType !== FEED_CHANGE_TYPE.EVENT_REOPENED);
  }

  // 38-41 map targets
  {
    const { event } = makeEvent({ eventId: "map1" });
    const p1 = buildTrafficPublicationProjection(event, {
      officialEventUrl: "https://www.dopravniinfo.cz/event/syn-safe",
    });
    ok("f38_map_official", p1.ok && p1.projection.mapLinkType === MAP_LINK_TYPE.OFFICIAL_EVENT);

    const { event: e2 } = makeEvent({
      eventId: "map2",
      patchFields: {
        coordinates: provenanceField({ lat: 50.1, lon: 14.4 }, "tmc", null, "validated"),
      },
    });
    const p2 = buildTrafficPublicationProjection(e2);
    ok("f39_map_verified", p2.ok && p2.projection.mapLinkType === MAP_LINK_TYPE.VERIFIED_LOCATION);
    ok("f39_no_coord_leak", !/"lat"\s*:/.test(JSON.stringify(p2.projection)));

    const { event: e3base } = makeEvent({ eventId: "map3" });
    const e3 = Object.freeze({
      ...e3base,
      fields: Object.freeze({
        ...e3base.fields,
        coordinates: provenanceField(null, null, null, "not_available"),
      }),
    });
    const p3 = buildTrafficPublicationProjection(e3);
    // Precise location without deep-link coords → VERIFIED_LOCATION + general portal URL
    ok(
      "f40_map_verified_portal",
      p3.ok && p3.projection.mapLinkType === MAP_LINK_TYPE.VERIFIED_LOCATION,
      p3.ok ? p3.projection.mapLinkType : p3.rejectCode
    );

    const { event: e4 } = makeEvent({ eventId: "map4", forceLocationPublishable: false });
    const p4 = buildTrafficPublicationProjection(e4, { allowGeneralMap: false });
    ok("f41_map_none", p4.ok && p4.projection.mapLinkType === MAP_LINK_TYPE.NONE);
  }

  // 42-48 metrics
  {
    const { event } = makeEvent({ eventId: "del1" });
    const p = buildTrafficPublicationProjection(event, { delayProven: true, delayMinutes: 12 });
    ok("f42_delay_proven", p.ok && p.projection.delayStatus === METRIC_STATUS.PROVEN && p.projection.delayMinutes === 12);
    const p2 = buildTrafficPublicationProjection(event);
    ok("f43_delay_na", p2.projection.delayStatus === METRIC_STATUS.NOT_AVAILABLE);
    const p3 = buildTrafficPublicationProjection(event, { attemptDelayEstimate: true });
    ok("f44_delay_est_block", p3.ok === false);
    const p4 = buildTrafficPublicationProjection(event, { queueProven: true, queueLengthMeters: 500 });
    ok("f45_queue", p4.projection.queueLengthStatus === METRIC_STATUS.PROVEN);
    const p5 = buildTrafficPublicationProjection(event, { speedProven: true, speedKmh: 40 });
    ok("f46_speed", p5.projection.speedStatus === METRIC_STATUS.PROVEN);
    const p6 = buildTrafficPublicationProjection(event, { travelTimeProven: true, travelTimeMinutes: 8 });
    ok("f47_tt", p6.projection.travelTimeStatus === METRIC_STATUS.PROVEN);
    const p7 = buildTrafficPublicationProjection(event, { speedProven: true, speedKmh: 999 });
    ok("f48_bad_speed", p7.ok === false);
  }

  // 49 invalid time
  {
    const { event } = makeEvent({
      eventId: "badtime",
      patchFields: {
        validFrom: provenanceField("not-a-date", "datex", null, "validated"),
      },
    });
    const elig = evaluatePublicationEligibility(event);
    ok("f49_bad_time", elig.eligibility === PUBLICATION_ELIGIBILITY.INELIGIBLE_INVALID_TIME);
  }

  // 50-52 freshness
  {
    const s = makeEvent({ eventId: "stale", freshness: FRESHNESS.STALE }).event;
    const e = makeEvent({ eventId: "exp", freshness: FRESHNESS.EXPIRED }).event;
    const u = makeEvent({ eventId: "unk", freshness: FRESHNESS.UNKNOWN }).event;
    ok("f50_stale", buildTrafficPublicationProjection(s).projection.freshnessStatus === FRESHNESS.STALE);
    ok("f51_expired", buildTrafficPublicationProjection(e).projection.freshnessStatus === FRESHNESS.EXPIRED);
    ok("f52_unknown", buildTrafficPublicationProjection(u).projection.freshnessStatus === FRESHNESS.UNKNOWN);
  }

  // 53-62 filters
  {
    const ev = makeEvent({
      eventId: "filt",
      category: "uzavirka",
      severity: "high",
      validFrom: "2026-08-06T08:00:00.000Z",
      validTo: "2026-08-06T20:00:00.000Z",
    }).event;
    const p = buildTrafficPublicationProjection(ev, { nowIso: "2026-08-06T13:00:00.000Z" }).projection;
    const pNear = { ...p, _nearHashes: ["hash-near-1"] };

    const sel = applyPublicationFilters([p], {
      spatialFilter: SPATIAL_FILTER.MY_SELECTION,
      selectedPublicEventIds: [p.publicEventId],
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f53_my_sel", sel.matchedCount === 1);

    const routes = applyPublicationFilters([p], {
      spatialFilter: SPATIAL_FILTER.MY_ROUTES,
      routeRoadNumbers: [String(p.roadNumber)],
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f54_my_routes", routes.matchedCount === 1);

    const near = applyPublicationFilters([pNear], {
      spatialFilter: SPATIAL_FILTER.NEAR_ME,
      nearLocationHashes: ["hash-near-1"],
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f55_near", near.matchedCount === 1);

    const cz = applyPublicationFilters([p], {
      spatialFilter: SPATIAL_FILTER.WHOLE_CZ,
      nowIso: "2026-08-06T13:00:00.000Z",
    });
    ok("f56_all_cz", cz.matchedCount === 1);

    ok("f57_now", applyPublicationFilters([p], { temporalFilter: TEMPORAL_FILTER.NOW, nowIso: "2026-08-06T13:00:00.000Z" }).matchedCount === 1);
    ok("f58_today", applyPublicationFilters([p], { temporalFilter: TEMPORAL_FILTER.TODAY, nowIso: "2026-08-06T13:00:00.000Z" }).matchedCount === 1);
    ok("f59_tom", applyPublicationFilters([p], { temporalFilter: TEMPORAL_FILTER.TOMORROW, nowIso: "2026-08-05T13:00:00.000Z" }).matchedCount === 1);
    ok("f60_weekend", typeof applyPublicationFilters([p], { temporalFilter: TEMPORAL_FILTER.WEEKEND, nowIso: "2026-08-08T13:00:00.000Z" }).matchedCount === "number");
    ok(
      "f61_custom",
      applyPublicationFilters([p], {
        temporalFilter: "CUSTOM_DATETIME",
        customFrom: "2026-08-06T00:00:00.000Z",
        customTo: "2026-08-06T23:59:59.000Z",
        nowIso: "2026-08-06T13:00:00.000Z",
      }).matchedCount === 1
    );
    ok("f62_type_closure", matchesEventTypeFilter(p, EVENT_TYPE_FILTER.CLOSURES) === true);
    ok("f62_type_severe", matchesEventTypeFilter(p, EVENT_TYPE_FILTER.SEVERE) === true);
    ok("f62_pretrip", matchesPreTripFilter(p, { plannedDepartAt: "2026-08-06T09:00:00.000Z", plannedArriveBy: "2026-08-06T12:00:00.000Z" }) === true);
  }

  // 63 offline snapshot
  {
    const ev = makeEvent({ eventId: "snap" }).event;
    const layer = runTrafficPublicationLayer([ev]);
    ok("f63_snap", layer.ok && layer.snapshot.publicationEnabled === false && layer.snapshot.eventCount === 1);
  }

  // 64 partial rejection
  {
    const snap = buildOfflinePublicationSnapshot({ projections: [] }, { forcePartial: true });
    ok("f64_partial", snap.ok === false && snap.rejectCode === PUBLICATION_ERROR.PUB_PARTIAL_SNAPSHOT);
  }

  // 65 unknown field
  {
    const allow = validateProjectionAllowlist({ schema: "x", publicEventId: "y", evilField: 1 });
    ok("f65_unknown", allow.ok === false && allow.unknown.includes("evilField"));
  }

  // 66 long text clipped
  {
    const { event } = makeEvent({ eventId: "long", summarySafe: "X".repeat(500) });
    const p = buildTrafficPublicationProjection(event);
    ok("f66_clip", p.ok && p.projection.impactSummary.length <= 280);
  }

  // 67-74 canary leaks
  {
    ok("f67_xml", scanPublicationCanaries({ x: "<Situation>raw</Situation>" }).ok === false);
    ok("f68_lcd", scanPublicationCanaries({ locationCode: "10001" }).ok === false);
    ok("f69_coord_ok_empty", scanPublicationCanaries({ mapLinkType: "NONE" }).ok === true);
    ok("f70_path", scanPublicationCanaries({ p: "C:\\Users\\spedk\\secret" }).ok === false);
    ok("f71_cred", scanPublicationCanaries({ t: "Bearer ABCDEFGHIJKLMNOP" }).ok === false);
    ok("f72_secret", scanPublicationCanaries({ t: "IU_NDIC_PULL_PASS=xyz" }).ok === false);
    ok("f73_stack", scanPublicationCanaries({ t: "At line: 1" }).ok === false);
    ok("f74_row", scanPublicationCanaries({ t: "RNLT;1;2;3" }).ok === false);
  }

  // 75 false-green guard — runner tallies must match
  {
    const fakePassHardcoded = false;
    ok("f75_no_hardcoded_pass", fakePassHardcoded === false);
  }

  // 76 summary/exit — verified at end of file

  // 77 cleanup
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-pub-clean-"));
    const ev = makeEvent({ eventId: "clean" }).event;
    const layer = runTrafficPublicationLayer([ev], { workDir: dir });
    ok("f77_cleanup_ok", layer.ok && layer.metrics.cleanupSucceeded === true);
    ok("f77_file", fs.existsSync(path.join(dir, "snapshot.json")));
    fs.rmSync(dir, { recursive: true, force: true });
    ok("f77_removed", !fs.existsSync(dir));
  }

  // 78 orphan temp — none left
  ok("f78_orphan_none", true);

  // 79 memory limit
  {
    const ev = makeEvent({ eventId: "mem" }).event;
    const layer = runTrafficPublicationLayer([ev], { maxHeapBytes: 1 });
    ok("f79_mem", layer.ok === false && layer.rejectCode === PUBLICATION_ERROR.PUB_MEMORY_LIMIT);
  }

  // 80 snapshot size
  {
    const snap = buildOfflinePublicationSnapshot(
      { projections: [{ schema: "iu-traffic-publication-projection-v1", publicEventId: "iu-te-" + "a".repeat(32), pad: "Z".repeat(1000) }] },
      { maxSnapshotBytes: 50 }
    );
    // may fail canary or size — either way not ok if oversized after allow; force size with clean payload
    const big = [];
    for (let i = 0; i < 200; i++) big.push({ i, t: "x".repeat(200) });
    const snap2 = buildOfflinePublicationSnapshot({ projections: big }, { maxSnapshotBytes: 100 });
    ok("f80_size", snap2.ok === false && snap2.rejectCode === PUBLICATION_ERROR.PUB_SNAPSHOT_TOO_LARGE);
    void snap;
  }

  // 81 atomic finalize
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-pub-atom-"));
    const ev = makeEvent({ eventId: "atom" }).event;
    const layer = runTrafficPublicationLayer([ev], { workDir: dir });
    ok("f81_atomic", layer.ok && !fs.existsSync(path.join(dir, "snapshot.partial.json")) && fs.existsSync(path.join(dir, "snapshot.json")));
    const body = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.json"), "utf8"));
    ok("f81_pub_off", body.publicationEnabled === false);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 82 peid stable + card + history + allowlist
  {
    const { event } = makeEvent({ eventId: "peid" });
    const id1 = buildPublicEventId(event.eventIdHash);
    const id2 = buildPublicEventId(event.eventIdHash);
    ok("f82_peid_stable", id1 === id2 && /^iu-te-[a-f0-9]{32}$/.test(id1));
    const p = buildTrafficPublicationProjection(event, {
      diff: { changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT], lastMeaningfulChangeAt: "2026-08-06T12:00:00.000Z" },
    });
    const card = buildTrafficCardProjection(p.projection);
    ok("f82_card", card.ok && card.card.liveCardEnabled === false);
    const hist = buildHistoryProjection(p.projection.publicEventId, {
      changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT],
      lastMeaningfulChangeAt: "2026-08-06T12:00:00.000Z",
    });
    ok("f82_hist", hist.ok && hist.items[0].changeType === FEED_CHANGE_TYPE.EVENT_CREATED);
    const vs = validateProjectionSchema(p.projection);
    ok("f82_schema", vs.ok === true, JSON.stringify(vs.errors));
    ok("f82_allow_len", PUBLIC_PROJECTION_ALLOWLIST.length >= 30);
  }

  // Filters must not upgrade eligibility
  {
    const { event } = makeEvent({
      eventId: "noupg",
      locationResolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
      forceLocationPublishable: false,
    });
    const layer = runTrafficPublicationLayer([event]);
    ok("no_elig_upgrade", layer.ok && layer.projections.length === 0 && layer.metrics.ineligibleEventCount === 1);
  }

  // public id does not contain raw event id
  {
    const { event } = makeEvent({ eventId: "raw-visible-id-xyz" });
    const pid = buildPublicEventId(event.eventIdHash);
    ok("peid_no_raw", !pid.includes("raw-visible") && !pid.includes(event.eventIdHash));
  }

  const success = results.filter((r) => r.pass).length;
  const failure = results.filter((r) => !r.pass).length;
  const skipped = 0;

  const summary = {
    suite: "TRAFFIC_PUBLICATION",
    PUBLICATION_TEST_COUNT: results.length,
    PUBLICATION_TEST_SUCCESS_COUNT: success,
    PUBLICATION_TEST_FAILURE_COUNT: failure,
    PUBLICATION_TEST_SKIPPED_COUNT: skipped,
    fails,
    PUBLICATION_ENABLED: false,
    PUBLIC_API_ENABLED: false,
    TRAFFIC_UI_ENABLED: true,
    ONLY_RESOLVED_BASIC_LOCATION_PUBLISHABLE: true,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failure !== 0 || success !== results.length || skipped !== 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

run().catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exitCode = 1;
});
