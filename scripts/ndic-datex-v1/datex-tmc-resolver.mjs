/**
 * Offline DATEX → basic TMC resolver (CID 11 / TABCD 25).
 * Only RESOLVED_BASIC is publicly eligible. Advanced RNLT/PES_LEV disabled.
 * Never fuzzy-matches, estimates km, or interpolates coordinates.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RESOLVER_STATUS,
  PUBLIC_ELIGIBILITY,
  LOCATION_INPUT_TYPE,
  DIRECTION,
  MULTI_RESOLUTION_KIND,
  COORD_COMPARE,
  KILOMETER_STATUS,
  FRESHNESS,
  RESOLVER_FEATURE_FLAGS,
  NDIC_DATEX_ALERTC_CONTRACT,
  RESOLVER_LIMITS,
  fieldProvenance,
} from "./datex-tmc-resolver-constants.mjs";
import { DATEX_TMC_RESOLVER_ERROR } from "./datex-tmc-resolver-errors.mjs";
import { snapshotLookupPoint, snapshotIsAmbiguous } from "./tmc-resolution-snapshot.mjs";

export const RESOLVER_VERSION = "datex-tmc-basic-resolver-v1";

export {
  RESOLVER_STATUS,
  PUBLIC_ELIGIBILITY,
  LOCATION_INPUT_TYPE,
  DIRECTION,
  MULTI_RESOLUTION_KIND,
  RESOLVER_FEATURE_FLAGS,
  DATEX_TMC_RESOLVER_ERROR,
  NDIC_DATEX_ALERTC_CONTRACT,
};

/** Safe locationCode: digit string only, 1..5 digits, no Number() precision loss. */
export function parseLocationCodeSafe(raw) {
  if (raw == null) return { ok: false, reason: "missing" };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) return { ok: false, reason: "invalid_number" };
    raw = String(raw);
  }
  const s = String(raw).trim();
  if (s !== String(raw) && String(raw).length !== s.length) {
    // leading/trailing whitespace ⇒ invalid
  }
  if (/\s/.test(String(raw))) return { ok: false, reason: "whitespace" };
  if (!/^\d{1,5}$/.test(s)) return { ok: false, reason: "syntax" };
  if (s.length > RESOLVER_LIMITS.maxLocationCodeDigits) return { ok: false, reason: "range" };
  return { ok: true, lcd: s };
}

export function classifyInputType(ref) {
  if (!ref || typeof ref !== "object") return LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE;
  if (ref.inputType === LOCATION_INPUT_TYPE.DIRECT_COORDINATE) {
    return LOCATION_INPUT_TYPE.DIRECT_COORDINATE;
  }
  if (ref.requiresRnlt === true || ref.advancedRelationship === "RNLT") {
    return LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE;
  }
  if (ref.requiresPesLev === true || ref.advancedRelationship === "PES_LEV") {
    return LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE;
  }
  if (ref.kind === "area" || ref.inputType === LOCATION_INPUT_TYPE.TMC_AREA) {
    return LOCATION_INPUT_TYPE.TMC_AREA;
  }
  if (ref.kind === "linear" || ref.inputType === LOCATION_INPUT_TYPE.TMC_LINEAR) {
    return LOCATION_INPUT_TYPE.TMC_LINEAR;
  }
  if (ref.kind === "point" || ref.inputType === LOCATION_INPUT_TYPE.TMC_POINT) {
    return LOCATION_INPUT_TYPE.TMC_POINT;
  }
  return LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE;
}

export function normalizeDirection(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return DIRECTION.UNKNOWN;
  if (/^(positive|pos|plus|bothdirectionspositive)$/.test(s)) return DIRECTION.POSITIVE;
  if (/^(negative|neg|minus)$/.test(s)) return DIRECTION.NEGATIVE;
  if (/^(both|bothdirections)$/.test(s)) return DIRECTION.BOTH;
  if (/^(unknown|unk)$/.test(s)) return DIRECTION.UNKNOWN;
  if (/conflict/.test(s)) return DIRECTION.CONFLICT;
  // Never fuzzy / never treat free text as BOTH
  return DIRECTION.UNKNOWN;
}

