/**
 * Minimal OpenLR physical-format decoder. It deliberately stops before map
 * matching: decoded LRPs are WGS84 evidence, not a road/network resolution.
 *
 * OpenLR's published binary examples encode absolute coordinates as signed
 * 24-bit values scaled by 360 / 2^24. Relative LRP deltas use signed 16-bit
 * values at the same scale. (DATEX XML supplies decimal WGS84 directly.)
 */
import { OPENLR_LOCATION_TYPE, OPENLR_STATUS, isValidCoordinate } from "./openlr-constants.mjs";

const ABS_SCALE = 360 / 0x1000000;

function signed24(a, b, c) {
  const n = (a << 16) | (b << 8) | c;
  return n & 0x800000 ? n - 0x1000000 : n;
}
function bytesFrom(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())) throw new Error("invalid_base64");
  const out = Buffer.from(value.trim(), "base64");
  if (!out.length) throw new Error("empty_binary");
  return out;
}
function coordinateAt(bytes, pos) {
  if (pos + 6 > bytes.length) throw new Error("truncated_coordinate");
  const lon = signed24(bytes[pos], bytes[pos + 1], bytes[pos + 2]) * ABS_SCALE;
  const lat = signed24(bytes[pos + 3], bytes[pos + 4], bytes[pos + 5]) * ABS_SCALE;
  if (!isValidCoordinate(lat, lon)) throw new Error("coordinate_range");
  return { coordinate: { lat, lon }, next: pos + 6 };
}
function signed16(hi, lo) {
  const n = (hi << 8) | lo;
  return n & 0x8000 ? n - 0x10000 : n;
}
function readRelative(bytes, pos, previous) {
  // OpenLR physical format: relative lon/lat are signed 16-bit at ABS_SCALE.
  if (pos + 4 > bytes.length) throw new Error("truncated_lrp");
  const lon = previous.lon + signed16(bytes[pos], bytes[pos + 1]) * ABS_SCALE;
  const lat = previous.lat + signed16(bytes[pos + 2], bytes[pos + 3]) * ABS_SCALE;
  if (!isValidCoordinate(lat, lon)) throw new Error("coordinate_range");
  return { coordinate: { lat, lon }, next: pos + 4 };
}
function typeFromHeader(header) {
  // The low five bits are the OpenLR location type field in physical format.
  // 0x0b is the documented line-location header used by the white-paper demo.
  const code = header & 0x1f;
  if (code === 0x0b || code === 0x01) return OPENLR_LOCATION_TYPE.LINE;
  if (code === 0x08) return OPENLR_LOCATION_TYPE.GEO_COORDINATE;
  if (code === 0x09) return OPENLR_LOCATION_TYPE.POINT_ALONG_LINE;
  if (code === 0x0a) return OPENLR_LOCATION_TYPE.POI_ACCESS;
  if (code === 0x0c) return OPENLR_LOCATION_TYPE.CIRCLE;
  if (code === 0x0d) return OPENLR_LOCATION_TYPE.RECTANGLE;
  if (code === 0x0e) return OPENLR_LOCATION_TYPE.GRID;
  if (code === 0x0f) return OPENLR_LOCATION_TYPE.POLYGON;
  if (code === 0x10) return OPENLR_LOCATION_TYPE.CLOSED_LINE;
  return OPENLR_LOCATION_TYPE.UNKNOWN;
}
function failure(type, error) {
  return { ok: false, status: OPENLR_STATUS.DECODE_FAILED, type, coordinates: [], error: String(error || "decode_failed") };
}

/** Decode a Base64 string or Buffer without retaining the source payload. */
export function decodeOpenlrBinary(input) {
  let bytes;
  try {
    bytes = bytesFrom(input);
  } catch (error) {
    return failure(OPENLR_LOCATION_TYPE.UNKNOWN, error.message);
  }
  const header = bytes[0];
  const type = typeFromHeader(header);
  // The physical format version is encoded in header bits 5..7. Versions
  // observed in DATEX/OpenLR v2/v3 retain compatible LRP coordinate fields.
  const version = (header >>> 5) & 0x07;
  try {
    if (type === OPENLR_LOCATION_TYPE.UNKNOWN) {
      return { ok: false, status: OPENLR_STATUS.UNSUPPORTED_TYPE, type, coordinates: [], version, error: "unsupported_header_type" };
    }
    if ([OPENLR_LOCATION_TYPE.CLOSED_LINE, OPENLR_LOCATION_TYPE.GRID, OPENLR_LOCATION_TYPE.POLYGON].includes(type)) {
      return { ok: false, status: OPENLR_STATUS.REFERENCE_DATA_MISSING, type, coordinates: [], version, error: "map_reference_required" };
    }
    const first = coordinateAt(bytes, 1);
    const coordinates = [first.coordinate];
    if (type === OPENLR_LOCATION_TYPE.GEO_COORDINATE) {
      return { ok: true, status: OPENLR_STATUS.RESOLVED, type, coordinates, version, lrpCount: 1 };
    }
    if ([OPENLR_LOCATION_TYPE.CIRCLE, OPENLR_LOCATION_TYPE.RECTANGLE].includes(type)) {
      return { ok: true, status: OPENLR_STATUS.RESOLVED, type, coordinates, version, lrpCount: 1 };
    }
    // LRP attribute bytes follow every location reference point. The first
    // LRP has three attributes; subsequent LRPs start with signed deltas then
    // attributes. We expose only coordinates that are completely present.
    // First LRP attrs = 3 bytes; each following LRP = 4-byte relative + 3 attrs.
    let pos = first.next + 3;
    let previous = first.coordinate;
    while (pos + 7 <= bytes.length) {
      const rel = readRelative(bytes, pos, previous);
      coordinates.push(rel.coordinate);
      previous = rel.coordinate;
      pos = rel.next + 3;
    }
    if (type === OPENLR_LOCATION_TYPE.POI_ACCESS || type === OPENLR_LOCATION_TYPE.POINT_ALONG_LINE) {
      return {
        ok: true, status: OPENLR_STATUS.RESOLVED, type, coordinates, version, lrpCount: coordinates.length,
        orientation: "DOCUMENTED_CODE_PRESENT",
      };
    }
    return { ok: true, status: OPENLR_STATUS.RESOLVED, type, coordinates, version, lrpCount: coordinates.length };
  } catch (error) {
    return failure(type, error.message);
  }
}

export const OPENLR_BINARY_ABSOLUTE_SCALE = ABS_SCALE;
