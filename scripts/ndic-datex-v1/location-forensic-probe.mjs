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

function hasExact(node, name) {
  if (!node) return false;
  return descendantsNamed(node, name, 1).length > 0;
}

function walkNames(node, maxNodes, visit) {
  if (!node) return;
  let n = 0;
  const stack = [node];
  while (stack.length && n < maxNodes) {
    const cur = stack.pop();
    n += 1;
    visit(String(cur && cur.name != null ? cur.name : "").toLowerCase());
    const kids = (cur && cur.children) || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
}

/**
 * Presence flags from groupOfLocations (or equivalent) — detection only.
 * @param {object|null|undefined} locNode
 */
export function extractLocationPresenceFlags(locNode) {
  const flags = {
    hasAlertCPoint: false,
    hasAlertCLinear: false,
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
  };
  if (!locNode) return flags;

  flags.hasAlertCPoint = hasExact(locNode, "alertCPoint");
  flags.hasAlertCLinear = hasExact(locNode, "alertCLinear");
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

  // OpenLR: any element local-name containing "openlr" (DATEX II variants).
  walkNames(locNode, 8000, (name) => {
    if (!name.includes("openlr")) return;
    flags.hasOpenLR = true;
    if (/linear|line.*location/.test(name)) flags.hasOpenlrLine = true;
    if (/point.*location|point.*along|poi/.test(name)) flags.hasOpenlrPoint = true;
    if (/geo.*coordinate/.test(name)) flags.hasOpenlrGeo = true;
    if (/circle|rectangle|grid|polygon|closed/.test(name)) flags.hasOpenlrArea = true;
    if (/binary|asbinary/.test(name)) flags.hasOpenlrBinary = true;
  });

return flags;
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
  // Business validity mirrors extractCoordinates success (identical acceptance rule).
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
  const side = table && table.forensicLcdClass && typeof table.forensicLcdClass === "object"
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
