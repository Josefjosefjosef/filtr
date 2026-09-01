/**
 * Promote document meta CSP → HTTP Content-Security-Policy.
 * Canonical policy source remains the HTML meta tag (updated by
 * scripts/iu-csp-apply-script-hashes-v1.mjs). Edge adds HTTP-only
 * frame-ancestors to match X-Frame-Options: SAMEORIGIN.
 */

export const IU_CSP_EDGE_MARKER = "meta-promoted-v1";
export const FRAME_ANCESTORS_SELF = "frame-ancestors 'self'";

/**
 * EXT-HDR-PERM-01 — minimal Permissions-Policy for public HTML documents.
 *
 * Inventory-backed:
 * - geolocation=(self): weather GPS (iu-app-feed-pipeline) — first-party only
 * - clipboard-read=(): app never reads clipboard (write-only + execCommand copy)
 * - camera/microphone/payment/usb/serial/bluetooth/hid=(): unused
 * - browsing-topics/interest-cohort=(): privacy Topics/FLoC not used
 *
 * Intentionally omitted (defaults preserved for real features / YouTube embeds):
 * clipboard-write, autoplay, accelerometer, gyroscope, picture-in-picture,
 * encrypted-media, fullscreen.
 */
export const PERMISSIONS_POLICY_VALUE = [
  "camera=()",
  "microphone=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "hid=()",
  "geolocation=(self)",
  "clipboard-read=()",
  "browsing-topics=()",
  "interest-cohort=()",
].join(", ");

/** Apply Permissions-Policy once; never duplicate / overwrite an existing value. */
export function ensurePermissionsPolicy(headers: Headers, value = PERMISSIONS_POLICY_VALUE): void {
  if (headers.has("Permissions-Policy")) return;
  headers.set("Permissions-Policy", value);
}

/** Extract Content-Security-Policy from a meta http-equiv tag (multiline OK). */
export function extractMetaCsp(html: string): string | null {
  const equivIdx = html.search(/http-equiv\s*=\s*["']Content-Security-Policy["']/i);
  if (equivIdx < 0) return null;

  // Find the opening <meta for THIS http-equiv (walk back; avoid earlier meta tags).
  const back = html.slice(Math.max(0, equivIdx - 300), equivIdx);
  const openRel = back.toLowerCase().lastIndexOf("<meta");
  if (openRel < 0) return null;
  const tagStart = Math.max(0, equivIdx - 300) + openRel;
  const after = html.slice(tagStart, tagStart + 16000);
  const endRel = after.indexOf(">");
  if (endRel < 0) return null;
  const tag = after.slice(0, endRel + 1);
  if (!/http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag)) return null;

  const contentMatch = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!contentMatch) return null;
  const normalized = contentMatch[2].replace(/\s+/g, " ").trim();
  return normalized || null;
}

/** Ensure HTTP-only frame-ancestors is present without duplicating. */
export function ensureFrameAncestors(csp: string, value = FRAME_ANCESTORS_SELF): string {
  const compact = String(csp || "").replace(/\s+/g, " ").trim();
  if (!compact) return value;
  if (/frame-ancestors\s+/i.test(compact)) return compact;
  return compact.replace(/;?\s*$/, "") + "; " + value;
}

export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return /text\/html/i.test(contentType);
}

/**
 * Paths that serve HTML documents for the public site.
 * Assets/API/JSON are excluded so Worker only wraps document responses.
 */
export function isHtmlDocumentPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/index.html") return true;
  if (pathname === "/statistiky" || pathname.startsWith("/statistiky/")) return true;
  if (pathname === "/zdroje-a-licence" || pathname.startsWith("/zdroje-a-licence/")) return true;
  if (pathname === "/bot" || pathname.startsWith("/bot/")) return true;
  return false;
}

/**
 * Clone an HTML origin response and set Content-Security-Policy from meta.
 * Always attach Permissions-Policy on HTML documents (EXT-HDR-PERM-01).
 * If meta CSP is missing, still apply Permissions-Policy (fail-open for CSP only).
 */
export async function promoteHtmlCsp(response: Response): Promise<Response> {
  if (!isHtmlContentType(response.headers.get("content-type"))) {
    return response;
  }

  const buf = await response.arrayBuffer();
  const headBytes = Math.min(buf.byteLength, 96 * 1024);
  const headText = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, headBytes));
  const metaCsp = extractMetaCsp(headText);
  const headers = new Headers(response.headers);
  ensurePermissionsPolicy(headers);

  if (metaCsp) {
    headers.set("Content-Security-Policy", ensureFrameAncestors(metaCsp));
    headers.set("x-iu-csp-edge", IU_CSP_EDGE_MARKER);
  }

  return new Response(buf, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