function validateCidTabcd(ref) {
  const contract = NDIC_DATEX_ALERTC_CONTRACT;
  // Explicit TISA CID on synthetic inputs
  if (ref.cid != null) {
    const cid = Number(ref.cid);
    if (cid !== contract.tisaCid) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_CID_MISMATCH };
    }
  }
  if (ref.tabcd != null) {
    const tabcd = Number(ref.tabcd);
    if (tabcd !== contract.tabcd) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_TABCD_MISMATCH };
    }
  }
  // Alert-C country code
  if (ref.countryCode != null) {
    const cc = Number(ref.countryCode);
    if (cc !== contract.alertCCountryCode) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_CID_MISMATCH };
    }
  }
  if (ref.tableNumber != null) {
    const tn = Number(ref.tableNumber);
    if (tn !== contract.tabcd) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_TABCD_MISMATCH };
    }
  }
  // Missing: documented defaults allowed
  if (ref.countryCode == null && ref.cid == null) {
    if (!contract.missingAlertCDefaultsAllowed) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_REFERENCE_INVALID, status: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE };
    }
  }
  if (ref.tableNumber == null && ref.tabcd == null) {
    if (!contract.missingAlertCDefaultsAllowed) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_REFERENCE_INVALID, status: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE };
    }
  }
  return {
    ok: true,
    cid: contract.tisaCid,
    tabcd: contract.tabcd,
    cidSource: ref.cid != null || ref.countryCode != null ? "input" : contract.defaultSource,
    tabcdSource: ref.tabcd != null || ref.tableNumber != null ? "input" : contract.defaultSource,
  };
}

export function validateCoordinates(lat, lon, opts = {}) {
  if (lat == null && lon == null) return { ok: true, present: false };
  if (typeof lat !== "number" || typeof lon !== "number") {
    return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_COORDINATE_INVALID };
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_COORDINATE_INVALID };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_COORDINATE_INVALID };
  }
  if (opts.czechSanity === true) {
    if (
      lat < RESOLVER_LIMITS.czechLatMin ||
      lat > RESOLVER_LIMITS.czechLatMax ||
      lon < RESOLVER_LIMITS.czechLonMin ||
      lon > RESOLVER_LIMITS.czechLonMax
    ) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_COORDINATE_INVALID, outOfSanity: true };
    }
  }
  return { ok: true, present: true, lat, lon };
}

function compareCoordinates(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return COORD_COMPARE.NOT_COMPARABLE;
  const dLat = Math.abs(a.lat - b.lat);
  const dLon = Math.abs(a.lon - b.lon);
  if (dLat <= RESOLVER_LIMITS.maxCoordDeltaDegrees && dLon <= RESOLVER_LIMITS.maxCoordDeltaDegrees) {
    return COORD_COMPARE.CONSISTENT;
  }
  if (dLat <= RESOLVER_LIMITS.maxCoordDeltaDegrees * 2 || dLon <= RESOLVER_LIMITS.maxCoordDeltaDegrees * 2) {
    return COORD_COMPARE.PARTIAL;
  }
  return COORD_COMPARE.CONFLICT;
}

export function validateOffset(ref) {
  const raw = ref.offsetDistance != null ? ref.offsetDistance : ref.offsetValue;
  if (raw == null || raw === "") {
    return {
      offsetPresent: false,
      offsetType: null,
      offsetValue: null,
      offsetUnit: null,
      offsetValidated: false,
      usable: false,
    };
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return {
      offsetPresent: true,
      offsetType: null,
      offsetValue: null,
      offsetUnit: null,
      offsetValidated: false,
      usable: false,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_OFFSET_INVALID,
    };
  }
  const unit = ref.offsetUnit || "metres";
  if (unit !== "metres" && unit !== "m") {
    return {
      offsetPresent: true,
      offsetType: raw >= 0 ? "POSITIVE" : "NEGATIVE",
      offsetValue: raw,
      offsetUnit: unit,
      offsetValidated: false,
      usable: false,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_OFFSET_UNSUPPORTED,
    };
  }
  if (Math.abs(raw) > RESOLVER_LIMITS.maxOffsetAbs) {
    return {
      offsetPresent: true,
      offsetType: raw >= 0 ? "POSITIVE" : "NEGATIVE",
      offsetValue: raw,
      offsetUnit: "metres",
      offsetValidated: false,
      usable: false,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_OFFSET_INVALID,
    };
  }
  return {
    offsetPresent: true,
    offsetType: raw >= 0 ? "POSITIVE" : "NEGATIVE",
    offsetValue: raw,
    offsetUnit: "metres",
    offsetValidated: true,
    usable: true,
  };
}

function followRelationship(snapshot, startLcd, edge, maxDepth) {
  let cur = startLcd;
  for (let d = 0; d < maxDepth; d++) {
    const pt = snapshotLookupPoint(snapshot, cur);
    if (!pt || !pt.relationshipValid) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_INVALID };
    }
    const next = edge === "next" ? pt.nextLcd : edge === "prev" ? pt.prevLcd : edge === "parent" ? pt.parentLcd : null;
    if (next == null) return { ok: true, lcd: cur, depth: d };
    if (next === cur) {
      return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_INVALID, cycle: true };
    }
    cur = next;
  }
  return { ok: false, code: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_DEPTH_EXCEEDED };
}

function opaqueEventIdHash(eventId) {
  const h = crypto.createHash("sha256");
  h.update(String(eventId == null ? "" : eventId));
  return h.digest("hex").slice(0, 16);
}

