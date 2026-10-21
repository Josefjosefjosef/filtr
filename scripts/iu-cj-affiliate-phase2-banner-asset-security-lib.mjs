/** Static banner asset security (offline buffers + URL guards). No public upload. */
import { assertFetchAllowed } from "./iu-cj-affiliate-phase2-offer-landing-lib.mjs";

export const BANNER_ASSET_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxWidth: 2000,
  maxHeight: 2000,
});

const ALLOWED_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

export function rejectActiveScriptOrHtmlCreative(source) {
  const s = String(source || "").trim();
  if (!s) return { ok: true, reason: "empty" };
  if (/<script[\s>]|javascript:|onerror\s*=|onload\s*=|<iframe/i.test(s)) {
    return { ok: false, reason: "executable_or_html_creative" };
  }
  if (/\.html?([?#]|$)/i.test(s)) {
    return { ok: false, reason: "html_creative_url" };
  }
  if (s.startsWith("data:text/html") || s.startsWith("data:text/javascript")) {
    return { ok: false, reason: "data_uri_script_or_html" };
  }
  return { ok: true, reason: "ok" };
}

export function sniffImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "gif";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function extensionMatchesSniff(url, sniff) {
  if (!sniff) return false;
  try {
    const path = new URL(String(url)).pathname.toLowerCase();
    const ext = path.slice(path.lastIndexOf("."));
    if (!ALLOWED_IMAGE_EXT.has(ext)) return sniff === "jpeg" && (ext === ".jpg" || ext === ".jpeg");
    if (ext === ".jpg" || ext === ".jpeg") return sniff === "jpeg";
    if (ext === ".png") return sniff === "png";
    if (ext === ".gif") return sniff === "gif";
    if (ext === ".webp") return sniff === "webp";
    return false;
  } catch {
    return false;
  }
}

export function validateBannerImageBuffer(buffer, options = {}) {
  const maxBytes = options.maxBytes ?? BANNER_ASSET_LIMITS.maxBytes;
  if (!Buffer.isBuffer(buffer)) {
    return { ok: false, reason: "missing_buffer" };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, reason: "file_too_large", bytes: buffer.length };
  }
  const sniff = sniffImageFormat(buffer);
  if (!sniff) {
    return { ok: false, reason: "unrecognized_image_magic" };
  }
  return { ok: true, format: sniff, bytes: buffer.length };
}

export async function validateBannerImageSourceUrl(url, options = {}) {
  const scriptGate = rejectActiveScriptOrHtmlCreative(url);
  if (!scriptGate.ok) return scriptGate;
  const gate = await assertFetchAllowed(url, {
    allowedHostSuffixes: options.allowedHostSuffixes,
  });
  if (!gate.ok) {
    return { ok: false, reason: "ssrf_or_host_blocked", detail: gate.reason };
  }
  try {
    const path = new URL(String(url)).pathname.toLowerCase();
    const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
    if (ext && !ALLOWED_IMAGE_EXT.has(ext)) {
      return { ok: false, reason: "extension_not_allowed", ext };
    }
  } catch {
    return { ok: false, reason: "invalid_image_url" };
  }
  return { ok: true, reason: "ok", host: gate.host };
}
