/**
 * Forensic-only anonymized digests for DATEX predefinedLocationReference.
 * Never retains raw id/version/XML/coordinates/event ids.
 *
 * NDIC common traffic profile (cz-ndic_d2-common-v1.1) documents that
 * SituationPublication locations must be nested NetworkLocation — NOT
 * references into PredefinedLocationsPublication.
 * https://registr.dopravniinfo.cz/cs/docs/x-format/cz-ndic_d2-common-v1.1-cs.pdf
 */
import crypto from "node:crypto";
import { descendantsNamed, attrOf } from "./safe-xml.mjs";

/** Non-secret domain separation for forensic digests (not a credential). */
export const PREDEFINED_REF_DIGEST_DOMAIN = "iu-ndic-predefined-ref-v1";

export const MAX_PREDEFINED_REF_INVENTORY = 32;

export const DOCUMENTED_PLS_DATASETS = Object.freeze([
  {
    name: "cz-ndic_d2-pls-fcd-v1.1",
    format: "x-format:cz-ndic_d2-predefined-location-set-v1.1",
    model: "DATEX_II_v2.3/PredefinedLocationsPublication",
    scope: "status_oriented_FCD",
  },
  {
    name: "cz-ndic_d2-pls-traffic-status-v1.1",
    format: "x-format:cz-ndic_d2-predefined-location-set-v1.1",
    model: "DATEX_II_v2.3/PredefinedLocationsPublication",
    scope: "status_oriented_traffic_status",
  },
  {
    name: "NDIC_WeatherStation",
    format: "x-format:cz-ndic_d2-predefined-location-set-v1.1",
    model: "DATEX_II_v2.3/PredefinedLocationsPublication",
    scope: "status_oriented_weather",
  },
]);

/** Official common-pull profile forbids PLS references for this publication. */
export const COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF = false;

function localName(node) {
  return String((node && node.name) || "")
    .replace(/^.*:/, "")
    .toLowerCase();
}

/**
 * Deterministic anonymized digest — same algorithm for feed refs and PLS ids.
 * @param {string} raw
 * @returns {string} 16-hex digest or ""
 */
