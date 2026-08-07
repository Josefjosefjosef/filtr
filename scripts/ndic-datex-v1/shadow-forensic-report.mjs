/**
 * Build + persist redacted NDIC isolated-shadow forensic retention artifacts.
 * Never retains raw DATEX/TMC/auth. Never enables publication.
 *
 * PUBLICATION_ITEMS / PUBLICATION_PROJECTIONS_TOTAL =
 *   gate-passed internal feed projections (legal provenance attached).
 *   NOT "publicly displayable geo cards".
 * PUBLICATION_ELIGIBLE_TOTAL =
 *   projections with verified location trust (tmc|coordinates) + provenance.
 */
import fs from "node:fs";
import path from "node:path";
import {
  FORENSIC_SCHEMA,
  CARD_PREVIEW_SCHEMA,
  VALIDATION_REPORT_SCHEMA,
  FORENSIC_DIR_NAME,
  FORENSIC_SUMMARY_FILE,
  FORENSIC_CARD_PREVIEW_FILE,
  FORENSIC_VALIDATION_FILE,
  MAX_CARD_PREVIEW_ITEMS,
  MAX_DATEX_BYTES_READ,
  MAX_RETAINED_IGNORED_ENTRY_METADATA,
  MAX_RETAINED_UNKNOWN_ENTRY_METADATA,
  ENTRY_CLASSIFICATION_ENUM,
  ENTRY_REASON_ENUM,
  CARD_PREVIEW_ALLOWLIST,
  HTTP_STATUS_CLASS,
  VERIFIED_LOCATION_TRUST,
} from "./shadow-forensic-constants.mjs";
import {
  validateForensicSummary,
  validateCardPreview,
  validateValidationReport,
  scanForensicCanaries,
} from "./shadow-forensic-schema.mjs";
import {
  classifyFeedItemPresentationForensics,
  LOCATION_PRESENTATION_LEVEL,
  FORENSIC_MAP_LINK_TYPE,
} from "./traffic-location-presentation-policy.mjs";
import { PARSER_VERSION } from "./config.mjs";
import { SP08001_TABLE_CODES } from "./tmc-sp08001-contract.mjs";

function clip(s, n) {
  if (s == null || s === "") return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n) : t;
}

/** Redact entry metadata for forensic retention (no raw basenames/paths/content). */
export function sanitizeForensicEntryMeta(e, indexFallback = 0) {
  const classification = String((e && e.classification) || "");
  const reasonCode = String((e && e.reasonCode) || "");
  const out = {
    basenameDigest:
      e && typeof e.basenameDigest === "string" && /^[a-f0-9]{16}$/.test(e.basenameDigest)
        ? e.basenameDigest
        : null,
    extension: String((e && e.extension) || "").slice(0, 16).toLowerCase().replace(/[^a-z0-9]/g, ""),
    classification: ENTRY_CLASSIFICATION_ENUM.includes(classification)
      ? classification
      : "REJECTED_UNSAFE",
    reasonCode: ENTRY_REASON_ENUM.includes(reasonCode) ? reasonCode : "UNSAFE_OR_UNSUPPORTED_ENTRY",
    resolutionRequired: e && e.resolutionRequired === true,
    authoritative: e && e.authoritative === true,
    entryOrdinal:
      e && Number.isInteger(e.entryOrdinal) && e.entryOrdinal >= 0 ? e.entryOrdinal : indexFallback,
  };
  const tc = e && e.tableCode != null ? String(e.tableCode) : null;
  if (tc === "README" || (tc && SP08001_TABLE_CODES.includes(tc))) {
    out.tableCode = tc;
  }
  return out;
}

function sanitizeEntryList(raw, max) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, max).map((e, i) => sanitizeForensicEntryMeta(e, i));
}

function normalizeIso(s, fallback) {
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s) && s.length <= 40) {
    return s;
  }
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return fallback;
}

function httpStatusClass(status) {
  const n = Number(status);
  if (!Number.isFinite(n) || n <= 0) return HTTP_STATUS_CLASS.none;
  if (n >= 200 && n < 300) return HTTP_STATUS_CLASS["2xx"];
  if (n >= 300 && n < 400) return HTTP_STATUS_CLASS["3xx"];
  if (n >= 400 && n < 500) return HTTP_STATUS_CLASS["4xx"];
  if (n >= 500 && n < 600) return HTTP_STATUS_CLASS["5xx"];
  return HTTP_STATUS_CLASS.unknown;
}

function resolveHeadSha(explicit) {
  const fromEnv = String(process.env.GITHUB_SHA || process.env.IU_NDIC_FORENSIC_HEAD_SHA || "")
    .toLowerCase()
    .trim();
  const want = String(explicit || fromEnv || "")
    .toLowerCase()
    .trim();
  if (/^[0-9a-f]{40}$/.test(want)) return want;
  return "0000000000000000000000000000000000000000";
}

function resolveRunId(explicit) {
  // Prefer GitHub Actions run id for artifact correlation.
  const fromEnv = String(process.env.GITHUB_RUN_ID || "").trim();
  if (fromEnv && fromEnv.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(fromEnv)) return fromEnv;
  const want = String(explicit || "").trim();
  if (want && want.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(want)) return want;
  return "local-forensic";
}

function hasVerifiedLocationTrust(item) {
  const trust = String((item && item.localizationTrust) || "");
  const tmcOk = item && item.ndicV1 && Number(item.ndicV1.tmcOk) > 0;
  return VERIFIED_LOCATION_TRUST.includes(trust) || tmcOk;
}

function hasProvenance(item) {
  return Boolean(item && item.attribution && item.sourceId);
}

/**
 * Build allowlisted card preview row from a gate/feed item.
 * Unverified geo fields stay null (never invent km/direction/locality).
 */
export function buildCardPreviewItem(item) {
  const verifiedLoc = hasVerifiedLocationTrust(item);
  const row = {
    type: clip(item && item.eventType, 80),
    road: verifiedLoc ? clip(item && item.roadNumber, 40) : null,
    km: null,
    direction: verifiedLoc ? clip(item && item.direction, 40) : null,
    locality: verifiedLoc ? clip(item && item.region && item.region.name, 80) : null,
    startsAt: clip(item && item.validFrom, 40),
    endsAt: clip(item && item.validTo, 40),
    status: clip(item && item.status, 40),
    severity: clip(item && item.severity, 40),
    source: clip((item && item.sourceLabel) || "NDIC", 40),
    lastChangedAt: clip(
      (item && (item.lastUpdatedBySource || item.sortAt || item.lastProcessedAt)) || null,
      40
    ),
  };
  for (const k of CARD_PREVIEW_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) row[k] = null;
  }
  return row;
}

