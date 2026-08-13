/**
 * Presentation-only location certainty policy for traffic cards.
 * Does NOT change TMC/OpenLR resolver, importer, or trust assignment.
 * Separates: subject scope ("čeho se týká") vs precise location ("kde přesně").
 */
import { DIRECTION } from "./datex-tmc-resolver-constants.mjs";

export const LOCATION_PRESENTATION_LEVEL = Object.freeze({
  PRECISE: "PRECISE",
  SCOPED: "SCOPED",
  GENERAL: "GENERAL",
  NONE: "NONE",
});

export const SUBJECT_SCOPE_KIND = Object.freeze({
  ROAD: "ROAD",
  ADMIN_AREA: "ADMIN_AREA",
  NONE: "NONE",
});

export const ROUTE_MATCH_MODE = Object.freeze({
  PRECISE_HIT: "PRECISE_HIT",
  SCOPE_ONLY: "SCOPE_ONLY",
  NONE: "NONE",
});

const MAX_LABEL = 120;

function clip(s, n) {
  if (s == null) return null;
  const t = String(s);
  return t.length > n ? t.slice(0, n) : t;
}

/**
 * Direction labels must not be mid-token clipped (avoids "… provoz ve smě").
 * Prefer omitting an oversized/unsafe value over inventing a fragment.
 */
function clipDirection(s, n) {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length > n) return null;
  if (/\bve\s+smě$/i.test(t) || /\bv\s+rámc$/i.test(t) || /\bna\s+sil$/i.test(t)) return null;
  if (/\s(?:ve|na|v|do|z|se|ke|od|a|i)$/i.test(t)) return null;
  return t;
}

function fv(ev, name) {
  return ev && ev.fields && ev.fields[name] ? ev.fields[name] : null;
}

function validatedValue(field) {
  if (!field || field.validationStatus !== "validated") return null;
  if (field.value == null || field.value === "") return null;
  return field.value;
}

/**
 * Build user-facing Czech disclosure (no internal jargon).
 * @param {string} level
 * @param {{ kind: string, label: string|null }} scope
 * @param {{ road?: string|null, kilometer?: number|null, direction?: string|null }} precise
 */
export function buildLocationDisclosureCs(level, scope, precise = {}) {
  if (level === LOCATION_PRESENTATION_LEVEL.PRECISE) {
    const parts = [];
    if (precise.road) parts.push(String(precise.road));
    if (precise.kilometer != null && Number.isFinite(Number(precise.kilometer))) {
      parts.push("km " + String(precise.kilometer));
    }
    const dir = String(precise.direction || "").trim();
    if (dir && !/^(kladný směr|záporný směr)$/i.test(dir)) {
      parts.push("směr " + dir);
    }
    if (parts.length) return clip(parts.join(" • "), MAX_LABEL);
    return "Poloha je v oficiálních datech ověřena.";
  }
  if (level === LOCATION_PRESENTATION_LEVEL.SCOPED) {
    if (scope && scope.kind === SUBJECT_SCOPE_KIND.ROAD && scope.label) {
      return clip(
        "Týká se komunikace " + scope.label + ". Přesná poloha není v oficiálních datech jednoznačně určena.",
        280
      );
    }
    if (scope && scope.kind === SUBJECT_SCOPE_KIND.ADMIN_AREA && scope.label) {
      return clip(
        "Týká se oblasti " + scope.label + ". Přesná poloha není v oficiálních datech jednoznačně určena.",
        280
      );
    }
    return "Událost má ověřený rozsah, ale přesná poloha není v oficiálních datech jednoznačně určena.";
  }
  if (level === LOCATION_PRESENTATION_LEVEL.GENERAL) {
    return "Událost je evidována v dopravním kontextu. Konkrétní úsek ani místo oficiální data neuvádějí.";
  }
  return "Oficiální data tuto událost nespojují s jednoznačně určitelnou lokalitou.";
}

/**
 * Classify presentation level from aggregated event + eligibility flags.
 * Never invents coordinates/km/direction.
 *
 * @param {object} event
 * @param {{ locationPreciseAllowed?: boolean }} [elig]
 */
