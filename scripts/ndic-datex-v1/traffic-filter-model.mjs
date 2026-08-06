/**
 * Internal filter models for future UI (not activated).
 * Spatial: MY_SELECTION | MY_ROUTES | NEAR_ME | WHOLE_CZ
 * Temporal: NOW | TODAY | TOMORROW | WEEKEND | CUSTOM_RANGE
 * No geocoding / fuzzy / heuristics.
 */
import { SPATIAL_FILTER, TEMPORAL_FILTER } from "./traffic-event-aggregation-constants.mjs";

function startOfDayUtc(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isWeekendUtc(ms) {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Temporal window predicate against event validity (normalized fields only).
 */
export function matchesTemporalFilter(event, filter, opts = {}) {
  const nowMs = Date.parse(opts.nowIso || new Date().toISOString());
  const from = event.fields && event.fields.validFrom && event.fields.validFrom.value;
  const to = event.fields && event.fields.validTo && event.fields.validTo.value;
  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;

  const overlaps = (winStart, winEnd) => {
    const start = Number.isFinite(fromMs) ? fromMs : -Infinity;
    const end = Number.isFinite(toMs) ? toMs : Infinity;
    return start <= winEnd && end >= winStart;
  };

  switch (filter) {
    case TEMPORAL_FILTER.NOW: {
      const start = Number.isFinite(fromMs) ? fromMs : -Infinity;
      const end = Number.isFinite(toMs) ? toMs : Infinity;
      return start <= nowMs && end >= nowMs;
    }
    case TEMPORAL_FILTER.TODAY: {
      const s = startOfDayUtc(nowMs);
      return overlaps(s, s + 86400000 - 1);
    }
    case TEMPORAL_FILTER.TOMORROW: {
      const s = startOfDayUtc(nowMs) + 86400000;
      return overlaps(s, s + 86400000 - 1);
    }
    case TEMPORAL_FILTER.WEEKEND: {
      // Current or next Sat–Sun UTC window containing now's weekend
      const day = new Date(nowMs).getUTCDay();
      const toSat = (6 - day + 7) % 7;
      const sat = startOfDayUtc(nowMs) + (day === 0 || day === 6 ? (day === 6 ? 0 : -86400000) : toSat * 86400000);
      const sunEnd = sat + 2 * 86400000 - 1;
      return overlaps(sat, sunEnd) || (isWeekendUtc(nowMs) && overlaps(startOfDayUtc(nowMs) - (day === 0 ? 86400000 : 0), sunEnd));
    }
    case TEMPORAL_FILTER.CUSTOM_RANGE: {
      const cs = Date.parse(opts.customFrom || "");
      const ce = Date.parse(opts.customTo || "");
      if (!Number.isFinite(cs) || !Number.isFinite(ce)) return false;
      return overlaps(cs, ce);
    }
    default:
      return false;
  }
}

/**
 * Spatial filter prep — WHOLE_CZ always true when locationPublishable or not required.
 * MY_SELECTION / MY_ROUTES / NEAR_ME require explicit opaque allowlists (no geo heuristics).
 */
export function matchesSpatialFilter(event, filter, opts = {}) {
  switch (filter) {
    case SPATIAL_FILTER.WHOLE_CZ:
      return true;
    case SPATIAL_FILTER.MY_SELECTION: {
      const set = new Set(opts.selectedEventIdHashes || []);
      return set.has(event.eventIdHash);
    }
    case SPATIAL_FILTER.MY_ROUTES: {
      // Opaque road-number allowlist only (already validated field)
      const roads = new Set(opts.routeRoadNumbers || []);
      const rn = event.fields && event.fields.roadNumber && event.fields.roadNumber.value;
      if (!rn || event.fields.roadNumber.validationStatus !== "validated") return false;
      return roads.has(String(rn));
    }
    case SPATIAL_FILTER.NEAR_ME: {
      // Explicit opaque locationCodeHash allowlist only — no distance calc / geocoding
      const hashes = new Set(opts.nearLocationHashes || []);
      if (!event.locationPublishable) return false;
      return (event.locations || []).some(
        (l) => l.primaryLocation && hashes.has(l.primaryLocation.locationCodeHash)
      );
    }
    default:
      return false;
  }
}

export function applyTrafficFilters(events, opts = {}) {
  const list = Array.isArray(events) ? events : [];
  const spatial = opts.spatialFilter || SPATIAL_FILTER.WHOLE_CZ;
  const temporal = opts.temporalFilter || TEMPORAL_FILTER.NOW;
  const out = [];
  for (const ev of list) {
    if (!matchesSpatialFilter(ev, spatial, opts)) continue;
    if (!matchesTemporalFilter(ev, temporal, opts)) continue;
    out.push(ev);
  }
  return {
    schema: "iu-traffic-filter-result-v1",
    spatialFilter: spatial,
    temporalFilter: temporal,
    inputCount: list.length,
    matchedCount: out.length,
    events: out,
  };
}

export { SPATIAL_FILTER, TEMPORAL_FILTER };
