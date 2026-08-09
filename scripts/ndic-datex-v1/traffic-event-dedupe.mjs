/**
 * Event deduplication — one internal event identity, never merge conflicts.
 */
import { AGGREGATION_ERROR } from "./traffic-event-aggregation-constants.mjs";

/**
 * Deduplicate normalized events by eventIdHash.
 * Identical hashes: keep highest version, or merge non-conflicting location lists.
 * Conflicting directions/segments across same identity ⇒ fail-closed (keep prior + flag).
 */
export function deduplicateNormalizedEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const byId = new Map();
  const rejected = [];
  const metrics = {
    inputCount: list.length,
    uniqueCount: 0,
    duplicateCollapsed: 0,
    conflictRejected: 0,
  };

  for (const ev of list) {
    if (!ev || !ev.eventIdHash) {
      rejected.push({ rejectCode: AGGREGATION_ERROR.AGG_IDENTITY_MISSING });
      continue;
    }
    const prev = byId.get(ev.eventIdHash);
    if (!prev) {
      byId.set(ev.eventIdHash, ev);
      continue;
    }
    metrics.duplicateCollapsed += 1;
    // Prefer higher version
    if ((ev.version || 1) < (prev.version || 1)) {
      continue;
    }
    if ((ev.version || 1) > (prev.version || 1)) {
      byId.set(ev.eventIdHash, ev);
      continue;
    }
    // Same version — attempt location union if no conflict markers
    if (ev.quarantine || prev.quarantine) {
      metrics.conflictRejected += 1;
      rejected.push({ eventIdHash: ev.eventIdHash, rejectCode: AGGREGATION_ERROR.AGG_LOCATION_CONFLICT });
      // Keep prev; do not invent merge
      continue;
    }
    const mergedLocs = mergeLocationsFailClosed(prev.locations || [], ev.locations || []);
    if (!mergedLocs.ok) {
      metrics.conflictRejected += 1;
      rejected.push({ eventIdHash: ev.eventIdHash, rejectCode: mergedLocs.rejectCode });
      continue;
    }
    byId.set(ev.eventIdHash, {
      ...ev,
      locations: mergedLocs.locations,
      fields: {
        ...ev.fields,
        locationCount: {
          ...(ev.fields && ev.fields.locationCount),
          value: mergedLocs.locations.length,
          validationStatus: "validated",
        },
      },
    });
  }

  const unique = [...byId.values()];
  metrics.uniqueCount = unique.length;
  return { ok: true, events: unique, rejected, metrics };
}

function locationKey(loc) {
  return [
    loc.primaryLocation && loc.primaryLocation.locationCodeHash,
    loc.secondaryLocation && loc.secondaryLocation.locationCodeHash,
    loc.direction && loc.direction.value,
    loc.inputReferenceType,
  ].join("|");
}

function mergeLocationsFailClosed(a, b) {
  const map = new Map();
  for (const loc of [...a, ...b]) {
    const k = locationKey(loc);
    if (map.has(k)) continue;
    // Direction conflict across set
    const dir = loc.direction && loc.direction.value;
    for (const existing of map.values()) {
      const ed = existing.direction && existing.direction.value;
      if (
        dir &&
        ed &&
        dir !== ed &&
        dir !== "BOTH" &&
        ed !== "BOTH" &&
        dir !== "UNKNOWN" &&
        ed !== "UNKNOWN" &&
        ((dir === "POSITIVE" && ed === "NEGATIVE") || (dir === "NEGATIVE" && ed === "POSITIVE"))
      ) {
        return { ok: false, rejectCode: AGGREGATION_ERROR.AGG_DIRECTION_CONFLICT };
      }
    }
    map.set(k, loc);
  }
  return { ok: true, locations: [...map.values()] };
}
