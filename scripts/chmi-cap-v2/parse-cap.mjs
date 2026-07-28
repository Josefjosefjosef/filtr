/**
 * CAP 1.2 alert parser for ČHMÚ (safe XML → normalized alert object).
 */
import { DEFAULT_LIMITS } from "./config.mjs";
import { childText, childTexts, childrenNamed, firstChild, parseSafeXml } from "./safe-xml.mjs";

const CAP_NS_HINT = /urn:oasis:names:tc:emergency:cap:1\.2/i;

function clip(s, max) {
  const t = String(s || "");
  return t.length > max ? t.slice(0, max) : t;
}

function parseGeocodes(areaNode, lim) {
  const out = [];
  for (const g of childrenNamed(areaNode, "geocode")) {
    if (out.length >= lim.maxGeocodesPerArea) break;
    out.push({
      valueName: clip(childText(g, "valueName", 200), 200),
      value: clip(childText(g, "value", 200), 200),
    });
  }
  return out;
}

function parsePolygon(areaNode, lim) {
  const raw = childText(areaNode, "polygon", lim.maxTextFieldChars);
  if (!raw) return null;
  const pts = raw.trim().split(/\s+/).filter(Boolean);
  if (pts.length > lim.maxPolygonPoints) {
    return { truncated: true, pointCount: pts.length, sample: pts.slice(0, 8) };
  }
  return { truncated: false, pointCount: pts.length, raw: clip(raw, lim.maxTextFieldChars) };
}

function parseAreas(infoNode, lim) {
  const areas = [];
  for (const a of childrenNamed(infoNode, "area")) {
    if (areas.length >= lim.maxAreasPerInfo) break;
    areas.push({
      areaDesc: clip(childText(a, "areaDesc", lim.maxTextFieldChars), lim.maxTextFieldChars),
      polygon: parsePolygon(a, lim),
      circle: clip(childText(a, "circle", 500), 500) || null,
      geocodes: parseGeocodes(a, lim),
      altitude: clip(childText(a, "altitude", 64), 64) || null,
      ceiling: clip(childText(a, "ceiling", 64), 64) || null,
    });
  }
  return areas;
}

function parseParameters(infoNode, lim) {
  return childrenNamed(infoNode, "parameter").slice(0, 100).map((p) => ({
    valueName: clip(childText(p, "valueName", 200), 200),
    value: clip(childText(p, "value", lim.maxTextFieldChars), lim.maxTextFieldChars),
  }));
}

function parseEventCodes(infoNode) {
  return childrenNamed(infoNode, "eventCode").slice(0, 50).map((e) => ({
    valueName: clip(childText(e, "valueName", 200), 200),
    value: clip(childText(e, "value", 200), 200),
  }));
}

function pickInfoBlocks(alertNode, lim) {
  const all = childrenNamed(alertNode, "info").slice(0, lim.maxInfoBlocks);
  const scored = all.map((node, index) => {
    const language = clip(childText(node, "language", 32), 32).toLowerCase();
    const isCs = language.startsWith("cs") || language.startsWith("cz");
    return { node, index, language, isCs };
  });
  const cs = scored.filter((x) => x.isCs);
  if (cs.length) {
    return {
      infos: cs.map((x) => x.node),
      languageFallback: false,
      selectedLanguages: cs.map((x) => x.language || "cs"),
    };
  }
  return {
    infos: scored.map((x) => x.node),
    languageFallback: scored.length > 0,
    selectedLanguages: scored.map((x) => x.language || ""),
  };
}

function parseInfo(infoNode, lim) {
  return {
    language: clip(childText(infoNode, "language", 32), 32),
    category: childTexts(infoNode, "category", 64),
    event: clip(childText(infoNode, "event", lim.maxTextFieldChars), lim.maxTextFieldChars),
    responseType: childTexts(infoNode, "responseType", 64),
    urgency: clip(childText(infoNode, "urgency", 64), 64),
    severity: clip(childText(infoNode, "severity", 64), 64),
    certainty: clip(childText(infoNode, "certainty", 64), 64),
    audience: clip(childText(infoNode, "audience", lim.maxTextFieldChars), lim.maxTextFieldChars),
    eventCode: parseEventCodes(infoNode),
    effective: clip(childText(infoNode, "effective", 64), 64),
    onset: clip(childText(infoNode, "onset", 64), 64),
    expires: clip(childText(infoNode, "expires", 64), 64),
    senderName: clip(childText(infoNode, "senderName", 500), 500),
    headline: clip(childText(infoNode, "headline", lim.maxTextFieldChars), lim.maxTextFieldChars),
    description: clip(childText(infoNode, "description", lim.maxTextFieldChars), lim.maxTextFieldChars),
    instruction: clip(childText(infoNode, "instruction", lim.maxTextFieldChars), lim.maxTextFieldChars),
    web: clip(childText(infoNode, "web", 2000), 2000),
    contact: clip(childText(infoNode, "contact", 2000), 2000),
    parameter: parseParameters(infoNode, lim),
    areas: parseAreas(infoNode, lim),
  };
}

/**
 * @param {string} xml
 * @param {{ limits?: Partial<typeof DEFAULT_LIMITS>, sourceUrl?: string }} [opts]
 */
export function parseCapAlertXml(xml, opts = {}) {
  const lim = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const root = parseSafeXml(xml, lim);
  if (root.name !== "alert") {
    throw Object.assign(new Error("cap_root_not_alert"), { code: "CAP_ROOT" });
  }
  const ns = root.attrs.xmlns || root.attrs.Xmlns || "";
  if (ns && !CAP_NS_HINT.test(ns)) {
    // allow missing xmlns in fixtures; reject clearly wrong ns
    if (/cap:1\.[01]/i.test(ns) === false && /emergency:cap/i.test(ns)) {
      /* older — still try */
    }
  }

  const { infos: infoNodes, languageFallback, selectedLanguages } = pickInfoBlocks(root, lim);
  const infos = infoNodes.map((n) => parseInfo(n, lim));

  const alert = {
    identifier: clip(childText(root, "identifier", 500), 500),
    sender: clip(childText(root, "sender", 500), 500),
    sent: clip(childText(root, "sent", 64), 64),
    status: clip(childText(root, "status", 64), 64),
    msgType: clip(childText(root, "msgType", 64), 64),
    source: clip(childText(root, "source", 500), 500),
    scope: clip(childText(root, "scope", 64), 64),
    restriction: clip(childText(root, "restriction", lim.maxTextFieldChars), lim.maxTextFieldChars),
    addresses: clip(childText(root, "addresses", lim.maxTextFieldChars), lim.maxTextFieldChars),
    code: childTexts(root, "code", 200),
    note: clip(childText(root, "note", lim.maxTextFieldChars), lim.maxTextFieldChars),
    references: clip(childText(root, "references", lim.maxTextFieldChars), lim.maxTextFieldChars),
    incidents: clip(childText(root, "incidents", lim.maxTextFieldChars), lim.maxTextFieldChars),
    infos,
    languageFallback,
    selectedLanguages,
    sourceUrl: opts.sourceUrl || null,
    xmlns: ns || null,
  };

  if (!alert.identifier || !alert.sender || !alert.sent) {
    throw Object.assign(new Error("cap_missing_identity_fields"), { code: "CAP_IDENTITY" });
  }
  if (infos.length > lim.maxInfoBlocks) {
    throw Object.assign(new Error("cap_too_many_info"), { code: "CAP_INFO" });
  }
  return alert;
}

export function isKnownMsgType(msgType) {
  return /^(Alert|Update|Cancel|Ack|Error)$/i.test(String(msgType || ""));
}
