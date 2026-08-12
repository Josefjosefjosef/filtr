/**
 * Authoritative SMV (silnice pro motorová vozidla) resolver.
 * Priority: explicit DATEX/card flag → geo match vs ŘSD ULS Layer 5 →
 * linear stationing (road + km) → unknown (fail closed).
 * NEVER treats whole road numbers as SMV.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SMV_STATUS = Object.freeze({
  TRUE: "true",
  FALSE: "false",
  UNKNOWN: "unknown",
});

export const SMV_SOURCE = Object.freeze({
  DATEX: "datex",
  RSD_ULS: "rsd-uls",
  NONE: "none",
});

export const SMV_ULS_LAYER = Object.freeze({
  endpoint: "https://geoportal.rsd.cz/arcgis/rest/services/WMS_ULS/MapServer/5",
  layerId: 5,
  layerName: "Silnice pro motorová vozidla",
});

/** Max point→polyline distance (metres) for a positive geo match. */
export const SMV_GEO_MATCH_MAX_M = 35;
/** Second-nearest must be farther by this margin, else ambiguous. */
export const SMV_GEO_AMBIGUOUS_MARGIN_M = 15;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultSmvReferencePaths(repoRoot = process.cwd()) {
  return [
    path.join(repoRoot, ".cache", "ndic-datex-v1", "smv-uls-reference-v1.json"),
    path.join(repoRoot, "projects", "data", "info_events", "ndic_datex_v1", "smv_uls_reference_v1.json"),
    path.join(__dirname, "fixtures", "smv-uls-reference-fixture.json"),
  ];
}

export function loadSmvReference(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  if (!json || !Array.isArray(json.segments)) return null;
  return json;
}

export function loadSmvReferenceFromRepo(repoRoot = process.cwd()) {
  for (const p of defaultSmvReferencePaths(repoRoot)) {
    const ref = loadSmvReference(p);
    if (ref && ref.segments.length) return { ref, path: p };
  }
  return { ref: null, path: null };
}

