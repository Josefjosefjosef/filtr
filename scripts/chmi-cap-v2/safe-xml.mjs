/**
 * Safe CAP-oriented XML tree builder (no DTD, no entities, no XXE).
 * Not a general-purpose XML library — rejects unsafe constructs before parse.
 */
import { DEFAULT_LIMITS } from "./config.mjs";

const FORBIDDEN_PRE =
  /<!DOCTYPE|<!ENTITY|SYSTEM\s+["']|PUBLIC\s+["']|%\w+;|&#x0*0+;|<!\[CDATA\[\s*<!ENTITY/i;

/**
 * @param {string} xml
 * @param {Partial<typeof DEFAULT_LIMITS>} [limits]
 */
export function assertSafeXmlInput(xml, limits = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  if (typeof xml !== "string") throw Object.assign(new Error("xml_not_string"), { code: "XML_TYPE" });
  if (!xml.length) throw Object.assign(new Error("xml_empty"), { code: "XML_EMPTY" });
  if (Buffer.byteLength(xml, "utf8") > lim.maxResponseBytes) {
    throw Object.assign(new Error("xml_too_large"), { code: "XML_TOO_LARGE" });
  }
  if (FORBIDDEN_PRE.test(xml)) {
    throw Object.assign(new Error("xml_forbidden_construct"), { code: "XML_UNSAFE" });
  }
  // Reject any entity reference except the five predefined XML ones and numeric refs that are not NUL
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(xml)) {
    throw Object.assign(new Error("xml_unknown_entity"), { code: "XML_ENTITY" });
  }
  return lim;
}

function decodeText(s) {
  return String(s || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = parseInt(h, 16);
      if (!cp || cp === 0) return "";
      try {
        return String.fromCodePoint(cp);
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      if (!cp) return "";
      try {
        return String.fromCodePoint(cp);
      } catch {
        return "";
      }
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function localName(tag) {
  const t = String(tag || "");
  const i = t.indexOf(":");
  return i >= 0 ? t.slice(i + 1) : t;
}

/**
 * @typedef {{ name: string, attrs: Record<string,string>, children: Array, text: string }} XmlNode
 */

/**
 * Stack-based XML parse → element tree. Text-only; no HTML interpretation.
 * @param {string} xml
 * @param {Partial<typeof DEFAULT_LIMITS>} [limits]
 * @returns {XmlNode}
 */
export function parseSafeXml(xml, limits = {}) {
  const lim = assertSafeXmlInput(xml, limits);
  let i = 0;
  const s = xml.replace(/^\uFEFF/, "");
  /** @type {XmlNode[]} */
  const stack = [];
  /** @type {XmlNode|null} */
  let root = null;
  let elements = 0;
  let depth = 0;

  function pushText(node, text) {
    if (!text) return;
    const decoded = decodeText(text);
    if (!decoded) return;
    if (node.text.length + decoded.length > lim.maxTextFieldChars * 4) {
      throw Object.assign(new Error("xml_text_budget"), { code: "XML_TEXT" });
    }
    node.text += decoded;
  }

  while (i < s.length) {
    if (s[i] !== "<") {
      const next = s.indexOf("<", i);
      const chunk = next < 0 ? s.slice(i) : s.slice(i, next);
      if (stack.length) pushText(stack[stack.length - 1], chunk);
      i = next < 0 ? s.length : next;
      continue;
    }
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) throw Object.assign(new Error("xml_comment_unclosed"), { code: "XML_PARSE" });
      i = end + 3;
      continue;
    }
    if (s.startsWith("<![CDATA[", i)) {
      const end = s.indexOf("]]>", i + 9);
      if (end < 0) throw Object.assign(new Error("xml_cdata_unclosed"), { code: "XML_PARSE" });
      if (stack.length) pushText(stack[stack.length - 1], s.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (s.startsWith("<?", i)) {
      const end = s.indexOf("?>", i + 2);
      if (end < 0) throw Object.assign(new Error("xml_pi_unclosed"), { code: "XML_PARSE" });
      i = end + 2;
      continue;
    }
    if (s.startsWith("<!", i)) {
      throw Object.assign(new Error("xml_declaration_forbidden"), { code: "XML_UNSAFE" });
    }

    const close = s[i + 1] === "/";
    const tagStart = i + (close ? 2 : 1);
    let j = tagStart;
    while (j < s.length && /[^\s>\/]/.test(s[j])) j++;
    const rawName = s.slice(tagStart, j);
    if (!rawName) throw Object.assign(new Error("xml_empty_tag"), { code: "XML_PARSE" });
    const name = localName(rawName);

    /** @type {Record<string,string>} */
    const attrs = {};
    while (j < s.length && s[j] !== ">" && s[j] !== "/") {
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length || s[j] === ">" || s[j] === "/") break;
      let k = j;
      while (k < s.length && /[^\s=\/>]/.test(s[k])) k++;
      const an = localName(s.slice(j, k));
      j = k;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] !== "=") continue;
      j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      const q = s[j];
      if (q !== '"' && q !== "'") throw Object.assign(new Error("xml_attr"), { code: "XML_PARSE" });
      j++;
      const ae = s.indexOf(q, j);
      if (ae < 0) throw Object.assign(new Error("xml_attr_unclosed"), { code: "XML_PARSE" });
      attrs[an] = decodeText(s.slice(j, ae));
      j = ae + 1;
    }
    while (j < s.length && /\s/.test(s[j])) j++;
    const selfClose = s[j] === "/";
    if (selfClose) j++;
    if (s[j] !== ">") throw Object.assign(new Error("xml_tag_end"), { code: "XML_PARSE" });
    j++;

    if (close) {
      if (!stack.length || stack[stack.length - 1].name !== name) {
        throw Object.assign(new Error("xml_mismatched_close:" + name), { code: "XML_PARSE" });
      }
      stack.pop();
      depth--;
      i = j;
      continue;
    }

    elements++;
    if (elements > lim.maxElements) {
      throw Object.assign(new Error("xml_too_many_elements"), { code: "XML_ELEMENTS" });
    }
    depth++;
    if (depth > lim.maxXmlDepth) {
      throw Object.assign(new Error("xml_too_deep"), { code: "XML_DEPTH" });
    }
    const node = { name, attrs, children: [], text: "" };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else {
      if (root) throw Object.assign(new Error("xml_multi_root"), { code: "XML_PARSE" });
      root = node;
    }
    if (!selfClose) stack.push(node);
    else depth--;
    i = j;
  }

  if (stack.length) throw Object.assign(new Error("xml_unclosed"), { code: "XML_PARSE" });
  if (!root) throw Object.assign(new Error("xml_no_root"), { code: "XML_PARSE" });
  return root;
}

/** @param {XmlNode} node @param {string} name */
export function childrenNamed(node, name) {
  if (!node) return [];
  const n = String(name);
  return (node.children || []).filter((c) => c && c.name === n);
}

/** @param {XmlNode} node @param {string} name */
export function firstChild(node, name) {
  return childrenNamed(node, name)[0] || null;
}

/** @param {XmlNode} node @param {string} name */
export function childText(node, name, maxLen = DEFAULT_LIMITS.maxTextFieldChars) {
  const c = firstChild(node, name);
  if (!c) return "";
  const t = String(c.text || "").trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/** @param {XmlNode} node @param {string} name */
export function childTexts(node, name, maxLen = DEFAULT_LIMITS.maxTextFieldChars) {
  return childrenNamed(node, name).map((c) => {
    const t = String(c.text || "").trim();
    return t.length > maxLen ? t.slice(0, maxLen) : t;
  });
}
