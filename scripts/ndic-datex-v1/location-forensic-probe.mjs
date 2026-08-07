/**
 * Forensic-only DATEX location presence + bucket helpers.
 * Never changes parse/localize/publication outcomes — counts/enums only.
 * No raw LCD, coordinates, XML, or event ids.
 */
import { descendantsNamed, childText } from "./safe-xml.mjs";

/** Primary TMC miss reasons (mutually exclusive per unresolved-TMC event). */
export const TMC_MISS_REASON = Object.freeze({
  CID_MISMATCH: "cid_mismatch",
  TABCD_MISMATCH: "tabcd_mismatch",
  LCD_NOT_FOUND: "lcd_not_found",
  POINT_LOOKUP_MISS: "point_lookup_miss",
  SEGMENT_LOOKUP_MISS: "segment_lookup_miss",
  AREA_LOOKUP_MISS: "area_lookup_miss",
  UNSUPPORTED_REFERENCE_TYPE: "unsupported_reference_type",
  UNSUPPORTED_DIRECTION: "unsupported_direction",
  UNSUPPORTED_OFFSET: "unsupported_offset",
  OTHER: "other",
});

/** Primary missing-reference location profile buckets. */
export const LOCATION_PROFILE_BUCKET = Object.freeze({
  ALERTC_POINT: "alertc_point",
  ALERTC_LINEAR: "alertc_linear",
  TMC_SPECIFIC_LOCATION: "tmc_specific_location",
  POINT_COORDINATES: "point_coordinates",
  OPENLR: "openlr",
  GML_POINT: "gml_point",
  GML_LINESTRING: "gml_linestring",
  GML_POLYGON: "gml_polygon",
  NETWORK_LOCATION: "network_location",
  SUPPLEMENTARY_POSITIONAL_DESCRIPTION: "supplementary_positional_description",
  TEXT_ONLY: "text_only",
  NO_LOCALIZATION_SIGNAL: "no_localization_signal",
  OTHER: "other",
});

/**
 * No-signal forensic subtypes (only when locationProfileBucket=no_localization_signal).
 * UNRECOGNIZED_* requires a real localization structure the parser cannot classify —
 * never metadata under a known profile, never empty wrappers alone.
 */
export const NO_SIGNAL_SUBTYPE = Object.freeze({
  EMPTY_LOCALIZATION: "empty_localization",
  NO_LOCATION_ELEMENT: "no_location_element",
  KNOWN_PROFILE_BUT_NO_USABLE_REFERENCE: "known_profile_but_no_usable_reference",
  UNRECOGNIZED_STANDARD_PROFILE: "unrecognized_standard_profile",
  UNRECOGNIZED_VENDOR_EXTENSION: "unrecognized_vendor_extension",
  LOCATION_EXTENSION_ONLY: "location_extension_only",
  TEXT_ONLY_LOCATION: "text_only_location",
  STRUCTURED_BUT_INCOMPLETE: "structured_but_incomplete",
  OTHER: "other_no_signal",
  /** @deprecated alias kept for one-cycle schema continuity */
  EMPTY_GROUP: "empty_localization",
  UNRECOGNIZED_PROFILE: "unrecognized_standard_profile",
});

/** DATEX II standard location roots the current parser does not resolve. */
const STANDARD_UNSUPPORTED_ROOTS = new Set([
  "alertcarea",
  "tpegpointlocation",
  "tpeglinearlocation",
  "tpegarealocation",
  "tpegframedpoint",
  "itinerary",
  "itinerarybyreference",
  "arealocation",
  "linearlocation",
  "pointlocation",
  "locationbygeometry",
  "locationbyreference",
  "singlelocation",
]);

/** Non-method / metadata children that must never imply an unrecognized profile. */
const NON_METHOD_ROOTS = new Set([
  "groupoflocations",
  "supplementarypositionaldescription",
  "locationdescriptor",
  "locationdescription",
  "namedarea",
  "roadinformation",
  "roadnumber",
  "roadname",
  "carriageway",
  "lane",
  "lanes",
  "lengthaffected",
  "destination",
  "directionrelative",
  "alertcdirection",
  "alertcdirectioncoded",
  "offsetdistance",
  "latitude",
  "longitude",
  "coordinatesfordisplay",
]);