export function normalizeSmvRoadKey(road) {
  const s = String(road || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if (!s) return "";
  if (/^D\d+/i.test(s) || /^R\d+/i.test(s)) return s.replace(/\s+/g, "");
  const m = s.match(/^(?:I|II|III)\s*\/?\s*(\d+)/i) || s.match(/^(\d+)/);
  return m ? String(Number(m[1])) : s;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distPointToSegmentM(lat, lon, a, b) {
  // Equirectangular local projection around the point (metres).
  const toRad = (d) => (d * Math.PI) / 180;
  const lat0 = toRad(lat);
  const x = (lng) => (toRad(lng) - toRad(lon)) * Math.cos(lat0) * 6371000;
  const y = (la) => (toRad(la) - lat0) * 6371000;
  const ax = x(a[0]);
  const ay = y(a[1]);
  const bx = x(b[0]);
  const by = y(b[1]);
  const px = 0;
  const py = 0;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 <= 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function distPointToPathsM(lat, lon, paths) {
  let best = Infinity;
  for (const pathPts of paths || []) {
    for (let i = 1; i < pathPts.length; i++) {
      const d = distPointToSegmentM(lat, lon, pathPts[i - 1], pathPts[i]);
      if (d < best) best = d;
    }
    if (pathPts.length === 1) {
      const p = pathPts[0];
      const d = haversineM(lat, lon, p[1], p[0]);
      if (d < best) best = d;
    }
  }
  return best;
}

function inBBox(lat, lon, bbox, padDeg = 0.0004) {
  if (!bbox || bbox.length < 4) return true;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return (
    lon >= minLon - padDeg &&
    lon <= maxLon + padDeg &&
    lat >= minLat - padDeg &&
    lat <= maxLat + padDeg
  );
}

function kilometerToMeters(km) {
  const n = Number(String(km).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000);
}

function stationingContains(seg, meters) {
  if (meters == null || seg.fromM == null || seg.toM == null) return false;
  const a = Math.min(seg.fromM, seg.toM);
  const b = Math.max(seg.fromM, seg.toM);
  // Point-like ULS stubs (from==to) are not usable for linear match alone.
  if (b - a < 50) return false;
  return meters >= a - 25 && meters <= b + 25;
}

function explicitSmvDecision(input = {}) {
  if (input.motorVehicleRoadConfirmed === true || input.isMotorVehicleRoad === true) {
    return {
      status: SMV_STATUS.TRUE,
      isMotorVehicleRoad: true,
      motorVehicleRoadSource: SMV_SOURCE.DATEX,
      reason: "explicit_true",
    };
  }
  if (
    String(input.roadFacilityType || "").toUpperCase() === "MOTOR_VEHICLE_ROAD"
  ) {
    return {
      status: SMV_STATUS.TRUE,
      isMotorVehicleRoad: true,
      motorVehicleRoadSource: SMV_SOURCE.DATEX,
      reason: "explicit_facility_type",
    };
  }
  if (input.motorVehicleRoadConfirmed === false || input.isMotorVehicleRoad === false) {
    return {
      status: SMV_STATUS.FALSE,
      isMotorVehicleRoad: false,
      motorVehicleRoadSource: SMV_SOURCE.DATEX,
      reason: "explicit_false",
    };
  }
  if (String(input.motorVehicleRoadStatus || "").toLowerCase() === SMV_STATUS.TRUE) {
    return {
      status: SMV_STATUS.TRUE,
      isMotorVehicleRoad: true,
      motorVehicleRoadSource: input.motorVehicleRoadSource || SMV_SOURCE.DATEX,
      reason: "status_true",
    };
  }
  if (String(input.motorVehicleRoadStatus || "").toLowerCase() === SMV_STATUS.FALSE) {
    return {
      status: SMV_STATUS.FALSE,
      isMotorVehicleRoad: false,
      motorVehicleRoadSource: input.motorVehicleRoadSource || SMV_SOURCE.DATEX,
      reason: "status_false",
    };
  }
  return null;
}

/**
 * @param {object} input
 * @param {object|null} reference SMV ULS compact reference
 */
export function resolveMotorVehicleRoad(input = {}, reference = null) {
  const explicit = explicitSmvDecision(input);
  if (explicit) return explicit;

  const roadKey = normalizeSmvRoadKey(input.road || input.roadNumber);
  // Motorways are never classified as SMV icon targets.
  if (/^D\d+/i.test(String(input.road || input.roadNumber || ""))) {
    return {
      status: SMV_STATUS.FALSE,
      isMotorVehicleRoad: false,
      motorVehicleRoadSource: SMV_SOURCE.NONE,
      reason: "motorway_not_smv",
    };
  }

  const lat = input.lat != null ? Number(input.lat) : Number(input.latitude);
  const lon = input.lon != null ? Number(input.lon) : Number(input.longitude);
  const hasCoords =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0);

  const ref = reference && Array.isArray(reference.segments) ? reference : null;
  if (!ref) {
    return {
      status: SMV_STATUS.UNKNOWN,
      isMotorVehicleRoad: null,
      motorVehicleRoadSource: SMV_SOURCE.NONE,
      reason: "reference_missing",
    };
  }

  if (hasCoords) {
    const candidates = [];
    for (const seg of ref.segments) {
      if (roadKey && seg.road && seg.road !== roadKey) continue;
      if (!inBBox(lat, lon, seg.bbox)) continue;
      const d = distPointToPathsM(lat, lon, seg.paths);
      if (d <= SMV_GEO_MATCH_MAX_M + 40) candidates.push({ seg, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    if (!candidates.length) {
      // Coords present + road known + no nearby SMV → false (not on SMV network).
      if (roadKey) {
        return {
          status: SMV_STATUS.FALSE,
          isMotorVehicleRoad: false,
          motorVehicleRoadSource: SMV_SOURCE.RSD_ULS,
          reason: "geo_no_nearby_smv",
          distanceM: null,
        };
      }
      return {
        status: SMV_STATUS.UNKNOWN,
        isMotorVehicleRoad: null,
        motorVehicleRoadSource: SMV_SOURCE.NONE,
        reason: "geo_no_candidates",
      };
    }
    const best = candidates[0];
    const second = candidates[1];
    if (best.d > SMV_GEO_MATCH_MAX_M) {
      return {
        status: SMV_STATUS.FALSE,
        isMotorVehicleRoad: false,
        motorVehicleRoadSource: SMV_SOURCE.RSD_ULS,
        reason: "geo_too_far",
        distanceM: Math.round(best.d * 10) / 10,
      };
    }
    if (second && second.d - best.d < SMV_GEO_AMBIGUOUS_MARGIN_M && second.seg.road !== best.seg.road) {
      return {
        status: SMV_STATUS.UNKNOWN,
        isMotorVehicleRoad: null,
        motorVehicleRoadSource: SMV_SOURCE.NONE,
        reason: "geo_ambiguous",
        distanceM: Math.round(best.d * 10) / 10,
      };
    }
    return {
      status: SMV_STATUS.TRUE,
      isMotorVehicleRoad: true,
      motorVehicleRoadSource: SMV_SOURCE.RSD_ULS,
      reason: "geo_match",
      distanceM: Math.round(best.d * 10) / 10,
      matchedRoad: best.seg.road,
      matchedSegmentId: best.seg.id,
    };
  }

  // Linear referencing fallback (road + km only when stationing span is meaningful).
  const meters = kilometerToMeters(input.kilometer != null ? input.kilometer : input.km);
  if (roadKey && meters != null) {
    const hits = ref.segments.filter((s) => s.road === roadKey && stationingContains(s, meters));
    if (hits.length === 1) {
      return {
        status: SMV_STATUS.TRUE,
        isMotorVehicleRoad: true,
        motorVehicleRoadSource: SMV_SOURCE.RSD_ULS,
        reason: "stationing_match",
        matchedSegmentId: hits[0].id,
      };
    }
    if (hits.length > 1) {
      return {
        status: SMV_STATUS.UNKNOWN,
        isMotorVehicleRoad: null,
        motorVehicleRoadSource: SMV_SOURCE.NONE,
        reason: "stationing_ambiguous",
      };
    }
    // Same road exists as SMV somewhere, but not this km → false for this section.
    const roadHasSmv = ref.segments.some((s) => s.road === roadKey);
    if (roadHasSmv) {
      return {
        status: SMV_STATUS.FALSE,
        isMotorVehicleRoad: false,
        motorVehicleRoadSource: SMV_SOURCE.RSD_ULS,
        reason: "stationing_outside_smv",
      };
    }
  }

  return {
    status: SMV_STATUS.UNKNOWN,
    isMotorVehicleRoad: null,
    motorVehicleRoadSource: SMV_SOURCE.NONE,
    reason: "insufficient_location",
  };
}

export function smvDecisionForPublication(input, reference) {
  const d = resolveMotorVehicleRoad(input, reference);
  return {
    isMotorVehicleRoad: d.status === SMV_STATUS.TRUE,
    motorVehicleRoadConfirmed: d.status === SMV_STATUS.TRUE,
    motorVehicleRoadStatus: d.status,
    motorVehicleRoadSource: d.motorVehicleRoadSource,
    roadFacilityType: d.status === SMV_STATUS.TRUE ? "MOTOR_VEHICLE_ROAD" : null,
    _smvReason: d.reason,
  };
}
