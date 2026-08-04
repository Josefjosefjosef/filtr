/**
 * Minimal bounded SAX-like XML tokenizer (no external deps).
 * Handles chunk boundaries for tags/attrs/UTF-8; rejects DOCTYPE/ENTITY.
 * Not a general XML library — DATEX SituationPublication profile only.
 */
import { TextDecoder } from "node:util";

export const STREAM_XML_LIMITS = Object.freeze({
  maxDepth: 60,
  maxElements: 1_500_000,
  maxAttrsPerElement: 64,
  maxNameLen: 128,
  maxAttrValueLen: 512,
  maxTextNodeChars: 12000,
  maxBufferChars: 256 * 1024,
  maxRecordBytes: 512 * 1024,
  maxRecords: 20000,
  maxRuntimeMs: 180_000,
});

function localName(qname) {
  const s = String(qname || "");
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(i + 1) : s;
}

function prefixOf(qname) {
  const s = String(qname || "");
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(0, i) : "";
}

/**
 * @param {Partial<typeof STREAM_XML_LIMITS>} [limits]
 * @param {{
 *   onOpen?: (ev: object) => void,
 *   onClose?: (ev: object) => void,
 *   onText?: (ev: object) => void,
 *   onEnd?: () => void,
 *   signal?: AbortSignal,
 * }} [handlers]
 */