function computeResolverAndPublicationMetrics(allItems, gateItems) {
  let active = 0;
  let future = 0;
  let ended = 0;
  let cancelled = 0;
  let resolvedBasic = 0;
  let resolvedOpenlr = 0;
  let resolvedOther = 0;
  let unresolvedTotal = 0;
  let unresolvedTmc = 0;
  let unresolvedMissing = 0;
  let unresolvedInvalid = 0;
  let resolverAttempted = 0;
  let provenanceValid = 0;
  let provenanceMissing = 0;
  let sourceTimeValid = 0;
  let sourceTimeMissing = 0;
  const tmcMissReasons = {
    cid_mismatch: 0,
    tabcd_mismatch: 0,
    lcd_not_found: 0,
    point_lookup_miss: 0,
    segment_lookup_miss: 0,
    area_lookup_miss: 0,
    unsupported_reference_type: 0,
    unsupported_direction: 0,
    unsupported_offset: 0,
    other: 0,
  };
  const locationProfiles = {
    alertc_point: 0,
    alertc_linear: 0,
    tmc_specific_location: 0,
    point_coordinates: 0,
    openlr: 0,
    gml_point: 0,
    gml_linestring: 0,
    gml_polygon: 0,
    network_location: 0,
    supplementary_positional_description: 0,
    text_only: 0,
    no_localization_signal: 0,
    other: 0,
  };
  const presenceFields = {
    hasAlertCPoint: 0,
    hasAlertCLinear: 0,
    hasSpecificLocation: 0,
    hasPointCoordinates: 0,
    hasOpenLR: 0,
    hasGmlPoint: 0,
    hasGmlLineString: 0,
    hasGmlPolygon: 0,
    hasNetworkLocation: 0,
    hasSupplementaryPositionalDescription: 0,
  };
  const trustBefore = { tmc: 0, text: 0, national_fallback: 0, none: 0 };
  const trustAfter = { coordinates: 0, openlr: 0, tmc: 0, text: 0, national_fallback: 0, none: 0 };
  const tmcReferenceKinds = { point: 0, linear: 0, other: 0 };
  const tmcLocationClasses = { point: 0, segment: 0, area: 0, unknown: 0 };
  let coordinatePresent = 0;
  let coordinateParsed = 0;
  let coordinateValid = 0;
  let coordinateVerifiedTrust = 0;
  let coordinateBlocked = 0;
  const openlr = {
    input: 0, resolved: 0, ambiguous: 0, invalid: 0, unsupported: 0, referenceDataMissing: 0, decodeFailed: 0,
    eligible: 0, blocked: 0, line: 0, point: 0, geo: 0, area: 0, binary: 0, other: 0, xml: 0,
  };
  const lcdMissClass = {
    point_in_lt: 0,
    segment_in_lt: 0,
    area_in_lt: 0,
    in_codes_only: 0,
    orphan_not_in_lt: 0,
  };
  const supplementaryClass = {
    verifiable_standard: 0,
    text_only: 0,
    incomplete: 0,
  };
  const noSignalSubtype = {
    empty_localization: 0,
    no_location_element: 0,
    known_profile_but_no_usable_reference: 0,
    unrecognized_standard_profile: 0,
    unrecognized_vendor_extension: 0,
    location_extension_only: 0,
    text_only_location: 0,
    structured_but_incomplete: 0,
    other_no_signal: 0,
    // legacy keys mapped during aggregation
    empty_group_of_locations: 0,
    unrecognized_location_profile: 0,
  };
  let locHasAlertCArea = 0;
  let locHasTpeg = 0;
  let locHasItinerary = 0;
  let locUnrecognized = 0;
  const standardRootCounts = new Map();
  const vendorRootCounts = new Map();
  const vendorClassCounts = {
    KNOWN_DATEX_PROFILE_INSIDE_EXTENSION: 0,
    KNOWN_DATEX_EXTENSION_TYPE: 0,
    NDIC_VENDOR_EXTENSION: 0,
    OTHER_VENDOR_EXTENSION: 0,
    METADATA_ONLY_EXTENSION: 0,
    STRUCTURED_LOCATION_EXTENSION: 0,
    TEXT_ONLY_EXTENSION: 0,
    UNKNOWN_EXTENSION: 0,
  };
  const predefinedRef = {
    total: 0,
    hasId: 0,
    hasVersion: 0,
    hasSetHint: 0,
    digests: new Map(),
  };
  const lcdCodesOnly = {
    total: 0,
    hasParent: 0,
    hasNext: 0,
    hasPrev: 0,
    hasRoadNumber: 0,
    hasRoadName: 0,
    hasDirection: 0,
    hasAdminArea: 0,
    hasMunicipality: 0,
    hasCoordinates: 0,
    hasSegmentLink: 0,
    hasPointLink: 0,
    hasAreaLink: 0,
    hasOtherStandardLink: 0,
    hasAllocated: 0,
    boundToRoadOnly: 0,
    unbound: 0,
    outcomeSafeExisting: 0,
    outcomeSafeMissingRef: 0,
    outcomeInvalid: 0,
    outcomeHistoricalForeign: 0,
    outcomeValidNoGeom: 0,
    outcomeFailClosed: 0,
  };
  const locationPresentation = {
    PRECISE: 0,
    SCOPED: 0,
    GENERAL: 0,
    NONE: 0,
    total: 0,
  };
  const mapLinkInventory = {
    DIRECT_EVENT: 0,
    VERIFIED_LOCATION: 0,
    GENERAL_RSD_FALLBACK: 0,
    NONE: 0,
    total: 0,
  };

  function bumpRootMap(map, name) {
    const key = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 80);
    const safe = key || "unknown_root";
    map.set(safe, (map.get(safe) || 0) + 1);
  }

  for (const it of allItems) {
    const st = String((it && it.status) || "");
    if (st === "aktivni") active += 1;
    else if (st === "naplanovano") future += 1;
    else if (st === "ukonceno") ended += 1;
    else if (st === "zruseno") cancelled += 1;

    const presentationForensic = classifyFeedItemPresentationForensics(it);
    const pLevel = String(presentationForensic.locationPresentationLevel || LOCATION_PRESENTATION_LEVEL.NONE);
    if (Object.prototype.hasOwnProperty.call(locationPresentation, pLevel)) {
      locationPresentation[pLevel] += 1;
    } else {
      locationPresentation.NONE += 1;
    }
    locationPresentation.total += 1;
    const mType = String(presentationForensic.mapLinkType || FORENSIC_MAP_LINK_TYPE.NONE);
    if (Object.prototype.hasOwnProperty.call(mapLinkInventory, mType)) {
      mapLinkInventory[mType] += 1;
    } else {
      mapLinkInventory.NONE += 1;
    }
    mapLinkInventory.total += 1;

    const trust = String((it && it.localizationTrust) || "");
    const tmcOk = it && it.ndicV1 && Number(it.ndicV1.tmcOk) > 0;
    const tmcMiss = it && it.ndicV1 && Number(it.ndicV1.tmcMiss) > 0;
    const forensic = (it && it.ndicV1 && it.ndicV1.forensic) || {};
    const openlrForensic = forensic.openlr || {};
    if (forensic.hasOpenLR === true) {
      openlr.input += 1;
      if (forensic.hasOpenlrLine) openlr.line += 1;
      else if (forensic.hasOpenlrPoint) openlr.point += 1;
      else if (forensic.hasOpenlrGeo) openlr.geo += 1;
      else if (forensic.hasOpenlrArea) openlr.area += 1;
      else openlr.other += 1;
      if (forensic.hasOpenlrBinary) openlr.binary += 1;
      else openlr.xml += 1;
      const status = String(openlrForensic.status || "");
      if (status === "OPENLR_RESOLVED") { openlr.resolved += 1; if (openlrForensic.publicationEligible) openlr.eligible += 1; }
      else { openlr.blocked += 1; if (status === "OPENLR_AMBIGUOUS") openlr.ambiguous += 1; else if (status === "OPENLR_INVALID") openlr.invalid += 1; else if (status === "OPENLR_UNSUPPORTED_TYPE") openlr.unsupported += 1; else if (status === "OPENLR_REFERENCE_DATA_MISSING") openlr.referenceDataMissing += 1; else openlr.decodeFailed += 1; }
    }
    for (const field of Object.keys(presenceFields)) {
      if (forensic[field] === true) presenceFields[field] += 1;
    }
    const coordinateProbe = forensic.coordinateProbe || {};
    if (coordinateProbe.present === true) coordinatePresent += 1;
    if (coordinateProbe.parsed === true) coordinateParsed += 1;
    if (coordinateProbe.valid === true) coordinateValid += 1;
    if (trust === "coordinates") coordinateVerifiedTrust += 1;
    if (coordinateProbe.present === true && trust !== "coordinates") coordinateBlocked += 1;

    const before = String(forensic.trustBeforeResolver || "");
    if (Object.prototype.hasOwnProperty.call(trustBefore, before)) trustBefore[before] += 1;
    const after = String(forensic.trustAfterResolver || "");
    if (Object.prototype.hasOwnProperty.call(trustAfter, after)) trustAfter[after] += 1;
    const referenceKind = String(forensic.tmcReferenceKind || "");
    if (referenceKind === "point" || referenceKind === "linear") tmcReferenceKinds[referenceKind] += 1;
    else tmcReferenceKinds.other += 1;
    const locationClass = String(forensic.tmcLocationClass || "");
    if (locationClass === "point" || locationClass === "segment" || locationClass === "area") {
      tmcLocationClasses[locationClass] += 1;
    } else {
      tmcLocationClasses.unknown += 1;
    }
    if (tmcOk || tmcMiss) resolverAttempted += 1;

    if (forensic.hasAlertCArea === true) locHasAlertCArea += 1;
    if (forensic.hasTpegLocation === true) locHasTpeg += 1;
    if (forensic.hasItinerary === true) locHasItinerary += 1;
    if (forensic.hasUnrecognizedLocationProfile === true) locUnrecognized += 1;

    if (trust === "openlr") resolvedOpenlr += 1;
    else if (trust === "tmc" || tmcOk) resolvedBasic += 1;
    else if (trust === "coordinates") resolvedOther += 1;
    else {
      unresolvedTotal += 1;
      if (tmcMiss && !tmcOk) {
        unresolvedTmc += 1;
        const reason = String(forensic.tmcMissReason || "");
        if (Object.prototype.hasOwnProperty.call(tmcMissReasons, reason)) tmcMissReasons[reason] += 1;
        else tmcMissReasons.other += 1;
        const missClass = String(forensic.tmcMissClass || "");
        if (Object.prototype.hasOwnProperty.call(lcdMissClass, missClass)) lcdMissClass[missClass] += 1;
        else lcdMissClass.orphan_not_in_lt += 1;
        if (missClass === "in_codes_only") {
          const co = forensic.lcdCodesOnly || {};
          lcdCodesOnly.total += 1;
          if (co.hasParent === true) lcdCodesOnly.hasParent += 1;
          if (co.hasNext === true) lcdCodesOnly.hasNext += 1;
          if (co.hasPrev === true) lcdCodesOnly.hasPrev += 1;
          if (co.hasRoadNumber === true) lcdCodesOnly.hasRoadNumber += 1;
          if (co.hasRoadName === true) lcdCodesOnly.hasRoadName += 1;
          if (co.hasDirection === true) lcdCodesOnly.hasDirection += 1;
          if (co.hasAdminArea === true) lcdCodesOnly.hasAdminArea += 1;
          if (co.hasMunicipality === true) lcdCodesOnly.hasMunicipality += 1;
          if (co.hasCoordinates === true) lcdCodesOnly.hasCoordinates += 1;
          if (co.hasSegmentLink === true) lcdCodesOnly.hasSegmentLink += 1;
          if (co.hasPointLink === true) lcdCodesOnly.hasPointLink += 1;
          if (co.hasAreaLink === true) lcdCodesOnly.hasAreaLink += 1;
          if (co.hasOtherStandardLink === true) lcdCodesOnly.hasOtherStandardLink += 1;
          if (co.hasAllocated === true) lcdCodesOnly.hasAllocated += 1;
          if (co.boundToRoadOnly === true) lcdCodesOnly.boundToRoadOnly += 1;
          if (co.unbound === true) lcdCodesOnly.unbound += 1;
          const outcome = String(co.outcome || "CORRECT_FAIL_CLOSED");
          if (outcome === "SAFE_RESOLVABLE_WITH_EXISTING_DATA") lcdCodesOnly.outcomeSafeExisting += 1;
          else if (outcome === "SAFE_RESOLVABLE_WITH_MISSING_OFFICIAL_REFERENCE_DATA") {
            lcdCodesOnly.outcomeSafeMissingRef += 1;
          } else if (outcome === "INVALID_SOURCE_REFERENCE") lcdCodesOnly.outcomeInvalid += 1;
          else if (outcome === "HISTORICAL_OR_FOREIGN_REFERENCE") lcdCodesOnly.outcomeHistoricalForeign += 1;
          else if (outcome === "VALID_BUT_NO_GEOMETRY") lcdCodesOnly.outcomeValidNoGeom += 1;
          else lcdCodesOnly.outcomeFailClosed += 1;
        }
      } else {
        unresolvedMissing += 1;
        const profile = String(forensic.locationProfileBucket || "");
        if (Object.prototype.hasOwnProperty.call(locationProfiles, profile)) locationProfiles[profile] += 1;
        else locationProfiles.no_localization_signal += 1;
        if (profile === "supplementary_positional_description") {
          const sc = String((forensic.supplementary && forensic.supplementary.classification) || "");
          if (sc === "SUPPLEMENTARY_VERIFIABLE_STANDARD_LOCATION") supplementaryClass.verifiable_standard += 1;
          else if (sc === "SUPPLEMENTARY_TEXT_ONLY") supplementaryClass.text_only += 1;
          else supplementaryClass.incomplete += 1;
        }
        if (profile === "no_localization_signal") {
          const st = String(forensic.noSignalSubtype || "other_no_signal");
          if (st === "empty_localization" || st === "empty_group_of_locations") {
            noSignalSubtype.empty_localization += 1;
            noSignalSubtype.empty_group_of_locations += 1;
          } else if (st === "unrecognized_standard_profile" || st === "unrecognized_location_profile") {
            noSignalSubtype.unrecognized_standard_profile += 1;
            noSignalSubtype.unrecognized_location_profile += 1;
            const ri = forensic.rootInventory || {};
            const names =
              Array.isArray(ri.standardRootNames) && ri.standardRootNames.length
                ? ri.standardRootNames
                : [ri.primaryStandardLocalName || "unknown_root"];
            bumpRootMap(standardRootCounts, names[0]);
            const pref = forensic.predefinedRef || null;
            const isPredef =
              String(names[0] || "") === "predefinedlocationreference" ||
              (pref && (pref.hasId === true || pref.count > 0));
            if (isPredef) {
              predefinedRef.total += 1;
              if (pref && pref.hasId === true) predefinedRef.hasId += 1;
              if (pref && pref.hasVersion === true) predefinedRef.hasVersion += 1;
              if (pref && pref.hasSetHint === true) predefinedRef.hasSetHint += 1;
              const dig = pref && typeof pref.idDigest === "string" ? pref.idDigest : "";
              if (/^[a-f0-9]{16}$/.test(dig)) {
                predefinedRef.digests.set(dig, (predefinedRef.digests.get(dig) || 0) + 1);
              }
            }
          } else if (st === "unrecognized_vendor_extension") {
            noSignalSubtype.unrecognized_vendor_extension += 1;
            const ri = forensic.rootInventory || {};
            const names =
              Array.isArray(ri.vendorRootNames) && ri.vendorRootNames.length
                ? ri.vendorRootNames
                : [ri.primaryVendorLocalName || "unknown_root"];
            bumpRootMap(vendorRootCounts, names[0]);
            const vc = String(ri.primaryVendorClass || "UNKNOWN_EXTENSION");
            if (Object.prototype.hasOwnProperty.call(vendorClassCounts, vc)) vendorClassCounts[vc] += 1;
            else vendorClassCounts.UNKNOWN_EXTENSION += 1;
          } else if (Object.prototype.hasOwnProperty.call(noSignalSubtype, st)) {
            noSignalSubtype[st] += 1;
          } else {
            noSignalSubtype.other_no_signal += 1;
          }
        }
      }
    }

    if (hasProvenance(it)) provenanceValid += 1;
    else provenanceMissing += 1;

    if (it && it.publishedAtSource) sourceTimeValid += 1;
    else sourceTimeMissing += 1;
  }

  let pubEligible = 0;
  let pubBlocked = 0;
  let blockedLocation = 0;
  let blockedKm = 0;
  let blockedDirection = 0;
  let blockedProvenance = 0;
  let withLocation = 0;
  let withoutLocation = 0;
  let withKm = 0;
  let withoutKm = 0;
  let withDirection = 0;
  let withoutDirection = 0;

  for (const it of gateItems) {
    const verified = hasVerifiedLocationTrust(it);
    const prov = hasProvenance(it);
    // km is never projected from current feed model (always absent)
    const hasKm = false;
    const hasDir = verified && Boolean(clip(it && it.direction, 40));

    if (verified) {
      withLocation += 1;
      if (hasDir) withDirection += 1;
      else {
        withoutDirection += 1;
        blockedDirection += 1;
      }
    } else {
      withoutLocation += 1;
      withoutDirection += 1;
      blockedLocation += 1;
      blockedDirection += 1;
    }
    withoutKm += 1;
    blockedKm += 1;
    if (!prov) blockedProvenance += 1;

    // Eligible for precise public geo publication only with verified location + provenance.
    // Unresolved location ⇒ blocked (not publicly displayable as precise traffic card).
    if (verified && prov) pubEligible += 1;
    else pubBlocked += 1;
  }

  function inventoryFromMap(map, max = 64) {
    const rows = [...map.entries()]
      .map(([localName, count]) => ({ localName, count }))
      .sort((a, b) => b.count - a.count || a.localName.localeCompare(b.localName));
    return {
      rows: rows.slice(0, max),
      truncated: rows.length > max,
      sum: [...map.values()].reduce((a, b) => a + b, 0),
    };
  }
  const standardRootInventory = inventoryFromMap(standardRootCounts);
  const vendorRootInventory = inventoryFromMap(vendorRootCounts);
  const vendorClassTotal = Object.values(vendorClassCounts).reduce((a, b) => a + b, 0);
  const predefinedRefDigestRows = [...predefinedRef.digests.entries()]
    .map(([digest, count]) => ({ digest, count }))
    .sort((a, b) => b.count - a.count || a.digest.localeCompare(b.digest))
    .slice(0, 32);

  return {
    active,
    future,
    ended,
    cancelled,
    resolvedBasic,
    resolvedOpenlr,
    resolvedOther,
    unresolvedTotal,
    unresolvedTmc,
    unresolvedMissing,
    unresolvedInvalid,
    resolverAttempted,
    provenanceValid,
    provenanceMissing,
    sourceTimeValid,
    sourceTimeMissing,
    pubEligible,
    pubBlocked,
    blockedLocation,
    blockedKm,
    blockedDirection,
    blockedProvenance,
    withLocation,
    withoutLocation,
    withKm,
    withoutKm,
    withDirection,
    withoutDirection,
    tmcMissReasons,
    locationProfiles,
    presenceFields,
    coordinatePresent,
    coordinateParsed,
    coordinateValid,
    coordinateVerifiedTrust,
    coordinateBlocked,
    trustBefore,
    trustAfter,
    tmcReferenceKinds,
    tmcLocationClasses,
    openlr,
    lcdMissClass,
    supplementaryClass,
    noSignalSubtype,
    locHasAlertCArea,
    locHasTpeg,
    locHasItinerary,
    locUnrecognized,
    standardRootInventory,
    vendorRootInventory,
    vendorClassCounts,
    vendorClassTotal,
    predefinedRef: {
      total: predefinedRef.total,
      hasId: predefinedRef.hasId,
      hasVersion: predefinedRef.hasVersion,
      hasSetHint: predefinedRef.hasSetHint,
      digestRows: predefinedRefDigestRows,
    },
    lcdCodesOnly,
    locationPresentation,
    mapLinkInventory,
  };
}

