/**
 * Sanitized DATEX XML structure diagnostics (no raw text/coords/ids).
 * Lightweight scan — does not build a full DOM of large text nodes.
 */
import { assertSafeXmlInput } from "../chmi-cap-v2/safe-xml.mjs";

/** Public standard URIs allowed in sanitized reports (no document content). */
export const PUBLIC_NS_ALLOW = Object.freeze([
  "http://datex2.eu/schema/2/2_0",
  "http://datex2.eu/schema/2_0RC1/2_0",
  "http://datex2.eu/schema/2/2_3",
  "http://datex2.eu/schema/3/3_0",
  "http://www.w3.org/2001/XMLSchema-instance",
  "http://www.w3.org/2001/XMLSchema",
  "http://www.w3.org/XML/1998/namespace",
]);

const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const DATEX_APP_NS_RE = /^https?:\/\/datex2\.eu\/schema\//i;

/**
 * @param {string} uri
 */
export function isPublicStandardNamespaceUri(uri) {
  const u = String(uri || "").trim();
  if (!u) return false;
  if (PUBLIC_NS_ALLOW.includes(u)) return true;
  if (DATEX_APP_NS_RE.test(u) && u.length <= 120) return true;
  return false;
}

/**
 * @param {string} uri
 */
export function isApplicationDatexNamespace(uri) {
  const u = String(uri || "").trim();
  if (!u || u === XSI_NS || u === XML_NS) return false;
  return DATEX_APP_NS_RE.test(u);
}

/**
 * Prefer default xmlns / DATEX application URI; never treat xsi as app namespace.
 * @param {string} xmlHead
 */