function hasExact(node, name) {
  if (!node) return false;
  return descendantsNamed(node, name, 1).length > 0;
}

function localName(node) {
  return String((node && node.name) || "").toLowerCase();
}

function isOpenlrName(name) {
  return name.includes("openlr");
}

function isSupportedMethodName(name) {
  if (!name) return false;
  if (isOpenlrName(name)) return true;
  return (
    name === "alertcpoint" ||
    name === "alertclinear" ||
    name === "specificlocation" ||
    name === "pointcoordinates" ||
    name === "pointbycoordinates" ||
    name === "networklocation" ||
    name === "linestring" ||
    name === "polygon" ||
    name === "point" ||
    name === "gml"
  );
}

function isVendorExtensionName(name) {
  return /^(ndic|rsd|cze|cz[_-]|ext[_-]|extension)/.test(name) || name.includes("extension");
}

function isLocationMethodLike(name) {
  if (!name || NON_METHOD_ROOTS.has(name)) return false;
  if (isSupportedMethodName(name)) return false;
  if (STANDARD_UNSUPPORTED_ROOTS.has(name)) return true;
  if (isVendorExtensionName(name)) return true;
  // Strict: only explicit *Location / *Referencing method roots, not any "point/area" substring.
  return (
    /(locationreference|locationreferencing|arealocation|linearlocation|pointlocation|tpeg|itinerary|alertcarea)$/.test(
      name
    ) || /^(area|linear|point)location$/.test(name)
  );
}

/**
 * Presence flags from groupOfLocations (or equivalent) — detection only.
 * @param {object|null|undefined} locNode
 */