export function classifyLocationPresentation(event, elig = {}) {
  const preciseAllowed = elig.locationPreciseAllowed === true;
  const roadField = fv(event, "roadNumber");
  const adminField = fv(event, "administrativeArea");
  const dirField = fv(event, "direction");
  const kmField = fv(event, "kilometer");
  const coordField = fv(event, "coordinates");

  const road = validatedValue(roadField);
  const admin = validatedValue(adminField);
  let direction = validatedValue(dirField);
  if (
    direction === DIRECTION.UNKNOWN ||
    direction === DIRECTION.CONFLICT ||
    direction === DIRECTION.NOT_APPLICABLE
  ) {
    direction = null;
  }
  const kilometer =
    kmField &&
    kmField.validationStatus === "validated" &&
    typeof kmField.value === "number" &&
    Number.isFinite(kmField.value)
      ? kmField.value
      : null;
  const hasVerifiedCoords =
    coordField &&
    coordField.validationStatus === "validated" &&
    coordField.value &&
    typeof coordField.value.lat === "number" &&
    typeof coordField.value.lon === "number";

  const preciseLocationVerified =
    preciseAllowed === true &&
    (hasVerifiedCoords === true || road != null || event.locationPublishable === true);

  let subjectScopeKind = SUBJECT_SCOPE_KIND.NONE;
  let subjectScopeLabel = null;
  if (road != null) {
    subjectScopeKind = SUBJECT_SCOPE_KIND.ROAD;
    subjectScopeLabel = clip(String(road), 40);
  } else if (admin != null) {
    subjectScopeKind = SUBJECT_SCOPE_KIND.ADMIN_AREA;
    subjectScopeLabel = clip(String(admin), 80);
  }
  const subjectScopeVerified = subjectScopeKind !== SUBJECT_SCOPE_KIND.NONE;

  let level = LOCATION_PRESENTATION_LEVEL.NONE;
  if (preciseLocationVerified) {
    level = LOCATION_PRESENTATION_LEVEL.PRECISE;
  } else if (subjectScopeVerified) {
    level = LOCATION_PRESENTATION_LEVEL.SCOPED;
  } else if (event && event.eventIdHash) {
    // Eligible identity exists, but no scope — general traffic context
    level = LOCATION_PRESENTATION_LEVEL.GENERAL;
  }

  // Precise geo display fields only when precise
  const displayRoad = preciseLocationVerified && road != null ? clip(String(road), 40) : null;
  const displayKm = preciseLocationVerified ? kilometer : null;
  const displayDirection =
    preciseLocationVerified && direction != null ? clipDirection(String(direction), 40) : null;
  const displayAdmin =
    preciseLocationVerified && admin != null ? clip(String(admin), 80) : null;

  // Scoped may surface subject label (road/admin) without km/direction
  const scopedRoad =
    !preciseLocationVerified && subjectScopeKind === SUBJECT_SCOPE_KIND.ROAD ? subjectScopeLabel : null;
  const scopedAdmin =
    !preciseLocationVerified && subjectScopeKind === SUBJECT_SCOPE_KIND.ADMIN_AREA
      ? subjectScopeLabel
      : null;

  const locationDisclosureCs = buildLocationDisclosureCs(
    level,
    { kind: subjectScopeKind, label: subjectScopeLabel },
    { road: displayRoad || scopedRoad, kilometer: displayKm, direction: displayDirection }
  );

  let routeMatchMode = ROUTE_MATCH_MODE.NONE;
  if (subjectScopeKind === SUBJECT_SCOPE_KIND.ROAD && subjectScopeLabel) {
    routeMatchMode = preciseLocationVerified
      ? ROUTE_MATCH_MODE.PRECISE_HIT
      : ROUTE_MATCH_MODE.SCOPE_ONLY;
  }

  const nearMeEligible =
    preciseLocationVerified === true &&
    event.locationPublishable === true &&
    Array.isArray(event.locations) &&
    event.locations.length > 0;

  return Object.freeze({
    locationPresentationLevel: level,
    subjectScopeVerified,
    preciseLocationVerified,
    subjectScopeKind,
    subjectScopeLabel,
    locationDisclosureCs,
    /** Road for filter/UI: precise road OR scoped subject road (never invent). */
    presentationRoad: displayRoad || scopedRoad,
    presentationKilometer: displayKm,
    presentationDirection: displayDirection,
    presentationAdminArea: displayAdmin || scopedAdmin,
    /** True only when km/dir may be shown as verified facts. */
    showPreciseGeoFields: preciseLocationVerified === true,
    routeMatchMode,
    nearMeEligible,
    fuzzyMatchUsed: false,
    geocodingUsed: false,
    heuristicLocationUsed: false,
  });
}

/**
 * Guard: presentation must never invent geo from text-only fail-closed buckets.
 */
export function assertFailClosedBucketsNeverInventGeo(presentation) {
  const p = presentation || {};
  if (p.preciseLocationVerified === true && p.heuristicLocationUsed === true) return false;
  if (p.fuzzyMatchUsed === true || p.geocodingUsed === true) return false;
  if (p.showPreciseGeoFields === true && p.locationPresentationLevel !== LOCATION_PRESENTATION_LEVEL.PRECISE) {
    return false;
  }
  return true;
}