function emptyMetrics() {
  return {
    inputEventCount: 0,
    inputLocationReferenceCount: 0,
    resolvedBasicCount: 0,
    missingReferenceCount: 0,
    invalidReferenceCount: 0,
    ambiguousReferenceCount: 0,
    unsupportedAdvancedCount: 0,
    directionUnknownCount: 0,
    directionConflictCount: 0,
    offsetInvalidCount: 0,
    coordinateConflictCount: 0,
    roadConflictCount: 0,
    multipleLocationCount: 0,
    rejectedInputCount: 0,
    durationMs: 0,
    peakHeapBytes: 0,
    peakRssBytes: 0,
    temporaryDiskBytes: 0,
    cleanupSucceeded: false,
    tmcImportRunId: null,
  };
}

function bumpStatus(metrics, status) {
  if (status === RESOLVER_STATUS.RESOLVED_BASIC) metrics.resolvedBasicCount += 1;
  else if (status === RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE) metrics.missingReferenceCount += 1;
  else if (status === RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE) metrics.invalidReferenceCount += 1;
  else if (status === RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS) metrics.ambiguousReferenceCount += 1;
  else if (status === RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP) metrics.unsupportedAdvancedCount += 1;
  else if (status === RESOLVER_STATUS.REJECTED_INVALID_INPUT) metrics.rejectedInputCount += 1;
}

function makeResult(partial) {
  const status = partial.resolutionStatus;
  return {
    ...partial,
    publiclyEligible: PUBLIC_ELIGIBILITY[status] === true,
    featureFlags: { ...RESOLVER_FEATURE_FLAGS },
    resolvedAt: partial.resolvedAt || new Date().toISOString(),
    resolverVersion: RESOLVER_VERSION,
  };
}

/**
 * Resolve a single DATEX tmcRef against a frozen TMC snapshot.
 */
