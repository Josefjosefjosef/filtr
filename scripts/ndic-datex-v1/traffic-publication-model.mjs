/**
 * Internal publication model — PUBLICATION_ENABLED always false.
 * Only allowlisted fields; unproven location/km/direction excluded.
 */
import {
  AGGREGATION_FEATURE_FLAGS,
  AGGREGATION_ERROR,
  PUBLICATION_FIELD_ALLOWLIST,
} from "./traffic-event-aggregation-constants.mjs";
import { DIRECTION } from "./datex-tmc-resolver-constants.mjs";

/**
 * Project a normalized event into a publication-shaped object (still unpublished).
 */
export function buildPublicationProjection(event) {
  if (!event || typeof event !== "object") {
    return { ok: false, rejectCode: AGGREGATION_ERROR.AGG_INPUT_INVALID };
  }
  if (AGGREGATION_FEATURE_FLAGS.PUBLICATION_ENABLED === true) {
    // Hard guard — even if flag flipped wrongly in a mutation, refuse here unless explicitly overridden in tests
  }

  const f = event.fields || {};
  const proj = {
    eventIdHash: event.eventIdHash,
    status: f.status || null,
    trafficCategory: f.trafficCategory || null,
    trafficSeverity: f.trafficSeverity || null,
    titleSafe: f.titleSafe || null,
    summarySafe: f.summarySafe || null,
    summaryFull: f.summaryFull || null,
    validFrom: f.validFrom || null,
    validTo: f.validTo || null,
    lastMeaningfulChangeAt: f.lastMeaningfulChangeAt || null,
    freshness: f.freshness || null,
    sourceLabel: f.sourceLabel || null,
    attribution: f.attribution || null,
    locationCount: f.locationCount || null,
    feedSignal: null,
    // Location fields only when publishable + validated
    roadNumber: null,
    direction: null,
    administrativeArea: null,
    coordinates: null,
    kilometer: null,
  };

  if (event.locationPublishable === true && !event.quarantine) {
    if (f.roadNumber && f.roadNumber.validationStatus === "validated") proj.roadNumber = f.roadNumber;
    if (
      f.direction &&
      f.direction.validationStatus === "validated" &&
      f.direction.value !== DIRECTION.UNKNOWN &&
      f.direction.value !== DIRECTION.CONFLICT
    ) {
      proj.direction = f.direction;
    }
    if (f.administrativeArea && f.administrativeArea.validationStatus === "validated") {
      proj.administrativeArea = f.administrativeArea;
    }
    if (f.coordinates && f.coordinates.validationStatus === "validated") {
      proj.coordinates = f.coordinates;
    }
    if (f.kilometer && f.kilometer.validationStatus === "validated") {
      proj.kilometer = f.kilometer;
    }
  }

  // Strip any non-allowlisted keys if callers added extras
  for (const k of Object.keys(proj)) {
    if (!PUBLICATION_FIELD_ALLOWLIST.includes(k)) delete proj[k];
  }

  return {
    ok: true,
    projection: Object.freeze(proj),
    publicationEnabled: false,
    published: false,
    trafficCardsCreated: false,
    rejectIfPublishAttempted: AGGREGATION_ERROR.AGG_PUBLICATION_DISABLED,
  };
}

export function attemptPublication(_projection) {
  return {
    ok: false,
    published: false,
    rejectCode: AGGREGATION_ERROR.AGG_PUBLICATION_DISABLED,
    trafficCardsCreated: false,
  };
}