/** Forensic map-link inventory labels (count-only; no URLs). */
export const FORENSIC_MAP_LINK_TYPE = Object.freeze({
  DIRECT_EVENT: "DIRECT_EVENT",
  VERIFIED_LOCATION: "VERIFIED_LOCATION",
  GENERAL_RSD_FALLBACK: "GENERAL_RSD_FALLBACK",
  NONE: "NONE",
});

/**
 * Count-only presentation + map-link classification for a normalized NDIC feed item.
 * Forensic-only — does not change trust/resolver/publication.
 * Prefers forensic.locationPresentationLevel / mapLinkType when already attached.
 *
 * @param {object|null|undefined} item
 */
export function classifyFeedItemPresentationForensics(item) {
  const it = item && typeof item === "object" ? item : {};
  const forensic = (it.ndicV1 && it.ndicV1.forensic) || {};

  let level = forensic.locationPresentationLevel
    ? String(forensic.locationPresentationLevel)
    : null;
  if (
    level !== LOCATION_PRESENTATION_LEVEL.PRECISE &&
    level !== LOCATION_PRESENTATION_LEVEL.SCOPED &&
    level !== LOCATION_PRESENTATION_LEVEL.GENERAL &&
    level !== LOCATION_PRESENTATION_LEVEL.NONE
  ) {
    level = null;
  }

  const trust = String(
    it.localizationTrust || forensic.trustAfterResolver || forensic.trustBeforeResolver || ""
  ).toLowerCase();

  if (!level) {
    if (trust === "tmc" || trust === "openlr" || trust === "coordinates") {
      level = LOCATION_PRESENTATION_LEVEL.PRECISE;
    } else if (trust === "text") {
      level = LOCATION_PRESENTATION_LEVEL.SCOPED;
    } else {
      const roadRaw =
        it.roadNumber != null
          ? String(it.roadNumber).trim()
          : it.ndicV1 && it.ndicV1.roadNumber != null
            ? String(it.ndicV1.roadNumber).trim()
            : "";
      // Subject-scope road without verified precise trust → SCOPED (never invents coords).
      if (roadRaw && roadRaw !== "0" && !/^neznám/i.test(roadRaw)) {
        level = LOCATION_PRESENTATION_LEVEL.SCOPED;
      } else if (trust === "national_fallback" || trust === "none" || trust === "") {
        level = LOCATION_PRESENTATION_LEVEL.GENERAL;
      } else {
        level = LOCATION_PRESENTATION_LEVEL.NONE;
      }
    }
  }

  let mapLinkType = forensic.mapLinkTypeForensic
    ? String(forensic.mapLinkTypeForensic)
    : forensic.mapLinkType
      ? String(forensic.mapLinkType)
      : null;
  if (
    mapLinkType !== FORENSIC_MAP_LINK_TYPE.DIRECT_EVENT &&
    mapLinkType !== FORENSIC_MAP_LINK_TYPE.VERIFIED_LOCATION &&
    mapLinkType !== FORENSIC_MAP_LINK_TYPE.GENERAL_RSD_FALLBACK &&
    mapLinkType !== FORENSIC_MAP_LINK_TYPE.NONE
  ) {
    if (mapLinkType === "OFFICIAL_EVENT") mapLinkType = FORENSIC_MAP_LINK_TYPE.DIRECT_EVENT;
    else if (mapLinkType === "VERIFIED_LOCATION") mapLinkType = FORENSIC_MAP_LINK_TYPE.VERIFIED_LOCATION;
    else if (mapLinkType === "GENERAL_RSD_MAP") mapLinkType = FORENSIC_MAP_LINK_TYPE.GENERAL_RSD_FALLBACK;
    else if (mapLinkType === "NONE") mapLinkType = FORENSIC_MAP_LINK_TYPE.NONE;
    else mapLinkType = null;
  }

  if (!mapLinkType) {
    const url = String(it.url || it.originalUrl || "").trim();
    let officialEvent = false;
    try {
      if (url) {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, "").toLowerCase();
        if (
          (host === "dopravniinfo.cz" || host.endsWith(".dopravniinfo.cz")) &&
          /\/event\//i.test(u.pathname)
        ) {
          officialEvent = true;
        }
      }
    } catch (_) {
      officialEvent = false;
    }
    if (officialEvent) mapLinkType = FORENSIC_MAP_LINK_TYPE.DIRECT_EVENT;
    else if (level === LOCATION_PRESENTATION_LEVEL.PRECISE) {
      mapLinkType = FORENSIC_MAP_LINK_TYPE.VERIFIED_LOCATION;
    } else if (level === LOCATION_PRESENTATION_LEVEL.NONE && !url) {
      mapLinkType = FORENSIC_MAP_LINK_TYPE.NONE;
    } else {
      mapLinkType = FORENSIC_MAP_LINK_TYPE.GENERAL_RSD_FALLBACK;
    }
  }

  return Object.freeze({
    locationPresentationLevel: level,
    mapLinkType,
  });
}
