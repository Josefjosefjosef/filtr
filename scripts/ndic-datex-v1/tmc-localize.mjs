/**
 * Localize DATEX TMC refs using active internal table + optional geo-registry.
 * Hierarchy of trust: explicit coordinates > OpenLR (applied outside) > TMC
 * point/linear > text road/name > national fallback.
 * Never invent a municipality assignment.
 */
import { TMC_COUNTRY_CODE, TMC_LOCATION_TABLE_NUMBER } from "./config.mjs";
import { lookupTmcPoint } from "./tmc-table.mjs";
import {
  TMC_MISS_REASON,
  LCD_MISS_CLASS,
  classifyLcdMiss,
  classifyLcdMissClass,
  classifyLcdCodesOnlyMeta,
  classifyLcdCodesOnlyOutcome,
  choosePrimaryTmcMissReason,
} from "./location-forensic-probe.mjs";

const DIR_CS = Object.freeze({
  positive: "kladný směr",
  negative: "záporný směr",
  both: "oba směry",
  unknown: "",
});

function directionLabel(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s) return "";
  if (/positive|pos|plus|bothDirectionsPositive/i.test(s)) return DIR_CS.positive;
  if (/negative|neg|minus/i.test(s)) return DIR_CS.negative;
  if (/both/i.test(s)) return DIR_CS.both;
  // Pass through short Czech-looking tokens only
  if (/^[a-zá-žA-ZÁ-Ž0-9 ./-]{2,40}$/.test(String(raw))) return String(raw);
  return "";
}

/**
 * @param {object[]} tmcRefs
 * @param {import("./tmc-table.mjs").TmcTable|null} table
 * @param {{ coordinates?: {lat:number,lon:number}|null, roadNumber?: string, roadName?: string, geoRegistry?: object|null }} [ctx]
 */