export function extractLocationPresenceFlags(locNode) {
  const flags = {
    hasAlertCPoint: false,
    hasAlertCLinear: false,
    hasAlertCArea: false,
    hasSpecificLocation: false,
    hasPointCoordinates: false,
    pointCoordinatesValid: false,
    hasOpenLR: false,
    hasOpenlrLine: false,
    hasOpenlrPoint: false,
    hasOpenlrGeo: false,
    hasOpenlrArea: false,
    hasOpenlrBinary: false,
    hasGmlPoint: false,
    hasGmlLineString: false,
    hasGmlPolygon: false,
    hasNetworkLocation: false,
    hasSupplementaryPositionalDescription: false,
    hasTpegLocation: false,
    hasItinerary: false,
    hasLocationExtension: false,
    hasUnrecognizedLocationProfile: false,
    hasUnrecognizedStandardProfile: false,
    hasUnrecognizedVendorExtension: false,
    groupOfLocationsEmpty: false,
    hasNonLocationChildrenOnly: false,
  };
  if (!locNode) {
    flags.groupOfLocationsEmpty = true;
    return flags;
  }

  flags.hasAlertCPoint = hasExact(locNode, "alertCPoint");
  flags.hasAlertCLinear = hasExact(locNode, "alertCLinear");
  flags.hasAlertCArea = hasExact(locNode, "alertCArea");
  flags.hasSpecificLocation = hasExact(locNode, "specificLocation");
  flags.hasPointCoordinates = hasExact(locNode, "pointCoordinates");
  flags.hasNetworkLocation = hasExact(locNode, "networkLocation");
  flags.hasSupplementaryPositionalDescription = hasExact(
    locNode,
    "supplementaryPositionalDescription"
  );
  flags.hasGmlLineString = hasExact(locNode, "LineString");
  flags.hasGmlPolygon = hasExact(locNode, "Polygon");
  flags.hasGmlPoint = hasExact(locNode, "Point");
  flags.hasTpegLocation =
    hasExact(locNode, "tpegPointLocation") ||
    hasExact(locNode, "tpegLinearLocation") ||
    hasExact(locNode, "tpegAreaLocation") ||
    hasExact(locNode, "tpegFramedPoint");
  flags.hasItinerary = hasExact(locNode, "itinerary") || hasExact(locNode, "itineraryByReference");
  flags.hasLocationExtension =
    hasExact(locNode, "locationExtension") || hasExact(locNode, "groupOfLocationsExtension");

  // OpenLR presence (descendant names) — never marks unrecognized.
  const stack = [locNode];
  let n = 0;
  while (stack.length && n < 8000) {
    const cur = stack.pop();
    n += 1;
    const name = localName(cur);
    if (isOpenlrName(name)) {
      flags.hasOpenLR = true;
      if (/linear|line.*location/.test(name)) flags.hasOpenlrLine = true;
      if (/point.*location|point.*along|poi/.test(name)) flags.hasOpenlrPoint = true;
      if (/geo.*coordinate/.test(name)) flags.hasOpenlrGeo = true;
      if (/circle|rectangle|grid|polygon|closed/.test(name)) flags.hasOpenlrArea = true;
      if (/binary|asbinary/.test(name)) flags.hasOpenlrBinary = true;
    }
    for (const child of cur.children || []) stack.push(child);
  }

  const kids = Array.isArray(locNode.children) ? locNode.children : [];
  flags.groupOfLocationsEmpty = kids.length === 0;

  const hasKnownSupported =
    flags.hasAlertCPoint ||
    flags.hasAlertCLinear ||
    flags.hasOpenLR ||
    flags.hasPointCoordinates ||
    flags.hasNetworkLocation ||
    flags.hasGmlPoint ||
    flags.hasGmlLineString ||
    flags.hasGmlPolygon ||
    flags.hasSupplementaryPositionalDescription;
  // Note: hasSpecificLocation alone is NOT enough — it also appears inside
  // unsupported Alert-C Area / TPEG containers and must not suppress them.

  // Unrecognized = real location METHOD root we do not classify — never when a known
  // supported profile is already present (avoids metadata / wrapper false-positives).
  if (!hasKnownSupported && !flags.groupOfLocationsEmpty) {
    let methodLike = 0;
    let nonMethod = 0;
    for (const child of kids) {
      const name = localName(child);
      if (!name) continue;
      if (NON_METHOD_ROOTS.has(name) || isSupportedMethodName(name)) {
        nonMethod += 1;
        continue;
      }
      if (STANDARD_UNSUPPORTED_ROOTS.has(name)) {
        flags.hasUnrecognizedStandardProfile = true;
        methodLike += 1;
        continue;
      }
      if (name === "locationextension" || name === "groupoflocationsextension") {
        flags.hasLocationExtension = true;
        methodLike += 1;
        continue;
      }
      if (isVendorExtensionName(name)) {
        flags.hasUnrecognizedVendorExtension = true;
        methodLike += 1;
        continue;
      }
      if (isLocationMethodLike(name)) {
        flags.hasUnrecognizedStandardProfile = true;
        methodLike += 1;
        continue;
      }
      nonMethod += 1;
    }
    if (flags.hasAlertCArea || flags.hasTpegLocation || flags.hasItinerary) {
      flags.hasUnrecognizedStandardProfile = true;
    }
    flags.hasUnrecognizedLocationProfile =
      flags.hasUnrecognizedStandardProfile || flags.hasUnrecognizedVendorExtension;
    flags.hasNonLocationChildrenOnly = methodLike === 0 && nonMethod > 0 && !flags.hasUnrecognizedLocationProfile;
  }

  return flags;
}

/** Anonymous LCD miss class — never returns raw LCD. */
export const LCD_MISS_CLASS = Object.freeze({
  POINT: "point_in_lt",
  SEGMENT: "segment_in_lt",
  AREA: "area_in_lt",
  IN_CODES_ONLY: "in_codes_only",
  ORPHAN_NOT_IN_LT: "orphan_not_in_lt",
});

/**
 * @param {object|null|undefined} table
 * @param {unknown} locationCode
 */
export function classifyLcdMissClass(table, locationCode) {
  const key = locationCode != null ? String(locationCode) : "";
  if (!key) return LCD_MISS_CLASS.ORPHAN_NOT_IN_LT;
  const side =
    table && table.forensicLcdClass && typeof table.forensicLcdClass === "object"
      ? table.forensicLcdClass
      : null;
  const cls = side ? side[key] : null;
  if (cls === "P") return LCD_MISS_CLASS.POINT;
  if (cls === "L") return LCD_MISS_CLASS.SEGMENT;
  if (cls === "A") return LCD_MISS_CLASS.AREA;
  const codes = table && table.forensicLocationCodes;
  if (codes && typeof codes.has === "function" && codes.has(key)) return LCD_MISS_CLASS.IN_CODES_ONLY;
  return LCD_MISS_CLASS.ORPHAN_NOT_IN_LT;
}

