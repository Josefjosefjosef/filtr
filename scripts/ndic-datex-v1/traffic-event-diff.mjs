/**
 * Normalized event diff engine — never diffs raw DATEX XML.
 */
import { EVENT_CHANGE_KIND } from "./traffic-event-aggregation-constants.mjs";

function fieldValue(ev, name) {
  if (!ev || !ev.fields || !ev.fields[name]) return null;
  return ev.fields[name].value;
}

function locationFingerprint(ev) {
  const locs = (ev && ev.locations) || [];
  return locs
    .map((l) =>
      [
        l.primaryLocation && l.primaryLocation.locationCodeHash,
        l.secondaryLocation && l.secondaryLocation.locationCodeHash,
        l.direction && l.direction.value,
      ].join(":")
    )
    .sort()
    .join("|");
}

/**
 * @param {object|null} prev
 * @param {object|null} next
 */
export function diffNormalizedEvents(prev, next) {
  if (!prev && next) {
    return {
      changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT],
      changes: [{ field: "identity", kind: EVENT_CHANGE_KIND.NEW_EVENT }],
      meaningful: true,
      lastMeaningfulChangeAt: (next.fields && next.fields.lastMeaningfulChangeAt && next.fields.lastMeaningfulChangeAt.value) || null,
    };
  }
  if (prev && !next) {
    return {
      changeKinds: [EVENT_CHANGE_KIND.STATUS_ENDED],
      changes: [{ field: "presence", kind: EVENT_CHANGE_KIND.STATUS_ENDED }],
      meaningful: true,
      lastMeaningfulChangeAt: null,
    };
  }
  if (!prev || !next) {
    return { changeKinds: [EVENT_CHANGE_KIND.NO_CHANGE], changes: [], meaningful: false, lastMeaningfulChangeAt: null };
  }

  const changes = [];
  const kinds = new Set();

  const statusPrev = fieldValue(prev, "status");
  const statusNext = fieldValue(next, "status");
  if (statusPrev !== statusNext) {
    if (statusNext === "zruseno" || statusNext === "cancelled") {
      kinds.add(EVENT_CHANGE_KIND.STATUS_CANCELLED);
      changes.push({ field: "status", kind: EVENT_CHANGE_KIND.STATUS_CANCELLED, from: statusPrev, to: statusNext });
    } else if (statusNext === "ukonceno" || statusNext === "ended") {
      kinds.add(EVENT_CHANGE_KIND.STATUS_ENDED);
      changes.push({ field: "status", kind: EVENT_CHANGE_KIND.STATUS_ENDED, from: statusPrev, to: statusNext });
    } else {
      kinds.add(EVENT_CHANGE_KIND.EVENT_UPDATED);
      changes.push({ field: "status", kind: EVENT_CHANGE_KIND.EVENT_UPDATED, from: statusPrev, to: statusNext });
    }
  }

  if (fieldValue(prev, "direction") !== fieldValue(next, "direction")) {
    kinds.add(EVENT_CHANGE_KIND.DIRECTION_CHANGED);
    changes.push({
      field: "direction",
      kind: EVENT_CHANGE_KIND.DIRECTION_CHANGED,
      from: fieldValue(prev, "direction"),
      to: fieldValue(next, "direction"),
    });
  }

  if (fieldValue(prev, "roadNumber") !== fieldValue(next, "roadNumber")) {
    kinds.add(EVENT_CHANGE_KIND.ROAD_CHANGED);
    changes.push({
      field: "roadNumber",
      kind: EVENT_CHANGE_KIND.ROAD_CHANGED,
      from: fieldValue(prev, "roadNumber"),
      to: fieldValue(next, "roadNumber"),
    });
  }

  const fpPrev = locationFingerprint(prev);
  const fpNext = locationFingerprint(next);
  if (fpPrev !== fpNext) {
    kinds.add(EVENT_CHANGE_KIND.SEGMENT_CHANGED);
    changes.push({ field: "locations", kind: EVENT_CHANGE_KIND.SEGMENT_CHANGED });
    const prevCount = (prev.locations || []).length;
    const nextCount = (next.locations || []).length;
    if (nextCount > prevCount) {
      kinds.add(EVENT_CHANGE_KIND.LOCATION_ADDED);
      changes.push({ field: "locations", kind: EVENT_CHANGE_KIND.LOCATION_ADDED });
    } else if (nextCount < prevCount) {
      kinds.add(EVENT_CHANGE_KIND.LOCATION_REMOVED);
      changes.push({ field: "locations", kind: EVENT_CHANGE_KIND.LOCATION_REMOVED });
    }
  }

  if (fieldValue(prev, "validFrom") !== fieldValue(next, "validFrom")) {
    kinds.add(EVENT_CHANGE_KIND.START_TIME_CHANGED);
    changes.push({ field: "validFrom", kind: EVENT_CHANGE_KIND.START_TIME_CHANGED });
  }
  if (fieldValue(prev, "validTo") !== fieldValue(next, "validTo")) {
    kinds.add(EVENT_CHANGE_KIND.END_TIME_CHANGED);
    changes.push({ field: "validTo", kind: EVENT_CHANGE_KIND.END_TIME_CHANGED });
  }
  if (fieldValue(prev, "trafficSeverity") !== fieldValue(next, "trafficSeverity")) {
    kinds.add(EVENT_CHANGE_KIND.SEVERITY_CHANGED);
    changes.push({ field: "trafficSeverity", kind: EVENT_CHANGE_KIND.SEVERITY_CHANGED });
  }
  if (fieldValue(prev, "summarySafe") !== fieldValue(next, "summarySafe") || fieldValue(prev, "titleSafe") !== fieldValue(next, "titleSafe")) {
    kinds.add(EVENT_CHANGE_KIND.DESCRIPTION_CHANGED);
    changes.push({ field: "description", kind: EVENT_CHANGE_KIND.DESCRIPTION_CHANGED });
  }

  if (prev.quarantine !== next.quarantine && next.quarantine) {
    kinds.add(EVENT_CHANGE_KIND.CONFLICT_UNMERGED);
    changes.push({ field: "quarantine", kind: EVENT_CHANGE_KIND.CONFLICT_UNMERGED });
  }

  if (!changes.length) {
    return { changeKinds: [EVENT_CHANGE_KIND.NO_CHANGE], changes: [], meaningful: false, lastMeaningfulChangeAt: fieldValue(prev, "lastMeaningfulChangeAt") };
  }

  if (![...kinds].every((k) => k === EVENT_CHANGE_KIND.NO_CHANGE)) {
    kinds.add(EVENT_CHANGE_KIND.EVENT_UPDATED);
  }

  return {
    changeKinds: [...kinds],
    changes,
    meaningful: true,
    lastMeaningfulChangeAt: fieldValue(next, "lastMeaningfulChangeAt") || fieldValue(next, "validFrom"),
  };
}

/**
 * Diff a previous store Map against a new event list.
 * @param {Map<string, object>|object} previousByHash
 * @param {object[]} nextEvents
 */
export function diffEventBatch(previousByHash, nextEvents) {
  const prevMap =
    previousByHash instanceof Map
      ? previousByHash
      : new Map(Object.entries(previousByHash || {}));
  const nextList = Array.isArray(nextEvents) ? nextEvents : [];
  const nextMap = new Map(nextList.map((e) => [e.eventIdHash, e]));
  const diffs = [];

  for (const [id, next] of nextMap) {
    const prev = prevMap.get(id) || null;
    diffs.push({ eventIdHash: id, ...diffNormalizedEvents(prev, next) });
  }
  for (const [id, prev] of prevMap) {
    if (!nextMap.has(id)) {
      diffs.push({ eventIdHash: id, ...diffNormalizedEvents(prev, null) });
    }
  }
  return { diffs, meaningfulCount: diffs.filter((d) => d.meaningful).length };
}
