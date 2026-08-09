/**
 * Count-only ACTIVE publication safety counters (no payloads / IDs).
 * Mirrors shadow forensic UNVERIFIED_* semantics:
 * count only geo fields that would remain on a fail-closed public preview row.
 */
import { VERIFIED_LOCATION_TRUST } from "./shadow-forensic-constants.mjs";

function clip(s, n) {
  if (s == null || s === "") return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n) : t;
}

function hasVerifiedLocationTrust(item) {
  const trust = String((item && item.localizationTrust) || "");
  const tmcOk = item && item.ndicV1 && Number(item.ndicV1.tmcOk) > 0;
  return VERIFIED_LOCATION_TRUST.includes(trust) || tmcOk;
}

/**
 * Fail-closed preview row (same nulling rules as shadow card preview).
 * Unverified geo fields stay null — never invent km/direction/locality.
 */
function buildFailClosedPreviewRow(item) {
  const verifiedLoc = hasVerifiedLocationTrust(item);
  return {
    road: verifiedLoc ? clip(item && item.roadNumber, 40) : null,
    // Shadow preview never publishes km on the redacted row.
    km: null,
    direction: verifiedLoc ? clip(item && item.direction, 40) : null,
    locality: verifiedLoc
      ? clip(item && item.region && item.region.name, 80) || clip(item && item.locality, 80)
      : null,
  };
}

/**
 * @param {object[]} feedItems gate-passed NDIC feed items
 * @returns {{
 *   UNVERIFIED_LOCATION_PUBLISHED: number,
 *   UNVERIFIED_KM_PUBLISHED: number,
 *   UNVERIFIED_DIRECTION_PUBLISHED: number,
 *   FUZZY_MATCH_USED: false,
 *   GEOCODING_USED: false,
 *   HEURISTIC_LOCATION_USED: false
 * }}
 */
export function countActivePublicationSafetyCounters(feedItems) {
  let unverifiedLocation = 0;
  let unverifiedKm = 0;
  let unverifiedDirection = 0;
  const list = Array.isArray(feedItems) ? feedItems : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const verified = hasVerifiedLocationTrust(item);
    const row = buildFailClosedPreviewRow(item);
    // Leak detectors: non-null geo on preview while source trust is unverified.
    if (row.km != null) unverifiedKm += 1;
    if (!verified) {
      if (row.locality != null || row.road != null) unverifiedLocation += 1;
      if (row.direction != null) unverifiedDirection += 1;
    }
  }
  return Object.freeze({
    UNVERIFIED_LOCATION_PUBLISHED: unverifiedLocation,
    UNVERIFIED_KM_PUBLISHED: unverifiedKm,
    UNVERIFIED_DIRECTION_PUBLISHED: unverifiedDirection,
    FUZZY_MATCH_USED: false,
    GEOCODING_USED: false,
    HEURISTIC_LOCATION_USED: false,
  });
}

/**
 * Optional second path: count leaks on already-built UI cards.
 * Used by fixtures; production ACTIVE path uses feedItems + fail-closed preview.
 */
export function countUnverifiedPublishedFromCards(cards) {
  let unverifiedLocation = 0;
  let unverifiedKm = 0;
  let unverifiedDirection = 0;
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || typeof c !== "object") continue;
    if (c.preciseLocationVerified === true) continue;
    if (c.kilometer != null) unverifiedKm += 1;
    if (c.direction != null && String(c.direction).trim() !== "") unverifiedDirection += 1;
    const road = c.road != null && String(c.road).trim() !== "";
    const location = c.location != null && String(c.location).trim() !== "";
    if (road || location) unverifiedLocation += 1;
  }
  return Object.freeze({
    UNVERIFIED_LOCATION_PUBLISHED: unverifiedLocation,
    UNVERIFIED_KM_PUBLISHED: unverifiedKm,
    UNVERIFIED_DIRECTION_PUBLISHED: unverifiedDirection,
    FUZZY_MATCH_USED: false,
    GEOCODING_USED: false,
    HEURISTIC_LOCATION_USED: false,
  });
}
