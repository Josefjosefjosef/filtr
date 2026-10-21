/** Offline RFC822/MIME parser for FORPSI ingest (no remote fetch, bounded memory). */
import { createHash } from "node:crypto";

export const MIME_PARSE_LIMITS = Object.freeze({
  maxMessageBytes: 512 * 1024,
  maxPartBytes: 256 * 1024,
  maxParts: 64,
  maxMimeDepth: 8,
  maxHeaderBytes: 32 * 1024,
  maxProcessingMs: 30_000,
});

const CHARSET_ALIASES = {
  "windows-1250": "windows-1250",
  "cp1250": "windows-1250",
  "iso-8859-2": "iso-8859-2",
  "latin2": "iso-8859-2",
  utf8: "utf-8",
};

export function normalizeCharset(charset) {
  const c = String(charset || "utf-8")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "");
  return CHARSET_ALIASES[c] || c;
}

export function decodeEncodedWord(value) {
  const s = String(value || "");
  return s.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_m, cs, enc, payload) => {
    try {
      const charset = normalizeCharset(cs);
      if (enc.toUpperCase() === "B") {
        const bytes = Buffer.from(payload, "base64");
        return new TextDecoder(charset, { fatal: false }).decode(bytes);
      }
      const qpBytes = decodeQuotedPrintableToBuffer(payload.replace(/_/g, " "));
      return new TextDecoder(charset, { fatal: false }).decode(qpBytes);
    } catch {
      return payload;
    }
  });
}

/** Quoted-printable → raw bytes (RFC 2045). */
export function decodeQuotedPrintableToBuffer(input) {
  const src = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "latin1");
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === 0x3d) {
      if (i + 1 < src.length && src[i + 1] === 0x0d && src[i + 2] === 0x0a) {
        i += 2;
        continue;
      }
      if (i + 1 < src.length && src[i + 1] === 0x0a) {
        i += 1;
        continue;
      }
      if (i + 2 < src.length) {
        const hex = src.slice(i + 1, i + 3).toString("ascii");
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          out.push(parseInt(hex, 16));
          i += 2;
          continue;
        }
      }
    }
    out.push(c);
  }
  return Buffer.from(out);
}

export function decodePartBodyToBuffer(body, encoding) {
  const enc = String(encoding || "7bit").toLowerCase();
  if (enc === "base64") {
    return Buffer.from(String(body).replace(/\s+/g, ""), "base64");
  }
  if (enc === "quoted-printable") {
    return decodeQuotedPrintableToBuffer(body);
  }
  return Buffer.from(String(body), "latin1");
}

export function decodePartBody(body, encoding, charset = "utf-8") {
  const bytes = decodePartBodyToBuffer(body, encoding);
  const cs = normalizeCharset(charset);
  try {
    return new TextDecoder(cs, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

const NAMED_HTML_ENTITIES = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  oacute: "ó",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  yacute: "ý",
  uacute: "ú",
  scaron: "š",
  ccaron: "č",
  rcaron: "ř",
  zcaron: "ž",
  yuml: "ý",
  ouml: "ö",
  uuml: "ü",
};

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&([a-z]+);/gi, (_m, name) => NAMED_HTML_ENTITIES[name.toLowerCase()] || _m)
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
}

function parseHeaders(headerBlock) {
  const lines = String(headerBlock || "").split(/\r?\n/);
  const headers = {};
  let current = null;
  for (const line of lines) {
    if (/^\s/.test(line) && current) {
      headers[current] += " " + line.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    current = line.slice(0, idx).trim().toLowerCase();
    headers[current] = line.slice(idx + 1).trim();
  }
  for (const k of Object.keys(headers)) {
    headers[k] = decodeEncodedWord(headers[k]);
  }
  return headers;
}

function splitHeadersBody(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "latin1");
  const sep = buf.indexOf("\r\n\r\n");
  const sepAlt = sep >= 0 ? sep : buf.indexOf("\n\n");
  if (sepAlt < 0) return { headers: parseHeaders(buf.toString("latin1")), body: "" };
  const headerBlock = buf.slice(0, sepAlt).toString("latin1");
  const bodyStart = sepAlt + (sep >= 0 ? 4 : 2);
  const body = buf.slice(bodyStart).toString("latin1");
  return { headers: parseHeaders(headerBlock), body };
}