/**
 * Classify no-signal events only. Does not alter trust/resolver.
 * @param {object} presence
 * @param {string} [trust]
 */
export function chooseNoSignalSubtype(presence, trust) {
  const p = presence || {};
  if (p.groupOfLocationsEmpty === true) return NO_SIGNAL_SUBTYPE.EMPTY_LOCALIZATION;

  if (p.hasLocationExtension && !p.hasUnrecognizedStandardProfile && !p.hasUnrecognizedVendorExtension) {
    return NO_SIGNAL_SUBTYPE.LOCATION_EXTENSION_ONLY;
  }
  if (p.hasUnrecognizedVendorExtension) return NO_SIGNAL_SUBTYPE.UNRECOGNIZED_VENDOR_EXTENSION;
  if (
    p.hasUnrecognizedStandardProfile ||
    p.hasAlertCArea ||
    p.hasTpegLocation ||
    p.hasItinerary
  ) {
    return NO_SIGNAL_SUBTYPE.UNRECOGNIZED_STANDARD_PROFILE;
  }
  if (trust === "text") return NO_SIGNAL_SUBTYPE.TEXT_ONLY_LOCATION;
  if (p.hasNonLocationChildrenOnly) return NO_SIGNAL_SUBTYPE.NO_LOCATION_ELEMENT;
  return NO_SIGNAL_SUBTYPE.OTHER;
}

/**
 * Parallel coord probe — must not change extractCoordinates return semantics.
 * @param {object|null|undefined} locNode
 * @param {{lat:number,lon:number}|null} extractedCoordinates return value of extractCoordinates
 */
export function buildCoordinateProbe(locNode, extractedCoordinates) {
  const present = hasExact(locNode, "pointCoordinates");
  let parsed = false;
  let validFromXml = false;
  if (present && locNode) {
    const pts = descendantsNamed(locNode, "pointCoordinates", 8);
    for (const p of pts) {
      const latRaw = childText(p, "latitude");
      const lonRaw = childText(p, "longitude");
      if (latRaw !== "" || lonRaw !== "") parsed = true;
      const lat = Number(latRaw);
      const lon = Number(lonRaw);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        validFromXml = true;
        parsed = true;
        break;
      }
    }
  }
  const valid = extractedCoordinates != null && validFromXml;
  return {
    present,
    parsed: present ? parsed || validFromXml : false,
    valid: Boolean(valid),
  };
}

/**
 * Choose one primary profile bucket for an unresolved-missing event.
 * Priority prefers richer / standard profiles that the pipeline may not resolve.
 */
export function chooseLocationProfileBucket(presence, trust) {
  const p = presence || {};
  if (p.hasOpenLR) return LOCATION_PROFILE_BUCKET.OPENLR;
  if (p.hasGmlPolygon) return LOCATION_PROFILE_BUCKET.GML_POLYGON;
  if (p.hasGmlLineString) return LOCATION_PROFILE_BUCKET.GML_LINESTRING;
  if (p.hasGmlPoint) return LOCATION_PROFILE_BUCKET.GML_POINT;
  if (p.hasNetworkLocation) return LOCATION_PROFILE_BUCKET.NETWORK_LOCATION;
  if (p.hasSupplementaryPositionalDescription) {
    return LOCATION_PROFILE_BUCKET.SUPPLEMENTARY_POSITIONAL_DESCRIPTION;
  }
  if (p.hasAlertCLinear) return LOCATION_PROFILE_BUCKET.ALERTC_LINEAR;
  if (p.hasAlertCPoint) return LOCATION_PROFILE_BUCKET.ALERTC_POINT;
  if (p.hasSpecificLocation) return LOCATION_PROFILE_BUCKET.TMC_SPECIFIC_LOCATION;
  if (p.hasPointCoordinates || p.pointCoordinatesValid) return LOCATION_PROFILE_BUCKET.POINT_COORDINATES;
  if (trust === "text") return LOCATION_PROFILE_BUCKET.TEXT_ONLY;
  if (trust === "national_fallback" || trust === "none" || !trust) {
    return LOCATION_PROFILE_BUCKET.NO_LOCALIZATION_SIGNAL;
  }
  return LOCATION_PROFILE_BUCKET.OTHER;
}

/**
 * Classify LCD miss using optional forensic side-index on the TMC table.
 * @param {object|null|undefined} table
 * @param {unknown} locationCode
 * @param {string} [refKind]
 */