export function localizeFromTmc(tmcRefs, table, ctx = {}) {
  const refs = Array.isArray(tmcRefs) ? tmcRefs : [];
  const codes = [];
  const names = [];
  const roads = new Set();
  let lat = ctx.coordinates && ctx.coordinates.lat;
  let lon = ctx.coordinates && ctx.coordinates.lon;
  let direction = "";
  let kind = "unknown";
  let tmcOk = 0;
  let tmcMiss = 0;
  let trust = "none";
  /** @type {string[]} */
  const missReasons = [];
  /** @type {string[]} */
  const missClasses = [];
  /** @type {string[]} */
  const refKindsSeen = [];

  if (ctx.roadNumber) roads.add(ctx.roadNumber);
  if (ctx.roadName) roads.add(ctx.roadName);

  for (const ref of refs) {
    if (!ref || ref.locationCode == null) continue;
    const refKind = String(ref.kind || "unknown");
    refKindsSeen.push(refKind);
    const cc = ref.countryCode != null ? Number(ref.countryCode) : TMC_COUNTRY_CODE;
    const tn = ref.tableNumber != null ? Number(ref.tableNumber) : TMC_LOCATION_TABLE_NUMBER;
    // Accept missing CC/LTN on ref (inherit approved table); reject wrong table.
    if (ref.countryCode != null && cc !== TMC_COUNTRY_CODE) {
      tmcMiss += 1;
      missReasons.push(TMC_MISS_REASON.CID_MISMATCH);
      continue;
    }
    if (ref.tableNumber != null && tn !== TMC_LOCATION_TABLE_NUMBER) {
      tmcMiss += 1;
      missReasons.push(TMC_MISS_REASON.TABCD_MISMATCH);
      continue;
    }
    codes.push(Number(ref.locationCode));
    if (ref.secondaryLocationCode != null) codes.push(Number(ref.secondaryLocationCode));
    if (!direction && ref.direction) direction = directionLabel(ref.direction);
    kind = ref.kind || kind;

    const pt = lookupTmcPoint(table, ref.locationCode);
    if (!pt) {
      tmcMiss += 1;
      missReasons.push(classifyLcdMiss(table, ref.locationCode, refKind));
      missClasses.push(classifyLcdMissClass(table, ref.locationCode));
      continue;
    }
    tmcOk += 1;
    if (pt.name) names.push(String(pt.name));
    if (pt.roadNumber) roads.add(String(pt.roadNumber));
    if ((lat == null || lon == null) && pt.lat != null && pt.lon != null) {
      lat = pt.lat;
      lon = pt.lon;
    }
    if (ref.secondaryLocationCode != null) {
      const pt2 = lookupTmcPoint(table, ref.secondaryLocationCode);
      if (pt2 && pt2.name) names.push(String(pt2.name));
      if (pt2 && pt2.roadNumber) roads.add(String(pt2.roadNumber));
      if (!pt2) {
        // Secondary miss is forensic-only: primary already resolved.
        missClasses.push(classifyLcdMissClass(table, ref.secondaryLocationCode));
      }
    }
  }

  // Forensic trust-before: ladder without coordinates override (does not change trust).
  let trustBefore = "none";
  if (tmcOk > 0) trustBefore = "tmc";
  else if (roads.size || names.length) trustBefore = "text";
  else trustBefore = "national_fallback";

  if (ctx.coordinates && ctx.coordinates.lat != null && ctx.coordinates.lon != null) {
    trust = "coordinates";
    lat = ctx.coordinates.lat;
    lon = ctx.coordinates.lon;
  } else if (tmcOk > 0) {
    trust = "tmc";
  } else if (roads.size || names.length) {
    trust = "text";
  } else {
    trust = "national_fallback";
  }

  const uniqueNames = [...new Set(names.filter(Boolean))];
  const roadList = [...roads].filter(Boolean);
  const locationLabel =
    uniqueNames.slice(0, 2).join(" – ") ||
    roadList[0] ||
    (trust === "national_fallback" ? "Česká republika" : "");

  // Region: never invent obec/ORP/okres from TMC alone without geo-registry hit.
  const region = {
    level: trust === "national_fallback" ? "stat" : roadList.length || uniqueNames.length ? "usek" : "stat",
    name: locationLabel || "Česká republika",
    tmcCodes: [...new Set(codes)],
    roadNumbers: roadList,
    confidence: trust,
  };

  // Optional geo-registry enrichment by coordinates (if provided)
  if (ctx.geoRegistry && lat != null && lon != null && typeof ctx.geoRegistry.lookupByLatLon === "function") {
    try {
      const hit = ctx.geoRegistry.lookupByLatLon(lat, lon);
      if (hit && hit.kraj) {
        region.kraj = hit.kraj;
        region.okres = hit.okres || undefined;
        region.orp = hit.orp || undefined;
        region.obec = hit.obec || undefined;
        region.level = hit.obec ? "obec" : hit.orp ? "orp" : hit.okres ? "okres" : "kraj";
        if (hit.obec || hit.orp) region.name = hit.obec || hit.orp;
      }
    } catch (_) {
      /* ignore geo enrich failures */
    }
  }

  const primaryMissReason = missReasons.length ? choosePrimaryTmcMissReason(missReasons) : null;
  const primaryMissClass = missClasses.length ? missClasses[0] : null;
  let tmcLocationClass = "unknown";
  if (primaryMissReason === TMC_MISS_REASON.POINT_LOOKUP_MISS) tmcLocationClass = "point";
  else if (primaryMissReason === TMC_MISS_REASON.SEGMENT_LOOKUP_MISS) tmcLocationClass = "segment";
  else if (primaryMissReason === TMC_MISS_REASON.AREA_LOOKUP_MISS) tmcLocationClass = "area";
  else if (tmcOk > 0) tmcLocationClass = "point";

  const tmcReferenceKind =
    refKindsSeen.includes("linear") ? "linear" : refKindsSeen.includes("point") ? "point" : kind || "unknown";

  /** @type {object|null} */
  let lcdCodesOnly = null;
  if (primaryMissClass === LCD_MISS_CLASS.IN_CODES_ONLY && refs.length) {
    const primaryRef = refs.find((r) => r && r.locationCode != null) || null;
    if (primaryRef) {
      const meta = classifyLcdCodesOnlyMeta(table, primaryRef.locationCode);
      lcdCodesOnly = {
        ...meta,
        outcome: classifyLcdCodesOnlyOutcome(meta),
      };
    }
  }

  return {
    locationLabel,
    direction,
    kind,
    lat: lat != null ? lat : null,
    lon: lon != null ? lon : null,
    region,
    tmcOk,
    tmcMiss,
    trust,
    roadNumber: roadList[0] || ctx.roadNumber || "",
    forensic: {
      tmcMissReason: primaryMissReason,
      tmcMissReasons: missReasons.slice(0, 8),
      tmcMissClass: primaryMissClass,
      tmcMissClasses: missClasses.slice(0, 8),
      tmcReferenceKind,
      tmcLocationClass,
      trustBeforeResolver: trustBefore,
      trustAfterResolver: trust,
      ...(lcdCodesOnly ? { lcdCodesOnly } : {}),
    },
  };
}
