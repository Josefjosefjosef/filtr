/**
 * Extract coordinate-bearing OpenLR references from DATEX groupOfLocations.
 * Never returns raw binary/Base64 in enumerable fields (resolver-only side channel).
 */
import { descendantsNamed, childText } from "./safe-xml.mjs";
import { OPENLR_LOCATION_TYPE, isValidCoordinate } from "./openlr-constants.mjs";

const BINARY_RE = /^[A-Za-z0-9+/]{12,}={0,2}$/;

/** Top-level DATEX OpenLR location containers only (not nested LRP/coord nodes). */
const TOP_LEVEL = [
  { re: /openlrgeocoordinate$/, type: OPENLR_LOCATION_TYPE.GEO_COORDINATE, kind: "geo" },
  { re: /openlrpointalongline|openlrpointalong$/, type: OPENLR_LOCATION_TYPE.POINT_ALONG_LINE, kind: "point" },
  { re: /openlrpoiwithaccess|openlrpointofinterest/, type: OPENLR_LOCATION_TYPE.POI_ACCESS, kind: "point" },
  { re: /openlrpointlocationreference$/, type: OPENLR_LOCATION_TYPE.POINT_ALONG_LINE, kind: "point" },
  { re: /openlrlinelocationreference$|openlrlinearlocationreference$|openlrextendedlinear$/, type: OPENLR_LOCATION_TYPE.LINE, kind: "line" },
  { re: /openlrlinear$/, type: OPENLR_LOCATION_TYPE.LINE, kind: "line" },
  { re: /openlrcircle/, type: OPENLR_LOCATION_TYPE.CIRCLE, kind: "area" },
  { re: /openlrrectangle/, type: OPENLR_LOCATION_TYPE.RECTANGLE, kind: "area" },
  { re: /openlrgrid/, type: OPENLR_LOCATION_TYPE.GRID, kind: "area" },
  { re: /openlrpolygon/, type: OPENLR_LOCATION_TYPE.POLYGON, kind: "area" },
  { re: /openlrclosedline/, type: OPENLR_LOCATION_TYPE.CLOSED_LINE, kind: "area" },
  { re: /openlrarealocationreference$/, type: OPENLR_LOCATION_TYPE.POLYGON, kind: "area" },
];

function nameOf(n) {
  return String((n && n.name) || "").toLowerCase();
}

function classifyTopLevel(name) {
  for (const rule of TOP_LEVEL) {
    if (rule.re.test(name)) return rule;
  }
  return null;
}

function isBinaryHolderName(name) {
  return /asbinary|openlrbinary|binarylocation|binaryencoding/.test(name) && /openlr/.test(name);
}

function validCoordinateFrom(node) {
  const rawLat = childText(node, "latitude");
  const rawLon = childText(node, "longitude");
  if (rawLat === "" || rawLon === "") return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  return isValidCoordinate(lat, lon) ? { lat, lon } : null;
}

function coordinatesUnder(node) {
  const out = [];
  const seen = new Set();
  for (const name of [
    "openlrCoordinate",
    "pointCoordinates",
    "openlrLocationReferencePoint",
    "openlrLastLocationReferencePoint",
  ]) {
    for (const candidate of descendantsNamed(node, name, 64)) {
      let point = validCoordinateFrom(candidate);
      if (!point) {
        const nested =
          descendantsNamed(candidate, "openlrCoordinate", 1)[0] ||
          descendantsNamed(candidate, "pointCoordinates", 1)[0];
        point = nested ? validCoordinateFrom(nested) : null;
      }
      if (!point) continue;
      const key = point.lat + "," + point.lon;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(point);
      }
    }
  }
  const direct = validCoordinateFrom(node);
  if (direct && !seen.has(direct.lat + "," + direct.lon)) out.unshift(direct);
  return out.slice(0, 32);
}

function walk(node, visit, max = 8000) {
  const stack = [node];
  let count = 0;
  while (stack.length && count++ < max) {
    const current = stack.pop();
    if (!current) continue;
    visit(current);
    for (const child of current.children || []) stack.push(child);
  }
}

/**
 * @param {object|null|undefined} locNode
 * @returns {{ presenceFlags: object, refs: object[] }}
 */
export function extractOpenlrFromLoc(locNode) {
  const presenceFlags = {
    hasOpenLR: false,
    hasOpenlr: false,
    hasOpenlrLine: false,
    hasOpenlrPoint: false,
    hasOpenlrGeo: false,
    hasOpenlrArea: false,
    hasOpenlrBinary: false,
  };
  const refs = [];
  const binaryInputs = [];
  if (!locNode) return { presenceFlags, refs };

  walk(locNode, (node) => {
    const name = nameOf(node);
    if (name.includes("openlr")) {
      presenceFlags.hasOpenLR = true;
      presenceFlags.hasOpenlr = true;
    }
  });

  walk(locNode, (node) => {
    const name = nameOf(node);
    if (!isBinaryHolderName(name)) return;
    const text = String(node.text || "").replace(/\s+/g, "");
    if (!BINARY_RE.test(text)) return;
    presenceFlags.hasOpenLR = true;
    presenceFlags.hasOpenlr = true;
    presenceFlags.hasOpenlrBinary = true;
    presenceFlags.hasOpenlrLine = true;
    refs.push({
      encoding: "binary",
      type: OPENLR_LOCATION_TYPE.LINE,
      coordinates: [],
      rawBinaryPresent: true,
    });
    binaryInputs.push(text);
  });

  walk(locNode, (node) => {
    const name = nameOf(node);
    if (!name.includes("openlr")) return;
    const rule = classifyTopLevel(name);
    if (!rule) return;
    if (rule.kind === "line") presenceFlags.hasOpenlrLine = true;
    if (rule.kind === "point") presenceFlags.hasOpenlrPoint = true;
    if (rule.kind === "geo") presenceFlags.hasOpenlrGeo = true;
    if (rule.kind === "area") presenceFlags.hasOpenlrArea = true;
    refs.push({
      encoding: "xml",
      type: rule.type,
      coordinates: coordinatesUnder(node),
      rawBinaryPresent: false,
    });
  });

  Object.defineProperty(refs, "_binaryInputs", { value: binaryInputs, enumerable: false });
  return { presenceFlags, refs };
}