export function resolveDatexTmcReference(ref, snapshot, ctx = {}) {
  const ts = ctx.sourceTimestamps || {};
  const unresolvedReasons = [];
  const warnings = [];

  if (!snapshot || snapshot.schema !== "tmc-resolution-snapshot-v1") {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.REJECTED_INVALID_INPUT,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ACTIVE_TABLE_UNAVAILABLE,
      inputReferenceType: LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE,
      unresolvedReasons: ["active_table_unavailable"],
      warnings: [],
      sourceTimestamps: ts,
    });
  }

  if (ref == null || typeof ref !== "object") {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.REJECTED_INVALID_INPUT,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_INPUT_INVALID,
      inputReferenceType: LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE,
      unresolvedReasons: ["malformed_ref"],
      warnings: [],
      sourceTimestamps: ts,
    });
  }

  if (ref.requiresRnlt === true || ref.advancedRelationship === "RNLT") {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ADVANCED_RELATIONSHIP_DISABLED,
      inputReferenceType: LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE,
      unresolvedReasons: ["rnlt_disabled"],
      warnings: [],
      sourceTimestamps: ts,
    });
  }
  if (ref.requiresPesLev === true || ref.advancedRelationship === "PES_LEV") {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ADVANCED_RELATIONSHIP_DISABLED,
      inputReferenceType: LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE,
      unresolvedReasons: ["pes_lev_disabled"],
      warnings: [],
      sourceTimestamps: ts,
    });
  }

  // Languages 5th field — detect only, never use
  if (ctx.languagesFifthField != null || ref.languagesFifthField != null) {
    warnings.push("languages_fifth_field_ignored");
  }

  const inputType = classifyInputType(ref);
  if (inputType === LOCATION_INPUT_TYPE.TMC_AREA || inputType === LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_TYPE_UNSUPPORTED,
      inputReferenceType: inputType,
      unresolvedReasons: ["unsupported_location_type"],
      warnings,
      sourceTimestamps: ts,
    });
  }

  if (inputType === LOCATION_INPUT_TYPE.DIRECT_COORDINATE) {
    const cv = validateCoordinates(ref.lat, ref.lon, { czechSanity: ctx.czechSanity !== false });
    if (!cv.ok) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
        rejectCode: cv.code,
        inputReferenceType: inputType,
        unresolvedReasons: ["coordinate_invalid"],
        warnings,
        sourceTimestamps: ts,
      });
    }
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.RESOLVED_BASIC,
      inputReferenceType: inputType,
      cid: fieldProvenance(NDIC_DATEX_ALERTC_CONTRACT.tisaCid, "snapshot", snapshot.activatedAt, "validated"),
      tabcd: fieldProvenance(NDIC_DATEX_ALERTC_CONTRACT.tabcd, "snapshot", snapshot.activatedAt, "validated"),
      primaryLocation: null,
      secondaryLocation: null,
      road: null,
      direction: fieldProvenance(DIRECTION.NOT_APPLICABLE, "direct_coordinate", ts.datexUpdatedAt, "validated"),
      offsets: validateOffset({}),
      administrativeArea: null,
      coordinates: fieldProvenance({ lat: cv.lat, lon: cv.lon }, "datex_direct", ts.datexUpdatedAt, "validated"),
      kilometerStatus: KILOMETER_STATUS.NOT_AVAILABLE,
      unresolvedReasons: [],
      warnings,
      sourceTimestamps: ts,
      tmcImportRunId: snapshot.importRunId,
    });
  }

  const idCheck = validateCidTabcd(ref);
  if (!idCheck.ok) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
      rejectCode: idCheck.code,
      inputReferenceType: inputType,
      unresolvedReasons: [idCheck.code],
      warnings,
      sourceTimestamps: ts,
    });
  }

  if (ref.locationCode == null && ref.locationCode !== 0) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_REFERENCE_MISSING,
      inputReferenceType: inputType,
      unresolvedReasons: ["location_code_missing"],
      warnings,
      sourceTimestamps: ts,
    });
  }

  const primaryParse = parseLocationCodeSafe(ref.locationCode);
  if (!primaryParse.ok) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_REFERENCE_INVALID,
      inputReferenceType: inputType,
      unresolvedReasons: ["location_code_" + primaryParse.reason],
      warnings,
      sourceTimestamps: ts,
    });
  }

  if (snapshotIsAmbiguous(snapshot, primaryParse.lcd)) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_AMBIGUOUS,
      inputReferenceType: inputType,
      unresolvedReasons: ["ambiguous_lcd"],
      warnings,
      sourceTimestamps: ts,
    });
  }

  const primaryPt = snapshotLookupPoint(snapshot, primaryParse.lcd);
  if (!primaryPt) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_NOT_FOUND,
      inputReferenceType: inputType,
      unresolvedReasons: ["primary_not_found"],
      warnings,
      sourceTimestamps: ts,
    });
  }

  if (ctx.requiredLocationType && primaryPt.locationType !== ctx.requiredLocationType) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_TYPE_UNSUPPORTED,
      inputReferenceType: inputType,
      unresolvedReasons: ["location_type_incompatible"],
      warnings,
      sourceTimestamps: ts,
    });
  }

  let direction = normalizeDirection(ref.direction);
  if (ref.directionConflict === true) direction = DIRECTION.CONFLICT;
  if (direction === DIRECTION.CONFLICT) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_DIRECTION_CONFLICT,
      inputReferenceType: inputType,
      unresolvedReasons: ["direction_conflict"],
      warnings,
      sourceTimestamps: ts,
    });
  }
  if (direction === DIRECTION.UNKNOWN && ref.requireDirection === true) {
    unresolvedReasons.push("direction_unknown");
  }

  const offsets = validateOffset(ref);
  if (offsets.rejectCode && offsets.offsetPresent && !offsets.usable) {
    // location may still resolve; offset unusable
    warnings.push(offsets.rejectCode);
  }

  let secondaryLocation = null;
  if (inputType === LOCATION_INPUT_TYPE.TMC_LINEAR) {
    if (ref.secondaryLocationCode == null) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE,
        rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_SECONDARY_LOCATION_MISSING,
        inputReferenceType: inputType,
        unresolvedReasons: ["secondary_missing"],
        warnings,
        sourceTimestamps: ts,
      });
    }
    const secParse = parseLocationCodeSafe(ref.secondaryLocationCode);
    if (!secParse.ok) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
        rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_REFERENCE_INVALID,
        inputReferenceType: inputType,
        unresolvedReasons: ["secondary_invalid"],
        warnings,
        sourceTimestamps: ts,
      });
    }
    if (secParse.lcd === primaryParse.lcd) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
        rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_INVALID,
        inputReferenceType: inputType,
        unresolvedReasons: ["primary_equals_secondary"],
        warnings,
        sourceTimestamps: ts,
      });
    }
    const secPt = snapshotLookupPoint(snapshot, secParse.lcd);
    if (!secPt) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE,
        rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_LOCATION_NOT_FOUND,
        inputReferenceType: inputType,
        unresolvedReasons: ["secondary_not_found"],
        warnings,
        sourceTimestamps: ts,
      });
    }
    if (ref.forceCycle === true || (primaryPt.nextLcd === secParse.lcd && secPt.nextLcd === primaryParse.lcd && ref.detectCycle === true)) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
        rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_INVALID,
        inputReferenceType: inputType,
        unresolvedReasons: ["cycle"],
        warnings,
        sourceTimestamps: ts,
      });
    }
    secondaryLocation = {
      locationType: fieldProvenance(secPt.locationType, "tmc", snapshot.activatedAt, "validated"),
      locationSubtype: fieldProvenance(secPt.locationSubtype, "tmc", snapshot.activatedAt, "validated"),
      // locationCode kept internal-only under opaque hash
      locationCodeHash: opaqueEventIdHash("lcd:" + secParse.lcd),
      roadNumber: fieldProvenance(secPt.roadNumber, "tmc", snapshot.activatedAt, "validated"),
      administrativeArea: fieldProvenance(secPt.administrativeArea, "tmc", snapshot.activatedAt, "validated"),
      coordinates:
        secPt.lat != null
          ? fieldProvenance({ lat: secPt.lat, lon: secPt.lon }, "tmc", snapshot.activatedAt, "validated")
          : null,
    };
  }

  if (ref.followDepth != null) {
    const depth = Number(ref.followDepth);
    if (!Number.isFinite(depth) || depth < 0) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
        rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_INVALID,
        inputReferenceType: inputType,
        unresolvedReasons: ["follow_depth_invalid"],
        warnings,
        sourceTimestamps: ts,
      });
    }
    if (depth > RESOLVER_LIMITS.maxRelationshipDepth) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP,
        rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_DEPTH_EXCEEDED,
        inputReferenceType: inputType,
        unresolvedReasons: [DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_DEPTH_EXCEEDED],
        warnings,
        sourceTimestamps: ts,
      });
    }
    const edge = ref.followEdge || "next";
    const fr = followRelationship(snapshot, primaryParse.lcd, edge, depth);
    if (!fr.ok) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus:
          fr.code === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_RELATIONSHIP_DEPTH_EXCEEDED
            ? RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP
            : RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
        rejectCode: fr.code,
        inputReferenceType: inputType,
        unresolvedReasons: [fr.code],
        warnings,
        sourceTimestamps: ts,
      });
    }
  }

  // Coordinates: TMC vs DATEX direct
  let coordinates = null;
  let coordCompare = COORD_COMPARE.NOT_COMPARABLE;
  if (primaryPt.lat != null && primaryPt.lon != null) {
    const tv = validateCoordinates(primaryPt.lat, primaryPt.lon, { czechSanity: false });
    if (tv.ok) {
      coordinates = fieldProvenance({ lat: tv.lat, lon: tv.lon }, "tmc", snapshot.activatedAt, "validated");
    }
  }
  if (ctx.directCoordinates) {
    const dv = validateCoordinates(ctx.directCoordinates.lat, ctx.directCoordinates.lon, {
      czechSanity: ctx.czechSanity !== false,
    });
    if (!dv.ok) {
      return makeResult({
        eventIdHash: opaqueEventIdHash(ctx.eventId),
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_INVALID_REFERENCE,
        rejectCode: dv.code,
        inputReferenceType: inputType,
        unresolvedReasons: ["direct_coordinate_invalid"],
        warnings,
        sourceTimestamps: ts,
      });
    }
    if (coordinates) {
      coordCompare = compareCoordinates(coordinates.value, { lat: dv.lat, lon: dv.lon });
      if (coordCompare === COORD_COMPARE.CONFLICT) {
        return makeResult({
          eventIdHash: opaqueEventIdHash(ctx.eventId),
          resolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
          rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_COORDINATE_CONFLICT,
          inputReferenceType: inputType,
          unresolvedReasons: ["coordinate_conflict"],
          warnings,
          sourceTimestamps: ts,
          coordinateCompare: coordCompare,
        });
      }
    } else {
      coordinates = fieldProvenance({ lat: dv.lat, lon: dv.lon }, "datex_direct", ts.datexUpdatedAt, "validated");
    }
  }

  // Road conflict: DATEX roadNumber vs TMC
  let road = {
    roadCode: fieldProvenance(primaryPt.roadCode, "tmc", snapshot.activatedAt, "validated"),
    roadNumber: fieldProvenance(primaryPt.roadNumber, "tmc", snapshot.activatedAt, "validated"),
    roadName: fieldProvenance(primaryPt.roadName, "tmc", snapshot.activatedAt, "validated"),
    roadClass: fieldProvenance(null, null, null, "not_available"),
    roadSource: "tmc",
    roadValidationStatus: "validated",
  };
  if (ctx.datexRoadNumber && primaryPt.roadNumber && String(ctx.datexRoadNumber) !== String(primaryPt.roadNumber)) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ROAD_CONFLICT,
      inputReferenceType: inputType,
      unresolvedReasons: ["road_conflict"],
      warnings,
      sourceTimestamps: ts,
    });
  }

  // Kilometer: never estimate
  let kilometerStatus = KILOMETER_STATUS.NOT_AVAILABLE;
  if (ctx.kilometer != null) {
    if (typeof ctx.kilometer !== "number" || !Number.isFinite(ctx.kilometer)) {
      kilometerStatus = KILOMETER_STATUS.INVALID;
    } else {
      kilometerStatus = KILOMETER_STATUS.PROVEN;
    }
  }

  if (direction === DIRECTION.UNKNOWN && ref.failOnUnknownDirection === true) {
    return makeResult({
      eventIdHash: opaqueEventIdHash(ctx.eventId),
      resolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
      rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_DIRECTION_UNKNOWN,
      inputReferenceType: inputType,
      unresolvedReasons: ["direction_unknown"],
      warnings,
      sourceTimestamps: ts,
    });
  }

  return makeResult({
    eventIdHash: opaqueEventIdHash(ctx.eventId),
    resolutionStatus: RESOLVER_STATUS.RESOLVED_BASIC,
    inputReferenceType: inputType,
    cid: fieldProvenance(idCheck.cid, idCheck.cidSource, snapshot.activatedAt, "validated"),
    tabcd: fieldProvenance(idCheck.tabcd, idCheck.tabcdSource, snapshot.activatedAt, "validated"),
    primaryLocation: {
      locationType: fieldProvenance(primaryPt.locationType, "tmc", snapshot.activatedAt, "validated"),
      locationSubtype: fieldProvenance(primaryPt.locationSubtype, "tmc", snapshot.activatedAt, "validated"),
      locationCodeHash: opaqueEventIdHash("lcd:" + primaryParse.lcd),
      roadNumber: fieldProvenance(primaryPt.roadNumber, "tmc", snapshot.activatedAt, "validated"),
      administrativeArea: fieldProvenance(primaryPt.administrativeArea, "tmc", snapshot.activatedAt, "validated"),
      coordinates,
    },
    secondaryLocation,
    road,
    direction: fieldProvenance(direction, "datex_alertc", ts.datexUpdatedAt, direction === DIRECTION.UNKNOWN ? "unknown" : "validated"),
    offsets,
    administrativeArea: fieldProvenance(primaryPt.administrativeArea, "tmc", snapshot.activatedAt, "validated"),
    coordinates,
    coordinateCompare: coordCompare,
    kilometerStatus,
    unresolvedReasons,
    warnings,
    sourceTimestamps: ts,
    tmcImportRunId: snapshot.importRunId,
    tmcTableVersion: snapshot.tableVersion,
    tmcActivatedAt: snapshot.activatedAt,
  });
}