/**
 * Card location validation: projected geo fields may be non-null only for verified-trust sources.
 */
export function evaluateCardLocationValidation(previewSource, previewItems) {
  if (previewSource.length !== previewItems.length) return false;
  for (let i = 0; i < previewSource.length; i += 1) {
    const src = previewSource[i];
    const row = previewItems[i];
    const verified = hasVerifiedLocationTrust(src);
    const geoFields = [row.road, row.km, row.direction, row.locality];
    const anyGeo = geoFields.some((v) => v != null && v !== "");
    if (!verified && anyGeo) return false;
    if (row.km != null) return false; // km never verified in current model
  }
  return true;
}

/**
 * Card publication eligibility: preview must not claim geo for blocked items.
 * Schema-valid projection ≠ publicly displayable precise card.
 */
export function evaluateCardPublicationEligibility(previewSource, previewItems, summaryEligibleTotal) {
  if (!evaluateCardLocationValidation(previewSource, previewItems)) return false;
  // If zero eligible in full gate set, preview must not show any geo fields.
  if (summaryEligibleTotal === 0) {
    return previewItems.every((row) => row.road == null && row.km == null && row.direction == null && row.locality == null);
  }
  return true;
}

/**
 * @param {object} ctx
 */
export function buildShadowForensicBundle(ctx = {}) {
  const finishedAt = normalizeIso(ctx.finishedAt, new Date().toISOString());
  const startedAt = normalizeIso(ctx.startedAt || finishedAt, finishedAt);
  const headSha = resolveHeadSha(ctx.headSha);
  const runId = resolveRunId(ctx.runId || (ctx.diagnostics && ctx.diagnostics.runId));
  const mode = ctx.mode || "shadow";
  const result = ctx.result || {};
  const parsed = result.parsed || {};
  const stats = ctx.stats || result.stats || {};
  const gateItems = Array.isArray(ctx.gateItems)
    ? ctx.gateItems
    : Array.isArray(result.gate && result.gate.items)
      ? result.gate.items
      : [];
  const quarantine = Array.isArray(result.quarantine) ? result.quarantine : [];
  const rejectedParse = Array.isArray(result.rejectedParse) ? result.rejectedParse : [];
  const allItems = Array.isArray(result.all) ? result.all : gateItems;

  const m = computeResolverAndPublicationMetrics(allItems, gateItems);

  const loaded = Number(parsed.situationCount) || allItems.length || gateItems.length;
  const rejected = (Number(parsed.rejectedCount) || 0) + quarantine.length + rejectedParse.length;
  const duplicatesDetected = Number(stats.unchanged) || 0;
  const deduplicated = duplicatesDetected;
  const previewSource = gateItems.slice(0, MAX_CARD_PREVIEW_ITEMS);
  const previewItems = previewSource.map(buildCardPreviewItem);

  let datexBytes = Number.isFinite(ctx.datexBytesRead) ? Math.max(0, Math.floor(ctx.datexBytesRead)) : 0;
  if (datexBytes > MAX_DATEX_BYTES_READ) datexBytes = MAX_DATEX_BYTES_READ;

  const tmcDiag = (ctx.diagnostics && ctx.diagnostics.tmc) || {};
  const ignoredEntries = sanitizeEntryList(tmcDiag.ignoredEntries, MAX_RETAINED_IGNORED_ENTRY_METADATA).map(
    (e) => ({ ...e, resolutionRequired: false, authoritative: false })
  );
  const unknownNonclassifiedEntries = sanitizeEntryList(
    tmcDiag.unknownNonclassifiedEntries,
    MAX_RETAINED_UNKNOWN_ENTRY_METADATA
  );
  const unknownRequiredEntries = sanitizeEntryList(
    tmcDiag.unknownRequiredEntries,
    MAX_RETAINED_UNKNOWN_ENTRY_METADATA
  );
  const rejectedUnsafeEntries = sanitizeEntryList(
    tmcDiag.rejectedUnsafeEntries,
    MAX_RETAINED_UNKNOWN_ENTRY_METADATA
  );
  const ignoredTotal = Number(tmcDiag.ignoredNonStandardCount) || 0;
  const unknownNonTotal = Number(tmcDiag.unknownNonclassifiedCount) || 0;
  const unknownReqTotal = Number(tmcDiag.unknownRequiredCount) || 0;
  const rejectedTotal = Number(tmcDiag.rejectedUnsafeCount) || 0;

  const cardProjectionPass = true; // set after validateCardPreview
  const cardLocationPass = evaluateCardLocationValidation(previewSource, previewItems);
  const cardEligPass = evaluateCardPublicationEligibility(previewSource, previewItems, m.pubEligible);

  const summary = {
    schema: FORENSIC_SCHEMA,
    RUN_ID: runId,
    HEAD_SHA: headSha,
    MODE: mode,
    STARTED_AT: startedAt,
    FINISHED_AT: finishedAt,
    OK: Boolean(ctx.ok),
    REASON: clip(ctx.reason || (ctx.ok ? "ok" : "failed"), 120) || "unknown",
    DATEX_HTTP_STATUS_CLASS: httpStatusClass(ctx.datexHttpStatus),
    DATEX_CONTENT_TYPE_VALID: Boolean(ctx.datexContentTypeValid),
    DATEX_BYTES_READ: datexBytes,
    DATEX_XML_PARSE_PASS: Boolean(parsed.ok != null ? parsed.ok : ctx.ok),
    TMC_ARCHIVE_USED: Boolean(
      ctx.diagnostics && ctx.diagnostics.tmc && (ctx.diagnostics.tmc.ok || ctx.diagnostics.tmc.reason === "fixture")
    ),
    TMC_VERSION:
      clip(
        (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.meta && ctx.diagnostics.tmc.meta.version) ||
          "unknown",
        64
      ) || "unknown",
    TMC_REASON: (() => {
      const raw =
        (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.reason) ||
        (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.ok === false ? "tmc_failed" : "none");
      const s = String(raw).replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 80);
      return s || "none";
    })(),
    TMC_ACTIVE: Boolean(
      ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.meta && ctx.diagnostics.tmc.meta.active
    ),
    TMC_POINT_COUNT: Number(
      (ctx.diagnostics &&
        ctx.diagnostics.tmc &&
        ctx.diagnostics.tmc.meta &&
        ctx.diagnostics.tmc.meta.pointCount) ||
        0
    ),
    TMC_NONSTANDARD_IGNORED_COUNT: Number(
      (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.ignoredNonStandardCount) || 0
    ),
    TMC_REQUIRED_TABLE_COUNT_EXPECTED: Number(
      (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.requiredTableCountExpected) || 0
    ),
    TMC_REQUIRED_TABLE_COUNT_FOUND: Number(
      (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.requiredTableCountFound) || 0
    ),
    TMC_REQUIRED_TABLE_SET_COMPLETE: Boolean(
      ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.requiredTableSetComplete === true
    ),
    TMC_REQUIRED_TABLE_SET_VALID: Boolean(
      ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.requiredTableSetValid === true
    ),
    TMC_UNKNOWN_REQUIRED_COUNT: Number(
      (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.unknownRequiredCount) || 0
    ),
    TMC_UNKNOWN_NONCLASSIFIED_COUNT: Number(
      (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.unknownNonclassifiedCount) || 0
    ),
    TMC_REJECTED_UNSAFE_COUNT: Number(
      (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.rejectedUnsafeCount) || 0
    ),
    TMC_UNKNOWN_NONCLASSIFIED_RETAINED_COUNT: unknownNonclassifiedEntries.length,
    TMC_UNKNOWN_REQUIRED_RETAINED_COUNT: unknownRequiredEntries.length,
    TMC_REJECTED_UNSAFE_RETAINED_COUNT: rejectedUnsafeEntries.length,
    TMC_CID: (() => {
      const v = tmcDiag.cid;
      return Number.isInteger(v) ? v : null;
    })(),
    TMC_TABCD: (() => {
      const v = tmcDiag.tabcd;
      return Number.isInteger(v) ? v : null;
    })(),
    TMC_RESOLVER_TABLE_ACTIVATED: Boolean(tmcDiag.resolverTableActivated === true),
    TMC_IGNORED_ENTRIES: ignoredEntries,
    TMC_IGNORED_ENTRIES_TRUNCATED: Boolean(
      tmcDiag.ignoredEntriesTruncated === true || ignoredTotal > ignoredEntries.length
    ),
    TMC_UNKNOWN_NONCLASSIFIED_ENTRIES: unknownNonclassifiedEntries,
    TMC_UNKNOWN_NONCLASSIFIED_ENTRIES_TRUNCATED: Boolean(unknownNonTotal > unknownNonclassifiedEntries.length),
    TMC_UNKNOWN_REQUIRED_ENTRIES: unknownRequiredEntries,
    TMC_UNKNOWN_REQUIRED_ENTRIES_TRUNCATED: Boolean(unknownReqTotal > unknownRequiredEntries.length),
    TMC_REJECTED_UNSAFE_ENTRIES: rejectedUnsafeEntries,
    TMC_REJECTED_UNSAFE_ENTRIES_TRUNCATED: Boolean(rejectedTotal > rejectedUnsafeEntries.length),
    TMC_RESOLVER_VERSION: clip(PARSER_VERSION, 64) || "unknown",
    LOADED_EVENTS: loaded,
    ACTIVE_EVENTS: m.active,
    FUTURE_EVENTS: m.future,
    ENDED_EVENTS: m.ended,
    REJECTED_EVENTS: rejected,
    RESOLVED_BASIC: m.resolvedBasic,
    RESOLVED_OPENLR: m.resolvedOpenlr,
    UNRESOLVED: m.unresolvedTotal,
    DUPLICATES_DETECTED: duplicatesDetected,
    DEDUPLICATED_EVENTS: deduplicated,
    NORMALIZED_EVENTS: gateItems.length,
    AGGREGATED_EVENTS: gateItems.length,
    DIFF_NEW: Number(stats.new) || 0,
    DIFF_CHANGED: Number(stats.updated) || 0,
    DIFF_ENDED: Number(stats.ended) || 0,
    DIFF_CANCELLED: m.cancelled,
    // PUBLICATION_ITEMS = internal projections (NOT public geo-eligible count)
    PUBLICATION_ITEMS: gateItems.length,
    PUBLICATION_REJECTED: rejected,
    FEED_ITEMS: gateItems.length,
    CARD_PREVIEW_COUNT: previewItems.length,
    CARD_VALIDATION_PASS: false,
    CARD_PROJECTION_VALIDATION_PASS: false,
    CARD_PUBLICATION_ELIGIBILITY_PASS: cardEligPass,
    CARD_LOCATION_VALIDATION_PASS: cardLocationPass,
    PROVENANCE_FIELDS_VALID: m.provenanceValid,
    PROVENANCE_FIELDS_MISSING: m.provenanceMissing,
    PROVENANCE_REJECTED: quarantine.filter((q) => q && /provenance|legal/i.test(String(q.quarantineReason || ""))).length,
    SOURCE_TIME_VALID: m.sourceTimeValid,
    SOURCE_TIME_MISSING: m.sourceTimeMissing,
    UNVERIFIED_KM_PUBLISHED: 0,
    UNVERIFIED_DIRECTION_PUBLISHED: 0,
    UNVERIFIED_LOCATION_PUBLISHED: 0,
    FUZZY_MATCH_USED: false,
    GEOCODING_USED: Boolean(ctx.geocodingUsed),
    HEURISTIC_LOCATION_USED: false,
    PUBLICATION_ENABLED: false,
    PUBLISHED: false,
    SHADOW_ISOLATED: ctx.shadowIsolated !== false,
    MAX_CARD_PREVIEW_ITEMS,
    PUBLICATION_PROJECTIONS_TOTAL: gateItems.length,
    PUBLICATION_ELIGIBLE_TOTAL: m.pubEligible,
    PUBLICATION_BLOCKED_TOTAL: m.pubBlocked,
    PUBLICATION_BLOCKED_LOCATION: m.blockedLocation,
    PUBLICATION_BLOCKED_KM: m.blockedKm,
    PUBLICATION_BLOCKED_DIRECTION: m.blockedDirection,
    PUBLICATION_BLOCKED_PROVENANCE: m.blockedProvenance,
    PUBLICATION_WITH_LOCATION: m.withLocation,
    PUBLICATION_WITHOUT_LOCATION: m.withoutLocation,
    PUBLICATION_WITH_KM: m.withKm,
    PUBLICATION_WITHOUT_KM: m.withoutKm,
    PUBLICATION_WITH_DIRECTION: m.withDirection,
    PUBLICATION_WITHOUT_DIRECTION: m.withoutDirection,
    RESOLVER_INPUT_TOTAL: allItems.length,
    RESOLVER_ATTEMPTED_TOTAL: m.resolverAttempted,
    RESOLVED_OTHER_VALID_LOCATION: m.resolvedOther,
    UNRESOLVED_TOTAL: m.unresolvedTotal,
    UNRESOLVED_TMC_REFERENCE: m.unresolvedTmc,
    UNRESOLVED_MISSING_REFERENCE: m.unresolvedMissing,
    UNRESOLVED_INVALID_REFERENCE: m.unresolvedInvalid,
    UNRESOLVED_TMC_MISS_CID_MISMATCH: m.tmcMissReasons.cid_mismatch,
    UNRESOLVED_TMC_MISS_TABCD_MISMATCH: m.tmcMissReasons.tabcd_mismatch,
    UNRESOLVED_TMC_MISS_LCD_NOT_FOUND: m.tmcMissReasons.lcd_not_found,
    UNRESOLVED_TMC_MISS_POINT_LOOKUP_MISS: m.tmcMissReasons.point_lookup_miss,
    UNRESOLVED_TMC_MISS_SEGMENT_LOOKUP_MISS: m.tmcMissReasons.segment_lookup_miss,
    UNRESOLVED_TMC_MISS_AREA_LOOKUP_MISS: m.tmcMissReasons.area_lookup_miss,
    UNRESOLVED_TMC_MISS_UNSUPPORTED_REFERENCE_TYPE: m.tmcMissReasons.unsupported_reference_type,
    UNRESOLVED_TMC_MISS_UNSUPPORTED_DIRECTION: m.tmcMissReasons.unsupported_direction,
    UNRESOLVED_TMC_MISS_UNSUPPORTED_OFFSET: m.tmcMissReasons.unsupported_offset,
    UNRESOLVED_TMC_MISS_OTHER: m.tmcMissReasons.other,
    UNRESOLVED_MISSING_PROFILE_ALERTC_POINT: m.locationProfiles.alertc_point,
    UNRESOLVED_MISSING_PROFILE_ALERTC_LINEAR: m.locationProfiles.alertc_linear,
    UNRESOLVED_MISSING_PROFILE_TMC_SPECIFIC_LOCATION: m.locationProfiles.tmc_specific_location,
    UNRESOLVED_MISSING_PROFILE_POINT_COORDINATES: m.locationProfiles.point_coordinates,
    UNRESOLVED_MISSING_PROFILE_OPENLR: m.locationProfiles.openlr,
    UNRESOLVED_MISSING_PROFILE_GML_POINT: m.locationProfiles.gml_point,
    UNRESOLVED_MISSING_PROFILE_GML_LINESTRING: m.locationProfiles.gml_linestring,
    UNRESOLVED_MISSING_PROFILE_GML_POLYGON: m.locationProfiles.gml_polygon,
    UNRESOLVED_MISSING_PROFILE_NETWORK_LOCATION: m.locationProfiles.network_location,
    UNRESOLVED_MISSING_PROFILE_SUPPLEMENTARY_POSITIONAL_DESCRIPTION:
      m.locationProfiles.supplementary_positional_description,
    UNRESOLVED_MISSING_PROFILE_TEXT_ONLY: m.locationProfiles.text_only,
    UNRESOLVED_MISSING_PROFILE_NO_LOCALIZATION_SIGNAL: m.locationProfiles.no_localization_signal,
    UNRESOLVED_MISSING_PROFILE_OTHER: m.locationProfiles.other,
    LOC_HAS_ALERTC_POINT: m.presenceFields.hasAlertCPoint,
    LOC_HAS_ALERTC_LINEAR: m.presenceFields.hasAlertCLinear,
    LOC_HAS_SPECIFIC_LOCATION: m.presenceFields.hasSpecificLocation,
    LOC_HAS_POINT_COORDINATES: m.presenceFields.hasPointCoordinates,
    LOC_HAS_OPENLR: m.presenceFields.hasOpenLR,
    LOC_HAS_GML_POINT: m.presenceFields.hasGmlPoint,
    LOC_HAS_GML_LINESTRING: m.presenceFields.hasGmlLineString,
    LOC_HAS_GML_POLYGON: m.presenceFields.hasGmlPolygon,
    LOC_HAS_NETWORK_LOCATION: m.presenceFields.hasNetworkLocation,
    LOC_HAS_SUPPLEMENTARY_POSITIONAL_DESCRIPTION: m.presenceFields.hasSupplementaryPositionalDescription,
    POINT_COORDINATES_PRESENT_TOTAL: m.coordinatePresent,
    POINT_COORDINATES_PARSED_TOTAL: m.coordinateParsed,
    POINT_COORDINATES_VALID_TOTAL: m.coordinateValid,
    POINT_COORDINATES_VERIFIED_TRUST_TOTAL: m.coordinateVerifiedTrust,
    POINT_COORDINATES_BLOCKED_TOTAL: m.coordinateBlocked,
    TRUST_BEFORE_TMC: m.trustBefore.tmc,
    TRUST_BEFORE_TEXT: m.trustBefore.text,
    TRUST_BEFORE_NATIONAL_FALLBACK: m.trustBefore.national_fallback,
    TRUST_BEFORE_NONE: m.trustBefore.none,
    TRUST_AFTER_COORDINATES: m.trustAfter.coordinates,
    TRUST_AFTER_OPENLR: m.trustAfter.openlr,
    TRUST_AFTER_TMC: m.trustAfter.tmc,
    TRUST_AFTER_TEXT: m.trustAfter.text,
    TRUST_AFTER_NATIONAL_FALLBACK: m.trustAfter.national_fallback,
    TRUST_AFTER_NONE: m.trustAfter.none,
    TMC_REF_KIND_POINT: m.tmcReferenceKinds.point,
    TMC_REF_KIND_LINEAR: m.tmcReferenceKinds.linear,
    TMC_REF_KIND_OTHER: m.tmcReferenceKinds.other,
    TMC_LOCATION_CLASS_POINT: m.tmcLocationClasses.point,
    TMC_LOCATION_CLASS_SEGMENT: m.tmcLocationClasses.segment,
    TMC_LOCATION_CLASS_AREA: m.tmcLocationClasses.area,
    TMC_LOCATION_CLASS_UNKNOWN: m.tmcLocationClasses.unknown,
    TMC_LCD_MISS_POINT_IN_LT: m.lcdMissClass.point_in_lt,
    TMC_LCD_MISS_SEGMENT_IN_LT: m.lcdMissClass.segment_in_lt,
    TMC_LCD_MISS_AREA_IN_LT: m.lcdMissClass.area_in_lt,
    TMC_LCD_MISS_IN_CODES_ONLY: m.lcdMissClass.in_codes_only,
    TMC_LCD_MISS_ORPHAN_NOT_IN_LT: m.lcdMissClass.orphan_not_in_lt,
    LCD_CODES_ONLY_TOTAL: m.lcdCodesOnly.total,
    LCD_CODES_ONLY_HAS_PARENT: m.lcdCodesOnly.hasParent,
    LCD_CODES_ONLY_HAS_NEXT: m.lcdCodesOnly.hasNext,
    LCD_CODES_ONLY_HAS_PREV: m.lcdCodesOnly.hasPrev,
    LCD_CODES_ONLY_HAS_ROAD_NUMBER: m.lcdCodesOnly.hasRoadNumber,
    LCD_CODES_ONLY_HAS_ROAD_NAME: m.lcdCodesOnly.hasRoadName,
    LCD_CODES_ONLY_HAS_DIRECTION: m.lcdCodesOnly.hasDirection,
    LCD_CODES_ONLY_HAS_ADMIN_AREA: m.lcdCodesOnly.hasAdminArea,
    LCD_CODES_ONLY_HAS_MUNICIPALITY: m.lcdCodesOnly.hasMunicipality,
    LCD_CODES_ONLY_HAS_COORDINATES: m.lcdCodesOnly.hasCoordinates,
    LCD_CODES_ONLY_HAS_SEGMENT_LINK: m.lcdCodesOnly.hasSegmentLink,
    LCD_CODES_ONLY_HAS_POINT_LINK: m.lcdCodesOnly.hasPointLink,
    LCD_CODES_ONLY_HAS_AREA_LINK: m.lcdCodesOnly.hasAreaLink,
    LCD_CODES_ONLY_HAS_OTHER_STANDARD_LINK: m.lcdCodesOnly.hasOtherStandardLink,
    LCD_CODES_ONLY_HAS_ALLOCATED: m.lcdCodesOnly.hasAllocated,
    LCD_CODES_ONLY_BOUND_TO_ROAD_ONLY: m.lcdCodesOnly.boundToRoadOnly,
    LCD_CODES_ONLY_UNBOUND: m.lcdCodesOnly.unbound,
    LCD_CODES_ONLY_SAFE_RESOLVABLE_WITH_EXISTING_DATA: m.lcdCodesOnly.outcomeSafeExisting,
    LCD_CODES_ONLY_SAFE_RESOLVABLE_WITH_MISSING_OFFICIAL_REFERENCE_DATA:
      m.lcdCodesOnly.outcomeSafeMissingRef,
    LCD_CODES_ONLY_INVALID_SOURCE_REFERENCE: m.lcdCodesOnly.outcomeInvalid,
    LCD_CODES_ONLY_HISTORICAL_OR_FOREIGN_REFERENCE: m.lcdCodesOnly.outcomeHistoricalForeign,
    LCD_CODES_ONLY_VALID_BUT_NO_GEOMETRY: m.lcdCodesOnly.outcomeValidNoGeom,
    LCD_CODES_ONLY_CORRECT_FAIL_CLOSED: m.lcdCodesOnly.outcomeFailClosed,
    LOCATION_PRESENTATION_PRECISE: m.locationPresentation.PRECISE,
    LOCATION_PRESENTATION_SCOPED: m.locationPresentation.SCOPED,
    LOCATION_PRESENTATION_GENERAL: m.locationPresentation.GENERAL,
    LOCATION_PRESENTATION_NONE: m.locationPresentation.NONE,
    LOCATION_PRESENTATION_TOTAL: m.locationPresentation.total,
    MAP_LINK_TYPE_DIRECT_EVENT: m.mapLinkInventory.DIRECT_EVENT,
    MAP_LINK_TYPE_VERIFIED_LOCATION: m.mapLinkInventory.VERIFIED_LOCATION,
    MAP_LINK_TYPE_GENERAL_RSD_FALLBACK: m.mapLinkInventory.GENERAL_RSD_FALLBACK,
    MAP_LINK_TYPE_NONE: m.mapLinkInventory.NONE,
    MAP_LINK_TOTAL: m.mapLinkInventory.total,
    SUPPLEMENTARY_VERIFIABLE_STANDARD_LOCATION: m.supplementaryClass.verifiable_standard,
    SUPPLEMENTARY_TEXT_ONLY: m.supplementaryClass.text_only,
    SUPPLEMENTARY_INCOMPLETE: m.supplementaryClass.incomplete,
    NO_SIGNAL_EMPTY_GROUP: m.noSignalSubtype.empty_localization,
    NO_SIGNAL_EMPTY_LOCALIZATION: m.noSignalSubtype.empty_localization,
    NO_SIGNAL_NO_LOCATION_ELEMENT: m.noSignalSubtype.no_location_element,
    NO_SIGNAL_KNOWN_PROFILE_BUT_NO_USABLE_REFERENCE: m.noSignalSubtype.known_profile_but_no_usable_reference,
    NO_SIGNAL_UNRECOGNIZED_PROFILE: m.noSignalSubtype.unrecognized_standard_profile,
    NO_SIGNAL_UNRECOGNIZED_STANDARD_PROFILE: m.noSignalSubtype.unrecognized_standard_profile,
    NO_SIGNAL_UNRECOGNIZED_VENDOR_EXTENSION: m.noSignalSubtype.unrecognized_vendor_extension,
    NO_SIGNAL_LOCATION_EXTENSION_ONLY: m.noSignalSubtype.location_extension_only,
    NO_SIGNAL_TEXT_ONLY_LOCATION: m.noSignalSubtype.text_only_location,
    NO_SIGNAL_STRUCTURED_BUT_INCOMPLETE: m.noSignalSubtype.structured_but_incomplete,
    NO_SIGNAL_OTHER: m.noSignalSubtype.other_no_signal,
    LOC_HAS_ALERTC_AREA: m.locHasAlertCArea,
    LOC_HAS_TPEG: m.locHasTpeg,
    LOC_HAS_ITINERARY: m.locHasItinerary,
    LOC_HAS_UNRECOGNIZED_LOCATION_PROFILE: m.locUnrecognized,
    STANDARD_ROOT_INVENTORY: m.standardRootInventory.rows,
    STANDARD_ROOT_INVENTORY_TRUNCATED: m.standardRootInventory.truncated,
    STANDARD_ROOT_INVENTORY_SUM: m.standardRootInventory.sum,
    VENDOR_ROOT_INVENTORY: m.vendorRootInventory.rows,
    VENDOR_ROOT_INVENTORY_TRUNCATED: m.vendorRootInventory.truncated,
    VENDOR_ROOT_INVENTORY_SUM: m.vendorRootInventory.sum,
    VENDOR_CLASS_KNOWN_DATEX_PROFILE_INSIDE_EXTENSION:
      m.vendorClassCounts.KNOWN_DATEX_PROFILE_INSIDE_EXTENSION,
    VENDOR_CLASS_KNOWN_DATEX_EXTENSION_TYPE: m.vendorClassCounts.KNOWN_DATEX_EXTENSION_TYPE,
    VENDOR_CLASS_NDIC_VENDOR_EXTENSION: m.vendorClassCounts.NDIC_VENDOR_EXTENSION,
    VENDOR_CLASS_OTHER_VENDOR_EXTENSION: m.vendorClassCounts.OTHER_VENDOR_EXTENSION,
    VENDOR_CLASS_METADATA_ONLY_EXTENSION: m.vendorClassCounts.METADATA_ONLY_EXTENSION,
    VENDOR_CLASS_STRUCTURED_LOCATION_EXTENSION: m.vendorClassCounts.STRUCTURED_LOCATION_EXTENSION,
    VENDOR_CLASS_TEXT_ONLY_EXTENSION: m.vendorClassCounts.TEXT_ONLY_EXTENSION,
    VENDOR_CLASS_UNKNOWN_EXTENSION: m.vendorClassCounts.UNKNOWN_EXTENSION,
    VENDOR_CLASS_TOTAL: m.vendorClassTotal,
    PREDEFINED_REF_TOTAL: m.predefinedRef.total,
    PREDEFINED_REF_HAS_ID: m.predefinedRef.hasId,
    PREDEFINED_REF_HAS_VERSION: m.predefinedRef.hasVersion,
    PREDEFINED_REF_HAS_SET_HINT: m.predefinedRef.hasSetHint,
    PREDEFINED_REF_DIGEST_INVENTORY: m.predefinedRef.digestRows,
    PREDEFINED_REF_DIGEST_INVENTORY_TRUNCATED: m.predefinedRef.digestRows.length >= 32,
    PLS_CATALOG_CHECK_PERFORMED: Boolean(ctx.plsCatalogCheckPerformed),
    PLS_DATASETS_CHECKED_COUNT: Number(ctx.plsDatasetsCheckedCount) || 0,
    PLS_MATCHED_TO_CATALOG: Number(ctx.plsMatched) || 0,
    PLS_UNMATCHED_TO_CATALOG:
      Number.isFinite(ctx.plsUnmatched) ? Number(ctx.plsUnmatched) : m.predefinedRef.total,
    PLS_MULTIPLE_CATALOG_MATCH: Number(ctx.plsMultiple) || 0,
    PLS_CATALOG_BINDING_PROVEN_TOTAL: Number(ctx.plsCatalogBindingProven) || 0,
    PLS_LOCATION_RECORD_EXISTS_TOTAL: Number(ctx.plsLocationRecordExists) || 0,
    PLS_VERIFIED_LOCATION_POSSIBLE_TOTAL: Number(ctx.plsVerifiedLocationPossible) || 0,
    COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF: false,
    OPENLR_INPUT_TOTAL: m.openlr.input,
    OPENLR_RESOLVED_TOTAL: m.openlr.resolved,
    OPENLR_AMBIGUOUS_TOTAL: m.openlr.ambiguous,
    OPENLR_INVALID_TOTAL: m.openlr.invalid,
    OPENLR_UNSUPPORTED_TOTAL: m.openlr.unsupported,
    OPENLR_REFERENCE_DATA_MISSING_TOTAL: m.openlr.referenceDataMissing,
    OPENLR_DECODE_FAILED_TOTAL: m.openlr.decodeFailed,
    OPENLR_PUBLICATION_ELIGIBLE_TOTAL: m.openlr.eligible,
    OPENLR_PUBLICATION_BLOCKED_TOTAL: m.openlr.blocked,
    OPENLR_TYPE_LINE: m.openlr.line,
    OPENLR_TYPE_POINT: m.openlr.point,
    OPENLR_TYPE_GEO: m.openlr.geo,
    OPENLR_TYPE_AREA: m.openlr.area,
    OPENLR_TYPE_BINARY: m.openlr.binary,
    OPENLR_TYPE_OTHER: m.openlr.other,
    OPENLR_ENCODING_XML: m.openlr.xml,
    OPENLR_ENCODING_BINARY: m.openlr.binary,
    FEED_INTERNAL_ITEMS: gateItems.length,
    FEED_PUBLICATION_ELIGIBLE_ITEMS: m.pubEligible,
    FEED_PUBLICATION_BLOCKED_ITEMS: m.pubBlocked,
  };

  // Fail-closed: never count unverified geo as published in preview
  for (const row of previewItems) {
    if (row.km != null) summary.UNVERIFIED_KM_PUBLISHED += 1;
  }
  // Recompute location/direction unverified from preview vs source trust
  for (let i = 0; i < previewSource.length; i += 1) {
    const verified = hasVerifiedLocationTrust(previewSource[i]);
    const row = previewItems[i];
    if (!verified) {
      if (row.locality != null || row.road != null) summary.UNVERIFIED_LOCATION_PUBLISHED += 1;
      if (row.direction != null) summary.UNVERIFIED_DIRECTION_PUBLISHED += 1;
    }
  }

  const cardPreview = {
    schema: CARD_PREVIEW_SCHEMA,
    HEAD_SHA: headSha,
    RUN_ID: runId,
    items: previewItems,
    COUNT: previewItems.length,
    PUBLICATION_ENABLED: false,
  };

  const cardCheck = validateCardPreview(cardPreview);
  summary.CARD_PROJECTION_VALIDATION_PASS = cardCheck.ok;
  summary.CARD_PUBLICATION_ELIGIBILITY_PASS = cardEligPass && cardCheck.ok;
  summary.CARD_LOCATION_VALIDATION_PASS = cardLocationPass && cardCheck.ok;
  summary.CARD_VALIDATION_PASS =
    summary.CARD_PROJECTION_VALIDATION_PASS &&
    summary.CARD_PUBLICATION_ELIGIBILITY_PASS &&
    summary.CARD_LOCATION_VALIDATION_PASS;

  const summaryCheck2 = validateForensicSummary(summary);
  const canary = scanForensicCanaries({ summary, cardPreview });

  const fails = []
    .concat(summaryCheck2.fails.map((f) => "summary:" + f))
    .concat(cardCheck.fails.map((f) => "card:" + f))
    .concat(canary.fails.map((f) => "canary:" + f));

  const validationReport = {
    schema: VALIDATION_REPORT_SCHEMA,
    HEAD_SHA: headSha,
    RUN_ID: runId,
    SUMMARY_SCHEMA_PASS: summaryCheck2.ok,
    CARD_PREVIEW_SCHEMA_PASS: cardCheck.ok,
    CANARY_PASS: canary.ok,
    FORENSIC_RETENTION_PASS: summaryCheck2.ok && cardCheck.ok && canary.ok && summary.CARD_VALIDATION_PASS,
    PUBLICATION_ENABLED: false,
    PUBLISHED: false,
    FAILS: fails.slice(0, 100),
  };
  const reportCheck = validateValidationReport(validationReport);
  if (!reportCheck.ok) {
    validationReport.FORENSIC_RETENTION_PASS = false;
    validationReport.FAILS = validationReport.FAILS.concat(reportCheck.fails.map((f) => "report:" + f)).slice(0, 100);
  }

  void cardProjectionPass;

  return {
    summary,
    cardPreview,
    validationReport,
    ok: validationReport.FORENSIC_RETENTION_PASS === true,
  };
}