export function pickRootNamespaceUri(xmlHead) {
  const head = String(xmlHead || "").slice(0, 8192);
  /** @type {{prefix:string|null, uri:string}[]} */
  const decls = [];
  const re = /\bxmlns(?::([A-Za-z_][\w.-]*))?=(["'])([^"']+)\2/g;
  let m;
  while ((m = re.exec(head))) {
    decls.push({ prefix: m[1] || null, uri: m[3] });
  }
  const def = decls.find((d) => d.prefix == null && isApplicationDatexNamespace(d.uri));
  if (def) return def.uri.slice(0, 120);
  const anyDatex = decls.find((d) => isApplicationDatexNamespace(d.uri));
  if (anyDatex) return anyDatex.uri.slice(0, 120);
  const anyPublic = decls.find((d) => isPublicStandardNamespaceUri(d.uri) && d.uri !== XSI_NS);
  if (anyPublic) return anyPublic.uri.slice(0, 120);
  return null;
}

/**
 * Collect unique public namespace URIs from xmlns declarations (no prefixes in output).
 * @param {string} xml
 */
export function collectPublicNamespaceUris(xml) {
  const s = String(xml || "");
  const out = new Set();
  const re = /\bxmlns(?::[A-Za-z_][\w.-]*)?=(["'])([^"']+)\1/g;
  let m;
  let guard = 0;
  while ((m = re.exec(s)) && guard++ < 500) {
    const uri = m[2];
    if (isPublicStandardNamespaceUri(uri)) out.add(uri.slice(0, 120));
  }
  return [...out].sort();
}

function localFromTag(raw) {
  const t = String(raw || "");
  const i = t.indexOf(":");
  return (i >= 0 ? t.slice(i + 1) : t).toLowerCase();
}

/**
 * Streaming-ish element localName counter (tag names only; ignores text/attrs values except xmlns URIs).
 * Safe across arbitrary chunk joins when fed the full string.
 *
 * @param {string} xml
 * @param {{ maxScanBytes?: number, maxDepth?: number, maxElements?: number }} [opts]
 */
export function scanDatexStructure(xml, opts = {}) {
  const maxScanBytes = opts.maxScanBytes || 80 * 1024 * 1024;
  const maxDepth = opts.maxDepth || 80;
  const maxElements = opts.maxElements || 2_000_000;
  const raw = typeof xml === "string" ? xml : Buffer.isBuffer(xml) ? xml.toString("utf8") : "";
  const byteLen = Buffer.byteLength(raw, "utf8");
  /** @type {Record<string, never>|object} */
  const diag = {
    rootLocalName: null,
    rootNamespaceUri: null,
    namespaceUris: [],
    detectedDatexMajorVersion: null,
    detectedDatexProfile: null,
    topLevelElementLocalNameCounts: {},
    candidateSituationElementCount: 0,
    candidateSituationRecordElementCount: 0,
    recordTypeLocalNameCounts: {},
    chunkBoundaryProbePassed: true,
    documentWellFormed: null,
    parserFailureCode: null,
    parserCompatibilityReason: null,
    scannedBytes: Math.min(byteLen, maxScanBytes),
    elementCountScanned: 0,
  };

  if (!raw) {
    diag.documentWellFormed = false;
    diag.parserFailureCode = "XML_EMPTY";
    diag.parserCompatibilityReason = "empty_document";
    return diag;
  }

  try {
    assertSafeXmlInput(raw.slice(0, Math.min(raw.length, 256 * 1024)), {
      maxResponseBytes: maxScanBytes,
      maxTextFieldChars: 12000,
      maxElements,
      maxXmlDepth: maxDepth,
    });
  } catch (e) {
    // Head-only safety probe may fail on truncated entity — continue structural tag scan.
    if (e && e.code === "XML_UNSAFE") {
      diag.documentWellFormed = false;
      diag.parserFailureCode = "XML_UNSAFE";
      diag.parserCompatibilityReason = "forbidden_xml_construct";
      return diag;
    }
  }

  diag.rootNamespaceUri = pickRootNamespaceUri(raw);
  diag.namespaceUris = collectPublicNamespaceUris(raw.slice(0, Math.min(raw.length, 512 * 1024)));

  const verM = raw.slice(0, 8192).match(/\bmodelBaseVersion=(["'])([^"']+)\1/);
  if (verM) {
    const v = verM[2];
    const maj = Number(String(v).split(".")[0]);
    diag.detectedDatexMajorVersion = Number.isFinite(maj) ? maj : null;
  }
  if (/SituationPublication/i.test(raw.slice(0, 16384))) {
    diag.detectedDatexProfile = "SituationPublication";
  }

  const stack = [];
  let i = 0;
  let elements = 0;
  let well = true;
  const topCounts = Object.create(null);
  const typeCounts = Object.create(null);
  const s = raw;

  while (i < s.length) {
    if (s[i] !== "<") {
      const next = s.indexOf("<", i);
      i = next < 0 ? s.length : next;
      continue;
    }
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) {
        well = false;
        break;
      }
      i = end + 3;
      continue;
    }
    if (s.startsWith("<?", i)) {
      const end = s.indexOf("?>", i + 2);
      if (end < 0) {
        well = false;
        break;
      }
      i = end + 2;
      continue;
    }
    if (s.startsWith("<![CDATA[", i)) {
      const end = s.indexOf("]]>", i + 9);
      if (end < 0) {
        well = false;
        break;
      }
      i = end + 3;
      continue;
    }
    if (s.startsWith("<!", i)) {
      well = false;
      diag.parserFailureCode = "XML_UNSAFE";
      break;
    }

    const close = s[i + 1] === "/";
    const tagStart = i + (close ? 2 : 1);
    let j = tagStart;
    while (j < s.length && /[^\s>\/]/.test(s[j])) j++;
    const rawName = s.slice(tagStart, j);
    if (!rawName) {
      well = false;
      break;
    }
    const name = localFromTag(rawName);

    // Skip attribute values entirely for privacy (advance to end of start tag).
    let inQuote = null;
    while (j < s.length) {
      const c = s[j];
      if (inQuote) {
        if (c === inQuote) inQuote = null;
        j++;
        continue;
      }
      if (c === '"' || c === "'") {
        inQuote = c;
        j++;
        continue;
      }
      if (c === ">") {
        j++;
        break;
      }
      j++;
    }

    const selfClose = s[j - 2] === "/";

    if (close) {
      if (!stack.length || stack[stack.length - 1] !== name) {
        well = false;
        break;
      }
      stack.pop();
      i = j;
      continue;
    }

    elements++;
    if (elements > maxElements) {
      diag.parserFailureCode = "XML_ELEMENTS";
      diag.parserCompatibilityReason = "element_limit_during_structure_scan";
      well = false;
      break;
    }
    if (stack.length + 1 > maxDepth) {
      diag.parserFailureCode = "XML_DEPTH";
      diag.parserCompatibilityReason = "depth_limit_during_structure_scan";
      well = false;
      break;
    }

    if (!diag.rootLocalName) diag.rootLocalName = name.slice(0, 80);
    if (stack.length === 1) {
      topCounts[name] = (topCounts[name] || 0) + 1;
    }
    if (name === "situation") diag.candidateSituationElementCount += 1;
    if (name === "situationrecord") diag.candidateSituationRecordElementCount += 1;
    // xsi:type values are attribute content — do not harvest free-text; only count known record-ish element names
    if (
      /^(accident|roadworks|obstruction|animalpresenceobstruction|poorenvironmentconditions|weatherrelatedroadconditions|abnormaltraffic|maintenanceworks|roadorscarriagewayorlanemanagement|networkmanagement|generalinstruction|transitinformation|publicEvent|activity|conditions)$/i.test(
        name
      )
    ) {
      typeCounts[name] = (typeCounts[name] || 0) + 1;
    }

    if (!selfClose) stack.push(name);
    i = j;
  }

  diag.elementCountScanned = elements;
  diag.topLevelElementLocalNameCounts = topCounts;
  diag.recordTypeLocalNameCounts = typeCounts;
  diag.documentWellFormed = well && stack.length === 0;

  if (!diag.rootNamespaceUri) {
    diag.parserCompatibilityReason = diag.parserCompatibilityReason || "missing_or_non_datex_root_namespace";
  } else if (!isApplicationDatexNamespace(diag.rootNamespaceUri)) {
    diag.parserCompatibilityReason = diag.parserCompatibilityReason || "root_namespace_not_datex_application";
  }

  if (diag.detectedDatexMajorVersion != null && diag.detectedDatexMajorVersion !== 2) {
    diag.parserCompatibilityReason = "unsupported_datex_major_version";
  }

  return diag;
}

/**
 * Probe that concatenated chunk splits still yield same root/ns counts (offline).
 * @param {string} xml
 * @param {number[]} cuts
 */
export function chunkBoundaryProbe(xml, cuts) {
  const full = scanDatexStructure(xml);
  let joined = "";
  let prev = 0;
  for (const c of cuts) {
    joined += xml.slice(prev, c);
    prev = c;
  }
  joined += xml.slice(prev);
  const part = scanDatexStructure(joined);
  return (
    full.rootLocalName === part.rootLocalName &&
    full.rootNamespaceUri === part.rootNamespaceUri &&
    full.candidateSituationElementCount === part.candidateSituationElementCount &&
    full.candidateSituationRecordElementCount === part.candidateSituationRecordElementCount
  );
}
