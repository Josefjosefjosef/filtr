/** OpenLR support is coordinate-only: no map matching or inferred road data. */
export const OPENLR_STATUS = Object.freeze({
  RESOLVED: "OPENLR_RESOLVED",
  AMBIGUOUS: "OPENLR_AMBIGUOUS",
  INVALID: "OPENLR_INVALID",
  UNSUPPORTED_TYPE: "OPENLR_UNSUPPORTED_TYPE",
  REFERENCE_DATA_MISSING: "OPENLR_REFERENCE_DATA_MISSING",
  DECODE_FAILED: "OPENLR_DECODE_FAILED",
});

export const OPENLR_LOCATION_TYPE = Object.freeze({
  GEO_COORDINATE: "GEO_COORDINATE",
  POINT_ALONG_LINE: "POINT_ALONG_LINE",
  POI_ACCESS: "POI_ACCESS",
  LINE: "LINE",
  CIRCLE: "CIRCLE",
  RECTANGLE: "RECTANGLE",
  GRID: "GRID",
  POLYGON: "POLYGON",
  CLOSED_LINE: "CLOSED_LINE",
  UNKNOWN: "UNKNOWN",
});

export const OPENLR_FEATURES = Object.freeze({
  MAP_MATCHING: false,
  NETWORK_API: false,
  GEOCODING: false,
  HEURISTIC_LOCATION: false,
  BINARY_VERSIONS: Object.freeze([2, 3]),
});

export function isValidCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
