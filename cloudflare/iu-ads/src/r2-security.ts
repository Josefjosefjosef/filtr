/** Creative / document upload security allowlists (Etapa 1 foundation). */

export const CREATIVE_MIME_ALLOW = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const DOCUMENT_MIME_ALLOW = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/json",
]);

export const FORBIDDEN_MIME = new Set([
  "text/html",
  "application/javascript",
  "text/javascript",
  "image/svg+xml",
  "application/xhtml+xml",
]);

export const MAX_CREATIVE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const MAGIC: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF....WEBP
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

export function detectMagicMime(buf: Uint8Array): string | null {
  for (const m of MAGIC) {
    if (buf.length < m.bytes.length) continue;
    let ok = true;
    for (let i = 0; i < m.bytes.length; i++) {
      if (buf[i] !== m.bytes[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (m.mime === "image/webp") {
      // RIFF....WEBP
      if (buf.length < 12) return null;
      const tag = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
      if (tag !== "WEBP") return null;
    }
    return m.mime;
  }
  return null;
}

export type UploadValidationResult =
  | { ok: true; mime: string }
  | { ok: false; reason: string };

export function validateUploadObject(opts: {
  purpose: "creative" | "document";
  declaredMime: string;
  filename: string;
  byteLength: number;
  content: Uint8Array;
}): UploadValidationResult {
  const declared = String(opts.declaredMime || "").toLowerCase().trim();
  const name = String(opts.filename || "").toLowerCase();
  if (FORBIDDEN_MIME.has(declared)) return { ok: false, reason: "forbidden_mime" };
  if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".js") || name.endsWith(".svg")) {
    return { ok: false, reason: "forbidden_extension" };
  }
  const max = opts.purpose === "creative" ? MAX_CREATIVE_BYTES : MAX_DOCUMENT_BYTES;
  if (opts.byteLength <= 0 || opts.byteLength > max) return { ok: false, reason: "size_limit" };
  const magic = detectMagicMime(opts.content);
  if (!magic) {
    // allow text/json documents without binary magic
    if (opts.purpose === "document" && (declared === "text/plain" || declared === "application/json")) {
      return { ok: true, mime: declared };
    }
    return { ok: false, reason: "magic_mismatch" };
  }
  const allow = opts.purpose === "creative" ? CREATIVE_MIME_ALLOW : DOCUMENT_MIME_ALLOW;
  if (!allow.has(magic)) return { ok: false, reason: "mime_not_allowed" };
  if (declared && declared !== magic && !(declared === "image/jpg" && magic === "image/jpeg")) {
    return { ok: false, reason: "declared_mime_mismatch" };
  }
  return { ok: true, mime: magic };
}

/** Build opaque object keys — never put client codes / emails in keys. */
export function buildObjectKey(parts: {
  kind: "creative" | "document" | "backup";
  id: string;
  version: number;
  ext: string;
}): string {
  const ext = parts.ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const id = parts.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "obj";
  return parts.kind + "/" + id + "/v" + String(parts.version) + "." + ext;
}
