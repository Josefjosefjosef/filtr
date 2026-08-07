/**
 * Forensic-only inventory of no-signal location roots (Cycle 3).
 * Retains public DATEX/XML local-names + counts only — never event IDs, LCD,
 * coordinates, or raw XML payloads.
 *
 * Docs:
 * - https://docs.datex2.eu/levels/mastering/location/
 * - https://docs.datex2.eu/levels/mastering/location/alertc/
 */
import { descendantsNamed } from "./safe-xml.mjs";

export const VENDOR_EXTENSION_CLASS = Object.freeze({
  KNOWN_DATEX_PROFILE_INSIDE_EXTENSION: "KNOWN_DATEX_PROFILE_INSIDE_EXTENSION",
  KNOWN_DATEX_EXTENSION_TYPE: "KNOWN_DATEX_EXTENSION_TYPE",
  NDIC_VENDOR_EXTENSION: "NDIC_VENDOR_EXTENSION",
  OTHER_VENDOR_EXTENSION: "OTHER_VENDOR_EXTENSION",
  METADATA_ONLY_EXTENSION: "METADATA_ONLY_EXTENSION",
  STRUCTURED_LOCATION_EXTENSION: "STRUCTURED_LOCATION_EXTENSION",
  TEXT_ONLY_EXTENSION: "TEXT_ONLY_EXTENSION",
  UNKNOWN_EXTENSION: "UNKNOWN_EXTENSION",
});

/** DATEX II documented location-package extension containers. */
const KNOWN_DATEX_EXTENSION_ROOTS = new Set([
  "groupoflocationsextension",
  "locationextension",
  "pointlocationextension",
  "linearlocationextension",
  "arealocationextension",
  "networklocationextension",
]);