export function classifyLcdMiss(table, locationCode, refKind) {
  const key = locationCode != null ? String(locationCode) : "";
  const side =
    table && table.forensicLcdClass && typeof table.forensicLcdClass === "object"
      ? table.forensicLcdClass
      : null;
  const cls = key && side ? side[key] : null;
  if (cls === "L") return TMC_MISS_REASON.SEGMENT_LOOKUP_MISS;
  if (cls === "A") return TMC_MISS_REASON.AREA_LOOKUP_MISS;
  if (cls === "P") return TMC_MISS_REASON.POINT_LOOKUP_MISS;
  const kind = String(refKind || "").toLowerCase();
  if (kind === "point") return TMC_MISS_REASON.POINT_LOOKUP_MISS;
  if (kind === "linear") return TMC_MISS_REASON.LCD_NOT_FOUND;
  return TMC_MISS_REASON.LCD_NOT_FOUND;
}

/**
 * Pick primary miss reason from ordered list of per-ref reasons (first highest priority).
 * @param {string[]} reasons
 */
export function choosePrimaryTmcMissReason(reasons) {
  const list = Array.isArray(reasons) ? reasons : [];
  const order = [
    TMC_MISS_REASON.CID_MISMATCH,
    TMC_MISS_REASON.TABCD_MISMATCH,
    TMC_MISS_REASON.UNSUPPORTED_REFERENCE_TYPE,
    TMC_MISS_REASON.UNSUPPORTED_DIRECTION,
    TMC_MISS_REASON.UNSUPPORTED_OFFSET,
    TMC_MISS_REASON.SEGMENT_LOOKUP_MISS,
    TMC_MISS_REASON.AREA_LOOKUP_MISS,
    TMC_MISS_REASON.POINT_LOOKUP_MISS,
    TMC_MISS_REASON.LCD_NOT_FOUND,
    TMC_MISS_REASON.OTHER,
  ];
  for (const r of order) {
    if (list.includes(r)) return r;
  }
  return TMC_MISS_REASON.OTHER;
}

export function emptyTmcMissReasonCounts() {
  return {
    [TMC_MISS_REASON.CID_MISMATCH]: 0,
    [TMC_MISS_REASON.TABCD_MISMATCH]: 0,
    [TMC_MISS_REASON.LCD_NOT_FOUND]: 0,
    [TMC_MISS_REASON.POINT_LOOKUP_MISS]: 0,
    [TMC_MISS_REASON.SEGMENT_LOOKUP_MISS]: 0,
    [TMC_MISS_REASON.AREA_LOOKUP_MISS]: 0,
    [TMC_MISS_REASON.UNSUPPORTED_REFERENCE_TYPE]: 0,
    [TMC_MISS_REASON.UNSUPPORTED_DIRECTION]: 0,
    [TMC_MISS_REASON.UNSUPPORTED_OFFSET]: 0,
    [TMC_MISS_REASON.OTHER]: 0,
  };
}

export function emptyLocationProfileCounts() {
  return {
    [LOCATION_PROFILE_BUCKET.ALERTC_POINT]: 0,
    [LOCATION_PROFILE_BUCKET.ALERTC_LINEAR]: 0,
    [LOCATION_PROFILE_BUCKET.TMC_SPECIFIC_LOCATION]: 0,
    [LOCATION_PROFILE_BUCKET.POINT_COORDINATES]: 0,
    [LOCATION_PROFILE_BUCKET.OPENLR]: 0,
    [LOCATION_PROFILE_BUCKET.GML_POINT]: 0,
    [LOCATION_PROFILE_BUCKET.GML_LINESTRING]: 0,
    [LOCATION_PROFILE_BUCKET.GML_POLYGON]: 0,
    [LOCATION_PROFILE_BUCKET.NETWORK_LOCATION]: 0,
    [LOCATION_PROFILE_BUCKET.SUPPLEMENTARY_POSITIONAL_DESCRIPTION]: 0,
    [LOCATION_PROFILE_BUCKET.TEXT_ONLY]: 0,
    [LOCATION_PROFILE_BUCKET.NO_LOCALIZATION_SIGNAL]: 0,
    [LOCATION_PROFILE_BUCKET.OTHER]: 0,
  };
}