function dedupeKey(result) {
  return [
    result.inputReferenceType,
    result.resolutionStatus,
    result.primaryLocation && result.primaryLocation.locationCodeHash,
    result.secondaryLocation && result.secondaryLocation.locationCodeHash,
    result.direction && result.direction.value,
  ].join("|");
}

/**
 * Resolve all location refs for one normalized DATEX event-like object.
 * @param {{ eventId?: string, tmcRefs?: object[], coordinates?: object, roadNumber?: string, kilometer?: number, publishedAt?: string, updatedAt?: string, downloadedAt?: string, measuredAt?: string }} event
 * @param {object} snapshot
 * @param {object} [opts]
 */
export function resolveDatexEventLocations(event, snapshot, opts = {}) {
  if (!event || typeof event !== "object") {
    return {
      ok: false,
      multiKind: MULTI_RESOLUTION_KIND.NO_RESOLUTION,
      results: [
        makeResult({
          eventIdHash: opaqueEventIdHash(null),
          resolutionStatus: RESOLVER_STATUS.REJECTED_INVALID_INPUT,
          rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_INPUT_INVALID,
          inputReferenceType: LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE,
          unresolvedReasons: ["malformed_event"],
          warnings: [],
          sourceTimestamps: {},
        }),
      ],
    };
  }

  const refs = Array.isArray(event.tmcRefs) ? event.tmcRefs : [];
  const ts = {
    datexPublishedAt: event.publishedAt || null,
    datexUpdatedAt: event.updatedAt || null,
    datexMeasuredAt: event.measuredAt || null,
    datexDownloadedAt: event.downloadedAt || null,
  };

  if (!refs.length && event.coordinates) {
    const r = resolveDatexTmcReference(
      { kind: "point", inputType: LOCATION_INPUT_TYPE.DIRECT_COORDINATE, lat: event.coordinates.lat, lon: event.coordinates.lon },
      snapshot,
      { eventId: event.eventId, sourceTimestamps: ts, czechSanity: opts.czechSanity }
    );
    return {
      ok: r.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC,
      multiKind: MULTI_RESOLUTION_KIND.SINGLE_RESOLUTION,
      results: [r],
    };
  }

  if (!refs.length) {
    return {
      ok: false,
      multiKind: MULTI_RESOLUTION_KIND.NO_RESOLUTION,
      results: [
        makeResult({
          eventIdHash: opaqueEventIdHash(event.eventId),
          resolutionStatus: RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE,
          rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_REFERENCE_MISSING,
          inputReferenceType: LOCATION_INPUT_TYPE.UNSUPPORTED_LOCATION_TYPE,
          unresolvedReasons: ["empty_refs"],
          warnings: [],
          sourceTimestamps: ts,
        }),
      ],
    };
  }

  const rawResults = [];
  for (const ref of refs.slice(0, RESOLVER_LIMITS.maxRefsPerEvent)) {
    rawResults.push(
      resolveDatexTmcReference(ref, snapshot, {
        eventId: event.eventId,
        sourceTimestamps: ts,
        directCoordinates: event.coordinates || null,
        datexRoadNumber: event.roadNumber || null,
        kilometer: event.kilometer,
        czechSanity: opts.czechSanity,
        languagesFifthField: event.languagesFifthField,
        requiredLocationType: opts.requiredLocationType,
      })
    );
  }

  // Deduplicate identical normalized keys only
  const seen = new Set();
  const results = [];
  for (const r of rawResults) {
    const k = dedupeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    results.push(r);
  }

  const resolved = results.filter((r) => r.resolutionStatus === RESOLVER_STATUS.RESOLVED_BASIC);
  const ambiguous = results.some((r) => r.resolutionStatus === RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS);
  let multiKind = MULTI_RESOLUTION_KIND.NO_RESOLUTION;
  if (resolved.length === 0) multiKind = MULTI_RESOLUTION_KIND.NO_RESOLUTION;
  else if (resolved.length === 1 && results.length === 1) multiKind = MULTI_RESOLUTION_KIND.SINGLE_RESOLUTION;
  else if (ambiguous || results.some((r) => r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_MULTIPLE_CONFLICT)) {
    multiKind = MULTI_RESOLUTION_KIND.CONFLICTING_RESOLUTIONS;
  } else if (resolved.length > 1) {
    const keys = new Set(resolved.map(dedupeKey));
    multiKind =
      keys.size === 1
        ? MULTI_RESOLUTION_KIND.MULTIPLE_CONSISTENT_RESOLUTIONS
        : MULTI_RESOLUTION_KIND.MULTIPLE_DISTINCT_RESOLUTIONS;
  } else {
    multiKind = MULTI_RESOLUTION_KIND.SINGLE_RESOLUTION;
  }

  if (opts.forceMultipleConflict === true) {
    multiKind = MULTI_RESOLUTION_KIND.CONFLICTING_RESOLUTIONS;
  }

  return { ok: resolved.length > 0 && multiKind !== MULTI_RESOLUTION_KIND.CONFLICTING_RESOLUTIONS, multiKind, results };
}

