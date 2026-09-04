/**
 * Promote document meta CSP → HTTP Content-Security-Policy.
 * Canonical policy source remains the HTML meta tag (updated by
 * scripts/iu-csp-apply-script-hashes-v1.mjs). Edge adds HTTP-only
 * frame-ancestors to match X-Frame-Options: SAMEORIGIN.
 *
 * EXT-CSP-SECONDARY-01: path-scoped minimal CSP for first-party secondary
 * HTML that has no meta CSP (offline / bot / zdroje-a-licence).
 */

export const IU_CSP_EDGE_MARKER = "meta-promoted-v1";
export const IU_CSP_SECONDARY_EDGE_MARKER = "secondary-v1";
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

/**
 * Exact sha256 of offline.html inline <script> body (no attrs).
 * Guard fails if offline.html script drifts without updating this constant.
 */
export const OFFLINE_INLINE_SCRIPT_SHA256 =
  "sha256-1PVur2yZYBQRvFvdt/52Tnb5q0UG7UA2TnrjjxtV2pU=";

/**
 * Exact sha256 of projekty zdroje-a-licence inline type=module script body.
 */
export const ZDROJE_INLINE_MODULE_SHA256 =
  "sha256-utP47or9WHGFUDOBx6M+rFC7+ZG4DPnjGcpkUff2Jcg=";

/** Minimal CSP: offline SW fallback — one hashed inline script + inline CSS. */
export const CSP_OFFLINE_HTML = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src '" + OFFLINE_INLINE_SCRIPT_SHA256 + "'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
].join("; ");

/**
 * Minimal CSP: crawler contact page.
 * script-src 'self' allows Cloudflare same-origin email-decode inject only.
 */
export const CSP_BOT_HTML = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
].join("; ");

/** Minimal CSP: legal sources registry page (hashed module + self JSON fetch). */
export const CSP_ZDROJE_HTML = [
  "default-src 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src '" + ZDROJE_INLINE_MODULE_SHA256 + "'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'self'",
  "worker-src 'none'",
  "manifest-src 'none'",
].join("; ");

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
  if (pathname === "/offline.html") return true;
  if (pathname === "/statistiky" || pathname.startsWith("/statistiky/")) return true;
  if (pathname === "/zdroje-a-licence" || pathname.startsWith("/zdroje-a-licence/")) return true;
  if (pathname === "/gdpr-a-vop" || pathname.startsWith("/gdpr-a-vop/")) return true;
  if (pathname === "/bot" || pathname.startsWith("/bot/")) return true;
  return false;
}

/** Path-scoped secondary CSP when document has no meta CSP. */
export function secondaryCspForPath(pathname: string): string | null {
  if (pathname === "/offline.html") return CSP_OFFLINE_HTML;
  if (pathname === "/bot" || pathname === "/bot/" || pathname === "/bot/index.html") {
    return CSP_BOT_HTML;
  }
  if (
    pathname === "/zdroje-a-licence" ||
    pathname === "/zdroje-a-licence/" ||
    pathname === "/zdroje-a-licence/index.html"
  ) {
    return CSP_ZDROJE_HTML;
  }
  return null;
}

/**
 * Clone an HTML origin response and set Content-Security-Policy from meta
 * or path-scoped secondary policy (EXT-CSP-SECONDARY-01).
 * Always attach Permissions-Policy on HTML documents (EXT-HDR-PERM-01).
 */
export async function promoteHtmlCsp(
  response: Response,
  pathname = "/"
): Promise<Response> {
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
    // Do not overwrite an existing origin/edge CSP.
    if (!headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", ensureFrameAncestors(metaCsp));
      headers.set("x-iu-csp-edge", IU_CSP_EDGE_MARKER);
    }
  } else {
    const secondary = secondaryCspForPath(pathname);
    if (secondary && !headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", secondary);
      headers.set("x-iu-csp-edge", IU_CSP_SECONDARY_EDGE_MARKER);
    }
  }

  return new Response(buf, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
