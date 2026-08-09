/**
 * Publication eligibility — only RESOLVED_BASIC locations may yield precise public geo fields.
 */
import { PUBLICATION_ELIGIBILITY, PUBLICATION_LAYER_FLAGS } from "./traffic-publication-constants.mjs";
import { RESOLVER_STATUS, FRESHNESS, DIRECTION } from "./datex-tmc-resolver-constants.mjs";

function fieldVal(ev, name) {
  return ev && ev.fields && ev.fields[name] ? ev.fields[name].value : null;
}

function fieldStatus(ev, name) {
  return ev && ev.fields && ev.fields[name] ? ev.fields[name].validationStatus : null;
}

/**
 * @param {object} event — normalized aggregated event
 * @param {{ requireLocation?: boolean, nowIso?: string }} [opts]
 */
export function evaluatePublicationEligibility(event, opts = {}) {
  if (!event || typeof event !== "object" || !event.eventIdHash) {
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_MISSING_REQUIRED_FIELDS,
      locationPreciseAllowed: false,
      reasons: ["missing_event"],
    };
  }
  if (PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === true) {
    // Flag must never be true in this layer; treat as security blocker if flipped
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_SECURITY_BLOCKER,
      locationPreciseAllowed: false,
      reasons: ["publication_flag_true"],
    };
  }
  if (event.quarantine === true) {
    const reason = String(event.quarantineReason || "");
    if (/AMBIGUOUS|ambiguous/.test(reason)) {
      return {
        eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_AMBIGUOUS_LOCATION,
        locationPreciseAllowed: false,
        reasons: ["quarantine_ambiguous"],
      };
    }
    if (/CONFLICT|conflict/.test(reason)) {
      return {
        eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_CONFLICT,
        locationPreciseAllowed: false,
        reasons: ["quarantine_conflict"],
      };
    }
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_SECURITY_BLOCKER,
      locationPreciseAllowed: false,
      reasons: ["quarantine"],
    };
  }

  const category = fieldVal(event, "trafficCategory");
  if (category == null || category === "" || category === "unknown") {
    // Still eligible for generic feed if identity exists — type invalid only when explicitly required
    if (opts.requireEventType === true) {
      return {
        eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_INVALID_EVENT_TYPE,
        locationPreciseAllowed: false,
        reasons: ["invalid_event_type"],
      };
    }
  }

  const from = fieldVal(event, "validFrom");
  const to = fieldVal(event, "validTo");
  if (from && Number.isNaN(Date.parse(from))) {
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_INVALID_TIME,
      locationPreciseAllowed: false,
      reasons: ["invalid_validFrom"],
    };
  }
  if (to && Number.isNaN(Date.parse(to))) {
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_INVALID_TIME,
      locationPreciseAllowed: false,
      reasons: ["invalid_validTo"],
    };
  }

  const freshness = fieldVal(event, "freshness");
  if (freshness === FRESHNESS.EXPIRED && opts.rejectExpired === true) {
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_STALE_SOURCE,
      locationPreciseAllowed: false,
      reasons: ["expired"],
    };
  }

  // Location precision: only when locationPublishable and all locs are RESOLVED_BASIC-backed
  let locationPreciseAllowed = false;
  if (event.locationPublishable === true && Array.isArray(event.locations) && event.locations.length > 0) {
    locationPreciseAllowed = true;
  } else if (opts.requireLocation === true) {
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_UNRESOLVED_LOCATION,
      locationPreciseAllowed: false,
      reasons: ["location_required"],
    };
  }

  // Ambiguous unmerged direction ⇒ no precise direction publish (eligibility may still hold for non-geo fields)
  const dirStatus = fieldStatus(event, "direction");
  if (dirStatus === "ambiguous_unmerged") {
    // Still eligible, but direction not precise
  }

  // Explicit unresolved marker on event
  if (event.locationResolutionStatus === RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE) {
    locationPreciseAllowed = false;
    if (opts.requireLocation === true) {
      return {
        eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_UNRESOLVED_LOCATION,
        locationPreciseAllowed: false,
        reasons: ["unresolved"],
      };
    }
  }
  if (event.locationResolutionStatus === RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS) {
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_AMBIGUOUS_LOCATION,
      locationPreciseAllowed: false,
      reasons: ["ambiguous"],
    };
  }
  if (event.locationResolutionStatus === RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE) {
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_INVALID_LOCATION,
      locationPreciseAllowed: false,
      reasons: ["invalid_location"],
    };
  }
  if (event.locationResolutionStatus === RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP) {
    return {
      eligibility: PUBLICATION_ELIGIBILITY.INELIGIBLE_UNSUPPORTED_RELATIONSHIP,
      locationPreciseAllowed: false,
      reasons: ["unsupported_relationship"],
    };
  }

  void DIRECTION;
  return {
    eligibility: PUBLICATION_ELIGIBILITY.ELIGIBLE_FOR_PUBLICATION,
    locationPreciseAllowed,
    reasons: [],
  };
}
