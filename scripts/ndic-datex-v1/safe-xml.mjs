/**
 * Safe DATEX-oriented XML parse — reuses CHMI CAP safe-xml with NDIC limits.
 */
import {
  parseSafeXml as parseSafeXmlBase,
  assertSafeXmlInput,
  childrenNamed,
  firstChild,
  childText,
  childTexts,
} from "../chmi-cap-v2/safe-xml.mjs";
import { DEFAULT_LIMITS } from "./config.mjs";

export { assertSafeXmlInput, childrenNamed, firstChild, childText, childTexts };

/**
 * @param {string} xml
 * @param {Partial<typeof DEFAULT_LIMITS>} [limits]
 */
export function parseSafeXml(xml, limits = {}) {
  return parseSafeXmlBase(xml, { ...DEFAULT_LIMITS, ...limits });
}

/**
 * Collect descendant elements by local name (namespace-agnostic).
 * @param {import("../chmi-cap-v2/safe-xml.mjs").XmlNode} node
 * @param {string} name
 * @param {number} [max]
 */
export function descendantsNamed(node, name, max = 100000) {
  const want = String(name || "").toLowerCase();
  const out = [];
  const walk = (n) => {
    if (!n || out.length >= max) return;
    if (String(n.name || "").toLowerCase() === want) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return out;
}

/**
 * First attribute match (case-insensitive), prefers unprefixed then xsi:type.
 * @param {import("../chmi-cap-v2/safe-xml.mjs").XmlNode} node
 * @param {string} attr
 */
export function attrOf(node, attr) {
  if (!node || !node.attrs) return "";
  const want = String(attr || "").toLowerCase();
  for (const [k, v] of Object.entries(node.attrs)) {
    const lk = String(k).toLowerCase();
    if (lk === want || lk.endsWith(":" + want)) return String(v || "");
  }
  return "";
}

/**
 * Strip xsi:type namespace prefix → local type name.
 * @param {string} raw
 */
export function localTypeName(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(i + 1) : s;
}
