/**
 * Extended publication filters: event types, pre-trip, selection/routes/near/CZ, time.
 * Eligibility is never upgraded by filters.
 */
import { EVENT_TYPE_FILTER } from "./traffic-publication-constants.mjs";
import { SPATIAL_FILTER, TEMPORAL_FILTER } from "./traffic-event-aggregation-constants.mjs";
import { applyTrafficFilters, matchesTemporalFilter, matchesSpatialFilter } from "./traffic-filter-model.mjs";
import { LIFECYCLE_STATUS } from "./traffic-publication-constants.mjs";

function categoryOf(proj) {
  return String(proj.eventCategory || proj.eventType || "").toLowerCase();
}

export function matchesEventTypeFilter(proj, typeFilter) {
  const t = typeFilter || EVENT_TYPE_FILTER.ALL;
  if (t === EVENT_TYPE_FILTER.ALL) return true;
  const cat = categoryOf(proj);
  const life = proj.lifecycleStatus;
  const sev = String(proj.severity || "").toLowerCase();
  switch (t) {
    case EVENT_TYPE_FILTER.CLOSURES:
      return /uzavir|closure/.test(cat);
    case EVENT_TYPE_FILTER.RESTRICTIONS:
      return /omezen|restrict/.test(cat);
    case EVENT_TYPE_FILTER.ACCIDENTS:
      return /nehod|accident/.test(cat);
    case EVENT_TYPE_FILTER.ROADWORKS:
      return /prace|roadwork|works/.test(cat);
    case EVENT_TYPE_FILTER.QUEUES:
      return /kolon|queue|congest/.test(cat);
    case EVENT_TYPE_FILTER.ROAD_AND_WEATHER:
      return /pocasi|weather|vozov/.test(cat);
    case EVENT_TYPE_FILTER.FUTURE:
      return life === LIFECYCLE_STATUS.FUTURE;
    case EVENT_TYPE_FILTER.ENDED:
      return life === LIFECYCLE_STATUS.ENDED || life === LIFECYCLE_STATUS.CANCELLED;
    case EVENT_TYPE_FILTER.SEVERE:
      return sev === "high" || sev === "severe";
    default:
      return false;
  }
}

/**
 * Pre-trip filter contract: overlap with planned interval only (no travel-time calc).
 */
export function matchesPreTripFilter(proj, opts = {}) {
  const planStart = Date.parse(opts.plannedDepartAt || "");
  const planEnd = Date.parse(opts.plannedArriveBy || opts.plannedWindowEnd || "");
  if (!Number.isFinite(planStart) || !Number.isFinite(planEnd)) return false;
  const from = proj.validFrom ? Date.parse(proj.validFrom) : -Infinity;
  const to = proj.expectedEnd ? Date.parse(proj.expectedEnd) : Infinity;
  return from <= planEnd && to >= planStart;
}

/**
 * Apply filters to publication projections (not raw events).
 * Spatial/near/routes use opaque hashes / road numbers from projection only.
 */
export function applyPublicationFilters(projections, opts = {}) {
  const list = Array.isArray(projections) ? projections : [];
  const spatial = opts.spatialFilter || SPATIAL_FILTER.WHOLE_CZ;
  const temporal = opts.temporalFilter || TEMPORAL_FILTER.NOW;
  const typeFilter = opts.eventTypeFilter || EVENT_TYPE_FILTER.ALL;
  const out = [];

  for (const p of list) {
    if (!p || p.publicationEligibility !== "ELIGIBLE_FOR_PUBLICATION") continue;

    // Adapt projection to event-like shape for temporal helpers where needed
    const pseudo = {
      eventIdHash: p.publicEventId,
      locationPublishable: p.roadNumber != null || p.locationLabel != null,
      fields: {
        validFrom: { value: p.validFrom },
        validTo: { value: p.expectedEnd },
        roadNumber: { value: p.roadNumber, validationStatus: p.roadNumber != null ? "validated" : "not_available" },
      },
      locations: p._nearHashes
        ? p._nearHashes.map((h) => ({ primaryLocation: { locationCodeHash: h } }))
        : [],
    };

    if (spatial === SPATIAL_FILTER.MY_SELECTION) {
      const set = new Set(opts.selectedPublicEventIds || []);
      if (!set.has(p.publicEventId)) continue;
    } else if (spatial === SPATIAL_FILTER.MY_ROUTES) {
      const roads = new Set(opts.routeRoadNumbers || []);
      if (!p.roadNumber || !roads.has(String(p.roadNumber))) continue;
    } else if (spatial === SPATIAL_FILTER.NEAR_ME) {
      const hashes = new Set(opts.nearLocationHashes || []);
      const mine = p._nearHashes || [];
      if (!mine.some((h) => hashes.has(h))) continue;
    } else if (spatial !== SPATIAL_FILTER.WHOLE_CZ && spatial !== "ALL_CZ") {
      continue;
    }

    // Temporal via pseudo event
    if (!matchesTemporalFilter(pseudo, temporal === "CUSTOM_DATETIME" ? TEMPORAL_FILTER.CUSTOM_RANGE : temporal, {
      nowIso: opts.nowIso,
      customFrom: opts.customFrom,
      customTo: opts.customTo,
    })) {
      continue;
    }

    if (!matchesEventTypeFilter(p, typeFilter)) continue;

    if (opts.preTrip === true && !matchesPreTripFilter(p, opts)) continue;

    out.push(p);
  }

  return {
    schema: "iu-traffic-publication-filter-result-v1",
    spatialFilter: spatial,
    temporalFilter: temporal,
    eventTypeFilter: typeFilter,
    inputCount: list.length,
    matchedCount: out.length,
    projections: out,
  };
}

export { EVENT_TYPE_FILTER, SPATIAL_FILTER, TEMPORAL_FILTER, applyTrafficFilters, matchesSpatialFilter };
