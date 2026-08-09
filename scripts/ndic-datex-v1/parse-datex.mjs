/**
 * DATEX II v2.3 SituationPublication parser (NDIC common traffic profile).
 * Namespace-agnostic; fail-closed on unsafe XML; isolates bad records.
 */
import { DEFAULT_LIMITS } from "./config.mjs";
import { mapSituationRecordType } from "./category-map.mjs";
import {
  parseSafeXml,
  descendantsNamed,
  childrenNamed,
  firstChild,
  childText,
  attrOf,
  localTypeName,
} from "./safe-xml.mjs";
import {
  extractLocationPresenceFlags,
  buildCoordinateProbe,
} from "./location-forensic-probe.mjs";
import {
  extractNoSignalRootInventory,
  projectRootInventoryForensic,
} from "./no-signal-root-forensics.mjs";
import {
  extractPredefinedRefForensics,
  projectPredefinedRefForensic,
} from "./predefined-location-ref-forensics.mjs";
import { extractOpenlrFromLoc } from "./openlr-datex-extract.mjs";
import { extractSupplementaryPositional } from "./supplementary-location.mjs";

function clip(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) : t;
}

function readDirection(node) {
  if (!node) return "";
  const direct = childText(node, "alertCDirectionCoded");
  if (direct) return direct;
  const wrap = firstChild(node, "alertCDirection");
  if (wrap) {
    const coded = childText(wrap, "alertCDirectionCoded");
    if (coded) return coded;
    return clip(wrap.text, 40);
  }
  return childText(node, "alertCDirection");
}