export function digestPredefinedToken(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t || t.length > 256) return "";
  // Reject path-like / payload-like tokens.
  if (/[\\/\s]/.test(t) || /[<>]/.test(t)) return "";
  return crypto
    .createHash("sha256")
    .update(PREDEFINED_REF_DIGEST_DOMAIN + "\0" + t, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/**
 * @param {object} node predefinedLocationReference element
 */
export function extractPredefinedRefFields(node) {
  const idAttr = attrOf(node, "id") || attrOf(node, "target") || "";
  const verAttr = attrOf(node, "version") || "";
  const targetClass = attrOf(node, "targetClass") || "";
  const textId = String((node && node.text) || "").trim();
  const idRaw = idAttr || textId;
  const setHint =
    attrOf(node, "predefinedLocationSetReference") ||
    attrOf(node, "locationSetReference") ||
    targetClass ||
    "";

  const idDigest = digestPredefinedToken(idRaw);
  const versionDigest = digestPredefinedToken(verAttr);
  const setHintDigest = digestPredefinedToken(setHint);

  return {
    hasId: Boolean(idDigest),
    hasVersion: Boolean(versionDigest),
    hasSetHint: Boolean(setHintDigest),
    idDigest,
    versionDigest,
    setHintDigest,
    bindingFields: [
      idDigest ? "id" : null,
      versionDigest ? "version" : null,
      setHintDigest ? "set_hint" : null,
    ]
      .filter(Boolean)
      .join("+"),
  };
}

/**
 * Collect predefinedLocationReference nodes under a groupOfLocations (or record loc).
 * @param {object|null|undefined} locNode
 */
export function extractPredefinedRefForensics(locNode) {
  const empty = {
    present: false,
    count: 0,
    hasId: false,
    hasVersion: false,
    hasSetHint: false,
    idDigest: "",
    versionDigest: "",
    setHintDigest: "",
    bindingFields: "",
  };
  if (!locNode) return empty;
  const nodes = descendantsNamed(locNode, "predefinedLocationReference", 8);
  if (!nodes.length) {
    // Also accept direct-child local-name already lowercased by inventory.
    const kids = Array.isArray(locNode.children) ? locNode.children : [];
    for (const c of kids) {
      if (localName(c) === "predefinedlocationreference") nodes.push(c);
    }
  }
  if (!nodes.length) return empty;
  const primary = extractPredefinedRefFields(nodes[0]);
  return {
    present: true,
    count: nodes.length,
    hasId: primary.hasId,
    hasVersion: primary.hasVersion,
    hasSetHint: primary.hasSetHint,
    idDigest: primary.idDigest,
    versionDigest: primary.versionDigest,
    setHintDigest: primary.setHintDigest,
    bindingFields: primary.bindingFields,
  };
}

/**
 * Redacted projection for feed forensic blob.
 * @param {ReturnType<typeof extractPredefinedRefForensics>} f
 */
export function projectPredefinedRefForensic(f) {
  if (!f || !f.present) return null;
  return {
    count: Number(f.count) || 0,
    hasId: f.hasId === true,
    hasVersion: f.hasVersion === true,
    hasSetHint: f.hasSetHint === true,
    idDigest: f.idDigest || "",
    versionDigest: f.versionDigest || "",
    setHintDigest: f.setHintDigest || "",
    bindingFields: String(f.bindingFields || "").slice(0, 64),
  };
}

/**
 * Build in-memory PLS digest index from PredefinedLocationsPublication XML.
 * Does not persist raw XML / ids.
 * @param {string} xml
 * @param {string} datasetName
 * @param {{ parseSafeXml: Function, attrOf: Function, descendantsNamed: Function }} xmlApi
 */
export function buildPlsDigestIndexFromXml(xml, datasetName, xmlApi) {
  const root = xmlApi.parseSafeXml(xml);
  const containers = [
    ...xmlApi.descendantsNamed(root, "predefinedLocationContainer", 200000),
    ...xmlApi.descendantsNamed(root, "predefinedLocation", 200000),
  ];
  const byId = new Map();
  let withAlertC = 0;
  let withOpenlr = 0;
  let withCoords = 0;
  let withStructured = 0;

  for (const node of containers) {
    const id = xmlApi.attrOf(node, "id");
    const version = xmlApi.attrOf(node, "version");
    const idDigest = digestPredefinedToken(id);
    if (!idDigest) continue;
    const versionDigest = digestPredefinedToken(version);
    const hasAlertC =
      xmlApi.descendantsNamed(node, "alertCPoint", 1).length > 0 ||
      xmlApi.descendantsNamed(node, "alertCLinear", 1).length > 0 ||
      xmlApi.descendantsNamed(node, "alertCArea", 1).length > 0;
    const hasOpenlr = xmlApi.descendantsNamed(node, "openlrLineLocationReference", 1).length > 0 ||
      [...(function* walk(n) {
        const stack = [n];
        let i = 0;
        while (stack.length && i < 5000) {
          const cur = stack.pop();
          i += 1;
          const name = String((cur && cur.name) || "").toLowerCase();
          if (name.includes("openlr")) yield cur;
          for (const c of (cur && cur.children) || []) stack.push(c);
        }
      })(node)].length > 0;
    const hasCoords = xmlApi.descendantsNamed(node, "pointCoordinates", 1).length > 0;
    const complete = hasAlertC || hasOpenlr || hasCoords;
    if (hasAlertC) withAlertC += 1;
    if (hasOpenlr) withOpenlr += 1;
    if (hasCoords) withCoords += 1;
    if (complete) withStructured += 1;

    const prev = byId.get(idDigest);
    if (!prev) {
      byId.set(idDigest, {
        idDigest,
        versionDigest,
        datasets: new Set([datasetName]),
        locationSemanticsComplete: complete,
        verifiedLocationPossible: complete && COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF === false ? false : complete,
      });
    } else {
      prev.datasets.add(datasetName);
      prev.locationSemanticsComplete = prev.locationSemanticsComplete || complete;
      if (versionDigest && !prev.versionDigest) prev.versionDigest = versionDigest;
    }
  }

  return {
    datasetName: String(datasetName || "").slice(0, 80),
    locationCount: byId.size,
    withAlertC,
    withOpenlr,
    withCoords,
    withStructured,
    byId,
  };
}

/**
 * Match feed ref digests against one or more PLS indexes.
 * Fail-closed on multiple catalog hits.
 * @param {{ idDigest: string, versionDigest?: string }[]} refs
 * @param {ReturnType<typeof buildPlsDigestIndexFromXml>[]} indexes
 */
export function matchPredefinedRefsToPls(refs, indexes) {
  const out = {
    matched: 0,
    unmatched: 0,
    multiple: 0,
    catalogBindingProven: 0,
    locationRecordExists: 0,
    verifiedLocationPossible: 0,
    rows: [],
  };
  const list = Array.isArray(refs) ? refs : [];
  for (const ref of list) {
    const idDigest = String((ref && ref.idDigest) || "");
    if (!idDigest) {
      out.unmatched += 1;
      out.rows.push({ idDigest: "", match: "unmatched", datasets: [] });
      continue;
    }
    const hits = [];
    for (const idx of indexes || []) {
      const hit = idx.byId && idx.byId.get(idDigest);
      if (hit) hits.push({ dataset: idx.datasetName, hit });
    }
    if (hits.length === 0) {
      out.unmatched += 1;
      out.rows.push({ idDigest, match: "unmatched", datasets: [] });
      continue;
    }
    if (hits.length > 1) {
      out.multiple += 1;
      out.rows.push({
        idDigest,
        match: "multiple",
        datasets: hits.map((h) => h.dataset).slice(0, 8),
      });
      continue;
    }
    const only = hits[0];
    out.matched += 1;
    out.locationRecordExists += 1;
    // Common traffic profile forbids PLS refs → binding not proven safe for this feed.
    const bindingProven = COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF === true;
    if (bindingProven) out.catalogBindingProven += 1;
    const verified =
      bindingProven && only.hit.locationSemanticsComplete === true;
    if (verified) out.verifiedLocationPossible += 1;
    out.rows.push({
      idDigest,
      match: "matched",
      datasets: [only.dataset],
      locationSemanticsComplete: only.hit.locationSemanticsComplete === true,
      verifiedLocationPossible: verified,
      catalogBindingProven: bindingProven,
    });
  }
  return out;
}