export function createXmlStreamTokenizer(limits = {}, handlers = {}) {
  const lim = { ...STREAM_XML_LIMITS, ...limits };
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let carry = "";
  let mode = "text"; // text | markup | comment | cdata | pi
  let markup = "";
  let depth = 0;
  let elements = 0;
  let maxDepthObserved = 0;
  let closed = false;
  let startedAt = Date.now();
  /** @type {{ prefix: string, uri: string }[][]} */
  const nsStack = [[]];

  function fail(code, msg) {
    const err = Object.assign(new Error(msg || code), { code });
    throw err;
  }

  function checkRuntime() {
    if (Date.now() - startedAt > lim.maxRuntimeMs) fail("XML_TIMEOUT", "parser_timeout");
    if (handlers.signal && handlers.signal.aborted) fail("XML_ABORTED", "aborted");
  }

  function emitOpen(qname, attrRaw, selfClose) {
    if (qname.length > lim.maxNameLen) fail("XML_NAME_TOO_LONG", "elem");
    const attrs = parseAttrs(attrRaw);
    /** @type {{ prefix: string, uri: string }[]} */
    const bindings = [];
    for (const a of attrs) {
      if (a.qname === "xmlns") bindings.push({ prefix: "", uri: a.value });
      else if (a.prefix === "xmlns") bindings.push({ prefix: a.local, uri: a.value });
    }
    // Bindings apply to this element and descendants
    const frame = bindings.slice();
    nsStack.push(frame);

    const pref = prefixOf(qname);
    let uri = "";
    if (pref === "xml") uri = "http://www.w3.org/XML/1998/namespace";
    else {
      for (let d = nsStack.length - 1; d >= 0; d--) {
        const fr = nsStack[d];
        for (let i = fr.length - 1; i >= 0; i--) {
          if (fr[i].prefix === pref) {
            uri = fr[i].uri;
            break;
          }
        }
        if (uri) break;
      }
    }

    elements += 1;
    if (elements > lim.maxElements) fail("XML_ELEMENTS", "too_many");
    const depthBefore = depth;
    if (!selfClose) {
      depth += 1;
      if (depth > lim.maxDepth) fail("XML_DEPTH", "too_deep");
      if (depth > maxDepthObserved) maxDepthObserved = depth;
    } else {
      // self-close: pop bindings immediately after open handlers
    }
    if (handlers.onOpen) {
      handlers.onOpen({
        qname,
        localName: localName(qname).toLowerCase(),
        prefix: pref,
        uri: uri || "",
        attrs,
        selfClose: !!selfClose,
        depth: selfClose ? depthBefore + 1 : depth,
        elements,
      });
    }
    if (selfClose) {
      if (handlers.onClose) {
        handlers.onClose({
          qname,
          localName: localName(qname).toLowerCase(),
          prefix: pref,
          uri: uri || "",
          depth: depthBefore + 1,
          elements,
        });
      }
      nsStack.pop();
    }
  }

  function emitClose(qname) {
    const local = localName(qname).toLowerCase();
    if (!depth) fail("XML_PARSE", "close_without_open");
    const closeDepth = depth;
    if (handlers.onClose) {
      handlers.onClose({
        qname,
        localName: local,
        prefix: prefixOf(qname),
        uri: "",
        depth: closeDepth,
        elements,
      });
    }
    nsStack.pop();
    depth -= 1;
  }

  function parseAttrs(raw) {
    /** @type {{ qname: string, prefix: string, local: string, value: string }[]} */
    const attrs = [];
    let i = 0;
    const s = raw;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      let j = i;
      while (j < s.length && /[^\s=\/]/.test(s[j])) j++;
      const qname = s.slice(i, j);
      if (!qname || qname.length > lim.maxNameLen) fail("XML_NAME_TOO_LONG", "attr_name");
      i = j;
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] !== "=") fail("XML_ATTR", "missing_eq");
      i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      const q = s[i];
      if (q !== '"' && q !== "'") fail("XML_ATTR", "quote");
      i++;
      const end = s.indexOf(q, i);
      if (end < 0) fail("XML_ATTR", "unclosed");
      let value = s.slice(i, end);
      if (value.length > lim.maxAttrValueLen) fail("XML_ATTR_VALUE_TOO_LONG", "attr_value");
      if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value)) {
        fail("XML_ENTITY", "unknown_entity_in_attr");
      }
      value = value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
      i = end + 1;
      if (attrs.length >= lim.maxAttrsPerElement) fail("XML_TOO_MANY_ATTRS", "attrs");
      attrs.push({
        qname,
        prefix: prefixOf(qname),
        local: localName(qname),
        value,
      });
    }
    return attrs;
  }

  function emitText(t) {
    if (!t || !depth) return;
    if (t.length > lim.maxTextNodeChars) fail("XML_TEXT", "text_too_long");
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t)) {
      fail("XML_ENTITY", "unknown_entity_in_text");
    }
    const decoded = t
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
    if (handlers.onText) handlers.onText({ text: decoded, depth });
  }

  function processMarkup(full) {
    // full includes leading '<' and should end with '>'
    if (full.startsWith("<!--")) {
      if (!full.endsWith("-->")) fail("XML_PARSE", "comment");
      return;
    }
    if (full.startsWith("<![CDATA[")) {
      if (!full.endsWith("]]>")) fail("XML_PARSE", "cdata");
      const inner = full.slice(9, -3);
      emitText(inner);
      return;
    }
    if (full.startsWith("<?")) {
      if (!full.endsWith("?>")) fail("XML_PARSE", "pi");
      return;
    }
    if (full.startsWith("<!")) {
      fail("XML_UNSAFE", "doctype_or_decl");
    }
    if (full.startsWith("</")) {
      const body = full.slice(2, -1).trim();
      const name = body.split(/\s/)[0];
      emitClose(name);
      return;
    }
    let inner = full.slice(1, -1);
    let selfClose = false;
    if (inner.endsWith("/")) {
      selfClose = true;
      inner = inner.slice(0, -1);
    }
    inner = inner.trim();
    let k = 0;
    while (k < inner.length && /[^\s\/]/.test(inner[k])) k++;
    const qname = inner.slice(0, k);
    const attrRaw = inner.slice(k);
    emitOpen(qname, attrRaw, selfClose);
  }

  function feedString(chunk) {
    checkRuntime();
    if (closed) fail("XML_PARSE", "after_end");
    carry += chunk;
    if (carry.length > lim.maxBufferChars * 4) fail("XML_BUFFER", "carry_overflow");

    let guard = 0;
    while (carry.length && guard++ < 100000) {
      if (mode === "text") {
        const lt = carry.indexOf("<");
        if (lt < 0) {
          // keep last few chars in case of partial entity
          if (carry.length > 16) {
            emitText(carry.slice(0, -8));
            carry = carry.slice(-8);
          }
          break;
        }
        if (lt > 0) {
          emitText(carry.slice(0, lt));
          carry = carry.slice(lt);
        }
        if (carry.startsWith("<!--")) {
          mode = "comment";
          markup = "";
          continue;
        }
        if (carry.startsWith("<![CDATA[")) {
          mode = "cdata";
          markup = "";
          continue;
        }
        if (carry.startsWith("<?")) {
          mode = "pi";
          markup = "";
          continue;
        }
        if (carry.startsWith("<!")) {
          fail("XML_UNSAFE", "doctype_or_decl");
        }
        mode = "markup";
        markup = "";
        continue;
      }

      if (mode === "comment") {
        const buf = markup + carry;
        const end = buf.indexOf("-->");
        if (end < 0) {
          markup = buf.length > lim.maxBufferChars ? buf.slice(-64) : buf;
          carry = "";
          break;
        }
        carry = buf.slice(end + 3);
        markup = "";
        mode = "text";
        continue;
      }
      if (mode === "cdata") {
        const buf = markup + carry;
        const end = buf.indexOf("]]>");
        if (end < 0) {
          if (buf.length > lim.maxTextNodeChars) fail("XML_TEXT", "cdata");
          markup = buf;
          carry = "";
          break;
        }
        emitText(buf.slice(9, end));
        carry = buf.slice(end + 3);
        markup = "";
        mode = "text";
        continue;
      }
      if (mode === "pi") {
        const buf = markup + carry;
        const end = buf.indexOf("?>");
        if (end < 0) {
          markup = buf.length > lim.maxBufferChars ? buf.slice(-64) : buf;
          carry = "";
          break;
        }
        carry = buf.slice(end + 2);
        markup = "";
        mode = "text";
        continue;
      }

      // markup: accumulate until '>' not in quotes
      let i = 0;
      let inQ = null;
      const src = markup + carry;
      let found = -1;
      for (; i < src.length; i++) {
        const c = src[i];
        if (inQ) {
          if (c === inQ) inQ = null;
          continue;
        }
        if (c === '"' || c === "'") {
          inQ = c;
          continue;
        }
        if (c === ">") {
          found = i;
          break;
        }
      }
      if (found < 0) {
        if (src.length > lim.maxBufferChars) fail("XML_BUFFER", "markup_too_long");
        markup = src;
        carry = "";
        break;
      }
      const full = src.slice(0, found + 1);
      carry = src.slice(found + 1);
      markup = "";
      mode = "text";
      processMarkup(full);
    }
  }

  return {
    get stats() {
      return { depth, elements, maxDepthObserved, carry: carry.length };
    },
    /**
     * @param {Buffer|Uint8Array|string} chunk
     */
    write(chunk) {
      checkRuntime();
      const str = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      feedString(str);
    },
    end() {
      checkRuntime();
      const tail = decoder.decode();
      if (tail) feedString(tail);
      if (mode !== "text" || markup) fail("XML_PARSE", "premature_eof");
      if (carry.trim()) emitText(carry);
      carry = "";
      if (depth !== 0) fail("XML_PARSE", "unclosed");
      closed = true;
      if (handlers.onEnd) handlers.onEnd();
    },
  };
}

export { localName, prefixOf };
