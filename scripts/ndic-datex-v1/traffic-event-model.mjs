/**
 * Normalized internal traffic-event model (never public by itself).
 * Consumes DATEX fields + RESOLVED_BASIC resolver results only.
 */
import crypto from "node:crypto";
import {
  AGGREGATION_FEATURE_FLAGS,
  AGGREGATION_ERROR,
  provenanceField,
} from "./traffic-event-aggregation-constants.mjs";
import { RESOLVER_STATUS, DIRECTION, FRESHNESS } from "./datex-tmc-resolver-constants.mjs";

export const NORMALIZED_EVENT_SCHEMA = "iu-normalized-traffic-event-v1";

export function opaqueHash(parts) {
  const h = crypto.createHash("sha256");
  h.update(String(parts == null ? "" : parts));
  return h.digest("hex").slice(0, 24);
}

/**
 * Filter resolver results to RESOLVED_BASIC only; surface conflicts fail-closed.
 * @param {object[]} resolutionResults — from resolveDatexEventLocations().results
 * @param {string} [multiKind]
 */
export function selectPublishableLocations(resolutionResults, multiKind) {
  const list = Array.isArray(resolutionResults) ? resolutionResults : [];
  if (multiKind === "CONFLICTING_RESOLUTIONS") {
    return {
      ok: false,
      rejectCode: AGGREGATION_ERROR.AGG_LOCATION_CONFLICT,
      locations: [],
      conflict: true,
    };
  }
  const basic = list.filter((r) => r && r.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC && r.publiclyEligible === true);
  // Distinct opposite directions are kept as separate location branches — never merged into one.
  // Only explicit CONFLICT direction or segmentConflict fails closed for the whole selection.
  if (basic.some((r) => r.direction && r.direction.value === DIRECTION.CONFLICT)) {
    return {
      ok: false,
      rejectCode: AGGREGATION_ERROR.AGG_DIRECTION_CONFLICT,
      locations: [],
      conflict: true,
    };
  }
  // Segment conflict: explicit segmentConflict flag fails closed
  if (basic.some((r) => r.segmentConflict === true)) {
    return {
      ok: false,
      rejectCode: AGGREGATION_ERROR.AGG_SEGMENT_CONFLICT,
      locations: [],
      conflict: true,
    };
  }
  // Deduplicate identical location keys only
  const seen = new Set();
  const locations = [];
  for (const r of basic) {
    const key = [
      r.primaryLocation && r.primaryLocation.locationCodeHash,
      r.secondaryLocation && r.secondaryLocation.locationCodeHash,
      r.direction && r.direction.value,
      r.inputReferenceType,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({
      inputReferenceType: r.inputReferenceType,
      direction: r.direction,
      road: r.road,
      primaryLocation: r.primaryLocation,
      secondaryLocation: r.secondaryLocation,
      coordinates: r.coordinates,
      administrativeArea: r.administrativeArea,
      kilometerStatus: r.kilometerStatus,
      offsets: r.offsets,
      tmcImportRunId: r.tmcImportRunId,
      freshness: r.freshness || FRESHNESS.UNKNOWN,
    });
  }
  return { ok: true, locations, conflict: false };
}

/**
 * Build one normalized event from synthetic DATEX-like input + resolver output.
 * Never invents location/km/direction.
 */
export function buildNormalizedTrafficEvent(input, opts = {}) {
  if (!input || typeof input !== "object") {
    return { ok: false, rejectCode: AGGREGATION_ERROR.AGG_INPUT_INVALID };
  }
  const identityRaw = input.eventId || input.situationId || input.id;
  if (!identityRaw) {
    return { ok: false, rejectCode: AGGREGATION_ERROR.AGG_IDENTITY_MISSING };
  }
  const eventIdHash = opaqueHash("evt:" + String(identityRaw));

  const locSel = selectPublishableLocations(input.resolutionResults || [], input.multiKind);
  if (!locSel.ok) {
    return {
      ok: false,
      rejectCode: locSel.rejectCode,
      eventIdHash,
      conflict: true,
    };
  }

  // Locations may be empty — event can still exist without public location
  const hasLocation = locSel.locations.length > 0;
  const ts = input.sourceTimestamps || {};
  const nowIso = opts.nowIso || new Date().toISOString();

  const category = String(input.category || input.eventType || "unknown");
  const severity = input.severity != null ? String(input.severity) : null;
  const status = String(input.status || "aktivni");

  // Provenance-wrapped fields
  const fields = {
    status: provenanceField(status, "datex", ts.datexUpdatedAt || null, "validated"),
    trafficCategory: provenanceField(category, "datex", ts.datexUpdatedAt || null, "validated"),
    trafficSeverity: provenanceField(severity, "datex", ts.datexUpdatedAt || null, severity != null ? "validated" : "not_available"),
    titleSafe: provenanceField(
      input.titleSafe != null ? String(input.titleSafe).slice(0, 120) : null,
      "datex_normalized",
      ts.datexUpdatedAt || null,
      input.titleSafe != null ? "validated" : "not_available"
    ),
    summarySafe: provenanceField(
      input.summarySafe != null ? String(input.summarySafe).slice(0, 280) : null,
      "datex_normalized",
      ts.datexUpdatedAt || null,
      input.summarySafe != null ? "validated" : "not_available"
    ),
    validFrom: provenanceField(input.validFrom || null, "datex", ts.datexUpdatedAt || null, input.validFrom ? "validated" : "not_available"),
    validTo: provenanceField(input.validTo || null, "datex", ts.datexUpdatedAt || null, input.validTo ? "validated" : "not_available"),
    sourceLabel: provenanceField("NDIC", "config", null, "validated"),
    attribution: provenanceField("Zdroj: NDIC", "config", null, "validated"),
  };

  // Location-derived publishable fields — only from RESOLVED_BASIC
  let roadNumber = provenanceField(null, null, null, "not_available");
  let direction = provenanceField(null, null, null, "not_available");
  let administrativeArea = provenanceField(null, null, null, "not_available");
  let coordinates = provenanceField(null, null, null, "not_available");
  let kilometer = provenanceField(null, null, null, "not_available");

  if (hasLocation) {
    const loc0 = locSel.locations[0];
    if (loc0.road && loc0.road.roadNumber && loc0.road.roadNumber.validationStatus === "validated") {
      roadNumber = loc0.road.roadNumber;
    }
    // Direction on event summary only if all publishable locations agree; else leave not_available (locations still retained)
    const dirVals = [
      ...new Set(
        locSel.locations
          .map((l) => l.direction && l.direction.value)
          .filter((d) => d && d !== DIRECTION.UNKNOWN && d !== DIRECTION.NOT_APPLICABLE && d !== DIRECTION.CONFLICT)
      ),
    ];
    if (dirVals.length === 1) {
      direction = locSel.locations.find((l) => l.direction && l.direction.value === dirVals[0]).direction;
    } else if (dirVals.length > 1) {
      direction = provenanceField(null, "aggregator", nowIso, "ambiguous_unmerged");
    }
    if (loc0.administrativeArea && loc0.administrativeArea.validationStatus === "validated") {
      administrativeArea = loc0.administrativeArea;
    }
    if (loc0.coordinates && loc0.coordinates.validationStatus === "validated") {
      coordinates = loc0.coordinates;
    }
    // Kilometer only if proven — never estimate
    if (input.kilometer != null && loc0.kilometerStatus === "PROVEN" && !AGGREGATION_FEATURE_FLAGS.KILOMETER_ESTIMATION_ENABLED) {
      if (typeof input.kilometer === "number" && Number.isFinite(input.kilometer)) {
        kilometer = provenanceField(input.kilometer, "datex", ts.datexUpdatedAt || null, "validated");
      }
    }
  }

  const event = Object.freeze({
    schema: NORMALIZED_EVENT_SCHEMA,
    eventIdHash,
    version: Number(input.version) || 1,
    fields: Object.freeze({
      ...fields,
      roadNumber,
      direction,
      administrativeArea,
      coordinates,
      kilometer,
      locationCount: provenanceField(locSel.locations.length, "aggregator", nowIso, "validated"),
      lastMeaningfulChangeAt: provenanceField(
        input.lastMeaningfulChangeAt || ts.datexUpdatedAt || nowIso,
        "aggregator",
        nowIso,
        "validated"
      ),
      freshness: provenanceField(input.freshness || FRESHNESS.UNKNOWN, "resolver", nowIso, "validated"),
    }),
    locations: Object.freeze(locSel.locations.slice()),
    locationPublishable: hasLocation,
    quarantine: Boolean(input.quarantine) || locSel.conflict === true,
    quarantineReason: locSel.conflict ? locSel.rejectCode : input.quarantineReason || null,
    featureFlags: { ...AGGREGATION_FEATURE_FLAGS },
    aggregatedAt: nowIso,
    sourceTimestamps: Object.freeze({ ...ts }),
  });

  return { ok: true, event };
}