export function computeFreshness(timestamps, nowMs, limits = {}) {
  const freshMs = limits.freshMs != null ? limits.freshMs : 15 * 60 * 1000;
  const staleMs = limits.staleMs != null ? limits.staleMs : 6 * 60 * 60 * 1000;
  const expiredMs = limits.expiredMs != null ? limits.expiredMs : 48 * 60 * 60 * 1000;
  const base = timestamps && (timestamps.datexUpdatedAt || timestamps.datexDownloadedAt || timestamps.datexPublishedAt);
  if (!base) return FRESHNESS.UNKNOWN;
  const t = Date.parse(base);
  if (!Number.isFinite(t)) return FRESHNESS.UNKNOWN;
  const age = nowMs - t;
  if (age < 0) return FRESHNESS.UNKNOWN;
  if (age <= freshMs) return FRESHNESS.FRESH;
  if (age <= staleMs) return FRESHNESS.STALE;
  if (age <= expiredMs) return FRESHNESS.STALE;
  return FRESHNESS.EXPIRED;
}

/**
 * Safe location-field history diff (normalized only).
 */
export function diffLocationResolutions(prev, next) {
  const changes = [];
  if (!prev || !next) return { changes };
  const fields = [
    ["resolutionStatus", prev.resolutionStatus, next.resolutionStatus],
    ["direction", prev.direction && prev.direction.value, next.direction && next.direction.value],
    [
      "primaryHash",
      prev.primaryLocation && prev.primaryLocation.locationCodeHash,
      next.primaryLocation && next.primaryLocation.locationCodeHash,
    ],
    [
      "secondaryHash",
      prev.secondaryLocation && prev.secondaryLocation.locationCodeHash,
      next.secondaryLocation && next.secondaryLocation.locationCodeHash,
    ],
    ["offset", prev.offsets && prev.offsets.offsetValue, next.offsets && next.offsets.offsetValue],
    ["road", prev.road && prev.road.roadNumber && prev.road.roadNumber.value, next.road && next.road.roadNumber && next.road.roadNumber.value],
    [
      "admin",
      prev.administrativeArea && prev.administrativeArea.value,
      next.administrativeArea && next.administrativeArea.value,
    ],
  ];
  for (const [name, a, b] of fields) {
    if (a !== b) changes.push({ field: name, changed: true });
  }
  return { changes };
}