function parseIso(s) {
  if (!s) return null;
  const t = Date.parse(String(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function numOrNull(s) {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract Alert-C / TMC location references from a groupOfLocations node.
 */
function extractTmcRefs(locNode, maxLocs) {
  const refs = [];
  if (!locNode) return refs;
  const alertPoints = descendantsNamed(locNode, "alertCPoint", maxLocs);
  for (const ap of alertPoints) {
    if (refs.length >= maxLocs) break;
    const method = firstChild(ap, "alertCMethod2PrimaryPointLocation") || ap;
    const loc = firstChild(method, "alertCLocation") || firstChild(ap, "alertCLocation");
    const specific = loc || ap;
    refs.push({
      kind: "point",
      countryCode: numOrNull(childText(ap, "alertCLocationCountryCode")),
      tableNumber: numOrNull(childText(ap, "alertCLocationTableNumber")),
      locationCode: numOrNull(childText(specific, "specificLocation") || childText(loc, "specificLocation")),
      direction: clip(readDirection(ap), 40),
      offsetDistance: numOrNull(childText(ap, "offsetDistance")),
    });
  }
  // Linear Alert-C
  const alertLinears = descendantsNamed(locNode, "alertCLinear", maxLocs);
  for (const al of alertLinears) {
    if (refs.length >= maxLocs) break;
    const primary =
      firstChild(al, "alertCMethod2PrimaryPointLocation") ||
      firstChild(al, "alertCMethod4PrimaryPointLocation");
    const secondary =
      firstChild(al, "alertCMethod2SecondaryPointLocation") ||
      firstChild(al, "alertCMethod4SecondaryPointLocation");
    const pLoc = primary ? firstChild(primary, "alertCLocation") : null;
    const sLoc = secondary ? firstChild(secondary, "alertCLocation") : null;
    refs.push({
      kind: "linear",
      countryCode: numOrNull(childText(al, "alertCLocationCountryCode")),
      tableNumber: numOrNull(childText(al, "alertCLocationTableNumber")),
      locationCode: numOrNull(pLoc ? childText(pLoc, "specificLocation") : ""),
      secondaryLocationCode: numOrNull(sLoc ? childText(sLoc, "specificLocation") : ""),
      direction: clip(readDirection(al), 40),
    });
  }
  // Fallback: any specificLocation under group
  if (!refs.length) {
    for (const sl of descendantsNamed(locNode, "specificLocation", maxLocs)) {
      if (refs.length >= maxLocs) break;
      const code = numOrNull(clip(sl.text, 32));
      if (code == null) continue;
      const parent = locNode;
      refs.push({
        kind: "point",
        countryCode: numOrNull(childText(parent, "alertCLocationCountryCode")),
        tableNumber: numOrNull(childText(parent, "alertCLocationTableNumber")),
        locationCode: code,
        direction: "",
      });
    }
  }
  return refs.filter((r) => r.locationCode != null);
}

function extractCoordinates(locNode) {
  if (!locNode) return null;
  const pts = descendantsNamed(locNode, "pointCoordinates", 8);
  for (const p of pts) {
    const lat = numOrNull(childText(p, "latitude"));
    const lon = numOrNull(childText(p, "longitude"));
    if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }
  return null;
}

function extractRoad(locNode, recordNode) {
  // Prefer direct children, then documented nested roadInformation / supplementary fields.
  let roadNumber =
    clip(childText(locNode, "roadNumber"), 40) ||
    clip(childText(recordNode, "roadNumber"), 40) ||
    "";
  let roadName =
    clip(childText(locNode, "roadName"), 120) ||
    clip(childText(recordNode, "roadName"), 120) ||
    "";
  if (!roadNumber && locNode) {
    for (const n of descendantsNamed(locNode, "roadNumber", 8)) {
      const t = clip(n.text, 40) || clip(childText(n, "value"), 40);
      if (t) {
        roadNumber = t;
        break;
      }
    }
  }
  if (!roadName && locNode) {
    for (const n of descendantsNamed(locNode, "roadName", 8)) {
      const t = clip(n.text, 120) || clip(childText(n, "value"), 120);
      if (t) {
        roadName = t;
        break;
      }
    }
  }
  return { roadNumber, roadName };
}

function extractValidity(recordNode) {
  const validity = firstChild(recordNode, "validity");
  const status = clip(childText(validity, "validityStatus"), 80);
  const spec = validity ? firstChild(validity, "validityTimeSpecification") : null;
  const overallStartTime = parseIso(childText(spec, "overallStartTime"));
  const overallEndTime = parseIso(childText(spec, "overallEndTime"));
  const openEnded = !overallEndTime && /active|definedByValidityTimeSpec|definedByValidityTimeSpec/i.test(status || "active");
  return { validityStatus: status, overallStartTime, overallEndTime, openEnded: !overallEndTime };
}

function extractTexts(recordNode, maxLen) {
  const general = firstChild(recordNode, "generalPublicComment") || firstChild(recordNode, "comment");
  let comment = "";
  if (general) {
    comment =
      clip(childText(general, "comment"), maxLen) ||
      clip(childText(firstChild(general, "comment"), "value"), maxLen) ||
      clip(general.text, maxLen);
    // nested values
    if (!comment) {
      for (const v of descendantsNamed(general, "value", 4)) {
        comment = clip(v.text, maxLen);
        if (comment) break;
      }
    }
  }
  const cause = clip(childText(recordNode, "cause"), maxLen);
  return { comment, cause };
}

/**
 * Parse one situationRecord element.
 */
function parseRecord(recNode, limits) {
  const typeRaw = attrOf(recNode, "type") || localTypeName(attrOf(recNode, "type"));
  // xsi:type often stored as key containing "type"
  let recordType = typeRaw;
  if (!recordType) {
    for (const [k, v] of Object.entries(recNode.attrs || {})) {
      if (/type$/i.test(k)) {
        recordType = localTypeName(v);
        break;
      }
    }
  }
  if (!recordType) recordType = recNode.name || "SituationRecord";

  const id = clip(attrOf(recNode, "id"), 200);
  const version = clip(attrOf(recNode, "version"), 80);
  const cat = mapSituationRecordType(recordType);
  const validity = extractValidity(recNode);
  const locs = childrenNamed(recNode, "groupOfLocations");
  const locNode = locs[0] || firstChild(recNode, "groupOfLocations");
  const tmcRefs = extractTmcRefs(locNode, limits.maxLocationsPerRecord);
  const coordinates = extractCoordinates(locNode);
  // Forensic-only presence/coord probes — must not alter tmcRefs/coordinates.
  const locationPresence = extractLocationPresenceFlags(locNode);
  const coordinateProbe = buildCoordinateProbe(locNode, coordinates);
  const openlrExtract = extractOpenlrFromLoc(locNode);
  Object.assign(locationPresence, openlrExtract.presenceFlags);
  if (coordinateProbe.valid) locationPresence.pointCoordinatesValid = true;
  // Cycle 3: anonymized root local-name inventory (names + class only).
  const rootInventory = projectRootInventoryForensic(extractNoSignalRootInventory(locNode));
  const predefinedRef = projectPredefinedRefForensic(extractPredefinedRefForensics(locNode));
  const supplementary = extractSupplementaryPositional(locNode);
  const road = extractRoad(locNode, recNode);
  if (!road.roadNumber && supplementary.roadNumber) road.roadNumber = supplementary.roadNumber;
  if (!road.roadName && supplementary.roadName) road.roadName = supplementary.roadName;
  const texts = extractTexts(recNode, limits.maxTextFieldChars);

  const severity = clip(
    childText(recNode, "severity") || childText(recNode, "trafficConstrictionType") || "",
    80
  );
  const probability = clip(childText(recNode, "probabilityOfOccurrence"), 40);

  return {
    recordId: id,
    recordVersion: version,
    recordType,
    category: cat,
    locationPresence,
    coordinateProbe,
    openlrExtract,
    rootInventory,
    predefinedRef,
    supplementary,
    createdAt: parseIso(childText(recNode, "situationRecordCreationTime")),
    versionTime: parseIso(childText(recNode, "situationRecordVersionTime")),
    firstSupplierVersionTime: parseIso(childText(recNode, "situationRecordFirstSupplierVersionTime")),
    validity,
    tmcRefs,
    coordinates,
    roadNumber: road.roadNumber,
    roadName: road.roadName,
    comment: texts.comment,
    cause: texts.cause,
    severity,
    probability,
    rawTypeKnown: cat.known,
  };
}

/**
 * @param {string} xml
 * @param {{ limits?: object }} [opts]
 */
export function parseDatexSituationPublication(xml, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const structure =
    opts.structure ||
    (opts.skipStructureScan
      ? null
      : (() => {
          try {
            // lazy import avoided — caller may pass structure
            return null;
          } catch {
            return null;
          }
        })());

  let root;
  try {
    root = parseSafeXml(xml, limits);
  } catch (e) {
    return {
      ok: false,
      publicationTime: null,
      situations: [],
      rejected: [],
      situationCount: 0,
      rejectedCount: 0,
      recordCount: 0,
      namespace: null,
      rootLocalName: null,
      modelBaseVersion: null,
      version: null,
      parserFailureCode: (e && e.code) || "XML_PARSE",
      parserCompatible: false,
      structure: structure || null,
    };
  }

  const rootNs =
    (root.attrs && (root.attrs.xmlns || root.attrs.Xmlns)) ||
    pickApplicationNsFromAttrs(root.attrs) ||
    null;
  const modelBaseVersion =
    (root.attrs && (root.attrs.modelBaseVersion || root.attrs.modelbaseversion)) || null;

  const situations = descendantsNamed(root, "situation", limits.maxSituations);
  const publicationTime =
    parseIso(childText(root, "publicationTime")) ||
    (() => {
      const pubs = descendantsNamed(root, "payloadPublication", 2);
      return pubs[0] ? parseIso(childText(pubs[0], "publicationTime")) : null;
    })();

  const out = [];
  const rejected = [];
  let recordCount = 0;
  for (const sit of situations) {
    if (out.length >= limits.maxSituations) {
      rejected.push({ reason: "max_situations", id: attrOf(sit, "id") });
      break;
    }
    const situationId = clip(attrOf(sit, "id"), 200);
    if (!situationId) {
      rejected.push({ reason: "missing_situation_id" });
      continue;
    }
    const situationVersion = clip(attrOf(sit, "version") || childText(sit, "situationVersion"), 80);
    const records = childrenNamed(sit, "situationRecord");
    // Also catch typed elements that are situation records by xsi:type under situation
    const typed = (sit.children || []).filter((c) => {
      if (!c || !c.attrs) return false;
      for (const [k, v] of Object.entries(c.attrs)) {
        if (/type$/i.test(k) && /Record|Accident|Roadworks|Obstruction|Traffic|Management|Conditions|Activity/i.test(v)) {
          return true;
        }
      }
      return false;
    });
    const recNodes = records.length ? records : typed;
    if (!recNodes.length) {
      rejected.push({ reason: "no_records", id: situationId });
      continue;
    }
    if (recNodes.length > limits.maxRecordsPerSituation) {
      rejected.push({ reason: "too_many_records", id: situationId, count: recNodes.length });
    }
    const parsedRecords = [];
    for (const rn of recNodes.slice(0, limits.maxRecordsPerSituation)) {
      try {
        parsedRecords.push(parseRecord(rn, limits));
      } catch (e) {
        rejected.push({ reason: "record_parse_error", id: situationId, detail: String(e && e.message) });
      }
    }
    if (!parsedRecords.length) continue;
    recordCount += parsedRecords.length;
    out.push({
      situationId,
      situationVersion,
      publicationTime,
      records: parsedRecords,
    });
  }

  const appNs = rootNs && isApplicationDatexNs(rootNs) ? rootNs : null;
  const compatible =
    Boolean(appNs) &&
    out.length > 0 &&
    recordCount > 0 &&
    (modelBaseVersion == null || String(modelBaseVersion).startsWith("2"));

  return {
    ok: compatible,
    publicationTime,
    situations: out,
    rejected,
    situationCount: out.length,
    rejectedCount: rejected.length,
    recordCount,
    namespace: appNs,
    rootLocalName: root.name || null,
    modelBaseVersion,
    version: modelBaseVersion,
    parserFailureCode: compatible
      ? null
      : !appNs
        ? "NAMESPACE_NOT_DATEX"
        : out.length === 0
          ? "NO_SITUATION_RECORDS"
          : "PARSER_INCOMPATIBLE",
    parserCompatible: compatible,
    structure: structure || null,
  };
}

function isApplicationDatexNs(uri) {
  return /^https?:\/\/datex2\.eu\/schema\//i.test(String(uri || ""));
}

function pickApplicationNsFromAttrs(attrs) {
  if (!attrs) return null;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "xsi" || /schema-instance/i.test(String(v))) continue;
    if (isApplicationDatexNs(v)) return String(v).slice(0, 120);
  }
  return null;
}