function parseContentType(value) {
  const main = String(value || "text/plain").split(";")[0].trim().toLowerCase();
  const params = {};
  for (const part of String(value || "").split(";").slice(1)) {
    const m = part.match(/^\s*([^=]+)=["']?([^"']+)["']?\s*$/);
    if (m) params[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return { type: main, params };
}

function isBlockingMimeWarning(w) {
  return (
    w === "mime_depth_exceeded" ||
    w === "max_parts_exceeded" ||
    w === "mime_processing_timeout" ||
    w === "multipart_missing_boundary" ||
    w.startsWith("part_too_large:")
  );
}

function walkMultipart(body, contentType, depth, limits, startedAt, out) {
  if (depth > limits.maxMimeDepth) {
    out.warnings.push("mime_depth_exceeded");
    return;
  }
  if (Date.now() - startedAt > limits.maxProcessingMs) {
    out.warnings.push("mime_processing_timeout");
    return;
  }
  const boundary = contentType.params.boundary;
  if (!boundary) {
    out.warnings.push("multipart_missing_boundary");
    return;
  }
  const parts = body.split(new RegExp("--" + boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\r?\\n|$)"));
  for (const part of parts) {
    if (!part || part === "--" || part.startsWith("--")) continue;
    if (out.parts.length >= limits.maxParts) {
      out.warnings.push("max_parts_exceeded");
      break;
    }
    let { headers, body: partBody } = splitHeadersBody(part);
    partBody = partBody.replace(/\r?\n--[^\r\n]+--\s*$/g, "").trimEnd();
    if (Buffer.byteLength(partBody, "latin1") > limits.maxPartBytes) {
      out.warnings.push("part_too_large:" + (headers["content-type"] || "unknown"));
      continue;
    }
    ingestLeafOrNested(headers, partBody, depth + 1, limits, startedAt, out);
  }
}

function ingestLeafOrNested(headers, body, depth, limits, startedAt, out) {
  const ct = parseContentType(headers["content-type"]);
  const disp = String(headers["content-disposition"] || "").toLowerCase();
  const isAttachment = disp.includes("attachment") || (disp.includes("filename") && !ct.type.startsWith("text/"));
  if (ct.type.startsWith("multipart/")) {
    walkMultipart(body, ct, depth, limits, startedAt, out);
    return;
  }
  const filename =
    (disp.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i) || [])[1] ||
    (ct.params.name ? decodeEncodedWord(ct.params.name) : null);
  const charset = normalizeCharset(ct.params.charset || "utf-8");
  const decoded = decodePartBody(body, headers["content-transfer-encoding"], charset);
  const partRec = {
    contentType: ct.type,
    charset,
    filename: filename ? decodeEncodedWord(filename) : null,
    sizeBytes: Buffer.byteLength(decoded, "utf8"),
    isAttachment,
  };
  out.parts.push(partRec);
  if (isAttachment) {
    out.attachmentNames.push(partRec.filename || "unnamed");
    out.attachmentBytesTotal += partRec.sizeBytes;
    return;
  }
  if (ct.type === "text/plain" && !out.bodyText) out.bodyText = decoded;
  if (ct.type === "text/html" && !out.bodyHtml) out.bodyHtml = decodeHtmlEntities(decoded);
}

/**
 * Parse raw RFC822/MIME into structured fields for classification (never executes content).
 */
export function parseRawMimeMessage(rawInput, limits = MIME_PARSE_LIMITS) {
  const startedAt = Date.now();
  const rawBuf = Buffer.isBuffer(rawInput) ? rawInput : Buffer.from(String(rawInput), "latin1");
  const sizeBytes = rawBuf.length;
  const out = {
    ok: true,
    sizeBytes,
    subject: null,
    from: null,
    to: null,
    date: null,
    messageId: null,
    bodyText: "",
    bodyHtml: "",
    attachmentNames: [],
    attachmentBytesTotal: 0,
    parts: [],
    warnings: [],
    rejectReason: null,
    contentSha256: createHash("sha256").update(rawBuf).digest("hex"),
  };
  if (sizeBytes > limits.maxMessageBytes) {
    out.ok = false;
    out.rejectReason = "message_too_large";
    return out;
  }
  const { headers, body } = splitHeadersBody(rawBuf);
  out.subject = headers.subject || null;
  out.from = headers.from || null;
  out.to = headers.to || null;
  out.date = headers.date || null;
  out.messageId = headers["message-id"] || null;
  const rootCt = parseContentType(headers["content-type"]);
  if (rootCt.type.startsWith("multipart/")) {
    walkMultipart(body, rootCt, 0, limits, startedAt, out);
  } else {
    ingestLeafOrNested(headers, body, 0, limits, startedAt, out);
  }
  if (!out.bodyText && out.bodyHtml) {
    out.bodyText = out.bodyHtml.replace(/<[^>]+>/g, " ");
  }
  if (out.warnings.some(isBlockingMimeWarning)) {
    out.ok = false;
    out.rejectReason = out.warnings.find(isBlockingMimeWarning) || "mime_rejected";
  }
  if (Date.now() - startedAt > limits.maxProcessingMs) {
    out.ok = false;
    out.rejectReason = "mime_processing_timeout";
  }
  return out;
}
