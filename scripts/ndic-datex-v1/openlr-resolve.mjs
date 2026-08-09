import { decodeOpenlrBinary } from "./openlr-binary-decode.mjs";
import { OPENLR_LOCATION_TYPE, OPENLR_STATUS, isValidCoordinate } from "./openlr-constants.mjs";

function result(status, extra = {}) {
  const resolved = status === OPENLR_STATUS.RESOLVED && isValidCoordinate(extra.lat, extra.lon);
  return {
    status, type: extra.type || OPENLR_LOCATION_TYPE.UNKNOWN, lat: resolved ? extra.lat : null, lon: resolved ? extra.lon : null,
    lrpCount: Number(extra.lrpCount) || 0, directionDocumented: extra.directionDocumented === true,
    directionLabel: "", offsetPositive: null, offsetNegative: null,
    failureReason: resolved ? "" : String(extra.failureReason || status), publicationEligible: resolved,
  };
}
function validRef(ref) {
  return ref && Array.isArray(ref.coordinates) && ref.coordinates.length &&
    isValidCoordinate(ref.coordinates[0].lat, ref.coordinates[0].lon);
}
function isMapRequired(type) {
  return [OPENLR_LOCATION_TYPE.CLOSED_LINE, OPENLR_LOCATION_TYPE.GRID, OPENLR_LOCATION_TYPE.POLYGON].includes(type);
}

/** Resolve only payload-provided WGS84 coordinates; never map-match. */
export function resolveOpenlrLocation(extracted) {
  const refs = extracted && Array.isArray(extracted.refs) ? extracted.refs : [];
  const flags = (extracted && extracted.presenceFlags) || {};
  if (!refs.length) {
    if (flags.hasOpenLR || flags.hasOpenlr) {
      return result(OPENLR_STATUS.UNSUPPORTED_TYPE, { failureReason: "openlr_present_without_supported_payload" });
    }
    return result(OPENLR_STATUS.DECODE_FAILED, { failureReason: "no_valid_openlr_reference" });
  }
  const candidates = [];
  let failure = null;
  let binaryIndex = 0;
  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i] || {};
    if (ref.offsets && Object.values(ref.offsets).some((v) => v != null && (!Number.isFinite(v) || v < 0))) {
      failure ||= result(OPENLR_STATUS.INVALID, { type: ref.type, failureReason: "invalid_offset" });
      continue;
    }
    if (ref.encoding === "xml") {
      if (isMapRequired(ref.type)) { failure ||= result(OPENLR_STATUS.REFERENCE_DATA_MISSING, { type: ref.type, failureReason: "map_reference_required" }); continue; }
      if (validRef(ref)) candidates.push({ type: ref.type, coordinates: ref.coordinates, directionDocumented: Boolean(ref.orientation) });
      else failure ||= result(OPENLR_STATUS.INVALID, { type: ref.type, failureReason: "invalid_xml_coordinate" });
      continue;
    }
    if (ref.encoding === "binary") {
      const raw = refs._binaryInputs && refs._binaryInputs[binaryIndex++];
      const decoded = raw ? decodeOpenlrBinary(raw) : null;
      if (!decoded) { failure ||= result(OPENLR_STATUS.DECODE_FAILED, { type: ref.type, failureReason: "binary_input_unavailable" }); continue; }
      if (decoded.ok && decoded.coordinates.length) candidates.push(decoded);
      else failure ||= result(decoded.status || OPENLR_STATUS.DECODE_FAILED, { type: decoded.type || ref.type, failureReason: decoded.error });
    }
  }
  if (!candidates.length) return failure || result(OPENLR_STATUS.DECODE_FAILED);
  const first = candidates[0].coordinates[0];
  for (const candidate of candidates.slice(1)) {
    const point = candidate.coordinates[0];
    // ~11m tolerance makes duplicated encodings of one reference non-conflicting.
    if (Math.abs(point.lat - first.lat) > 0.0001 || Math.abs(point.lon - first.lon) > 0.0001) {
      return result(OPENLR_STATUS.AMBIGUOUS, { failureReason: "conflicting_payload_coordinates" });
    }
  }
  return result(OPENLR_STATUS.RESOLVED, {
    type: candidates[0].type, lat: first.lat, lon: first.lon, lrpCount: candidates[0].coordinates.length,
    directionDocumented: candidates[0].directionDocumented === true,
  });
}