/** Standard unsupported method roots (keep in sync with location-forensic-probe). */
export const STANDARD_UNSUPPORTED_ROOTS = Object.freeze([
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

const METADATA_CHILD = new Set([
  "locationdescriptor",
  "locationdescription",
  "namedarea",
  "destination",
  "directionrelative",
  "lengthaffected",
  "carriageway",
  "lane",
  "lanes",
]);

const STRUCTURED_CHILD = new Set([
  "roadinformation",
  "roadnumber",
  "roadname",
  "pointcoordinates",
  "alertclocation",
  "specificlocation",
]);

export const MAX_ROOT_INVENTORY = 64;

function localName(node) {
  return String((node && node.name) || "")
    .replace(/^.*:/, "")
    .toLowerCase();
}

function safeLocalName(name) {
  const n = String(name || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!n || n.length > 80) return "";
  return n;
}

function hasNamed(node, name) {
  return descendantsNamed(node, name, 1).length > 0;
}

function childHasKnownSupportedProfile(node) {
  return (
    hasNamed(node, "alertCPoint") ||
    hasNamed(node, "alertCLinear") ||
    hasNamed(node, "openlrLineLocationReference") ||
    hasNamed(node, "openlrLinear") ||
    hasNamed(node, "openlrPointLocationReference") ||
    hasNamed(node, "openlrGeoCoordinate") ||
    hasNamed(node, "pointCoordinates") ||
    hasNamed(node, "networkLocation") ||
    hasNamed(node, "LineString") ||
    hasNamed(node, "Polygon")
  );
}

function childStructureClass(node) {
  if (!node) return "empty";
  if (childHasKnownSupportedProfile(node)) return "known_datex_profile_inside";
  let hasStructured = false;
  let hasMeta = false;
  let hasText = false;
  const stack = [node];
  let n = 0;
  while (stack.length && n < 2000) {
    const cur = stack.pop();
    n += 1;
    const name = localName(cur);
    if (STRUCTURED_CHILD.has(name)) hasStructured = true;
    if (METADATA_CHILD.has(name)) hasMeta = true;
    if (name === "locationdescriptor" || name === "locationdescription" || name === "value") {
      if (String(cur.text || "").trim()) hasText = true;
    }
    for (const c of cur.children || []) stack.push(c);
  }
  if (hasStructured) return "structured_location";
  if (hasText && !hasStructured) return "text_only";
  if (hasMeta) return "metadata_only";
  if (!(node.children && node.children.length)) return "empty";
  return "unknown_structure";
}

function isStandardUnsupportedRoot(name) {
  return STANDARD_UNSUPPORTED_ROOTS.includes(name);
}

function isVendorishName(name) {
  return /^(ndic|rsd|cze|cz[_-]|ext[_-]|extension)/.test(name) || name.includes("extension");
}

function isNdicVendorName(name) {
  return /^(ndic|rsd|cze|cz[_-])/.test(name);
}

/**
 * Classify one direct child of groupOfLocations (forensic only).
 * @param {object} node
 */
export function classifyLocationRootNode(node) {
  const name = safeLocalName(localName(node));
  if (!name) {
    return {
      localName: "",
      rootKind: "unknown",
      vendorClass: VENDOR_EXTENSION_CLASS.UNKNOWN_EXTENSION,
      childStructureClass: "empty",
      knownDatexNamespace: false,
      locationInformationPresent: false,
    };
  }

  const structure = childStructureClass(node);
  const knownInside = structure === "known_datex_profile_inside";
  const locationInformationPresent =
    knownInside || structure === "structured_location" || structure === "text_only";

  if (isStandardUnsupportedRoot(name)) {
    return {
      localName: name,
      rootKind: "standard_unsupported",
      vendorClass: "",
      childStructureClass: structure,
      knownDatexNamespace: true,
      locationInformationPresent,
      documentationReference: "https://docs.datex2.eu/levels/mastering/location/",
      standardProfile: true,
    };
  }

  if (knownInside && (KNOWN_DATEX_EXTENSION_ROOTS.has(name) || name.includes("extension"))) {
    return {
      localName: name,
      rootKind: "vendor_extension",
      vendorClass: VENDOR_EXTENSION_CLASS.KNOWN_DATEX_PROFILE_INSIDE_EXTENSION,
      childStructureClass: structure,
      knownDatexNamespace: KNOWN_DATEX_EXTENSION_ROOTS.has(name),
      locationInformationPresent: true,
    };
  }

  if (KNOWN_DATEX_EXTENSION_ROOTS.has(name)) {
    let vendorClass = VENDOR_EXTENSION_CLASS.KNOWN_DATEX_EXTENSION_TYPE;
    if (structure === "metadata_only") vendorClass = VENDOR_EXTENSION_CLASS.METADATA_ONLY_EXTENSION;
    else if (structure === "structured_location") {
      vendorClass = VENDOR_EXTENSION_CLASS.STRUCTURED_LOCATION_EXTENSION;
    } else if (structure === "text_only") vendorClass = VENDOR_EXTENSION_CLASS.TEXT_ONLY_EXTENSION;
    return {
      localName: name,
      rootKind: "vendor_extension",
      vendorClass,
      childStructureClass: structure,
      knownDatexNamespace: true,
      locationInformationPresent,
    };
  }

  if (isVendorishName(name)) {
    let vendorClass = VENDOR_EXTENSION_CLASS.UNKNOWN_EXTENSION;
    if (isNdicVendorName(name)) vendorClass = VENDOR_EXTENSION_CLASS.NDIC_VENDOR_EXTENSION;
    else if (structure === "metadata_only") vendorClass = VENDOR_EXTENSION_CLASS.METADATA_ONLY_EXTENSION;
    else if (structure === "structured_location") {
      vendorClass = VENDOR_EXTENSION_CLASS.STRUCTURED_LOCATION_EXTENSION;
    } else if (structure === "text_only") vendorClass = VENDOR_EXTENSION_CLASS.TEXT_ONLY_EXTENSION;
    else if (name.includes("extension")) vendorClass = VENDOR_EXTENSION_CLASS.OTHER_VENDOR_EXTENSION;
    return {
      localName: name,
      rootKind: "vendor_extension",
      vendorClass,
      childStructureClass: structure,
      knownDatexNamespace: false,
      locationInformationPresent,
    };
  }

  if (
    /(locationreference|locationreferencing|arealocation|linearlocation|pointlocation|tpeg|itinerary|alertcarea)$/.test(
      name
    ) ||
    /^(area|linear|point)location$/.test(name)
  ) {
    return {
      localName: name,
      rootKind: "standard_unsupported",
      vendorClass: "",
      childStructureClass: structure,
      knownDatexNamespace: true,
      locationInformationPresent,
      documentationReference: "https://docs.datex2.eu/levels/mastering/location/",
      standardProfile: true,
    };
  }

  return {
    localName: name,
    rootKind: "other",
    vendorClass: VENDOR_EXTENSION_CLASS.UNKNOWN_EXTENSION,
    childStructureClass: structure,
    knownDatexNamespace: false,
    locationInformationPresent,
  };
}

/**
 * Inventory direct children of groupOfLocations that drive no-signal unrecognized buckets.
 * Does not alter presence flags / trust.
 * @param {object|null|undefined} locNode
 */
export function extractNoSignalRootInventory(locNode) {
  const out = {
    standardRoots: [],
    vendorRoots: [],
    primaryStandardLocalName: "",
    primaryVendorLocalName: "",
    primaryVendorClass: "",
  };
  if (!locNode) return out;
  const kids = Array.isArray(locNode.children) ? locNode.children : [];
  for (const child of kids) {
    const classified = classifyLocationRootNode(child);
    if (!classified.localName) continue;
    if (classified.rootKind === "standard_unsupported") {
      out.standardRoots.push(classified);
      if (!out.primaryStandardLocalName) out.primaryStandardLocalName = classified.localName;
    } else if (classified.rootKind === "vendor_extension") {
      out.vendorRoots.push(classified);
      if (!out.primaryVendorLocalName) {
        out.primaryVendorLocalName = classified.localName;
        out.primaryVendorClass = classified.vendorClass;
      }
    }
  }
  return out;
}

/**
 * Redacted forensic projection (no raw nodes).
 * @param {ReturnType<typeof extractNoSignalRootInventory>} inventory
 */
export function projectRootInventoryForensic(inventory) {
  const inv = inventory || { standardRoots: [], vendorRoots: [] };
  return {
    primaryStandardLocalName: inv.primaryStandardLocalName || "",
    primaryVendorLocalName: inv.primaryVendorLocalName || "",
    primaryVendorClass: inv.primaryVendorClass || "",
    standardRootNames: (inv.standardRoots || []).map((r) => r.localName).slice(0, 8),
    vendorRootNames: (inv.vendorRoots || []).map((r) => r.localName).slice(0, 8),
  };
}

export function emptyVendorClassCounts() {
  return {
    [VENDOR_EXTENSION_CLASS.KNOWN_DATEX_PROFILE_INSIDE_EXTENSION]: 0,
    [VENDOR_EXTENSION_CLASS.KNOWN_DATEX_EXTENSION_TYPE]: 0,
    [VENDOR_EXTENSION_CLASS.NDIC_VENDOR_EXTENSION]: 0,
    [VENDOR_EXTENSION_CLASS.OTHER_VENDOR_EXTENSION]: 0,
    [VENDOR_EXTENSION_CLASS.METADATA_ONLY_EXTENSION]: 0,
    [VENDOR_EXTENSION_CLASS.STRUCTURED_LOCATION_EXTENSION]: 0,
    [VENDOR_EXTENSION_CLASS.TEXT_ONLY_EXTENSION]: 0,
    [VENDOR_EXTENSION_CLASS.UNKNOWN_EXTENSION]: 0,
  };
}

/**
 * @param {Map<string, number>} map
 * @param {string} key
 */
export function bumpCount(map, key) {
  const k = safeLocalName(key);
  if (!k) return;
  map.set(k, (map.get(k) || 0) + 1);
}

/**
 * @param {Map<string, number>} map
 * @param {number} [max]
 */
export function mapToInventoryRows(map, max = MAX_ROOT_INVENTORY) {
  const rows = [...map.entries()]
    .map(([localName, count]) => ({ localName, count }))
    .sort((a, b) => b.count - a.count || a.localName.localeCompare(b.localName));
  const truncated = rows.length > max;
  return { rows: rows.slice(0, max), truncated, totalDistinct: rows.length };
}
