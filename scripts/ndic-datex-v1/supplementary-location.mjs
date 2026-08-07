/**
 * DATEX II SupplementaryPositionalDescription — structured field extract only.
 * Docs: https://docs.datex2.eu/levels/mastering/location/supplementarypositionaldescription/
 * Never geocodes; never invents coordinates/km/direction.
 */
import { descendantsNamed, childText } from "./safe-xml.mjs";

export const SUPPLEMENTARY_CLASS = Object.freeze({
  VERIFIABLE_STANDARD: "SUPPLEMENTARY_VERIFIABLE_STANDARD_LOCATION",
  TEXT_ONLY: "SUPPLEMENTARY_TEXT_ONLY",
  INCOMPLETE: "SUPPLEMENTARY_INCOMPLETE",
  ABSENT: "SUPPLEMENTARY_ABSENT",
});

function hasNamed(node, name) {
  return descendantsNamed(node, name, 1).length > 0;
}

function firstNonEmptyText(node, name) {
  for (const n of descendantsNamed(node, name, 8)) {
    const direct = String((n && n.text) || "").trim();
    if (direct) return direct.slice(0, 120);
    const value = childText(n, "value");
    if (value) return String(value).slice(0, 120);
  }
  return "";
}

/**
 * @param {object|null|undefined} locNode
 */
export function extractSupplementaryPositional(locNode) {
  const empty = {
    present: false,
    hasRoadNumber: false,
    hasRoadName: false,
    hasCarriageway: false,
    hasNamedArea: false,
    hasLocationDescriptor: false,
    hasLane: false,
    hasLengthAffected: false,
    roadNumber: "",
    roadName: "",
    classification: SUPPLEMENTARY_CLASS.ABSENT,
  };
  if (!locNode) return empty;
  const roots = descendantsNamed(locNode, "supplementaryPositionalDescription", 8);
  if (!roots.length) return empty;

  let hasRoadNumber = false;
  let hasRoadName = false;
  let hasCarriageway = false;
  let hasNamedArea = false;
  let hasLocationDescriptor = false;
  let hasLane = false;
  let hasLengthAffected = false;
  let roadNumber = "";
  let roadName = "";

  for (const root of roots) {
    if (hasNamed(root, "roadNumber") || firstNonEmptyText(root, "roadNumber")) {
      hasRoadNumber = true;
      if (!roadNumber) roadNumber = firstNonEmptyText(root, "roadNumber");
    }
    if (hasNamed(root, "roadName") || firstNonEmptyText(root, "roadName")) {
      hasRoadName = true;
      if (!roadName) roadName = firstNonEmptyText(root, "roadName");
    }
    if (hasNamed(root, "carriageway")) hasCarriageway = true;
    if (hasNamed(root, "namedArea")) hasNamedArea = true;
    if (hasNamed(root, "locationDescriptor") || hasNamed(root, "locationDescription")) {
      hasLocationDescriptor = true;
    }
    if (hasNamed(root, "lane") || hasNamed(root, "lanes")) hasLane = true;
    if (hasNamed(root, "lengthAffected")) hasLengthAffected = true;
  }

  let classification = SUPPLEMENTARY_CLASS.INCOMPLETE;
  if (hasRoadNumber || hasNamedArea) classification = SUPPLEMENTARY_CLASS.VERIFIABLE_STANDARD;
  else if (hasRoadName || hasLocationDescriptor) classification = SUPPLEMENTARY_CLASS.TEXT_ONLY;
  else if (hasCarriageway || hasLane || hasLengthAffected) classification = SUPPLEMENTARY_CLASS.INCOMPLETE;
  else classification = SUPPLEMENTARY_CLASS.INCOMPLETE;

  return {
    present: true,
    hasRoadNumber,
    hasRoadName,
    hasCarriageway,
    hasNamedArea,
    hasLocationDescriptor,
    hasLane,
    hasLengthAffected,
    roadNumber,
    roadName,
    classification,
  };
}