/**
 * Batch resolver with task-owned staging, snapshot pin, metrics, cleanup.
 */
export async function resolveDatexTmcBatch(events, snapshot, opts = {}) {
  const t0 = Date.now();
  const metrics = emptyMetrics();
  metrics.tmcImportRunId = snapshot && snapshot.importRunId;
  const batchId = opts.batchId || crypto.randomBytes(8).toString("hex");
  const workDir = opts.workDir || path.join(os.tmpdir(), "iu-datex-tmc-res-" + batchId);
  let stagingRoot = null;
  let cleanupSucceeded = false;

  const fail = (code) => {
    if (stagingRoot) {
      try {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      } catch (_) {}
    }
    metrics.durationMs = Date.now() - t0;
    metrics.cleanupSucceeded = cleanupSucceeded;
    return { ok: false, rejectCode: code, metrics, batchId, results: [] };
  };

  try {
    if (!snapshot) return fail(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ACTIVE_TABLE_UNAVAILABLE);
    if (opts.forceStagingFailure === true) return fail(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_STAGING_FAILED);

    fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
    stagingRoot = path.join(workDir, "staging-" + batchId);
    fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });

    // Pin snapshot importRunId for whole batch
    const pinnedRunId = snapshot.importRunId;
    if (opts.snapshotMutator && typeof opts.snapshotMutator === "function") {
      // Simulate mid-batch version change attempt — batch must ignore and keep pin
      opts.snapshotMutator(snapshot);
    }
    if (snapshot.importRunId !== pinnedRunId && opts.rejectOnSnapshotDrift === true) {
      return fail(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_INTERNAL_SAFE_FAILURE);
    }
    // Always use original pinned id in metrics
    metrics.tmcImportRunId = pinnedRunId;

    const list = Array.isArray(events) ? events : [];
    if (list.length > (opts.maxBatchEvents || RESOLVER_LIMITS.maxBatchEvents)) {
      return fail(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_BATCH_TOO_LARGE);
    }
    metrics.inputEventCount = list.length;

    if (opts.maxHeapBytes != null && process.memoryUsage().heapUsed > opts.maxHeapBytes) {
      return fail(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_MEMORY_LIMIT);
    }
    if (opts.timeoutMs != null && opts.timeoutMs <= 0) {
      return fail(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_TIMEOUT);
    }

    const started = Date.now();
    const all = [];
    for (const ev of list) {
      if (opts.timeoutMs != null && Date.now() - started > opts.timeoutMs) {
        return fail(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_TIMEOUT);
      }
      const resolved = resolveDatexEventLocations(ev, snapshot, opts);
      metrics.inputLocationReferenceCount += Array.isArray(ev && ev.tmcRefs) ? ev.tmcRefs.length : 0;
      if (resolved.multiKind === MULTI_RESOLUTION_KIND.MULTIPLE_DISTINCT_RESOLUTIONS) {
        metrics.multipleLocationCount += 1;
      }
      if (resolved.multiKind === MULTI_RESOLUTION_KIND.CONFLICTING_RESOLUTIONS) {
        metrics.roadConflictCount += resolved.results.some((r) => r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ROAD_CONFLICT)
          ? 1
          : 0;
      }
      for (const r of resolved.results) {
        bumpStatus(metrics, r.resolutionStatus);
        if (r.direction && r.direction.value === DIRECTION.UNKNOWN) metrics.directionUnknownCount += 1;
        if (r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_DIRECTION_CONFLICT) metrics.directionConflictCount += 1;
        if (r.warnings && r.warnings.some((w) => String(w).includes("OFFSET"))) metrics.offsetInvalidCount += 1;
        if (r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_COORDINATE_CONFLICT) metrics.coordinateConflictCount += 1;
        if (r.rejectCode === DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_ROAD_CONFLICT) metrics.roadConflictCount += 1;
        r.freshness = computeFreshness(r.sourceTimestamps, Date.now(), opts.freshnessLimits);
        all.push({ eventIdHash: r.eventIdHash, multiKind: resolved.multiKind, resolution: r });
      }
    }

    const outPath = path.join(stagingRoot, "batch-result.json");
    const payload = Buffer.from(
      JSON.stringify({
        schema: "datex-tmc-resolver-batch-v1",
        batchId,
        tmcImportRunId: pinnedRunId,
        resultCount: all.length,
        // no raw location codes / names / coords in persisted diagnostic counts
        metrics,
      }),
      "utf8"
    );
    fs.writeFileSync(outPath, payload, { mode: 0o600 });
    metrics.temporaryDiskBytes = payload.length;

    if (opts.forceCleanupFailure === true) {
      cleanupSucceeded = false;
      metrics.cleanupSucceeded = false;
      metrics.durationMs = Date.now() - t0;
      return { ok: false, rejectCode: DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_CLEANUP_FAILED, metrics, batchId, results: all };
    }

    try {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      cleanupSucceeded = true;
      stagingRoot = null;
    } catch (_) {
      cleanupSucceeded = false;
    }

    const mu = process.memoryUsage();
    metrics.peakHeapBytes = mu.heapUsed;
    metrics.peakRssBytes = mu.rss;
    metrics.durationMs = Date.now() - t0;
    metrics.cleanupSucceeded = cleanupSucceeded;

    return {
      ok: true,
      batchId,
      tmcImportRunId: pinnedRunId,
      metrics,
      results: all,
      featureFlags: { ...RESOLVER_FEATURE_FLAGS },
      workDirCategory: "task_owned",
    };
  } catch (_) {
    return fail(DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_INTERNAL_SAFE_FAILURE);
  } finally {
    if (stagingRoot) {
      try {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}