export function resolveForensicDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.IU_NDIC_FORENSIC_DIR) return path.resolve(process.env.IU_NDIC_FORENSIC_DIR);
  const base = process.env.RUNNER_TEMP || process.env.TEMP || process.env.TMPDIR || ".";
  return path.join(base, FORENSIC_DIR_NAME);
}

export function writeShadowForensicBundle(dir, bundle) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [
    [FORENSIC_SUMMARY_FILE, bundle.summary],
    [FORENSIC_CARD_PREVIEW_FILE, bundle.cardPreview],
    [FORENSIC_VALIDATION_FILE, bundle.validationReport],
  ];
  for (const [name, obj] of files) {
    const p = path.join(dir, name);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, p);
  }
  return {
    dir,
    files: files.map(([name]) => name),
  };
}

/** Safe aggregate-only stdout lines (no raw payloads). */
export function printShadowForensicStdout(summary, validationReport) {
  const retentionPass = validationReport && validationReport.FORENSIC_RETENTION_PASS === true;
  const lines = [
    "SHADOW_FORENSIC_SUMMARY_OK=" + (retentionPass ? "YES" : "NO"),
    "FORENSIC_RETENTION_PASS=" + (retentionPass ? "YES" : "NO"),
    "LOADED_EVENTS=" + (summary && summary.LOADED_EVENTS),
    "ACTIVE_EVENTS=" + (summary && summary.ACTIVE_EVENTS),
    "FUTURE_EVENTS=" + (summary && summary.FUTURE_EVENTS),
    "ENDED_EVENTS=" + (summary && summary.ENDED_EVENTS),
    "RESOLVED_BASIC=" + (summary && summary.RESOLVED_BASIC),
    "RESOLVED_OPENLR=" + (summary && summary.RESOLVED_OPENLR),
    "TMC_ARCHIVE_USED=" + (summary && summary.TMC_ARCHIVE_USED ? "true" : "false"),
    "TMC_REASON=" + (summary && summary.TMC_REASON),
    "TMC_ACTIVE=" + (summary && summary.TMC_ACTIVE ? "true" : "false"),
    "TMC_POINT_COUNT=" + (summary && summary.TMC_POINT_COUNT),
    "TMC_NONSTANDARD_IGNORED_COUNT=" + (summary && summary.TMC_NONSTANDARD_IGNORED_COUNT),
    "TMC_REQUIRED_TABLE_SET_COMPLETE=" +
      (summary && summary.TMC_REQUIRED_TABLE_SET_COMPLETE ? "true" : "false"),
    "TMC_REQUIRED_TABLE_SET_VALID=" + (summary && summary.TMC_REQUIRED_TABLE_SET_VALID ? "true" : "false"),
    "TMC_UNKNOWN_REQUIRED_COUNT=" + (summary && summary.TMC_UNKNOWN_REQUIRED_COUNT),
    "TMC_UNKNOWN_NONCLASSIFIED_COUNT=" + (summary && summary.TMC_UNKNOWN_NONCLASSIFIED_COUNT),
    "TMC_REJECTED_UNSAFE_COUNT=" + (summary && summary.TMC_REJECTED_UNSAFE_COUNT),
    "TMC_UNKNOWN_NONCLASSIFIED_RETAINED_COUNT=" +
      (summary && summary.TMC_UNKNOWN_NONCLASSIFIED_RETAINED_COUNT),
    "TMC_UNKNOWN_REQUIRED_RETAINED_COUNT=" + (summary && summary.TMC_UNKNOWN_REQUIRED_RETAINED_COUNT),
    "TMC_REJECTED_UNSAFE_RETAINED_COUNT=" + (summary && summary.TMC_REJECTED_UNSAFE_RETAINED_COUNT),
    "TMC_CID=" + (summary && summary.TMC_CID),
    "TMC_TABCD=" + (summary && summary.TMC_TABCD),
    "TMC_RESOLVER_TABLE_ACTIVATED=" +
      (summary && summary.TMC_RESOLVER_TABLE_ACTIVATED ? "true" : "false"),
    "RESOLVED_OTHER_VALID_LOCATION=" + (summary && summary.RESOLVED_OTHER_VALID_LOCATION),
    "UNRESOLVED_TOTAL=" + (summary && summary.UNRESOLVED_TOTAL),
    "UNRESOLVED_TMC_REFERENCE=" + (summary && summary.UNRESOLVED_TMC_REFERENCE),
    "UNRESOLVED_MISSING_REFERENCE=" + (summary && summary.UNRESOLVED_MISSING_REFERENCE),
    ...[
      "UNRESOLVED_TMC_MISS_CID_MISMATCH",
      "UNRESOLVED_TMC_MISS_TABCD_MISMATCH",
      "UNRESOLVED_TMC_MISS_LCD_NOT_FOUND",
      "UNRESOLVED_TMC_MISS_POINT_LOOKUP_MISS",
      "UNRESOLVED_TMC_MISS_SEGMENT_LOOKUP_MISS",
      "UNRESOLVED_TMC_MISS_AREA_LOOKUP_MISS",
      "UNRESOLVED_TMC_MISS_UNSUPPORTED_REFERENCE_TYPE",
      "UNRESOLVED_TMC_MISS_UNSUPPORTED_DIRECTION",
      "UNRESOLVED_TMC_MISS_UNSUPPORTED_OFFSET",
      "UNRESOLVED_TMC_MISS_OTHER",
      "UNRESOLVED_MISSING_PROFILE_ALERTC_POINT",
      "UNRESOLVED_MISSING_PROFILE_ALERTC_LINEAR",
      "UNRESOLVED_MISSING_PROFILE_TMC_SPECIFIC_LOCATION",
      "UNRESOLVED_MISSING_PROFILE_POINT_COORDINATES",
      "UNRESOLVED_MISSING_PROFILE_OPENLR",
      "UNRESOLVED_MISSING_PROFILE_GML_POINT",
      "UNRESOLVED_MISSING_PROFILE_GML_LINESTRING",
      "UNRESOLVED_MISSING_PROFILE_GML_POLYGON",
      "UNRESOLVED_MISSING_PROFILE_NETWORK_LOCATION",
      "UNRESOLVED_MISSING_PROFILE_SUPPLEMENTARY_POSITIONAL_DESCRIPTION",
      "UNRESOLVED_MISSING_PROFILE_TEXT_ONLY",
      "UNRESOLVED_MISSING_PROFILE_NO_LOCALIZATION_SIGNAL",
      "UNRESOLVED_MISSING_PROFILE_OTHER",
      "LOC_HAS_ALERTC_POINT",
      "LOC_HAS_ALERTC_LINEAR",
      "LOC_HAS_SPECIFIC_LOCATION",
      "LOC_HAS_POINT_COORDINATES",
      "LOC_HAS_OPENLR",
      "LOC_HAS_GML_POINT",
      "LOC_HAS_GML_LINESTRING",
      "LOC_HAS_GML_POLYGON",
      "LOC_HAS_NETWORK_LOCATION",
      "LOC_HAS_SUPPLEMENTARY_POSITIONAL_DESCRIPTION",
      "POINT_COORDINATES_PRESENT_TOTAL",
      "POINT_COORDINATES_PARSED_TOTAL",
      "POINT_COORDINATES_VALID_TOTAL",
      "POINT_COORDINATES_VERIFIED_TRUST_TOTAL",
      "POINT_COORDINATES_BLOCKED_TOTAL",
      "TRUST_BEFORE_TMC",
      "TRUST_BEFORE_TEXT",
      "TRUST_BEFORE_NATIONAL_FALLBACK",
      "TRUST_BEFORE_NONE",
      "TRUST_AFTER_COORDINATES",
      "TRUST_AFTER_TMC",
      "TRUST_AFTER_TEXT",
      "TRUST_AFTER_NATIONAL_FALLBACK",
      "TRUST_AFTER_NONE",
      "TMC_REF_KIND_POINT",
      "TMC_REF_KIND_LINEAR",
      "TMC_REF_KIND_OTHER",
      "TMC_LOCATION_CLASS_POINT",
      "TMC_LOCATION_CLASS_SEGMENT",
      "TMC_LOCATION_CLASS_AREA",
      "TMC_LOCATION_CLASS_UNKNOWN",
      "TMC_LCD_MISS_POINT_IN_LT",
      "TMC_LCD_MISS_SEGMENT_IN_LT",
      "TMC_LCD_MISS_AREA_IN_LT",
      "TMC_LCD_MISS_IN_CODES_ONLY",
      "TMC_LCD_MISS_ORPHAN_NOT_IN_LT",
      "LCD_CODES_ONLY_TOTAL",
      "LCD_CODES_ONLY_HAS_PARENT",
      "LCD_CODES_ONLY_HAS_NEXT",
      "LCD_CODES_ONLY_HAS_PREV",
      "LCD_CODES_ONLY_HAS_ROAD_NUMBER",
      "LCD_CODES_ONLY_HAS_ROAD_NAME",
      "LCD_CODES_ONLY_HAS_DIRECTION",
      "LCD_CODES_ONLY_HAS_ADMIN_AREA",
      "LCD_CODES_ONLY_HAS_MUNICIPALITY",
      "LCD_CODES_ONLY_HAS_COORDINATES",
      "LCD_CODES_ONLY_HAS_SEGMENT_LINK",
      "LCD_CODES_ONLY_HAS_POINT_LINK",
      "LCD_CODES_ONLY_HAS_AREA_LINK",
      "LCD_CODES_ONLY_HAS_OTHER_STANDARD_LINK",
      "LCD_CODES_ONLY_HAS_ALLOCATED",
      "LCD_CODES_ONLY_BOUND_TO_ROAD_ONLY",
      "LCD_CODES_ONLY_UNBOUND",
      "LCD_CODES_ONLY_SAFE_RESOLVABLE_WITH_EXISTING_DATA",
      "LCD_CODES_ONLY_SAFE_RESOLVABLE_WITH_MISSING_OFFICIAL_REFERENCE_DATA",
      "LCD_CODES_ONLY_INVALID_SOURCE_REFERENCE",
      "LCD_CODES_ONLY_HISTORICAL_OR_FOREIGN_REFERENCE",
      "LCD_CODES_ONLY_VALID_BUT_NO_GEOMETRY",
      "LCD_CODES_ONLY_CORRECT_FAIL_CLOSED",
      "LOCATION_PRESENTATION_PRECISE",
      "LOCATION_PRESENTATION_SCOPED",
      "LOCATION_PRESENTATION_GENERAL",
      "LOCATION_PRESENTATION_NONE",
      "LOCATION_PRESENTATION_TOTAL",
      "MAP_LINK_TYPE_DIRECT_EVENT",
      "MAP_LINK_TYPE_VERIFIED_LOCATION",
      "MAP_LINK_TYPE_GENERAL_RSD_FALLBACK",
      "MAP_LINK_TYPE_NONE",
      "MAP_LINK_TOTAL",
      "SUPPLEMENTARY_VERIFIABLE_STANDARD_LOCATION",
      "SUPPLEMENTARY_TEXT_ONLY",
      "SUPPLEMENTARY_INCOMPLETE",
      "NO_SIGNAL_EMPTY_GROUP",
      "NO_SIGNAL_EMPTY_LOCALIZATION",
      "NO_SIGNAL_NO_LOCATION_ELEMENT",
      "NO_SIGNAL_KNOWN_PROFILE_BUT_NO_USABLE_REFERENCE",
      "NO_SIGNAL_UNRECOGNIZED_PROFILE",
      "NO_SIGNAL_UNRECOGNIZED_STANDARD_PROFILE",
      "NO_SIGNAL_UNRECOGNIZED_VENDOR_EXTENSION",
      "NO_SIGNAL_LOCATION_EXTENSION_ONLY",
      "NO_SIGNAL_TEXT_ONLY_LOCATION",
      "NO_SIGNAL_STRUCTURED_BUT_INCOMPLETE",
      "NO_SIGNAL_OTHER",
      "LOC_HAS_ALERTC_AREA",
      "LOC_HAS_TPEG",
      "LOC_HAS_ITINERARY",
      "LOC_HAS_UNRECOGNIZED_LOCATION_PROFILE",
      "STANDARD_ROOT_INVENTORY_SUM",
      "VENDOR_ROOT_INVENTORY_SUM",
      "VENDOR_CLASS_KNOWN_DATEX_PROFILE_INSIDE_EXTENSION",
      "VENDOR_CLASS_KNOWN_DATEX_EXTENSION_TYPE",
      "VENDOR_CLASS_NDIC_VENDOR_EXTENSION",
      "VENDOR_CLASS_OTHER_VENDOR_EXTENSION",
      "VENDOR_CLASS_METADATA_ONLY_EXTENSION",
      "VENDOR_CLASS_STRUCTURED_LOCATION_EXTENSION",
      "VENDOR_CLASS_TEXT_ONLY_EXTENSION",
      "VENDOR_CLASS_UNKNOWN_EXTENSION",
      "VENDOR_CLASS_TOTAL",
      "PREDEFINED_REF_TOTAL",
      "PREDEFINED_REF_HAS_ID",
      "PREDEFINED_REF_HAS_VERSION",
      "PREDEFINED_REF_HAS_SET_HINT",
      "PLS_DATASETS_CHECKED_COUNT",
      "PLS_MATCHED_TO_CATALOG",
      "PLS_UNMATCHED_TO_CATALOG",
      "PLS_MULTIPLE_CATALOG_MATCH",
      "PLS_CATALOG_BINDING_PROVEN_TOTAL",
      "PLS_LOCATION_RECORD_EXISTS_TOTAL",
      "PLS_VERIFIED_LOCATION_POSSIBLE_TOTAL",
      "OPENLR_INPUT_TOTAL",
      "OPENLR_RESOLVED_TOTAL",
      "OPENLR_AMBIGUOUS_TOTAL",
      "OPENLR_INVALID_TOTAL",
      "OPENLR_UNSUPPORTED_TOTAL",
      "OPENLR_REFERENCE_DATA_MISSING_TOTAL",
      "OPENLR_DECODE_FAILED_TOTAL",
      "OPENLR_PUBLICATION_ELIGIBLE_TOTAL",
      "OPENLR_PUBLICATION_BLOCKED_TOTAL",
      "TRUST_AFTER_OPENLR",
    ].map((key) => key + "=" + (summary && summary[key])),
    "PUBLICATION_PROJECTIONS_TOTAL=" + (summary && summary.PUBLICATION_PROJECTIONS_TOTAL),
    "PUBLICATION_ELIGIBLE_TOTAL=" + (summary && summary.PUBLICATION_ELIGIBLE_TOTAL),
    "PUBLICATION_BLOCKED_TOTAL=" + (summary && summary.PUBLICATION_BLOCKED_TOTAL),
    "PUBLICATION_BLOCKED_LOCATION=" + (summary && summary.PUBLICATION_BLOCKED_LOCATION),
    "FEED_INTERNAL_ITEMS=" + (summary && summary.FEED_INTERNAL_ITEMS),
    "FEED_PUBLICATION_ELIGIBLE_ITEMS=" + (summary && summary.FEED_PUBLICATION_ELIGIBLE_ITEMS),
    "FEED_PUBLICATION_BLOCKED_ITEMS=" + (summary && summary.FEED_PUBLICATION_BLOCKED_ITEMS),
    "CARD_PROJECTION_VALIDATION_PASS=" + (summary && summary.CARD_PROJECTION_VALIDATION_PASS ? "YES" : "NO"),
    "CARD_PUBLICATION_ELIGIBILITY_PASS=" + (summary && summary.CARD_PUBLICATION_ELIGIBILITY_PASS ? "YES" : "NO"),
    "CARD_LOCATION_VALIDATION_PASS=" + (summary && summary.CARD_LOCATION_VALIDATION_PASS ? "YES" : "NO"),
    "CARD_VALIDATION_PASS=" + (summary && summary.CARD_VALIDATION_PASS ? "YES" : "NO"),
    "UNVERIFIED_LOCATION_PUBLISHED=" + (summary && summary.UNVERIFIED_LOCATION_PUBLISHED),
    "UNVERIFIED_KM_PUBLISHED=" + (summary && summary.UNVERIFIED_KM_PUBLISHED),
    "UNVERIFIED_DIRECTION_PUBLISHED=" + (summary && summary.UNVERIFIED_DIRECTION_PUBLISHED),
    "PUBLISHED=false",
    "PUBLICATION_ENABLED=NO",
  ];
  if (!retentionPass && validationReport && Array.isArray(validationReport.FAILS)) {
    const safe = validationReport.FAILS.slice(0, 12)
      .map((f) => String(f).replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80))
      .filter(Boolean);
    lines.push("FORENSIC_FAILS=" + safe.join("|"));
  }
  for (const line of lines) console.log(line);
}
